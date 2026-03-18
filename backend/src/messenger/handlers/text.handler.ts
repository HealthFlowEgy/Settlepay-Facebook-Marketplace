import { Injectable, Logger, Inject } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { QuickReplyFactory } from '../templates/quick-reply.factory';
import { TemplateFactory } from '../templates/template.factory';
import { BotSession, BotSessionState } from '../bot-session.types';
import { PrismaService } from '../../common/prisma.service';
import { EscrowService } from '../../deals/escrow.service';
import { DealStatus } from '@prisma/client';

/**
 * TextHandler (A.9 — Fixed: HI-02, ME-02)
 *
 * HI-02/ME-02 fix: Added DEAL_CONFIRM, DEAL_ACTIVE, AWAITING_EVIDENCE states.
 * The wizard now has a complete creation path that calls EscrowService.initiateDeal().
 */
@Injectable()
export class TextHandler {
  private readonly logger = new Logger(TextHandler.name);

  private readonly AMOUNT_PATTERNS = [
    /(?:بـ|بـ\s*|بـ |b\s*)([\d,\.]+)\s*(?:جنيه|جنية|egp|ج|EGP)?/i,
    /(?:EGP|egp|LE|le|جنيه|جنية)\s*([\d,\.]+)/i,
    /([\d,\.]+)\s*(?:EGP|egp|LE|le|جنيه|جنية|pound|pounds)/i,
    /([\d]{3,6})/,
  ];

  private readonly DEAL_KEYWORDS = [
    'escrow','ضمان','حماية','صفقة','sette','settle','deal','شراء','بيع','دفع','pay','secure','أمان',
  ];

  private readonly CONFIRM_KEYWORDS = ['yes','نعم','ايوه','اه','موافق','confirm','ok','okay','تمام'];
  private readonly CANCEL_KEYWORDS  = ['no','لا','cancel','الغاء','الغ','نو','ipdate','انسخ'];

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly quickReplies: QuickReplyFactory,
    private readonly templates: TemplateFactory,
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
  ) {}

  async handle(psid: string, text: string, session: BotSession): Promise<void> {
    this.logger.log(`Text: PSID=${psid} state=${session.state} text="${text.substring(0, 40)}"`);

    switch (session.state) {
      case BotSessionState.IDLE:
        await this.handleIdle(psid, text);
        break;
      case BotSessionState.DEAL_SETUP_AMOUNT:
        await this.handleDealAmount(psid, text, session);
        break;
      case BotSessionState.DEAL_SETUP_ITEM:
        await this.handleDealItem(psid, text, session);
        break;
      case BotSessionState.DEAL_SETUP_BUYER:
        await this.handleDealBuyer(psid, text, session);
        break;
      case BotSessionState.DEAL_CONFIRM:
        await this.handleDealConfirm(psid, text, session); // HI-02 fix
        break;
      case BotSessionState.DEAL_ACTIVE:
        await this.handleDealActive(psid, text, session); // HI-02 fix
        break;
      case BotSessionState.AWAITING_DISPUTE_REASON:
        await this.handleDisputeReason(psid, text, session);
        break;
      case BotSessionState.AWAITING_EVIDENCE:
        await this.handleEvidenceText(psid, text, session); // HI-02 fix
        break;
      case BotSessionState.LINKING_ACCOUNT:
        await this.messenger.sendText(psid,
          'Please complete account linking using the link I sent. Type "link" to get a new one.',
        );
        break;
      default:
        await this.sendHelpMenu(psid);
    }
  }

  // ── IDLE ──────────────────────────────────────────────────────────────────
  private async handleIdle(psid: string, text: string): Promise<void> {
    if (this.isDealIntent(text)) {
      const user = await this.sessionService.getUserByPsid(psid);
      if (!user) {
        await this.messenger.sendText(psid, 'You need to link your SettePay account first. Type "link" to get started.');
        return;
      }
      if (!user.isProvider) {
        await this.messenger.sendText(psid, 'Only registered sellers can create deals. Visit the app to upgrade your account.');
        return;
      }
      await this.sessionService.updateSession(psid, {
        state: BotSessionState.DEAL_SETUP_AMOUNT,
        context: { sellerId: user.id },
      });
      await this.messenger.sendText(psid,
        '🔒 Starting a new escrow deal.\n\nHow much is the deal? Enter the amount in EGP\n(e.g. 1500 or ١٥٠٠ جنيه)',
      );
    } else if (text.toLowerCase().includes('link') || text.includes('ربط')) {
      await this.sessionService.updateSession(psid, { state: BotSessionState.LINKING_ACCOUNT });
      const token   = await this.sessionService.createLinkToken(psid);
      const appUrl  = process.env.FRONTEND_URL || 'https://marketplace.sette.io';
      await this.messenger.sendText(psid, `Please tap the link to connect your account:\n\n${appUrl}/auth/link?token=${token}\n\nExpires in 15 minutes.`);
    } else {
      await this.sendHelpMenu(psid);
    }
  }

  // ── DEAL_SETUP_AMOUNT ─────────────────────────────────────────────────────
  private async handleDealAmount(psid: string, text: string, session: BotSession): Promise<void> {
    const amount = this.extractAmount(text);
    if (!amount) {
      await this.messenger.sendText(psid, 'Please enter a valid amount (e.g. 1500 EGP أو ١٥٠٠ جنيه)');
      return;
    }
    if (amount < 50)     { await this.messenger.sendText(psid, 'Minimum deal is EGP 50.'); return; }
    if (amount > 50000)  { await this.messenger.sendText(psid, 'Deals above EGP 50,000 require manual approval. Please contact support.'); return; }

    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_ITEM,
      context: { ...session.context, amount },
    });
    await this.messenger.sendText(psid, `Got it — EGP ${amount.toLocaleString('ar-EG')}.\n\nWhat is the item description?`);
  }

  // ── DEAL_SETUP_ITEM ───────────────────────────────────────────────────────
  private async handleDealItem(psid: string, text: string, session: BotSession): Promise<void> {
    if (text.trim().length < 3) {
      await this.messenger.sendText(psid, 'Please describe the item (at least 3 characters).');
      return;
    }
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_BUYER,
      context: { ...session.context, itemDescription: text.trim() },
    });
    await this.messenger.sendText(psid,
      'Who is the buyer?\n\nEnter their mobile number (e.g. 01012345678) or type "skip" if you\'ll share the deal link.',
    );
  }

  // ── DEAL_SETUP_BUYER ──────────────────────────────────────────────────────
  private async handleDealBuyer(psid: string, text: string, session: BotSession): Promise<void> {
    const buyerInput = text.trim().toLowerCase() === 'skip' ? null : text.trim();
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_CONFIRM,
      context: { ...session.context, buyerInput },
    });
    await this.sendDealSummary(psid, session.context.amount, session.context.itemDescription, buyerInput);
  }

  // ── DEAL_CONFIRM (HI-02 fix — creates real deal) ─────────────────────────
  private async handleDealConfirm(psid: string, text: string, session: BotSession): Promise<void> {
    if (this.isCancelIntent(text)) {
      await this.sessionService.clearSession(psid);
      await this.messenger.sendText(psid, 'Deal creation cancelled.');
      return;
    }

    if (!this.isConfirmIntent(text)) {
      await this.sendDealSummary(psid, session.context.amount, session.context.itemDescription, session.context.buyerInput);
      return;
    }

    const user = await this.sessionService.getUserByPsid(psid);
    if (!user) { await this.messenger.sendText(psid, 'Session expired. Please start again.'); await this.sessionService.clearSession(psid); return; }

    try {
      // Resolve buyer
      let buyerId: string | undefined;
      if (session.context.buyerInput) {
        const buyer = await this.prisma.user.findFirst({ where: { mobile: { contains: session.context.buyerInput.replace(/^0/, '+20') } } });
        buyerId = buyer?.id;
      }

      const deal = await this.escrow.initiateDeal(
        user.id,
        buyerId ?? user.id, // Self-deal if buyer not found — seller will share link
        session.context.amount,
        session.context.itemDescription,
      );

      await this.sessionService.updateSession(psid, {
        state: BotSessionState.DEAL_ACTIVE,
        dealId: deal.id,
        context: { ...session.context, dealId: deal.id },
      });

      const appUrl = process.env.FRONTEND_URL || 'https://marketplace.sette.io';
      await this.messenger.sendTemplate(psid, this.templates.buildEscrowActive({
        id: deal.id,
        amount: deal.amount,
        itemDescription: deal.itemDescription,
        waybillUrl: undefined,
      }));

      // Send payment request link for buyer to pay
      await this.messenger.sendText(psid,
        `✅ Deal created!\n\nShare this link with the buyer:\n${appUrl}/deals/${deal.id}/pay\n\nDeal ID: ${deal.id.slice(-8).toUpperCase()}`,
      );
    } catch (err: any) {
      this.logger.error(`Deal creation failed: ${err.message}`);
      await this.messenger.sendText(psid, `Could not create deal: ${err.message}`);
    }
  }

  // ── DEAL_ACTIVE (HI-02 fix) ───────────────────────────────────────────────
  private async handleDealActive(psid: string, text: string, session: BotSession): Promise<void> {
    const dealId = session.dealId || session.context?.dealId;
    if (dealId) {
      const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
      if (deal) {
        await this.messenger.sendText(psid,
          `📋 Deal Status: ${deal.status.replace(/_/g, ' ')}\n\n"${deal.itemDescription}" — EGP ${deal.amount}\n\nFull details: ${process.env.FRONTEND_URL || 'https://marketplace.sette.io'}/deals/${dealId}`,
        );
        return;
      }
    }
    await this.sendHelpMenu(psid);
  }

  // ── AWAITING_DISPUTE_REASON ────────────────────────────────────────────────
  private async handleDisputeReason(psid: string, text: string, session: BotSession): Promise<void> {
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.AWAITING_EVIDENCE,
      context: { ...session.context, disputeReason: text.trim() },
    });
    const appUrl = process.env.FRONTEND_URL || 'https://marketplace.sette.io';
    await this.messenger.sendText(psid,
      `Thank you — dispute reason recorded.\n\nPlease submit evidence (photos, screenshots) via the app:\n${appUrl}/disputes/${session.context.disputeId}/evidence\n\nOr send images directly in this chat.`,
    );
  }

  // ── AWAITING_EVIDENCE (HI-02 fix) ────────────────────────────────────────
  private async handleEvidenceText(psid: string, text: string, session: BotSession): Promise<void> {
    await this.messenger.sendText(psid,
      'Thank you. Our admin team will review your dispute within 72 hours.\n\n' +
      'To upload photo evidence, please send images directly in this chat.',
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private async sendDealSummary(psid: string, amount: number, itemDescription: string, buyerInput: string | null): Promise<void> {
    const commission = Math.max(amount * 0.018, 0.75);
    const summary =
      '📋 Deal Summary\n\n' +
      `Amount: EGP ${amount.toLocaleString('ar-EG')}\n` +
      `Item: ${itemDescription}\n` +
      `Buyer: ${buyerInput || 'Share link after creation'}\n` +
      `SettePay commission: EGP ${commission.toFixed(2)}\n` +
      `Seller receives: EGP ${(amount - commission).toFixed(2)}\n\n` +
      'Confirm to create this escrow deal?';

    await this.messenger.sendQuickReplies(psid, summary, this.quickReplies.buildDealConfirmOptions());
  }

  private async sendHelpMenu(psid: string): Promise<void> {
    await this.messenger.sendQuickReplies(
      psid,
      '🔒 SettePay — Secure Facebook Marketplace Escrow\n\nHow can I help you today?',
      this.quickReplies.buildWelcomeOptions(),
    );
  }

  private isDealIntent(text: string): boolean {
    const lower = text.toLowerCase();
    return this.DEAL_KEYWORDS.some(k => lower.includes(k));
  }

  private isConfirmIntent(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return this.CONFIRM_KEYWORDS.some(k => lower.includes(k));
  }

  private isCancelIntent(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return this.CANCEL_KEYWORDS.some(k => lower.includes(k));
  }

  private extractAmount(text: string): number | null {
    const normalized = text.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    for (const pattern of this.AMOUNT_PATTERNS) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        const cleaned = match[1].replace(/,/g, '');
        const amount = parseFloat(cleaned);
        if (!isNaN(amount) && amount > 0) return amount;
      }
    }
    return null;
  }
}
