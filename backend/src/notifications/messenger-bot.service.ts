import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

// ── Messenger message types ───────────────────────────────────────────────────
export interface MessengerButton {
  type:    'web_url' | 'postback';
  title:   string;
  url?:    string;
  payload?: string;
  webview_height_ratio?: 'compact' | 'tall' | 'full';
}

export interface MessengerGenericElement {
  title:    string;
  subtitle: string;
  buttons:  MessengerButton[];
  image_url?: string;
}

@Injectable()
export class MessengerBotService {
  private readonly logger = new Logger(MessengerBotService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v19.0/me/messages';

  constructor(private readonly config: ConfigService) {}

  private get token() {
    return this.config.get<string>('meta.pageAccessToken');
  }

  // ── Core send ──────────────────────────────────────────────────────────────
  private async send(psid: string, message: object): Promise<void> {
    if (!this.token) {
      this.logger.warn('META_PAGE_ACCESS_TOKEN not configured — Messenger message skipped');
      return;
    }
    try {
      await axios.post(`${this.baseUrl}?access_token=${this.token}`, {
        recipient: { id: psid },
        message,
      });
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message;
      this.logger.error(`Messenger send failed to PSID ${psid}: ${errMsg}`);
      // Never throw — Messenger failure must not break escrow flow
    }
  }

  // ── Text message ───────────────────────────────────────────────────────────
  async sendText(psid: string, text: string): Promise<void> {
    await this.send(psid, { text });
  }

  // ── Generic template (deal card) ───────────────────────────────────────────
  async sendGenericTemplate(psid: string, elements: MessengerGenericElement[]): Promise<void> {
    await this.send(psid, {
      attachment: {
        type: 'template',
        payload: { template_type: 'generic', elements },
      },
    });
  }

  // ── Deal initiation card ───────────────────────────────────────────────────
  async sendDealCard(psid: string, deal: any): Promise<void> {
    const frontendUrl = this.config.get<string>('app.frontendUrl') || 'https://marketplace.sette.io';
    const elements: MessengerGenericElement[] = [{
      title:    `🔒 Secure Payment — ${deal.itemDescription}`,
      subtitle: `Amount: EGP ${deal.amount.toLocaleString()} | Escrow Protected by SettePay`,
      buttons:  [
        {
          type:                  'web_url',
          title:                 `Pay EGP ${deal.amount.toLocaleString()}`,
          url:                   `${frontendUrl}/deals/${deal.id}/pay`,
          webview_height_ratio:  'tall',
        },
        {
          type:    'postback',
          title:   '❌ Decline',
          payload: `CANCEL_DEAL_${deal.id}`,
        },
      ],
    }];
    await this.sendGenericTemplate(psid, elements);
    this.logger.log(`Deal card sent to PSID ${psid} for deal ${deal.id}`);
  }

  // ── Escrow status messages ─────────────────────────────────────────────────
  async sendEscrowActive(psid: string, deal: any, isSeller: boolean): Promise<void> {
    if (isSeller) {
      await this.sendText(psid,
        `✅ Funds secured!\n\nEGP ${deal.amount.toLocaleString()} is held in escrow for:\n` +
        `"${deal.itemDescription}"\n\n` +
        `📦 Ship the item now. Funds release automatically when delivery is confirmed.\n\n` +
        `Waybill: ${deal.waybillId || 'Auto-generated — check your SettePay dashboard'}`
      );
    } else {
      await this.sendText(psid,
        `🔒 Your payment is secured!\n\n` +
        `EGP ${deal.amount.toLocaleString()} is held in escrow.\n` +
        `"${deal.itemDescription}"\n\n` +
        `Your money is safe. It will only be released to the seller when you receive your item.`
      );
    }
  }

  async sendShippedNotification(psid: string, deal: any, isBuyer: boolean): Promise<void> {
    if (isBuyer) {
      await this.sendText(psid,
        `📦 Your item is on the way!\n\n` +
        `"${deal.itemDescription}"\n` +
        `Waybill: ${deal.waybillId || 'N/A'}\n\n` +
        `Once delivered, your escrow funds will be released to the seller. ` +
        `You have 48 hours after delivery to raise a dispute if needed.`
      );
    }
  }

  async sendDeliveryConfirmed(psid: string, deal: any, isBuyer: boolean): Promise<void> {
    const frontendUrl = this.config.get<string>('app.frontendUrl') || 'https://marketplace.sette.io';
    if (isBuyer) {
      await this.send(psid, {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: `✅ Your item has been delivered!\n\n"${deal.itemDescription}"\n\nHappy with your purchase? Your payment will be released to the seller automatically in 48 hours.\n\nNot satisfied? Raise a dispute now.`,
            buttons: [
              {
                type:    'web_url',
                title:   '✅ All Good',
                url:     `${frontendUrl}/deals/${deal.id}`,
                webview_height_ratio: 'compact',
              },
              {
                type:    'web_url',
                title:   '⚠️ Raise Dispute',
                url:     `${frontendUrl}/deals/${deal.id}?action=dispute`,
                webview_height_ratio: 'tall',
              },
            ],
          },
        },
      });
    }
  }

  async sendPaymentReleased(psid: string, deal: any, isSeller: boolean): Promise<void> {
    if (isSeller) {
      const commission = deal.commission || 0;
      const netPayout  = deal.netPayout  || deal.amount;
      await this.sendText(psid,
        `💸 Payment released!\n\n` +
        `"${deal.itemDescription}"\n` +
        `Gross: EGP ${deal.amount.toLocaleString()}\n` +
        `Commission: EGP ${commission.toFixed(2)}\n` +
        `Net to wallet: EGP ${netPayout.toLocaleString()}\n\n` +
        `Thanks for using SettePay Marketplace!`
      );
    } else {
      await this.sendText(psid,
        `✅ Deal complete!\n\n"${deal.itemDescription}"\n\n` +
        `Your escrow payment has been released to the seller. Thank you for using SettePay.`
      );
    }
  }

  async sendDisputeRaised(psid: string, deal: any, isSeller: boolean): Promise<void> {
    if (isSeller) {
      await this.sendText(psid,
        `⚠️ Dispute raised\n\n` +
        `The buyer has raised a dispute on:\n"${deal.itemDescription}"\n\n` +
        `Your payment is on hold. Please submit your evidence within 24 hours.\n` +
        `Admin will resolve within 72 hours.`
      );
    } else {
      await this.sendText(psid,
        `⚠️ Dispute opened\n\nYour dispute for "${deal.itemDescription}" has been registered.\n` +
        `Please submit any evidence (photos, screenshots) within 24 hours.\n` +
        `Admin will review and resolve within 72 hours.`
      );
    }
  }

  async sendDisputeResolved(psid: string, deal: any, resolution: string): Promise<void> {
    const msgs: Record<string, string> = {
      FULL_RELEASE: `✅ Dispute resolved — Full Release\n\nThe payment has been released to the seller.\n"${deal.itemDescription}"`,
      FULL_REFUND:  `✅ Dispute resolved — Full Refund\n\nThe full amount has been refunded to the buyer.\n"${deal.itemDescription}"`,
      PARTIAL:      `✅ Dispute resolved — Partial Resolution\n\nA split payment has been processed.\n"${deal.itemDescription}"\n\nCheck your SettePay wallet for details.`,
    };
    await this.sendText(psid, msgs[resolution] || `Dispute resolved: ${resolution}`);
  }

  async sendInsufficientFunds(psid: string, deal: any): Promise<void> {
    const frontendUrl = this.config.get<string>('app.frontendUrl') || 'https://marketplace.sette.io';
    await this.send(psid, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: `💰 Insufficient wallet balance\n\nYou need EGP ${deal.amount.toLocaleString()} to secure this deal:\n"${deal.itemDescription}"\n\nTop up your SettePay wallet to continue.`,
          buttons: [{
            type:                 'web_url',
            title:                '💳 Top Up Wallet',
            url:                  `${frontendUrl}/wallet?topup=${deal.amount}`,
            webview_height_ratio: 'tall',
          }],
        },
      },
    });
  }

  async sendWelcome(psid: string): Promise<void> {
    await this.sendText(psid,
      `👋 Welcome to SettePay Marketplace!\n\n` +
      `I'm your escrow payment assistant.\n\n` +
      `🔒 Sellers: Create a secure payment link for any Facebook deal\n` +
      `✅ Buyers: Pay safely — funds only release when you receive your item\n` +
      `⚖️ Disputes: We resolve any disagreements within 72 hours\n\n` +
      `To start a deal, the seller shares a SettePay payment link in your Messenger chat.`
    );
  }

  // ── Typing indicator ───────────────────────────────────────────────────────
  async sendTypingOn(psid: string): Promise<void> {
    if (!this.token) return;
    try {
      await axios.post(`${this.baseUrl}?access_token=${this.token}`, {
        recipient:          { id: psid },
        sender_action:      'typing_on',
      });
    } catch {}
  }

  // ── Read receipt ───────────────────────────────────────────────────────────
  async markSeen(psid: string): Promise<void> {
    if (!this.token) return;
    try {
      await axios.post(`${this.baseUrl}?access_token=${this.token}`, {
        recipient:     { id: psid },
        sender_action: 'mark_seen',
      });
    } catch {}
  }
}
