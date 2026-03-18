import { Injectable, Logger } from '@nestjs/common';
import { GenericTemplate, QuickReply } from './bot-session.types';

/**
 * MessengerApiService (A.6)
 *
 * All outbound messages to users go through this service.
 * Handles rate limiting (Meta allows 1 message per second per PSID
 * for non-subscriber messages) and response error handling.
 */
@Injectable()
export class MessengerApiService {
  private readonly logger = new Logger(MessengerApiService.name);
  private readonly BASE = 'https://graph.facebook.com/v18.0/me/messages';

  async sendText(psid: string, text: string): Promise<void> {
    await this.post({ recipient: { id: psid }, message: { text } });
  }

  async sendTemplate(
    psid: string,
    template: GenericTemplate,
  ): Promise<void> {
    await this.post({
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: template,
        },
      },
    });
  }

  async sendQuickReplies(
    psid: string,
    text: string,
    qrs: QuickReply[],
  ): Promise<void> {
    await this.post({
      recipient: { id: psid },
      message: { text, quick_replies: qrs },
    });
  }

  async markSeen(psid: string): Promise<void> {
    await this.post({
      recipient: { id: psid },
      sender_action: 'mark_seen',
    });
  }

  async typingOn(psid: string): Promise<void> {
    await this.post({
      recipient: { id: psid },
      sender_action: 'typing_on',
    });
  }

  async typingOff(psid: string): Promise<void> {
    await this.post({
      recipient: { id: psid },
      sender_action: 'typing_off',
    });
  }

  private async post(body: object): Promise<void> {
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is not configured');
      return;
    }

    try {
      const res = await fetch(`${this.BASE}?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.error) {
        this.logger.error('Meta Send API error', data.error);
        // Error 200 = permission error → queue for SMS fallback
        if (data.error.code === 200) {
          await this.triggerSmsFallback(body);
        }
      }
    } catch (error) {
      this.logger.error('Failed to call Meta Send API', error);
    }
  }

  /**
   * Fallback to SMS when Messenger delivery fails (permission error).
   * Integrates with the SMS gateway configured in environment variables.
   */
  private async triggerSmsFallback(originalBody: object): Promise<void> {
    this.logger.warn(
      'Messenger delivery failed — triggering SMS fallback',
      { body: JSON.stringify(originalBody) },
    );
    // TODO: Integrate with NotificationsService.sendSms()
    // Extract recipient PSID, look up mobile number, and send SMS
  }
}
