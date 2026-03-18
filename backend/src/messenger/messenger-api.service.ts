import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../common/redis.module';
import { GenericTemplate, QuickReply } from './bot-session.types';
import Redis from 'ioredis';

/**
 * MessengerApiService (A.6 — Fixed: CR-04, HI-01)
 *
 * CR-04: PAGE_ACCESS_TOKEN sent via Authorization Bearer header (not URL query param)
 * HI-01: SMS fallback wired to NotificationsService.sendSms() via Redis queue
 */
@Injectable()
export class MessengerApiService {
  private readonly logger = new Logger(MessengerApiService.name);
  private readonly BASE   = 'https://graph.facebook.com/v18.0/me/messages';

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async sendText(psid: string, text: string): Promise<void> {
    await this.post({ recipient: { id: psid }, message: { text } }, psid);
  }

  async sendTemplate(psid: string, template: GenericTemplate): Promise<void> {
    await this.post({
      recipient: { id: psid },
      message: { attachment: { type: 'template', payload: template } },
    }, psid);
  }

  async sendQuickReplies(psid: string, text: string, qrs: QuickReply[]): Promise<void> {
    await this.post({
      recipient: { id: psid },
      message: { text, quick_replies: qrs },
    }, psid);
  }

  async markSeen(psid: string): Promise<void> {
    await this.post({ recipient: { id: psid }, sender_action: 'mark_seen' }, psid);
  }

  async typingOn(psid: string): Promise<void> {
    await this.post({ recipient: { id: psid }, sender_action: 'typing_on' }, psid);
  }

  async typingOff(psid: string): Promise<void> {
    await this.post({ recipient: { id: psid }, sender_action: 'typing_off' }, psid);
  }

  // ── CR-04 fix: Token in Authorization header, NOT URL query param ─────────
  private async post(body: object, psidForFallback?: string): Promise<void> {
    const token = this.config.get<string>('meta.pageAccessToken');
    if (!token) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is not configured');
      return;
    }

    try {
      const res = await fetch(this.BASE, {          // ← No ?access_token= in URL
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,       // ← Token in header
        },
        body: JSON.stringify(body),
      });

      const data = await res.json() as any;

      if (data.error) {
        this.logger.error('Meta Send API error', { code: data.error.code, msg: data.error.message });

        // Error 200 = permission error → trigger SMS fallback
        if (data.error.code === 200 && psidForFallback) {
          await this.triggerSmsFallback(psidForFallback, body);
        }
        // Error 10 or 190 = token invalid — log critical
        if (data.error.code === 10 || data.error.code === 190) {
          this.logger.error('CRITICAL: META_PAGE_ACCESS_TOKEN invalid or expired — renew in Meta Developer Portal');
        }
      }
    } catch (error: any) {
      this.logger.error('Failed to call Meta Send API', error?.message);
      if (psidForFallback) await this.triggerSmsFallback(psidForFallback, body);
    }
  }

  /**
   * HI-01 fix: SMS fallback — push to Redis queue for NotificationsService to process.
   * Avoids circular dependency by using Redis as the message bus.
   */
  private async triggerSmsFallback(psid: string, originalBody: object): Promise<void> {
    this.logger.warn(`Messenger delivery failed for PSID ${psid} — queuing SMS fallback`);
    try {
      await this.redis.lpush('sms:fallback:queue', JSON.stringify({
        psid,
        bodyType: this.inferBodyType(originalBody),
        queuedAt: new Date().toISOString(),
      }));
    } catch (e: any) {
      this.logger.error('Failed to queue SMS fallback', e?.message);
    }
  }

  private inferBodyType(body: any): string {
    if (body?.message?.text) return 'text';
    if (body?.message?.attachment?.type === 'template') return 'template';
    if (body?.sender_action) return body.sender_action;
    return 'unknown';
  }
}
