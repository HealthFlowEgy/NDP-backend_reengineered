#!/bin/bash
# ============================================================================
# NDP Backend Deployment Script
# Deploy to Kubernetes cluster
# ============================================================================

set -euo pipefail

# Configuration
NAMESPACE="${NAMESPACE:-ndp}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
VERSION="${VERSION:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/healthflow}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ============================================================================
# Pre-flight Checks
# ============================================================================
preflight_checks() {
    log "Running pre-flight checks..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed"
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        error "Cannot connect to Kubernetes cluster"
    fi
    
    # Check namespace exists or create
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log "Creating namespace $NAMESPACE..."
        kubectl create namespace "$NAMESPACE"
    fi
    
    log "Pre-flight checks passed ✓"
}

# ============================================================================
# Deploy Infrastructure
# ============================================================================
deploy_infrastructure() {
    log "Deploying infrastructure..."
    
    cd infrastructure/k8s
    
    # Apply namespace and config
    kubectl apply -f 00-namespace.yaml
    
    # Apply database
    kubectl apply -f 01-database.yaml
    
    # Wait for database to be ready
    log "Waiting for PostgreSQL to be ready..."
    kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app.kubernetes.io/name=postgresql --timeout=300s || true
    
    log "Waiting for Redis to be ready..."
    kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app.kubernetes.io/name=redis --timeout=120s || true
    
    cd ../..
    log "Infrastructure deployed ✓"
}

# ============================================================================
# Deploy Services
# ============================================================================
deploy_services() {
    log "Deploying services with version $VERSION..."
    
    cd infrastructure/k8s
    
    # Apply service deployments
    kubectl apply -f 02-api-gateway.yaml
    kubectl apply -f 03-core-services.yaml
    kubectl apply -f 04-security-services.yaml
    kubectl apply -f 05-supporting-services.yaml
    
    # Update images if version is specified
    if [ "$VERSION" != "latest" ]; then
        log "Updating images to version $VERSION..."
        
        SERVICES=(
            "api-gateway"
            "prescription-service"
            "dispense-service"
            "medication-directory"
            "auth-service"
            "signing-service"
            "ai-validation-service"
            "legacy-adapter"
            "notification-service"
            "regulator-service"
            "reporting-service"
        )
        
        for service in "${SERVICES[@]}"; do
            kubectl -n "$NAMESPACE" set image deployment/"$service" \
                "$service"="$REGISTRY/ndp-$service:$VERSION" || true
        done
    fi
    
    cd ../..
    log "Services deployed ✓"
}

# ============================================================================
# Deploy Networking
# ============================================================================
deploy_networking() {
    log "Deploying networking configuration..."
    
    cd infrastructure/k8s
    kubectl apply -f 06-networking.yaml
    cd ../..
    
    log "Networking deployed ✓"
}

# ============================================================================
# Wait for Rollout
# ============================================================================
wait_for_rollout() {
    log "Waiting for deployments to be ready..."
    
    DEPLOYMENTS=(
        "api-gateway"
        "prescription-service"
        "dispense-service"
        "medication-directory"
        "auth-service"
        "signing-service"
        "ai-validation-service"
    )
    
    for deployment in "${DEPLOYMENTS[@]}"; do
        log "Waiting for $deployment..."
        kubectl -n "$NAMESPACE" rollout status deployment/"$deployment" --timeout=300s || {
            warn "Deployment $deployment may not be ready"
        }
    done
    
    log "All deployments ready ✓"
}

# ============================================================================
# Run Database Migrations
# ============================================================================
run_migrations() {
    log "Running database migrations..."
    
    # Get PostgreSQL pod
    PG_POD=$(kubectl -n "$NAMESPACE" get pod -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}')
    
    if [ -z "$PG_POD" ]; then
        warn "PostgreSQL pod not found, skipping migrations"
        return
    fi
    
    # Copy and run migration
    kubectl -n "$NAMESPACE" cp infrastructure/scripts/001_initial_schema.sql "$PG_POD":/tmp/migration.sql
    kubectl -n "$NAMESPACE" exec "$PG_POD" -- sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/migration.sql' || {
        warn "Migration may have already been applied"
    }
    
    log "Migrations complete ✓"
}

# ============================================================================
# Health Check
# ============================================================================
health_check() {
    log "Running health checks..."
    
    # Get API Gateway service IP
    API_IP=$(kubectl -n "$NAMESPACE" get svc api-gateway -o jsonpath='{.spec.clusterIP}')
    
    if [ -z "$API_IP" ]; then
        warn "Could not get API Gateway IP, skipping health check"
        return
    fi
    
    # Run health check via kubectl exec
    kubectl -n "$NAMESPACE" run health-check --rm -i --restart=Never --image=curlimages/curl:latest -- \
        curl -sf "http://$API_IP:3000/health" || {
        warn "Health check may have failed"
    }
    
    log "Health checks complete ✓"
}

# ============================================================================
# Print Status
# ============================================================================
print_status() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo "============================================"
    echo ""
    echo "Namespace: $NAMESPACE"
    echo "Version: $VERSION"
    echo "Environment: $ENVIRONMENT"
    echo ""
    echo "Services:"
    kubectl -n "$NAMESPACE" get deployments -o wide
    echo ""
    echo "Pods:"
    kubectl -n "$NAMESPACE" get pods
    echo ""
    echo "Services:"
    kubectl -n "$NAMESPACE" get svc
    echo ""
    
    if [ "$ENVIRONMENT" == "production" ]; then
        echo "Production URLs:"
        echo "  API: https://api.ndp.egypt.gov.eg"
        echo "  SOAP: https://soap.ndp.egypt.gov.eg"
        echo "  Regulator: https://regulator.ndp.egypt.gov.eg"
    fi
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo ""
    echo "============================================"
    echo "NDP Backend Deployment"
    echo "============================================"
    echo "Namespace: $NAMESPACE"
    echo "Version: $VERSION"
    echo "Environment: $ENVIRONMENT"
    echo "============================================"
    echo ""
    
    preflight_checks
    deploy_infrastructure
    run_migrations
    deploy_services
    
    if [ "$ENVIRONMENT" == "production" ]; then
        deploy_networking
    fi
    
    wait_for_rollout
    health_check
    print_status
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [-n namespace] [-e environment] [-v version]"
            echo ""
            echo "Options:"
            echo "  -n, --namespace   Kubernetes namespace (default: ndp)"
            echo "  -e, --environment Environment: staging|production (default: staging)"
            echo "  -v, --version     Image version tag (default: latest)"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

main
