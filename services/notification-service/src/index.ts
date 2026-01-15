/**
 * Notification Service
 * SMS, Email, Push, and WhatsApp notifications
 * National Digital Prescription Platform - Egypt
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';

import { loadConfig } from '../../../shared/config/index.js';
import { createLogger, generateUUID } from '../../../shared/utils/index.js';
import { NDPError, ErrorCodes } from '../../../shared/types/ndp.types.js';

const config = loadConfig('notification-service');
const logger = createLogger('notification-service', config.logLevel);

// ============================================================================
// Configuration
// ============================================================================

const SMS_CONFIG = {
  provider: process.env['SMS_PROVIDER'] || 'vodafone', // vodafone, orange, etisalat
  apiUrl: process.env['SMS_API_URL'] || '',
  apiKey: process.env['SMS_API_KEY'] || '',
  senderId: process.env['SMS_SENDER_ID'] || 'NDP-EGYPT',
  enabled: process.env['SMS_ENABLED'] === 'true',
};

const EMAIL_CONFIG = {
  provider: process.env['EMAIL_PROVIDER'] || 'smtp',
  smtpHost: process.env['SMTP_HOST'] || 'smtp.gmail.com',
  smtpPort: parseInt(process.env['SMTP_PORT'] || '587'),
  smtpUser: process.env['SMTP_USER'] || '',
  smtpPassword: process.env['SMTP_PASSWORD'] || '',
  fromEmail: process.env['FROM_EMAIL'] || 'noreply@ndp.egypt.gov.eg',
  fromName: process.env['FROM_NAME'] || 'National Digital Prescription',
  enabled: process.env['EMAIL_ENABLED'] === 'true',
};

const WHATSAPP_CONFIG = {
  apiUrl: process.env['WHATSAPP_API_URL'] || '',
  apiKey: process.env['WHATSAPP_API_KEY'] || '',
  phoneNumberId: process.env['WHATSAPP_PHONE_ID'] || '',
  enabled: process.env['WHATSAPP_ENABLED'] === 'true',
};

const PUSH_CONFIG = {
  fcmServerKey: process.env['FCM_SERVER_KEY'] || '',
  enabled: process.env['PUSH_ENABLED'] === 'true',
};

// ============================================================================
// Types
// ============================================================================

type NotificationChannel = 'sms' | 'email' | 'whatsapp' | 'push';
type NotificationType = 
  | 'prescription_created'
  | 'prescription_signed'
  | 'prescription_dispensed'
  | 'prescription_cancelled'
  | 'prescription_expiring'
  | 'medication_recalled'
  | 'dispense_reminder'
  | 'verification_code'
  | 'custom';

interface NotificationRequest {
  type: NotificationType;
  channel: NotificationChannel | NotificationChannel[];
  recipient: {
    nationalId?: string;
    phone?: string;
    email?: string;
    pushToken?: string;
    name?: string;
  };
  data: Record<string, any>;
  template?: string;
  priority?: 'low' | 'normal' | 'high';
  scheduledAt?: string;
}

interface NotificationResult {
  notificationId: string;
  channel: NotificationChannel;
  status: 'sent' | 'queued' | 'failed' | 'disabled';
  sentAt?: string;
  error?: string;
  externalId?: string;
}

interface NotificationRecord {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  recipientId?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  content: string;
  externalId?: string;
  error?: string;
  createdAt: Date;
  sentAt?: Date;
  deliveredAt?: Date;
}

// ============================================================================
// Notification Templates
// ============================================================================

const TEMPLATES: Record<NotificationType, Record<string, { subject?: string; body: string; bodyAr?: string }>> = {
  prescription_created: {
    sms: {
      body: 'Your prescription {prescriptionNumber} has been created by Dr. {physicianName}. Valid until {expiryDate}.',
      bodyAr: 'تم إنشاء الروشتة {prescriptionNumber} بواسطة د. {physicianName}. صالحة حتى {expiryDate}.',
    },
    email: {
      subject: 'New Prescription Created - {prescriptionNumber}',
      body: `Dear {patientName},

Your prescription {prescriptionNumber} has been created by Dr. {physicianName}.

Medications:
{medicationList}

This prescription is valid until {expiryDate}.

Please visit any authorized pharmacy to collect your medications.

National Digital Prescription Platform
Ministry of Health - Egypt`,
    },
    whatsapp: {
      body: '✅ *New Prescription*\n\nPrescription: {prescriptionNumber}\nDoctor: {physicianName}\nValid until: {expiryDate}\n\nVisit any authorized pharmacy to collect.',
    },
  },
  
  prescription_signed: {
    sms: {
      body: 'Prescription {prescriptionNumber} has been digitally signed and is now active. You can collect your medications.',
      bodyAr: 'تم توقيع الروشتة {prescriptionNumber} رقميًا وهي الآن نشطة. يمكنك الحصول على أدويتك.',
    },
    email: {
      subject: 'Prescription Signed - {prescriptionNumber}',
      body: `Dear {patientName},

Your prescription {prescriptionNumber} has been digitally signed and is now active.

You can collect your medications from any authorized pharmacy.

National Digital Prescription Platform`,
    },
  },
  
  prescription_dispensed: {
    sms: {
      body: 'Prescription {prescriptionNumber} dispensed at {pharmacyName}. Remaining dispenses: {remainingDispenses}.',
      bodyAr: 'تم صرف الروشتة {prescriptionNumber} في {pharmacyName}. المتبقي: {remainingDispenses} مرة.',
    },
    email: {
      subject: 'Prescription Dispensed - {prescriptionNumber}',
      body: `Dear {patientName},

Your prescription {prescriptionNumber} has been dispensed.

Pharmacy: {pharmacyName}
Dispensed by: {pharmacistName}
Date: {dispenseDate}
Items dispensed: {itemCount}
Remaining dispenses: {remainingDispenses}

National Digital Prescription Platform`,
    },
  },
  
  prescription_cancelled: {
    sms: {
      body: 'Prescription {prescriptionNumber} has been cancelled. Reason: {reason}. Please contact your doctor if needed.',
    },
    email: {
      subject: 'Prescription Cancelled - {prescriptionNumber}',
      body: `Dear {patientName},

Your prescription {prescriptionNumber} has been cancelled.

Reason: {reason}

If you have any questions, please contact your healthcare provider.

National Digital Prescription Platform`,
    },
  },
  
  prescription_expiring: {
    sms: {
      body: 'Reminder: Prescription {prescriptionNumber} expires on {expiryDate}. {remainingDispenses} dispenses remaining.',
    },
    email: {
      subject: 'Prescription Expiring Soon - {prescriptionNumber}',
      body: `Dear {patientName},

This is a reminder that your prescription {prescriptionNumber} will expire on {expiryDate}.

Remaining dispenses: {remainingDispenses}

Please visit a pharmacy before the expiry date to collect your medications.

National Digital Prescription Platform`,
    },
  },
  
  medication_recalled: {
    sms: {
      body: 'ALERT: {medicationName} has been recalled. If you have this medication, please return it to the pharmacy. Contact your doctor for alternatives.',
    },
    email: {
      subject: 'URGENT: Medication Recall Notice - {medicationName}',
      body: `Dear {patientName},

IMPORTANT: A medication you may have received has been recalled.

Medication: {medicationName}
Batch Numbers: {batchNumbers}
Recall Reason: {recallReason}

ACTION REQUIRED:
1. Stop using this medication immediately
2. Return unused medication to your pharmacy
3. Contact your doctor for an alternative prescription

National Digital Prescription Platform`,
    },
  },
  
  dispense_reminder: {
    sms: {
      body: 'Reminder: You have an active prescription {prescriptionNumber}. {remainingDispenses} dispenses remaining.',
    },
  },
  
  verification_code: {
    sms: {
      body: 'Your NDP verification code is: {code}. Valid for {validMinutes} minutes. Do not share this code.',
      bodyAr: 'رمز التحقق الخاص بك: {code}. صالح لمدة {validMinutes} دقيقة. لا تشارك هذا الرمز.',
    },
    email: {
      subject: 'Verification Code - NDP',
      body: `Your verification code is: {code}

This code is valid for {validMinutes} minutes.

If you did not request this code, please ignore this message.

National Digital Prescription Platform`,
    },
  },
  
  custom: {
    sms: { body: '{message}' },
    email: { subject: '{subject}', body: '{message}' },
    whatsapp: { body: '{message}' },
    push: { body: '{message}' },
  },
};

// ============================================================================
// Template Renderer
// ============================================================================

function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return data[key]?.toString() || match;
  });
}

function getTemplate(type: NotificationType, channel: NotificationChannel, data: Record<string, any>): {
  subject?: string;
  body: string;
} {
  const typeTemplates = TEMPLATES[type];
  const channelTemplate = typeTemplates?.[channel];
  
  if (!channelTemplate) {
    throw new NDPError(
      ErrorCodes.INVALID_REQUEST,
      `No template found for type '${type}' and channel '${channel}'`,
      400
    );
  }
  
  return {
    subject: channelTemplate.subject ? renderTemplate(channelTemplate.subject, data) : undefined,
    body: renderTemplate(data.useArabic && channelTemplate.bodyAr ? channelTemplate.bodyAr : channelTemplate.body, data),
  };
}

// ============================================================================
// Channel Providers
// ============================================================================

// SMS Provider
async function sendSMS(phone: string, message: string): Promise<{ success: boolean; externalId?: string; error?: string }> {
  if (!SMS_CONFIG.enabled) {
    logger.info('SMS disabled, skipping', { phone: phone.slice(-4) });
    return { success: true, externalId: 'disabled' };
  }
  
  // Format Egyptian phone number
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '2' + formattedPhone;
  } else if (!formattedPhone.startsWith('20')) {
    formattedPhone = '20' + formattedPhone;
  }
  
  try {
    // Simulated SMS API call
    // In production, integrate with Vodafone/Orange/Etisalat SMS gateway
    logger.info('Sending SMS', { 
      phone: formattedPhone.slice(-4), 
      messageLength: message.length,
      provider: SMS_CONFIG.provider 
    });
    
    if (SMS_CONFIG.apiUrl) {
      const response = await fetch(SMS_CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SMS_CONFIG.apiKey}`,
        },
        body: JSON.stringify({
          to: formattedPhone,
          message,
          senderId: SMS_CONFIG.senderId,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`SMS API error: ${response.status}`);
      }
      
      const result = await response.json();
      return { success: true, externalId: result.messageId };
    }
    
    // Mock success for development
    return { success: true, externalId: `sms-${generateUUID().slice(0, 8)}` };
  } catch (error) {
    logger.error('SMS send error', error);
    return { success: false, error: (error as Error).message };
  }
}

// Email Provider
async function sendEmail(
  to: string, 
  subject: string, 
  body: string,
  recipientName?: string
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  if (!EMAIL_CONFIG.enabled) {
    logger.info('Email disabled, skipping', { to });
    return { success: true, externalId: 'disabled' };
  }
  
  try {
    logger.info('Sending email', { to, subject });
    
    // In production, use nodemailer or SendGrid/Mailgun
    // For now, simulate success
    
    return { success: true, externalId: `email-${generateUUID().slice(0, 8)}` };
  } catch (error) {
    logger.error('Email send error', error);
    return { success: false, error: (error as Error).message };
  }
}

// WhatsApp Provider (Meta Business API)
async function sendWhatsApp(
  phone: string, 
  message: string,
  templateName?: string
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  if (!WHATSAPP_CONFIG.enabled) {
    logger.info('WhatsApp disabled, skipping', { phone: phone.slice(-4) });
    return { success: true, externalId: 'disabled' };
  }
  
  try {
    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '20' + formattedPhone.slice(1);
    }
    
    logger.info('Sending WhatsApp', { phone: formattedPhone.slice(-4) });
    
    if (WHATSAPP_CONFIG.apiUrl) {
      const response = await fetch(WHATSAPP_CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WHATSAPP_CONFIG.apiKey}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'text',
          text: { body: message },
        }),
      });
      
      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${response.status}`);
      }
      
      const result = await response.json();
      return { success: true, externalId: result.messages?.[0]?.id };
    }
    
    return { success: true, externalId: `wa-${generateUUID().slice(0, 8)}` };
  } catch (error) {
    logger.error('WhatsApp send error', error);
    return { success: false, error: (error as Error).message };
  }
}

// Push Notification Provider (FCM)
async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  if (!PUSH_CONFIG.enabled) {
    logger.info('Push notifications disabled, skipping');
    return { success: true, externalId: 'disabled' };
  }
  
  try {
    logger.info('Sending push notification', { tokenPrefix: token.slice(0, 10) });
    
    if (PUSH_CONFIG.fcmServerKey) {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${PUSH_CONFIG.fcmServerKey}`,
        },
        body: JSON.stringify({
          to: token,
          notification: { title, body },
          data,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`FCM error: ${response.status}`);
      }
      
      const result = await response.json();
      return { success: result.success === 1, externalId: result.multicast_id?.toString() };
    }
    
    return { success: true, externalId: `push-${generateUUID().slice(0, 8)}` };
  } catch (error) {
    logger.error('Push notification error', error);
    return { success: false, error: (error as Error).message };
  }
}

// ============================================================================
// Notification Service
// ============================================================================

// In-memory store (use Redis/DB in production)
const notificationStore: Map<string, NotificationRecord> = new Map();

class NotificationService {
  async send(request: NotificationRequest): Promise<NotificationResult[]> {
    const channels = Array.isArray(request.channel) ? request.channel : [request.channel];
    const results: NotificationResult[] = [];
    
    for (const channel of channels) {
      const result = await this.sendToChannel(channel, request);
      results.push(result);
      
      // Store notification record
      const record: NotificationRecord = {
        id: result.notificationId,
        type: request.type,
        channel,
        recipientId: request.recipient.nationalId,
        recipientPhone: request.recipient.phone,
        recipientEmail: request.recipient.email,
        status: result.status === 'sent' ? 'sent' : 'failed',
        content: '', // Populated below
        externalId: result.externalId,
        error: result.error,
        createdAt: new Date(),
        sentAt: result.status === 'sent' ? new Date() : undefined,
      };
      notificationStore.set(record.id, record);
    }
    
    return results;
  }
  
  private async sendToChannel(channel: NotificationChannel, request: NotificationRequest): Promise<NotificationResult> {
    const notificationId = generateUUID();
    
    try {
      // Get template and render
      const template = getTemplate(request.type, channel, {
        ...request.data,
        patientName: request.recipient.name,
      });
      
      let result: { success: boolean; externalId?: string; error?: string };
      
      switch (channel) {
        case 'sms':
          if (!request.recipient.phone) {
            return { notificationId, channel, status: 'failed', error: 'Phone number required for SMS' };
          }
          result = await sendSMS(request.recipient.phone, template.body);
          break;
          
        case 'email':
          if (!request.recipient.email) {
            return { notificationId, channel, status: 'failed', error: 'Email address required' };
          }
          result = await sendEmail(
            request.recipient.email,
            template.subject || 'NDP Notification',
            template.body,
            request.recipient.name
          );
          break;
          
        case 'whatsapp':
          if (!request.recipient.phone) {
            return { notificationId, channel, status: 'failed', error: 'Phone number required for WhatsApp' };
          }
          result = await sendWhatsApp(request.recipient.phone, template.body);
          break;
          
        case 'push':
          if (!request.recipient.pushToken) {
            return { notificationId, channel, status: 'failed', error: 'Push token required' };
          }
          result = await sendPushNotification(
            request.recipient.pushToken,
            template.subject || 'NDP',
            template.body,
            request.data as Record<string, string>
          );
          break;
          
        default:
          return { notificationId, channel, status: 'failed', error: `Unknown channel: ${channel}` };
      }
      
      if (result.success) {
        logger.info('Notification sent', { 
          notificationId, 
          channel, 
          type: request.type,
          externalId: result.externalId 
        });
        return {
          notificationId,
          channel,
          status: 'sent',
          sentAt: new Date().toISOString(),
          externalId: result.externalId,
        };
      } else {
        return {
          notificationId,
          channel,
          status: 'failed',
          error: result.error,
        };
      }
    } catch (error) {
      logger.error('Notification error', error, { channel, type: request.type });
      return {
        notificationId,
        channel,
        status: 'failed',
        error: (error as Error).message,
      };
    }
  }
  
  async getNotification(id: string): Promise<NotificationRecord | null> {
    return notificationStore.get(id) || null;
  }
  
  async getNotificationsByRecipient(nationalId: string, limit: number = 20): Promise<NotificationRecord[]> {
    const records: NotificationRecord[] = [];
    for (const record of notificationStore.values()) {
      if (record.recipientId === nationalId) {
        records.push(record);
      }
    }
    return records.slice(0, limit);
  }
}

const notificationService = new NotificationService();

// ============================================================================
// Routes
// ============================================================================

const SendNotificationSchema = z.object({
  type: z.enum([
    'prescription_created', 'prescription_signed', 'prescription_dispensed',
    'prescription_cancelled', 'prescription_expiring', 'medication_recalled',
    'dispense_reminder', 'verification_code', 'custom'
  ]),
  channel: z.union([
    z.enum(['sms', 'email', 'whatsapp', 'push']),
    z.array(z.enum(['sms', 'email', 'whatsapp', 'push']))
  ]),
  recipient: z.object({
    nationalId: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    pushToken: z.string().optional(),
    name: z.string().optional(),
  }),
  data: z.record(z.any()),
  template: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  scheduledAt: z.string().optional(),
});

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'notification-service',
    channels: {
      sms: SMS_CONFIG.enabled,
      email: EMAIL_CONFIG.enabled,
      whatsapp: WHATSAPP_CONFIG.enabled,
      push: PUSH_CONFIG.enabled,
    },
    timestamp: new Date().toISOString(),
  });
});

// Send notification
router.post('/api/notifications/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = SendNotificationSchema.safeParse(req.body);
    if (!validation.success) {
      throw new NDPError(
        ErrorCodes.INVALID_REQUEST,
        validation.error.errors.map(e => e.message).join('; '),
        400
      );
    }
    
    const results = await notificationService.send(validation.data);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

// Send prescription notification (convenience endpoint)
router.post('/api/notifications/prescription/:event', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = req.params.event as NotificationType;
    const { recipient, prescription, ...data } = req.body;
    
    const results = await notificationService.send({
      type: event.startsWith('prescription_') ? event : `prescription_${event}` as NotificationType,
      channel: ['sms', 'email'],
      recipient,
      data: { ...prescription, ...data },
    });
    
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

// Send verification code
router.post('/api/notifications/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email, code, validMinutes = 5 } = req.body;
    
    if (!phone && !email) {
      throw new NDPError(ErrorCodes.INVALID_REQUEST, 'Phone or email required', 400);
    }
    
    const channels: NotificationChannel[] = [];
    if (phone) channels.push('sms');
    if (email) channels.push('email');
    
    const results = await notificationService.send({
      type: 'verification_code',
      channel: channels,
      recipient: { phone, email },
      data: { code, validMinutes },
    });
    
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

// Get notification by ID
router.get('/api/notifications/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await notificationService.getNotification(req.params.id!);
    if (!record) {
      throw new NDPError(ErrorCodes.NOT_FOUND, 'Notification not found', 404);
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

// Get notifications by recipient
router.get('/api/notifications/recipient/:nationalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await notificationService.getNotificationsByRecipient(
      req.params.nationalId!,
      parseInt(req.query.limit as string) || 20
    );
    res.json(records);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Error Handler
// ============================================================================

function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Notification error', error);

  if (error instanceof NDPError) {
    return res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  logger.info('Starting Notification Service', { env: config.env, port: config.port });

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json());
  app.use('/', router);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`Notification Service listening on port ${config.port}`);
    logger.info('Enabled channels:', {
      sms: SMS_CONFIG.enabled,
      email: EMAIL_CONFIG.enabled,
      whatsapp: WHATSAPP_CONFIG.enabled,
      push: PUSH_CONFIG.enabled,
    });
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(error => {
  logger.error('Failed to start service', error);
  process.exit(1);
});

export { notificationService };
