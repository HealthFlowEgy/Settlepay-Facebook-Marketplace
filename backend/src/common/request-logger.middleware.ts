import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { sanitizeLog } from './log-sanitizer';

const REDACT_PATHS = ['/auth/verify-otp', '/auth/send-otp', '/kyc/verify'];

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const start = Date.now();
    const shouldRedact = REDACT_PATHS.some((p) => originalUrl.includes(p));

    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const color = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '🟢';
      this.logger.log(`${color} ${method} ${originalUrl} ${status} ${ms}ms`);
    });

    if (
      process.env.NODE_ENV !== 'production' &&
      Object.keys(req.body || {}).length > 0
    ) {
      // Always sanitize body through the comprehensive log sanitizer (C.4)
      const body = sanitizeLog(req.body);
      this.logger.debug(`Body: ${JSON.stringify(body)}`);
    }

    next();
  }
}
