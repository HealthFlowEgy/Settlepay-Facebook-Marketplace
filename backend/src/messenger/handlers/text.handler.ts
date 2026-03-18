import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { QuickReplyFactory } from '../templates/quick-reply.factory';
import { BotSession, BotSessionState } from '../bot-session.types';

/**
 * TextHandler (A.9)
 *
 * Handles free-text messages from users. Egyptian Marketplace sellers
 * write in Arabic, Franco-Arabic, or English. The wizard must be
 * resilient to all three input styles.
 *
 * The text handler attempts amount extraction before falling back
 * to the structured wizard.
 */
@Injectable()
export class TextHandler {
  private readonly logger = new Logger(TextHandler.name);

  // Regex patterns for Egyptian price mentions (A.9)
  private readonly AMOUNT_PATTERNS = [
    /(?:بـ|بـ\s*|بـ |b\s*)([\d,\.]+)\s*(?:جنيه|جنية|egp|ج|EGP)?/i,
    /(?:EGP|egp|LE|le|جنيه|جنية)\s*([\d,\.]+)/i,
    /([\d,\.]+)\s*(?:EGP|egp|LE|le|جنيه|جنية|pound|pounds)/i,
    /([\d]{3,6})/, // bare number fallback (3–6 digit = likely EGP amount)
  ];

  // Deal intent keywords in Arabic, Franco-Arabic, and English
  private readonly DEAL_KEYWORDS = [
    'escrow',
    'ضمان',
    'حماية',
    'صفقة',
    'sette',
    'settle',
    'deal',
    'شراء',
    'بيع',
    'دفع',
    'pay',
    'secure',
    'أمان',
  ];

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly quickReplies: QuickReplyFactory,
  ) {}

  async handle(
    psid: string,
    text: string,
    session: BotSession,
  ): Promise<void> {
    this.logger.log(
      `Text received: PSID=${psid}, state=${session.state}, text="${text.substring(0, 50)}"`,
    );

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

      case BotSessionState.AWAITING_DISPUTE_REASON:
        await this.handleDisputeReason(psid, text, session);
        break;

      case BotSessionState.LINKING_ACCOUNT:
        await this.messenger.sendText(
          psid,
          'Please complete account linking using the link I sent. If it expired, type "link" to get a new one.',
        );
        break;

      default:
        await this.sendHelpMenu(psid);
    }
  }

  private async handleIdle(psid: string, text: string): Promise<void> {
    if (this.isDealIntent(text)) {
      // Check if user is linked
      const user = await this.sessionService.getUserByPsid(psid);
      if (!user) {
        await this.messenger.sendText(
          psid,
          'You need to link your SettePay account first. Type "link" to get started.',
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
    } else if (
      text.toLowerCase().includes('link') ||
      text.includes('ربط')
    ) {
      // Trigger account linking
      await this.sessionService.updateSession(psid, {
        state: BotSessionState.LINKING_ACCOUNT,
      });
      const linkToken =
        Math.random().toString(36).substring(2) +
        Math.random().toString(36).substring(2);
      const linkUrl = `https://app.sette.io/auth/link?token=${linkToken}&psid=${psid}`;
      await this.messenger.sendText(
        psid,
        `Please tap the link below to connect your SettePay account:\n\n${linkUrl}`,
      );
    } else if (
      text.toLowerCase().includes('help') ||
      text.includes('مساعدة')
    ) {
      await this.sendHelpMenu(psid);
    } else {
      await this.sendHelpMenu(psid);
    }
  }

  private async handleDealAmount(
    psid: string,
    text: string,
    session: BotSession,
  ): Promise<void> {
    const amount = this.extractAmount(text);

    if (!amount) {
      await this.messenger.sendText(
        psid,
        'Please enter the price (e.g. 1500 EGP أو ١٥٠٠ جنيه)',
      );
      return;
    }

    if (amount < 50) {
      await this.messenger.sendText(psid, 'Minimum deal is EGP 50.');
      return;
    }

    if (amount > 50000) {
      await this.messenger.sendText(
        psid,
        'Deals above EGP 50,000 require manual approval. Please contact support.',
      );
      return;
    }

    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_SETUP_ITEM,
      context: { ...session.context, amount },
    });

    await this.messenger.sendText(
      psid,
      `Got it — EGP ${amount}. What is the item description?`,
    );
  }

  private async handleDealItem(
    psid: string,
    text: string,
    session: BotSession,
  ): Promise<void> {
    if (text.length < 3) {
      await this.messenger.sendText(
        psid,
        'Please describe the item (at least 3 characters).',
      );
      return;
    }

    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_CONFIRM,
      context: { ...session.context, itemDescription: text },
    });

    await this.sendDealSummary(
      psid,
      session.context.amount,
      text,
    );
  }

  private async handleDealBuyer(
    psid: string,
    text: string,
    session: BotSession,
  ): Promise<void> {
    // Accept buyer PSID or mobile number
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.DEAL_CONFIRM,
      context: { ...session.context, buyerIdentifier: text.trim() },
    });

    await this.sendDealSummary(
      psid,
      session.context.amount,
      session.context.itemDescription,
    );
  }

  private async handleDisputeReason(
    psid: string,
    text: string,
    session: BotSession,
  ): Promise<void> {
    await this.sessionService.updateSession(psid, {
      state: BotSessionState.AWAITING_EVIDENCE,
      context: { ...session.context, disputeReason: text },
    });

    await this.messenger.sendText(
      psid,
      'Thank you. Please upload photos or evidence to support your dispute.\n\n' +
        `Upload here: https://app.sette.io/disputes/${session.context.dealId}/evidence`,
    );
  }

  private async sendDealSummary(
    psid: string,
    amount: number,
    itemDescription: string,
  ): Promise<void> {
    const summary =
      `📋 Deal Summary:\n\n` +
      `Amount: EGP ${amount}\n` +
      `Item: ${itemDescription}\n\n` +
      `Commission: EGP ${Math.max(amount * 0.018, 0.75).toFixed(2)}\n\n` +
      `Confirm to create this escrow deal?`;

    await this.messenger.sendQuickReplies(
      psid,
      summary,
      this.quickReplies.buildDealConfirmOptions(),
    );
  }

  private async sendHelpMenu(psid: string): Promise<void> {
    await this.messenger.sendQuickReplies(
      psid,
      '🔒 SettePay — Secure Facebook Marketplace Escrow\n\n' +
        'How can I help you today?',
      this.quickReplies.buildWelcomeOptions(),
    );
  }

  private isDealIntent(text: string): boolean {
    const lower = text.toLowerCase();
    return this.DEAL_KEYWORDS.some((k) => lower.includes(k));
  }

  /**
   * Extract EGP amount from text using multiple regex patterns.
   * Handles Arabic numerals, comma-separated numbers, and various
   * currency indicators (EGP, LE, جنيه, جنية).
   */
  private extractAmount(text: string): number | null {
    // Convert Arabic-Indic numerals to Western
    const normalized = text.replace(/[٠-٩]/g, (d) =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
    );

    for (const pattern of this.AMOUNT_PATTERNS) {
      const match = normalized.match(pattern);
      if (match && match[1]) {
        const cleaned = match[1].replace(/,/g, '');
        const amount = parseFloat(cleaned);
        if (!isNaN(amount) && amount > 0) {
          return amount;
        }
      }
    }

    return null;
  }
}
