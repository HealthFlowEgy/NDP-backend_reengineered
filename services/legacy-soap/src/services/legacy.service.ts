import Redis from 'ioredis';
import CircuitBreaker from 'opossum';
import Bottleneck from 'bottleneck';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { getEventProducer } from '../../../../shared/kafka/index.js';
import { generateUUID, createLogger } from '../../../../shared/utils/index.js';
import { SERVICE_NAME, FEATURES, SERVICES } from '../config/index.js';
import { convertFHIRToLegacy } from '../utils/soap.utils.js';

const logger = createLogger('legacy-soap:service');

// HTTP Pooling
const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

// Rate Limiter
export const rateLimiter = new Bottleneck({
  maxConcurrent: 100,
  minTime: 10,
  reservoir: 1000,
  reservoirRefreshInterval: 1000,
  reservoirRefreshAmount: 1000,
});

// Redis
let redis: Redis | null = null;
if (FEATURES.CACHING) {
  redis = new Redis(process.env['REDIS_URL'] || 'redis://redis:6379', { lazyConnect: true });
}

// Kafka
const eventProducer = getEventProducer(SERVICE_NAME);

export class LegacyService {
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor() {
    this.initBreakers();
  }

  private initBreakers() {
    const callBackend = async (url: string, method: string = 'GET', body?: any) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        // @ts-expect-error - Agent property is missing in fetch types but works in node-fetch/undici
      });
      if (!response.ok) throw new Error(`Backend Error: ${response.status}`);
      return response.json();
    };

    if (FEATURES.CIRCUIT_BREAKER) {
      this.breakers.set('backend', new CircuitBreaker(callBackend, { timeout: 10000 }));
    }
  }

  async connect() {
    if (FEATURES.ASYNC_PROCESSING) await eventProducer.connect();
    if (redis && FEATURES.CACHING) await redis.connect();
  }

  async disconnect() {
    if (FEATURES.ASYNC_PROCESSING) await eventProducer.disconnect();
    if (redis) await redis.quit();
  }

  async getPrescription(identifier: string) {
    const cacheKey = `legacy:prescription:${identifier}`;
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return { Prescription: JSON.parse(cached), Source: 'CACHE' };
    }

    const url = `${SERVICES.prescription}/fhir/MedicationRequest/${identifier}`;
    const fhir = await this.call('backend', url);
    const legacy = convertFHIRToLegacy(fhir);

    if (redis) await redis.setex(cacheKey, 300, JSON.stringify(legacy));
    return { Prescription: legacy };
  }

  async createPrescriptionAsync(prescription: any, headers: any) {
    const trackingId = generateUUID();
    await eventProducer.publish('prescription.legacy.create' as any, {
      trackingId,
      legacyRequest: prescription,
      receivedAt: new Date().toISOString(),
    });
    return { TrackingID: trackingId, Status: 'ACCEPTED' };
  }

  async getStatus(trackingId: string) {
    if (redis) {
      const status = await redis.get(`legacy:status:${trackingId}`);
      if (status) return JSON.parse(status);
    }
    return { TrackingID: trackingId, Status: 'PROCESSING' };
  }

  private async call(breakerName: string, ...args: any[]) {
    const breaker = this.breakers.get(breakerName);
    if (breaker) return breaker.fire(...args);
    // Fallback to direct call if breaker not found or disabled
    const fn = async (url: string, method: string = 'GET', body?: any) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return response.json();
    };
    // @ts-expect-error - Variadic arguments spread into typed function
  }
}

export const legacyService = new LegacyService();
