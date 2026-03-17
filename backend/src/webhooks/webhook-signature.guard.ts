import {
  CanActivate, ExecutionContext, Injectable,
  UnauthorizedException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req    = context.switchToHttp().getRequest();
    const path   = req.path as string;

    // Determine which secret to use based on path
    let secret: string | undefined;
    let signatureHeader: string | undefined;

    if (path.includes('/healthpay')) {
      secret          = this.config.get<string>('healthpay.webhookSecret');
      signatureHeader = req.headers['x-healthpay-signature'] as string;
    } else if (path.includes('/bosta')) {
      secret          = this.config.get<string>('bosta.webhookSecret');
      signatureHeader = req.headers['x-bosta-signature'] as string;
    } else if (path.includes('/messenger')) {
      // Messenger uses hub.verify_token for GET, app secret for POST
      if (req.method === 'GET') return true; // Handled in controller
      secret          = this.config.get<string>('meta.appSecret');
      signatureHeader = (req.headers['x-hub-signature-256'] as string)?.replace('sha256=', '');
    }

    // If no secret configured, log warning but allow in dev
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(`Webhook secret not configured for path: ${path}`);
        throw new UnauthorizedException('Webhook secret not configured');
      }
      this.logger.warn(`⚠️  No webhook secret for ${path} — allowing in dev mode`);
      return true;
    }

    // If signature not provided
    if (!signatureHeader) {
      this.logger.warn(`Missing webhook signature on ${path}`);
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Missing webhook signature');
      }
      return true; // Allow in dev
    }

    // Compute expected signature
    const rawBody  = req.rawBody || JSON.stringify(req.body);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    try {
      const sigBuf = Buffer.from(signatureHeader, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('Signature mismatch');
      }
    } catch {
      this.logger.warn(`Invalid webhook signature on ${path}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
