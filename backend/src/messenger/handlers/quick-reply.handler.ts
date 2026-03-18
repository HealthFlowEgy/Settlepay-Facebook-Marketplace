import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { PostbackHandler } from './postback.handler';
import { BotSessionState } from '../bot-session.types';

/**
 * QuickReplyHandler
 *
 * Routes quick reply selections. Most quick replies map directly
 * to postback payloads, so this handler delegates to PostbackHandler.
 */
@Injectable()
export class QuickReplyHandler {
  private readonly logger = new Logger(QuickReplyHandler.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly postbackHandler: PostbackHandler,
  ) {}

  async handle(psid: string, payload: string): Promise<void> {
    this.logger.log(`Quick reply received: PSID=${psid}, payload=${payload}`);

    switch (payload) {
      case 'CONFIRM_DEAL_WIZARD':
        await this.handleConfirmDealWizard(psid);
        break;

      case 'EDIT_AMOUNT':
        await this.handleEditAmount(psid);
        break;

      case 'CANCEL_DEAL_WIZARD':
        await this.handleCancelWizard(psid);
        break;

      case 'DISPUTE_NOT_AS_DESCRIBED':
      case 'DISPUTE_DAMAGED':
      case 'DISPUTE_NOT_RECEIVED':
      case 'DISPUTE_OTHER':
        await this.handleDisputeReason(psid, payload);
        break;

      default:
        // Delegate to postback handler for standard payloads
        await this.postbackHandler.handle(psid, payload);
    }
  }

  private async handleConfirmDealWizard(psid: string): Promise<void> {
    const session = await this.sessionService.getSession(psid);

    if (session.state !== BotSessionState.DEAL_CONFIRM) {
      await this.messenger.sendText(psid, 'No deal to confirm. Start a new deal with "deal" or "صفقة".');
      return;
    }

    // TODO: Call DealsService.createDeal() with session.context
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_ACTIVE,
    });

    await this.messenger.sendText(
      psid,
      `✅ Escrow deal created!\n\nAmount: EGP ${session.context.amount}\nItem: ${session.context.itemDescription}\n\nThe buyer will be notified to pay.`,
    );
  }

  private async handleEditAmount(psid: string): Promise<void> {
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_AMOUNT,
    });
    await this.messenger.sendText(
      psid,
      'Enter the new amount in EGP:',
    );
  }

  private async handleCancelWizard(psid: string): Promise<void> {
    await this.sessionService.clearSession(psid);
    await this.messenger.sendText(psid, 'Deal creation cancelled.');
  }

  private async handleDisputeReason(
    psid: string,
    payload: string,
  ): Promise<void> {
    const session = await this.sessionService.getSession(psid);
    const reasonMap: Record<string, string> = {
      DISPUTE_NOT_AS_DESCRIBED: 'Item not as described',
      DISPUTE_DAMAGED: 'Item damaged',
      DISPUTE_NOT_RECEIVED: 'Item not received',
      DISPUTE_OTHER: 'Other',
    };

    const reason = reasonMap[payload] || 'Unknown';

    // TODO: Create dispute via DisputesService
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.AWAITING_EVIDENCE,
      context: { ...session.context, disputeReason: reason },
    });

    await this.messenger.sendText(
      psid,
      `Dispute reason recorded: "${reason}"\n\nPlease upload evidence (photos/screenshots) to support your claim:\nhttps://app.sette.io/disputes/${session.context.dealId}/evidence`,
    );
  }
}
