import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from './bot-session.service';
import { MessengerApiService } from './messenger-api.service';
import { TemplateFactory } from './templates/template.factory';
import { PostbackHandler } from './handlers/postback.handler';
import { TextHandler } from './handlers/text.handler';
import { QuickReplyHandler } from './handlers/quick-reply.handler';
import { OptinHandler } from './handlers/optin.handler';
import { BotSessionState } from './bot-session.types';

/**
 * MessengerBotService — Central Bot Brain / Dispatcher
 * CR-08 fix: This is the ONLY MessengerBotService. The duplicate in
 * notifications/ has been removed. All Messenger calls route through here.
 */
@Injectable()
export class MessengerBotService {
  private readonly logger = new Logger(MessengerBotService.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messengerApi: MessengerApiService,
    private readonly templates: TemplateFactory,
    private readonly postbackHandler: PostbackHandler,
    private readonly textHandler: TextHandler,
    private readonly quickReplyHandler: QuickReplyHandler,
    private readonly optinHandler: OptinHandler,
  ) {}

  async processEvent(event: any): Promise<void> {
    // Internal synthetic events (e.g., from delivery webhook)
    if (event._internal) {
      await this.handleInternalEvent(event.sender?.id, event._internal);
      return;
    }

    const psid = event.sender?.id;
    if (!psid) { this.logger.warn('Event without sender PSID'); return; }

    try {
      if (event.optin) {
        await this.optinHandler.handle(psid, event.optin.ref);
        return;
      }

      if (event.postback) {
        const payload = event.postback.payload;
        if (payload === 'GET_STARTED') {
          await this.optinHandler.handle(psid, event.postback.referral?.ref);
          return;
        }
        await this.postbackHandler.handle(psid, payload);
        return;
      }

      if (event.message) {
        if (event.message.quick_reply) {
          await this.quickReplyHandler.handle(psid, event.message.quick_reply.payload);
          return;
        }
        if (event.message.text) {
          const session = await this.sessionService.getSession(psid);
          await this.textHandler.handle(psid, event.message.text, session);
          return;
        }
        if (event.message.attachments) {
          await this.handleAttachments(psid, event.message.attachments);
          return;
        }
      }

      this.logger.debug(`Unhandled event for PSID ${psid}`);
    } catch (error: any) {
      this.logger.error(`Error processing event for PSID ${psid}: ${error.message}`);
      await this.messengerApi.sendText(psid,
        'Sorry, something went wrong. Please try again or type "help".',
      ).catch(() => {});
    }
  }

  /** Send deal proposal template to a PSID (called from deals API after creation) */
  async sendDealProposal(buyerPsid: string, deal: { id: string; amount: number; itemDescription: string; sellerName: string }): Promise<void> {
    await this.messengerApi.sendTemplate(buyerPsid, this.templates.buildDealProposed(deal));
  }

  /** Send escrow active notification (called after deductFromUser succeeds) */
  async sendEscrowActivated(psid: string, deal: { id: string; amount: number; itemDescription: string; waybillUrl?: string }): Promise<void> {
    await this.messengerApi.sendTemplate(psid, this.templates.buildEscrowActive(deal));
  }

  /** Send delivery confirmation request to buyer */
  async sendDeliveryConfirm(buyerPsid: string, deal: { id: string; amount: number; itemDescription: string }): Promise<void> {
    await this.messengerApi.sendTemplate(buyerPsid, this.templates.buildDeliveredConfirm(deal));
  }

  /** Send settlement notification to both parties */
  async sendSettlement(psid: string, deal: { id: string; amount: number; netPayout: number; commission: number }): Promise<void> {
    await this.messengerApi.sendTemplate(psid, this.templates.buildSettled(deal));
  }

  /** Send dispute opened notification */
  async sendDisputeOpened(psid: string, deal: { id: string; disputeId: string; itemDescription: string }): Promise<void> {
    await this.messengerApi.sendTemplate(psid, this.templates.buildDisputed(deal));
  }

  /** Send dispute resolved notification */
  async sendDisputeResolved(psid: string, deal: { id: string; resolution: string; amount: number }): Promise<void> {
    await this.messengerApi.sendTemplate(psid, this.templates.buildResolved(deal));
  }

  private async handleInternalEvent(psid: string | undefined, internal: any): Promise<void> {
    if (!psid) return;
    switch (internal.type) {
      case 'delivery_confirmed':
        const deal = { id: internal.dealId, amount: internal.amount || 0, itemDescription: internal.itemDescription || '' };
        await this.messengerApi.sendTemplate(psid, this.templates.buildDeliveredConfirm(deal));
        break;
      default:
        this.logger.debug(`Unhandled internal event: ${internal.type}`);
    }
  }

  private async handleAttachments(psid: string, attachments: any[]): Promise<void> {
    const session = await this.sessionService.getSession(psid);

    if (session.state === BotSessionState.AWAITING_EVIDENCE) {
      const imageUrls = attachments
        .filter((a: any) => a.type === 'image')
        .map((a: any) => a.payload?.url)
        .filter(Boolean);

      if (imageUrls.length > 0) {
        // Store evidence URLs in session context for dispute
        await this.sessionService.updateSession(psid, {
          context: {
            ...session.context,
            evidenceUrls: [...(session.context.evidenceUrls || []), ...imageUrls],
          },
        });

        await this.messengerApi.sendText(psid,
          `✅ Received ${imageUrls.length} image(s) as evidence.\n\n` +
          `Our admin team will review your dispute within 72 hours. You'll be notified of the resolution.`,
        );
        return;
      }
    }

    await this.messengerApi.sendText(psid,
      'I received your attachment. If this is dispute evidence, please describe your issue first.',
    );
  }
}
