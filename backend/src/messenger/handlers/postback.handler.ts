import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { TemplateFactory } from '../templates/template.factory';
import { QuickReplyFactory } from '../templates/quick-reply.factory';
import { BotSessionState } from '../bot-session.types';

/**
 * PostbackHandler (A.8)
 *
 * Every CTA button click sends a postback to POST /webhooks/messenger.
 * The payload string is the contract between templates and handlers.
 *
 * Postback Payload Contract:
 *   GET_STARTED                → Welcome screen / Persistent Menu
 *   LINK_ACCOUNT               → Generate bot:link_token, send account-link URL
 *   START_DEAL                 → Begin DealWizard (DEAL_SETUP_AMOUNT)
 *   PAY_DEAL|{dealId}          → Redirect to PWA checkout
 *   DECLINE_DEAL|{dealId}      → Set deal CANCELLED; notify seller
 *   CONFIRM_DELIVERY|{dealId}  → Trigger EscrowService.releaseEscrow()
 *   RAISE_DISPUTE|{dealId}     → Create Dispute; set AWAITING_DISPUTE_REASON
 *   SUBMIT_EVIDENCE|{disputeId}→ Send webview URL to evidence upload
 *   VIEW_DEAL|{dealId}         → Send deal status summary card
 *   VIEW_RECEIPT|{dealId}      → Send commission breakdown + transaction IDs
 */
@Injectable()
export class PostbackHandler {
  private readonly logger = new Logger(PostbackHandler.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly templates: TemplateFactory,
    private readonly quickReplies: QuickReplyFactory,
  ) {}

  async handle(psid: string, payload: string): Promise<void> {
    this.logger.log(`Postback received: PSID=${psid}, payload=${payload}`);

    await this.messenger.markSeen(psid);
    await this.messenger.typingOn(psid);

    const [action, entityId] = payload.split('|');

    switch (action) {
      case 'GET_STARTED':
        await this.handleGetStarted(psid);
        break;

      case 'LINK_ACCOUNT':
        await this.handleLinkAccount(psid);
        break;

      case 'START_DEAL':
        await this.handleStartDeal(psid);
        break;

      case 'PAY_DEAL':
        await this.handlePayDeal(psid, entityId);
        break;

      case 'DECLINE_DEAL':
        await this.handleDeclineDeal(psid, entityId);
        break;

      case 'CONFIRM_DELIVERY':
        await this.handleConfirmDelivery(psid, entityId);
        break;

      case 'RAISE_DISPUTE':
        await this.handleRaiseDispute(psid, entityId);
        break;

      case 'SUBMIT_EVIDENCE':
        await this.handleSubmitEvidence(psid, entityId);
        break;

      case 'VIEW_DEAL':
        await this.handleViewDeal(psid, entityId);
        break;

      case 'VIEW_RECEIPT':
        await this.handleViewReceipt(psid, entityId);
        break;

      case 'LIST_DEALS':
        await this.handleListDeals(psid);
        break;

      case 'WALLET_BALANCE':
        await this.handleWalletBalance(psid);
        break;

      default:
        this.logger.warn(`Unknown postback payload: ${payload}`);
        await this.messenger.sendText(
          psid,
          "Sorry, I didn't understand that. Type 'help' for available commands.",
        );
    }
  }

  private async handleGetStarted(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);

    if (user) {
      // User already linked
      await this.messenger.sendQuickReplies(
        psid,
        `Welcome back, ${user.firstName}! 🔒 What would you like to do?`,
        this.quickReplies.buildWelcomeOptions(),
      );
    } else {
      // New user — prompt account linking
      await this.messenger.sendText(
        psid,
        'Welcome to SettePay 🔒 — Egypt\'s secure Facebook Marketplace escrow.\n\n' +
          'To get started, you need to link your SettePay account.',
      );
      await this.messenger.sendQuickReplies(psid, 'Would you like to link your account now?', [
        { content_type: 'text', title: '🔗 Link Account', payload: 'LINK_ACCOUNT' },
        { content_type: 'text', title: '📝 Create Account', payload: 'LINK_ACCOUNT' },
      ]);
    }
  }

  private async handleLinkAccount(psid: string): Promise<void> {
    // Generate a one-time link token (15 min TTL in Redis)
    const linkToken = this.generateLinkToken();

    await this.sessionService.updateSession(psid, {
      state: BotSessionState.LINKING_ACCOUNT,
      context: { linkToken },
    });

    const linkUrl = `https://app.sette.io/auth/link?token=${linkToken}&psid=${psid}`;
    await this.messenger.sendText(
      psid,
      `Please tap the link below to connect your SettePay account:\n\n${linkUrl}\n\nThis link expires in 15 minutes.`,
    );
  }

  private async handleStartDeal(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) {
      await this.messenger.sendText(
        psid,
        'You need to link your SettePay account first. Tap "Link Account" to get started.',
      );
      return;
    }

    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_AMOUNT,
      context: { userId: user.id },
    });

    await this.messenger.sendText(
      psid,
      '🔒 Starting a new escrow deal.\n\nHow much is the deal? Enter the amount in EGP (e.g. 1500 or ١٥٠٠ جنيه)',
    );
  }

  private async handlePayDeal(psid: string, dealId: string): Promise<void> {
    await this.messenger.sendText(
      psid,
      `Opening secure payment for deal...\n\nhttps://app.sette.io/deals/${dealId}/pay`,
    );
  }

  private async handleDeclineDeal(psid: string, dealId: string): Promise<void> {
    // TODO: Call DealsService to cancel the deal
    await this.sessionService.clearSession(psid);
    await this.messenger.sendText(
      psid,
      `Deal has been declined. The seller will be notified.`,
    );
  }

  private async handleConfirmDelivery(psid: string, dealId: string): Promise<void> {
    // TODO: Call EscrowService.releaseEscrow(dealId)
    await this.messenger.sendText(
      psid,
      '✅ Delivery confirmed! The seller will receive their payment shortly.',
    );
  }

  private async handleRaiseDispute(psid: string, dealId: string): Promise<void> {
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.AWAITING_DISPUTE_REASON,
      context: { dealId },
    });

    await this.messenger.sendQuickReplies(
      psid,
      'Please select the reason for your dispute:',
      this.quickReplies.buildDisputeReasonOptions(),
    );
  }

  private async handleSubmitEvidence(psid: string, disputeId: string): Promise<void> {
    await this.messenger.sendText(
      psid,
      `Please submit your evidence here:\n\nhttps://app.sette.io/disputes/${disputeId}/evidence`,
    );
  }

  private async handleViewDeal(psid: string, dealId: string): Promise<void> {
    // TODO: Fetch deal from DB and send status summary card
    await this.messenger.sendText(
      psid,
      `View your deal details:\n\nhttps://app.sette.io/deals/${dealId}`,
    );
  }

  private async handleViewReceipt(psid: string, dealId: string): Promise<void> {
    // TODO: Fetch commission breakdown and transaction IDs
    await this.messenger.sendText(
      psid,
      `View your receipt:\n\nhttps://app.sette.io/deals/${dealId}/receipt`,
    );
  }

  private async handleListDeals(psid: string): Promise<void> {
    // TODO: Fetch user's active deals and send as carousel
    await this.messenger.sendText(
      psid,
      'View all your deals:\n\nhttps://app.sette.io/deals',
    );
  }

  private async handleWalletBalance(psid: string): Promise<void> {
    // TODO: Fetch wallet balance via PaymentService
    await this.messenger.sendText(
      psid,
      'View your wallet:\n\nhttps://app.sette.io/wallet',
    );
  }

  private generateLinkToken(): string {
    return (
      Math.random().toString(36).substring(2) +
      Math.random().toString(36).substring(2)
    );
  }
}
