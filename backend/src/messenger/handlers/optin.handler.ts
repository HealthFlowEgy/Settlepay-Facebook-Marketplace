import { Injectable, Logger } from '@nestjs/common';
import { BotSessionService } from '../bot-session.service';
import { MessengerApiService } from '../messenger-api.service';
import { QuickReplyFactory } from '../templates/quick-reply.factory';

/**
 * OptinHandler (A.10)
 *
 * Handles GET_STARTED postback and referral opt-in events.
 * Meta App Review will reject any bot that does not handle
 * GET_STARTED postback.
 */
@Injectable()
export class OptinHandler {
  private readonly logger = new Logger(OptinHandler.name);

  constructor(
    private readonly sessionService: BotSessionService,
    private readonly messenger: MessengerApiService,
    private readonly quickReplies: QuickReplyFactory,
  ) {}

  async handle(psid: string, ref?: string): Promise<void> {
    this.logger.log(`Optin received: PSID=${psid}, ref=${ref || 'none'}`);

    const user = await this.sessionService.getUserByPsid(psid);

    if (user) {
      // Returning user
      await this.messenger.sendQuickReplies(
        psid,
        `Welcome back, ${user.firstName}! 🔒\n\nWhat would you like to do?`,
        this.quickReplies.buildWelcomeOptions(),
      );
    } else {
      // New user — send welcome + account link CTA
      await this.messenger.sendText(
        psid,
        'Welcome to SettePay 🔒 — Egypt\'s secure Facebook Marketplace escrow.\n\n' +
          'Protect your Facebook Marketplace deals with our escrow service:\n' +
          '• Buyer\'s money is held securely until delivery\n' +
          '• Seller ships with confidence\n' +
          '• Disputes resolved fairly within 72 hours\n\n' +
          'Tap below to link your account and start!',
      );

      await this.messenger.sendQuickReplies(psid, 'Get started:', [
        { content_type: 'text', title: '🔗 Link Account', payload: 'LINK_ACCOUNT' },
        { content_type: 'text', title: '❓ How it works', payload: 'HELP' },
      ]);
    }

    // Handle referral deep-link (e.g., from m.me/settepay?ref=deal_123)
    if (ref && ref.startsWith('deal_')) {
      const dealId = ref.replace('deal_', '');
      this.logger.log(`Referral deal: ${dealId}`);
      // TODO: Auto-open deal details for the user
    }
  }
}
