import { Request, Response, NextFunction } from 'express';
import { parseSOAPRequest, buildSOAPResponse, buildSOAPFault } from '../utils/soap.utils.js';
import { legacyService, rateLimiter } from '../services/legacy.service.js';
import { FEATURES } from '../config/index.js';
import { createLogger } from '../../../../shared/utils/index.js';

const logger = createLogger('legacy-soap:controller');

export class SOAPController {
  async handleSOAP(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');

    const process = async () => {
      try {
        const { action, body, headers } = await parseSOAPRequest(req.body);
        logger.info('SOAP Action', { action });

        let result: any;
        switch (action) {
          case 'GetPrescription':
            result = await legacyService.getPrescription(body.PrescriptionNumber || body.PrescriptionID);
            break;
          case 'CreatePrescription':
            result = await legacyService.createPrescriptionAsync(body.Prescription || body, headers);
            break;
          case 'GetStatus':
            result = await legacyService.getStatus(body.TrackingID);
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        res.send(buildSOAPResponse(action, result));
      } catch (error: any) {
        logger.error('SOAP Error', error);
        res.status(500).send(buildSOAPFault('Server', error.message));
      }
    };

    if (FEATURES.RATE_LIMITING) {
      rateLimiter.schedule(process).catch(err => {
        res.status(503).send(buildSOAPFault('Server', 'Overloaded'));
      });
    } else {
      process();
    }
  }
}

export const soapController = new SOAPController();
