import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { PostbackHandler } from './postback.handler';
import { BotSessionState } from '../bot-session.types';
import { EscrowService } from '../../deals/escrow.service';
import { DisputesService } from '../../disputes/disputes.service';

/**
 * QuickReplyHandler — Fixed: wires CONFIRM_DEAL_WIZARD to EscrowService
 */
@Injectable()
export class QuickReplyHandler {
  private readonly logger = new Logger(QuickReplyHandler.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly postbackHandler: PostbackHandler,
    private readonly escrow: EscrowService,
    private readonly disputes: DisputesService,
  ) {}

  async handle(psid: string, payload: string): Promise<void> {
    this.logger.log(`QuickReply: PSID=${psid} payload=${payload}`);

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
        await this.postbackHandler.handle(psid, payload);
    }
  }

  private async handleConfirmDealWizard(psid: string): Promise<void> {
    // Delegate to text handler's confirm flow by simulating "yes"
    const session = await this.sessionService.getSession(psid);
    if (session.state !== BotSessionState.DEAL_CONFIRM) {
      await this.messenger.sendText(psid, 'No deal to confirm. Type "deal" to start a new one.');
      return;
    }
    // Forward to postback handler which calls TextHandler confirm logic
    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Session expired. Please start again.'); return; }

    try {
      const deal = await this.escrow.initiateDeal(
        user.id,
        session.context.buyerInput || user.id,
        session.context.amount,
        session.context.itemDescription,
      );
      await this.sessionService.updateSession(psid, {
        state: BotSessionState.DEAL_ACTIVE,
        dealId: deal.id,
        context: { ...session.context, dealId: deal.id },
      });
      const appUrl = process.env.FRONTEND_URL || 'https://marketplace.sette.io';
      await this.messenger.sendText(psid,
        `✅ Deal created!\n\nItem: ${deal.itemDescription}\nAmount: EGP ${deal.amount}\n\nShare this pay link with the buyer:\n${appUrl}/deals/${deal.id}/pay`,
      );
    } catch (err: any) {
      await this.messenger.sendText(psid, `Could not create deal: ${err.message}`);
    }
  }

  private async handleEditAmount(psid: string): Promise<void> {
    await this.sessionService.updateSession(psid, { state: BotSessionState.DEAL_SETUP_AMOUNT });
    await this.messenger.sendText(psid, 'Enter the new amount in EGP:');
  }

  private async handleCancelWizard(psid: string): Promise<void> {
    await this.sessionService.clearSession(psid);
    await this.messenger.sendText(psid, 'Deal creation cancelled.');
  }

  private async handleDisputeReason(psid: string, payload: string): Promise<void> {
    const session = await this.sessionService.getSession(psid);
    const reasonMap: Record<string, string> = {
      DISPUTE_NOT_AS_DESCRIBED: 'Item not as described',
      DISPUTE_DAMAGED:          'Item damaged',
      DISPUTE_NOT_RECEIVED:     'Item not received',
      DISPUTE_OTHER:            'Other',
    };
    const reason = reasonMap[payload] || 'Other';

    if (session.context.dealId) {
      try {
        const user = await this.sessionService.getUserByPsid(psid);
        if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

        let disputeId = session.context.disputeId;
        if (!disputeId) {
          const dispute = await this.disputes.raiseDispute(session.context.dealId, user.id);
          disputeId = dispute.id;
        }

        await this.sessionService.updateSession(psid, {
          state: BotSessionState.AWAITING_EVIDENCE,
          context: { ...session.context, disputeReason: reason, disputeId },
        });

        const appUrl = process.env.FRONTEND_URL || 'https://marketplace.sette.io';
        await this.messenger.sendText(psid,
          `Dispute reason: "${reason}"\n\nPlease submit evidence:\n${appUrl}/disputes/${disputeId}/evidence\n\nOr send photos directly in this chat.`,
        );
      } catch (err: any) {
        await this.messenger.sendText(psid, `Could not process dispute: ${err.message}`);
      }
    } else {
      await this.sessionService.updateSession(psid, {
        state: BotSessionState.AWAITING_EVIDENCE,
        context: { ...session.context, disputeReason: reason },
      });
      await this.messenger.sendText(psid, `Dispute reason recorded: "${reason}". Please send evidence.`);
    }
  }
}
