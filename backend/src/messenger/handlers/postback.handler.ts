import { Injectable, Logger, Inject } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { TemplateFactory } from '../templates/template.factory';
import { QuickReplyFactory } from '../templates/quick-reply.factory';
import { BotSessionState } from '../bot-session.types';
import { EscrowService } from '../../deals/escrow.service';
import { WalletService } from '../../deals/wallet.service';
import { DisputesService } from '../../disputes/disputes.service';
import { PrismaService } from '../../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../../payment/payment.service.interface';
import { DealStatus } from '@prisma/client';

/**
 * PostbackHandler (A.8 — Fixed: CR-01)
 *
 * CR-01 fix: All 10 handlers now call real services.
 * No more TODO stubs — every postback executes actual business logic.
 *
 * Postback Payload Contract:
 *   GET_STARTED                → Welcome / account check
 *   LINK_ACCOUNT               → Generate secure link token (CR-03: CSPRNG)
 *   START_DEAL                 → Begin DealWizard
 *   CONFIRM_DELIVERY|{dealId}  → Call EscrowService.releaseEscrowOnDelivery()
 *   DECLINE_DEAL|{dealId}      → Cancel deal in DB + notify seller
 *   RAISE_DISPUTE|{dealId}     → Create Dispute + set AWAITING_DISPUTE_REASON
 *   SUBMIT_EVIDENCE|{disputeId}→ Send evidence upload link
 *   VIEW_DEAL|{dealId}         → Fetch deal from DB and send status card
 *   VIEW_RECEIPT|{dealId}      → Fetch commission breakdown
 *   LIST_DEALS                 → Fetch user's active deals
 *   WALLET_BALANCE             → Fetch balance via PaymentService
 */
@Injectable()
export class PostbackHandler {
  private readonly logger = new Logger(PostbackHandler.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly templates: TemplateFactory,
    private readonly quickReplies: QuickReplyFactory,
    private readonly escrow: EscrowService,
    private readonly wallet: WalletService,
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  async handle(psid: string, payload: string): Promise<void> {
    this.logger.log(`Postback: PSID=${psid} payload=${payload}`);
    await this.messenger.markSeen(psid);
    await this.messenger.typingOn(psid);

    const [action, entityId] = payload.split('|');

    switch (action) {
      case 'GET_STARTED': await this.handleGetStarted(psid); break;
      case 'LINK_ACCOUNT': await this.handleLinkAccount(psid); break;
      case 'START_DEAL': await this.handleStartDeal(psid); break;
      case 'CONFIRM_DELIVERY': await this.handleConfirmDelivery(psid, entityId); break;
      case 'DECLINE_DEAL': await this.handleDeclineDeal(psid, entityId); break;
      case 'RAISE_DISPUTE': await this.handleRaiseDispute(psid, entityId); break;
      case 'SUBMIT_EVIDENCE': await this.handleSubmitEvidence(psid, entityId); break;
      case 'VIEW_DEAL': await this.handleViewDeal(psid, entityId); break;
      case 'VIEW_RECEIPT': await this.handleViewReceipt(psid, entityId); break;
      case 'LIST_DEALS': await this.handleListDeals(psid); break;
      case 'WALLET_BALANCE': await this.handleWalletBalance(psid); break;
      case 'HELP':
        await this.messenger.sendQuickReplies(psid,
          '🔒 SettePay — Secure Facebook Marketplace Escrow\n\n' +
          '• Sellers: create a secure pay link for any deal\n' +
          '• Buyers: funds held safely until delivery\n' +
          '• Disputes resolved within 72 hours\n\n' +
          'How can I help you?',
          this.quickReplies.buildWelcomeOptions(),
        );
        break;
      default:
        this.logger.warn(`Unknown postback: ${payload}`);
        await this.messenger.sendText(psid, 'Sorry, I didn\'t understand that. Type "help" for options.');
    }
  }

  // ── 1. GET_STARTED ────────────────────────────────────────────────────────
  private async handleGetStarted(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);
    if (user) {
      await this.messenger.sendQuickReplies(
        psid,
        `Welcome back, ${user.firstName}! 🔒 What would you like to do?`,
        this.quickReplies.buildWelcomeOptions(),
      );
    } else {
      await this.messenger.sendText(psid,
        'Welcome to SettePay 🔒 — Egypt\'s secure Facebook Marketplace escrow.\n\n' +
        '✅ Buyer pays — funds held securely\n' +
        '📦 Seller ships with confidence\n' +
        '⚖️ Disputes resolved in 72 hours\n\n' +
        'Link your SettePay account to start.',
      );
      await this.messenger.sendQuickReplies(psid, 'Get started:', [
        { content_type: 'text', title: '🔗 Link Account', payload: 'LINK_ACCOUNT' },
        { content_type: 'text', title: '❓ How it works', payload: 'HELP' },
      ]);
    }
  }

  // ── 2. LINK_ACCOUNT — CR-03: CSPRNG token ────────────────────────────────
  private async handleLinkAccount(psid: string): Promise<void> {
    const token = await this.sessionService.createLinkToken(psid); // crypto.randomBytes(32)
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.LINKING_ACCOUNT,
      context: { linkToken: token },
    });
    const frontendUrl = this.getAppUrl();
    await this.messenger.sendText(psid,
      `Please tap the link below to connect your SettePay account:\n\n${frontendUrl}/auth/link?token=${token}\n\nThis link expires in 15 minutes. Do not share it.`,
    );
  }

  // ── 3. START_DEAL ─────────────────────────────────────────────────────────
  private async handleStartDeal(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) {
      await this.messenger.sendText(psid, 'You need to link your SettePay account first.');
      await this.messenger.sendQuickReplies(psid, '', [{ content_type: 'text', title: '🔗 Link Account', payload: 'LINK_ACCOUNT' }]);
      return;
    }
    if (!user.isProvider) {
      await this.messenger.sendText(psid,
        'Only sellers (SettePay Providers) can create escrow deals.\n\n' +
        'Are you a seller? Please register as a provider at:\n' + this.getAppUrl() + '/register?role=seller',
      );
      return;
    }
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_AMOUNT,
      context: { sellerId: user.id },
    });
    await this.messenger.sendText(psid,
      '🔒 Starting a new escrow deal.\n\nHow much is the deal?\nEnter the amount in EGP (e.g. 1500 or ١٥٠٠ جنيه)',
    );
  }

  // ── 4. CONFIRM_DELIVERY — CR-01 fix: calls EscrowService ──────────────────
  private async handleConfirmDelivery(psid: string, dealId: string): Promise<void> {
    if (!dealId) { await this.messenger.sendText(psid, 'Invalid deal reference.'); return; }

    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { buyer: true, seller: true },
    });

    if (!deal) { await this.messenger.sendText(psid, 'Deal not found.'); return; }
    if (deal.buyerId !== user.id) { await this.messenger.sendText(psid, 'Only the buyer can confirm delivery.'); return; }
    if (deal.status !== DealStatus.DELIVERY_CONFIRMED && deal.status !== DealStatus.SHIPPED) {
      await this.messenger.sendText(psid, `This deal is in ${deal.status} state and cannot be confirmed now.`);
      return;
    }

    try {
      // Set DELIVERY_CONFIRMED if only SHIPPED
      if (deal.status === DealStatus.SHIPPED) {
        await this.prisma.deal.update({
          where: { id: dealId },
          data: { status: DealStatus.DELIVERY_CONFIRMED, deliveredAt: new Date() },
        });
      }

      await this.escrow.releaseEscrowOnDelivery(dealId);

      const settled = await this.prisma.deal.findUnique({ where: { id: dealId } });
      await this.messenger.sendTemplate(psid, this.templates.buildSettled({
        id: dealId,
        amount: deal.amount,
        netPayout: settled?.netPayout ?? (deal.amount * 0.982),
        commission: settled?.commission ?? (deal.amount * 0.018),
      }));

      // Notify seller too
      if (deal.seller?.psid) {
        await this.messenger.sendTemplate(deal.seller.psid, this.templates.buildSettled({
          id: dealId,
          amount: deal.amount,
          netPayout: settled?.netPayout ?? (deal.amount * 0.982),
          commission: settled?.commission ?? (deal.amount * 0.018),
        }));
      }

      await this.sessionService.updateSession(psid, { state: BotSessionState.IDLE });
    } catch (err: any) {
      this.logger.error(`Confirm delivery failed for deal ${dealId}: ${err.message}`);
      await this.messenger.sendText(psid, 'Sorry, we couldn\'t process your confirmation right now. Please try via the app or contact support.');
    }
  }

  // ── 5. DECLINE_DEAL — CR-01 fix: updates DB ───────────────────────────────
  private async handleDeclineDeal(psid: string, dealId: string): Promise<void> {
    if (!dealId) { await this.messenger.sendText(psid, 'Invalid deal reference.'); return; }

    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { seller: true },
    });

    if (!deal) { await this.messenger.sendText(psid, 'Deal not found.'); return; }
    if (deal.status !== DealStatus.PENDING && deal.status !== DealStatus.AWAITING_BUYER_CONFIRMATION) {
      await this.messenger.sendText(psid, 'This deal cannot be declined in its current state.');
      return;
    }

    await this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.CANCELLED, cancelReason: 'Buyer declined via Messenger', cancelledAt: new Date() },
    });

    await this.sessionService.clearSession(psid);
    await this.messenger.sendText(psid, '✅ Deal declined. The seller has been notified.');

    // Notify seller
    if (deal.seller?.psid) {
      await this.messenger.sendText(deal.seller.psid,
        `❌ Deal declined\n\n"${deal.itemDescription}" (EGP ${deal.amount})\n\nThe buyer has declined this deal.`,
      );
    }
  }

  // ── 6. RAISE_DISPUTE — CR-01 fix: creates Dispute via DisputesService ────
  private async handleRaiseDispute(psid: string, dealId: string): Promise<void> {
    if (!dealId) { await this.messenger.sendText(psid, 'Invalid deal reference.'); return; }

    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

    try {
      const dispute = await this.disputes.raiseDispute(dealId, user.id);
      await this.sessionService.updateSession(psid, {
        state: BotSessionState.AWAITING_DISPUTE_REASON,
        context: { dealId, disputeId: dispute.id },
      });
      await this.messenger.sendQuickReplies(
        psid,
        '⚠️ Dispute opened.\n\nPlease select the reason:',
        this.quickReplies.buildDisputeReasonOptions(),
      );
    } catch (err: any) {
      this.logger.error(`Raise dispute failed: ${err.message}`);
      await this.messenger.sendText(psid,
        `Could not open dispute: ${err.message}\n\nPlease try via the app: ${this.getAppUrl()}/deals/${dealId}`,
      );
    }
  }

  // ── 7. SUBMIT_EVIDENCE ────────────────────────────────────────────────────
  private async handleSubmitEvidence(psid: string, disputeId: string): Promise<void> {
    await this.messenger.sendText(psid,
      `📎 Please submit your evidence here:\n\n${this.getAppUrl()}/disputes/${disputeId}/evidence\n\nOr send photos/screenshots directly in this chat — I'll attach them to your dispute.`,
    );
    const session = await this.sessionService.getSession(psid);
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.AWAITING_EVIDENCE,
      context: { ...session.context, disputeId },
    });
  }

  // ── 8. VIEW_DEAL — CR-01 fix: fetches real deal data ─────────────────────
  private async handleViewDeal(psid: string, dealId: string): Promise<void> {
    if (!dealId) { await this.messenger.sendText(psid, 'Invalid deal reference.'); return; }

    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { buyer: true, seller: true, dispute: true },
    });

    if (!deal) { await this.messenger.sendText(psid, 'Deal not found.'); return; }

    const statusEmoji: Record<string, string> = {
      PENDING: '⏳', AWAITING_BUYER_CONFIRMATION: '👆', ESCROW_ACTIVE: '🔒',
      SHIPPED: '🚚', DELIVERY_CONFIRMED: '📦', SETTLING: '⚙️', SETTLED: '✅',
      DISPUTED: '⚠️', AWAITING_TOP_UP: '💳', CANCELLED: '❌', REFUNDED: '↩️',
    };
    const emoji = statusEmoji[deal.status] || '📋';

    await this.messenger.sendText(psid,
      `${emoji} Deal Status\n\n` +
      `Item: ${deal.itemDescription}\n` +
      `Amount: EGP ${deal.amount.toLocaleString('ar-EG')}\n` +
      `Status: ${deal.status.replace(/_/g, ' ')}\n` +
      `Buyer: ${deal.buyer?.firstName || 'N/A'}\n` +
      `Seller: ${deal.seller?.firstName || 'N/A'}\n\n` +
      `Full details: ${this.getAppUrl()}/deals/${dealId}`,
    );
  }

  // ── 9. VIEW_RECEIPT — CR-01 fix: fetches real commission data ────────────
  private async handleViewReceipt(psid: string, dealId: string): Promise<void> {
    if (!dealId) { await this.messenger.sendText(psid, 'Invalid deal reference.'); return; }

    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { commissionRecord: true, escrowTx: true },
    });

    if (!deal) { await this.messenger.sendText(psid, 'Deal not found.'); return; }
    if (deal.status !== DealStatus.SETTLED) {
      await this.messenger.sendText(psid, 'Receipt is only available for completed deals.');
      return;
    }

    const commission = deal.commissionRecord?.commissionAmount ?? (deal.amount * 0.018);
    const netPayout  = deal.commissionRecord?.netPayout ?? (deal.amount - commission);

    await this.messenger.sendText(psid,
      `🧾 Receipt — Deal #${dealId.slice(-8).toUpperCase()}\n\n` +
      `Item: ${deal.itemDescription}\n` +
      `Gross: EGP ${deal.amount.toLocaleString('ar-EG')}\n` +
      `SettePay commission: EGP ${commission.toFixed(2)}\n` +
      `Net payout: EGP ${netPayout.toLocaleString('ar-EG')}\n` +
      `HP Ref: ${deal.escrowTx?.hpPayoutRef ?? 'N/A'}\n\n` +
      `Full receipt: ${this.getAppUrl()}/deals/${dealId}/receipt`,
    );
  }

  // ── 10. LIST_DEALS — CR-01 fix: fetches real deals ────────────────────────
  private async handleListDeals(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

    const activeStatuses = [
      DealStatus.PENDING, DealStatus.AWAITING_BUYER_CONFIRMATION,
      DealStatus.ESCROW_ACTIVE, DealStatus.SHIPPED,
      DealStatus.DELIVERY_CONFIRMED, DealStatus.DISPUTED,
    ];

    const [buyerDeals, sellerDeals] = await Promise.all([
      this.prisma.deal.findMany({
        where: { buyerId: user.id, status: { in: activeStatuses } },
        take: 3, orderBy: { createdAt: 'desc' },
        include: { seller: { select: { firstName: true } } },
      }),
      this.prisma.deal.findMany({
        where: { sellerId: user.id, status: { in: activeStatuses } },
        take: 3, orderBy: { createdAt: 'desc' },
        include: { buyer: { select: { firstName: true } } },
      }),
    ]);

    const allDeals = [...buyerDeals, ...sellerDeals];

    if (allDeals.length === 0) {
      await this.messenger.sendQuickReplies(psid,
        'You have no active deals.\n\nStart a new escrow deal?',
        [{ content_type: 'text', title: '🔒 Start Deal', payload: 'START_DEAL' }],
      );
      return;
    }

    let summary = `📋 Your Active Deals (${allDeals.length}):\n\n`;
    for (const d of allDeals.slice(0, 5)) {
      const role = d.buyerId === user.id ? '🛒 Buyer' : '🏪 Seller';
      summary += `${role}: "${d.itemDescription}" — EGP ${d.amount} — ${d.status.replace(/_/g,' ')}\n`;
    }
    summary += `\nFull dashboard: ${this.getAppUrl()}/deals`;

    await this.messenger.sendText(psid, summary);
  }

  // ── 11. WALLET_BALANCE — CR-01 fix: calls WalletService ──────────────────
  private async handleWalletBalance(psid: string): Promise<void> {
    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Please link your account first.'); return; }

    try {
      const balance = await this.wallet.getBalance(user.id);
      await this.messenger.sendText(psid,
        `💳 SettePay Wallet\n\nBalance: EGP ${(balance.total || 0).toLocaleString('ar-EG')}\n\nTop up or view history: ${this.getAppUrl()}/wallet`,
      );
    } catch (err: any) {
      this.logger.error(`Wallet balance fetch failed: ${err.message}`);
      await this.messenger.sendText(psid,
        `💳 View your wallet:\n${this.getAppUrl()}/wallet`,
      );
    }
  }

  private getAppUrl(): string {
    return process.env.FRONTEND_URL || 'https://marketplace.sette.io';
  }
}
