import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from './bot-session.service';
import { MessengerApiService } from './messenger-api.service';
import { PostbackHandler } from './handlers/postback.handler';
import { TextHandler } from './handlers/text.handler';
import { QuickReplyHandler } from './handlers/quick-reply.handler';
import { OptinHandler } from './handlers/optin.handler';

/**
 * MessengerBotService (A.1 — Central Bot Brain / Dispatcher)
 *
 * Routes incoming Messenger webhook events to the appropriate handler
 * based on event type: postback, message (text), quick_reply, or optin.
 */
@Injectable()
export class MessengerBotService {
  private readonly logger = new Logger(MessengerBotService.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messengerApi: MessengerApiService,
    private readonly postbackHandler: PostbackHandler,
    private readonly textHandler: TextHandler,
    private readonly quickReplyHandler: QuickReplyHandler,
    private readonly optinHandler: OptinHandler,
  ) {}

  /**
   * Process a single Messenger webhook event entry.
   * Called from the webhooks controller for each messaging event.
   */
  async processEvent(event: any): Promise<void> {
    const psid = event.sender?.id;
    if (!psid) {
      this.logger.warn('Received event without sender PSID');
      return;
    }

    try {
      // 1. Optin / GET_STARTED
      if (event.optin) {
        await this.optinHandler.handle(psid, event.optin.ref);
        return;
      }

      // 2. Postback (CTA button clicks)
      if (event.postback) {
        const payload = event.postback.payload;

        // GET_STARTED is a special postback
        if (payload === 'GET_STARTED') {
          await this.optinHandler.handle(psid, event.postback.referral?.ref);
          return;
        }

        await this.postbackHandler.handle(psid, payload);
        return;
      }

      // 3. Message events
      if (event.message) {
        // 3a. Quick reply
        if (event.message.quick_reply) {
          await this.quickReplyHandler.handle(
            psid,
            event.message.quick_reply.payload,
          );
          return;
        }

        // 3b. Text message
        if (event.message.text) {
          const session = await this.sessionService.getSession(psid);
          await this.textHandler.handle(psid, event.message.text, session);
          return;
        }

        // 3c. Attachments (images for dispute evidence)
        if (event.message.attachments) {
          await this.handleAttachments(psid, event.message.attachments);
          return;
        }
      }

      this.logger.debug(`Unhandled event type for PSID ${psid}`);
    } catch (error) {
      this.logger.error(
        `Error processing event for PSID ${psid}`,
        error,
      );
      await this.messengerApi.sendText(
        psid,
        'Sorry, something went wrong. Please try again or type "help".',
      );
    }
  }

  /**
   * Handle image/file attachments (e.g., dispute evidence uploads).
   */
  private async handleAttachments(
    psid: string,
    attachments: any[],
  ): Promise<void> {
    const session = await this.sessionService.getSession(psid);

    if (session.state === 'AWAITING_EVIDENCE') {
      const imageUrls = attachments
        .filter((a: any) => a.type === 'image')
        .map((a: any) => a.payload?.url)
        .filter(Boolean);

      if (imageUrls.length > 0) {
        // TODO: Upload to S3 and attach to dispute
        await this.messengerApi.sendText(
          psid,
          `✅ Received ${imageUrls.length} image(s) as evidence. Our team will review your dispute within 72 hours.`,
        );
        return;
      }
    }

    await this.messengerApi.sendText(
      psid,
      'I received your attachment. If you need help, type "help" or start a deal with "deal".',
    );
  }
}
