# NDP Gap Implementation Deployment Guide

## 📋 Overview

This guide covers deploying the infrastructure gaps identified in the architecture validation:

| Gap | Component | Purpose |
|-----|-----------|---------|
| **Apache Kafka** | Event Streaming | Async event-driven architecture |
| **PgBouncer** | Connection Pooling | 10,000+ concurrent DB connections |
| **Elasticsearch** | Audit Logging | Centralized audit trail & search |
| **Prometheus + Grafana** | Monitoring | Metrics, alerts, dashboards |

---

## 🚀 Quick Deployment

### Deploy All Gaps at Once

```bash
# From repository root
kubectl apply -f infrastructure/k8s/07-kafka.yaml
kubectl apply -f infrastructure/k8s/08-elasticsearch.yaml
kubectl apply -f infrastructure/k8s/09-pgbouncer.yaml
kubectl apply -f infrastructure/k8s/10-monitoring.yaml
```

### Verify Deployment

```bash
# Check all namespaces
kubectl get pods -n ndp-kafka
kubectl get pods -n ndp-logging
kubectl get pods -n ndp
kubectl get pods -n ndp-monitoring
```

---

## 1️⃣ Apache Kafka Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    KAFKA CLUSTER                            │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Zookeeper-0 │  │ Zookeeper-1 │  │ Zookeeper-2 │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                │                │                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Kafka-0    │  │  Kafka-1    │  │  Kafka-2    │        │
│  │ (Broker)    │  │ (Broker)    │  │ (Broker)    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  Topics:                                                    │
│  • ndp.prescription.events (6 partitions, RF=3)            │
│  • ndp.dispense.events (6 partitions, RF=3)                │
│  • ndp.medication.events (3 partitions, RF=3)              │
│  • ndp.notification.events (6 partitions, RF=3)            │
│  • ndp.audit.events (6 partitions, RF=3)                   │
│  • ndp.dead-letter (3 partitions, RF=3)                    │
└─────────────────────────────────────────────────────────────┘
```

### Deploy

```bash
kubectl apply -f infrastructure/k8s/07-kafka.yaml

# Wait for Zookeeper
kubectl -n ndp-kafka wait --for=condition=ready pod -l app.kubernetes.io/name=zookeeper --timeout=300s

# Wait for Kafka
kubectl -n ndp-kafka wait --for=condition=ready pod -l app.kubernetes.io/name=kafka --timeout=300s
```

### Verify

```bash
# Check cluster status
kubectl -n ndp-kafka exec kafka-0 -- kafka-metadata.sh --snapshot /var/lib/kafka/data/__cluster_metadata-0/00000000000000000000.log --command "describe"

# List topics
kubectl -n ndp-kafka exec kafka-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --list

# Create topics manually (if auto-create is disabled)
kubectl -n ndp-kafka exec kafka-0 -- kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic ndp.prescription.events --partitions 6 --replication-factor 3
```

### Kafka UI

```bash
# Port forward to access Kafka UI
kubectl -n ndp-kafka port-forward svc/kafka-ui 8080:8080

# Access at http://localhost:8080
```

### Configuration for Services

```yaml
# Add to service environment variables
env:
  - name: KAFKA_BROKERS
    value: "kafka-0.kafka-headless.ndp-kafka:9092,kafka-1.kafka-headless.ndp-kafka:9092,kafka-2.kafka-headless.ndp-kafka:9092"
  - name: KAFKA_CLIENT_ID
    value: "prescription-service"
```

---

## 2️⃣ PgBouncer Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PGBOUNCER CLUSTER                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ PgBouncer-0 │  │ PgBouncer-1 │  │ PgBouncer-2 │        │
│  │  (Active)   │  │  (Active)   │  │  (Active)   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         └────────────────┼────────────────┘                │
│                          │                                  │
│              ┌───────────┴───────────┐                     │
│              ▼                       ▼                     │
│       ┌─────────────┐         ┌─────────────┐             │
│       │ PostgreSQL  │         │ PostgreSQL  │             │
│       │  (Primary)  │────────►│  (Replica)  │             │
│       └─────────────┘         └─────────────┘             │
│                                                             │
│  Settings:                                                  │
│  • max_client_conn: 10,000                                 │
│  • default_pool_size: 100                                  │
│  • pool_mode: transaction                                  │
└─────────────────────────────────────────────────────────────┘
```

### Deploy

```bash
kubectl apply -f infrastructure/k8s/09-pgbouncer.yaml

# Wait for PgBouncer
kubectl -n ndp wait --for=condition=ready pod -l app.kubernetes.io/name=pgbouncer --timeout=120s
```

### Update Secrets

```bash
# Generate password hashes for PgBouncer userlist.txt
# Use SCRAM-SHA-256 format

# Example: Generate hash for user 'ndp' with password 'your_password'
kubectl -n ndp exec postgresql-0 -- psql -U postgres -c "SELECT 'ndp' || ' \"' || passwd || '\"' FROM pg_shadow WHERE usename='ndp';"
```

### Configure Services to Use PgBouncer

```yaml
# Update service environment variables
env:
  - name: USE_PGBOUNCER
    value: "true"
  - name: PGBOUNCER_HOST
    value: "pgbouncer"
  - name: PGBOUNCER_PORT
    value: "6432"
  - name: DB_HOST
    value: "pgbouncer"  # Point to PgBouncer instead of PostgreSQL
  - name: DB_PORT
    value: "6432"       # PgBouncer port
```

### Monitoring PgBouncer

```bash
# Check pool stats
kubectl -n ndp exec -it $(kubectl -n ndp get pod -l app.kubernetes.io/name=pgbouncer -o jsonpath='{.items[0].metadata.name}') -- \
  psql -h localhost -p 6432 -U pgbouncer_stats pgbouncer -c "SHOW POOLS;"

# Check client connections
kubectl -n ndp exec -it $(kubectl -n ndp get pod -l app.kubernetes.io/name=pgbouncer -o jsonpath='{.items[0].metadata.name}') -- \
  psql -h localhost -p 6432 -U pgbouncer_stats pgbouncer -c "SHOW CLIENTS;"
```

---

## 3️⃣ Elasticsearch Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  ELASTICSEARCH CLUSTER                      │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │    ES-0     │  │    ES-1     │  │    ES-2     │        │
│  │  (Master/   │  │  (Master/   │  │  (Master/   │        │
│  │   Data)     │  │   Data)     │  │   Data)     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │                    KIBANA                        │       │
│  │  • Dashboards  • Discover  • Visualizations     │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  Indices:                                                   │
│  • ndp-audit-YYYY.MM (monthly rotation)                    │
│  • ILM Policy: hot → warm → cold → delete                  │
│    - Hot: 7 days, 50GB rollover                            │
│    - Warm: 30 days, shrink to 1 shard                      │
│    - Cold: 90 days, freeze                                 │
│    - Delete: 365 days                                      │
└─────────────────────────────────────────────────────────────┘
```

### Deploy

```bash
kubectl apply -f infrastructure/k8s/08-elasticsearch.yaml

# Wait for Elasticsearch
kubectl -n ndp-logging wait --for=condition=ready pod -l app.kubernetes.io/name=elasticsearch --timeout=600s

# Wait for setup job to complete
kubectl -n ndp-logging wait --for=condition=complete job/elasticsearch-setup --timeout=300s
```

### Update Credentials

```bash
# Update the password in the secret
kubectl -n ndp-logging create secret generic elasticsearch-credentials \
  --from-literal=username=elastic \
  --from-literal=password='YOUR_SECURE_PASSWORD' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Configure Services

```yaml
# Add to service environment variables
env:
  - name: ELASTICSEARCH_URL
    value: "http://elasticsearch.ndp-logging:9200"
  - name: ELASTICSEARCH_USERNAME
    value: "elastic"
  - name: ELASTICSEARCH_PASSWORD
    valueFrom:
      secretKeyRef:
        name: elasticsearch-credentials
        key: password
```

### Access Kibana

```bash
# Port forward
kubectl -n ndp-logging port-forward svc/kibana 5601:5601

# Access at http://localhost:5601
# Login: elastic / <your_password>
```

### Create Index Pattern in Kibana

1. Go to Stack Management → Index Patterns
2. Create pattern: `ndp-audit-*`
3. Select `@timestamp` as time field

---

## 4️⃣ Prometheus + Grafana Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   MONITORING STACK                          │
│                                                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │                  PROMETHEUS                      │       │
│  │  • Scrapes /metrics from all services           │       │
│  │  • 30-day retention                             │       │
│  │  • Alert rules for NDP                          │       │
│  └─────────────────────────────────────────────────┘       │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────┐       │
│  │                   GRAFANA                        │       │
│  │  • Pre-built NDP dashboards                     │       │
│  │  • Prometheus + Elasticsearch datasources       │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  Alert Rules:                                               │
│  • HighErrorRate (>5% for 5min)                            │
│  • HighLatency (p95 > 2s)                                  │
│  • ServiceDown (1min)                                      │
│  • DatabaseConnectionPoolExhausted                         │
│  • KafkaConsumerLag (>1000 messages)                       │
│  • DrugRecallIssued (Class I)                              │
└─────────────────────────────────────────────────────────────┘
```

### Deploy

```bash
kubectl apply -f infrastructure/k8s/10-monitoring.yaml

# Wait for Prometheus
kubectl -n ndp-monitoring wait --for=condition=ready pod -l app.kubernetes.io/name=prometheus --timeout=300s

# Wait for Grafana
kubectl -n ndp-monitoring wait --for=condition=ready pod -l app.kubernetes.io/name=grafana --timeout=300s
```

### Update Credentials

```bash
# Update Grafana admin password
kubectl -n ndp-monitoring create secret generic grafana-credentials \
  --from-literal=admin-password='YOUR_SECURE_PASSWORD' \
  --dry-run=client -o yaml | kubectl apply -f -

# Update basic auth for ingress
htpasswd -nb admin 'YOUR_SECURE_PASSWORD' | base64
# Update monitoring-basic-auth secret with the output
```

### Access Dashboards

```bash
# Grafana
kubectl -n ndp-monitoring port-forward svc/grafana 3000:3000
# Access at http://localhost:3000 (admin / <password>)

# Prometheus
kubectl -n ndp-monitoring port-forward svc/prometheus 9090:9090
# Access at http://localhost:9090
```

### Add Prometheus Annotations to Services

```yaml
# Add to pod template metadata
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3001"
    prometheus.io/path: "/metrics"
```

---

## 5️⃣ Application Integration

### Install Dependencies

```bash
npm install kafkajs @elastic/elasticsearch prom-client pg
npm install -D @types/pg
```

### Environment Variables

```bash
# .env or ConfigMap
KAFKA_BROKERS=kafka-0.kafka-headless.ndp-kafka:9092,kafka-1.kafka-headless.ndp-kafka:9092,kafka-2.kafka-headless.ndp-kafka:9092
ELASTICSEARCH_URL=http://elasticsearch.ndp-logging:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your_password
USE_PGBOUNCER=true
PGBOUNCER_HOST=pgbouncer
PGBOUNCER_PORT=6432
```

### Code Integration

```typescript
// Import modules
import { getEventProducer, NDPEventConsumer } from './shared/kafka';
import { getAuditLogger, auditMiddleware } from './shared/elasticsearch';
import { getDatabase } from './shared/database';
import { metricsMiddleware, metricsHandler } from './shared/metrics';

// Initialize
const eventProducer = getEventProducer('my-service');
const auditLogger = getAuditLogger('my-service');
const db = getDatabase('my-service', { usePgBouncer: true });

// Use middleware
app.use(metricsMiddleware('my-service'));
app.use(auditMiddleware());
app.get('/metrics', metricsHandler);

// Publish events
await eventProducer.publishPrescriptionCreated(payload);

// Log audit
await auditLogger.logPrescriptionAccess('create', id, userId, 'success');

// Query database via PgBouncer
const result = await db.query('SELECT * FROM prescriptions WHERE id = $1', [id]);
```

---

## 📊 Monitoring URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| **Grafana** | https://monitoring.ndp.egypt.gov.eg | admin / secret |
| **Prometheus** | https://prometheus.ndp.egypt.gov.eg | admin / secret |
| **Kibana** | http://kibana.ndp-logging:5601 (internal) | elastic / secret |
| **Kafka UI** | http://kafka-ui.ndp-kafka:8080 (internal) | - |

---

## 🔧 Troubleshooting

### Kafka Issues

```bash
# Check broker logs
kubectl -n ndp-kafka logs kafka-0

# Check consumer lag
kubectl -n ndp-kafka exec kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --describe --all-groups

# Reset consumer offset
kubectl -n ndp-kafka exec kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --group my-group --reset-offsets --to-earliest --execute --topic my-topic
```

### PgBouncer Issues

```bash
# Check logs
kubectl -n ndp logs -l app.kubernetes.io/name=pgbouncer

# Check stats
kubectl -n ndp exec -it pgbouncer-xxx -- psql -p 6432 -U pgbouncer_stats pgbouncer -c "SHOW STATS;"
```

### Elasticsearch Issues

```bash
# Check cluster health
kubectl -n ndp-logging exec elasticsearch-0 -- curl -s localhost:9200/_cluster/health?pretty

# Check indices
kubectl -n ndp-logging exec elasticsearch-0 -- curl -s localhost:9200/_cat/indices?v
```

### Prometheus Issues

```bash
# Check targets
kubectl -n ndp-monitoring port-forward svc/prometheus 9090:9090
# Visit http://localhost:9090/targets

# Check alerts
# Visit http://localhost:9090/alerts
```

---

## ✅ Verification Checklist

- [ ] Kafka cluster healthy (3 brokers)
- [ ] Zookeeper ensemble running (3 nodes)
- [ ] PgBouncer accepting connections
- [ ] Elasticsearch cluster green
- [ ] Kibana accessible
- [ ] Prometheus scraping targets
- [ ] Grafana dashboards loading
- [ ] Services publishing events to Kafka
- [ ] Audit logs appearing in Elasticsearch
- [ ] Metrics visible in Prometheus

---

**Deployment Complete!** 🎉
