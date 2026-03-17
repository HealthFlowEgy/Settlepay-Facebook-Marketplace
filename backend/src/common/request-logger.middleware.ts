import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const REDACT_PATHS = ['/auth/verify-otp', '/auth/send-otp', '/kyc/verify'];
const SENSITIVE_FIELDS = ['otp', 'password', 'nationalId', 'apiKey', 'token', 'userToken'];

function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const result = { ...body };
  for (const field of SENSITIVE_FIELDS) {
    if (field in result) result[field] = '[REDACTED]';
  }
  return result;
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const start = Date.now();
    const shouldRedact = REDACT_PATHS.some(p => originalUrl.includes(p));

    res.on('finish', () => {
      const ms     = Date.now() - start;
      const status = res.statusCode;
      const color  = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '🟢';
      this.logger.log(`${color} ${method} ${originalUrl} ${status} ${ms}ms`);
    });

    if (process.env.NODE_ENV !== 'production' && Object.keys(req.body || {}).length > 0) {
      const body = shouldRedact ? sanitizeBody(req.body) : req.body;
      this.logger.debug(`Body: ${JSON.stringify(body)}`);
    }

    next();
  }
}
