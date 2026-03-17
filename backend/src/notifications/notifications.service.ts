import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

const DEAL_MESSAGES: Record<string, (d: any, meta?: any) => { title: string; body: string }> = {
  deal_initiated:        (d)    => ({ title: 'New Deal Created', body: `Escrow deal for EGP ${d.amount} — ${d.itemDescription}` }),
  payment_request_sent:  (d)    => ({ title: 'Payment Request', body: `Please confirm your payment of EGP ${d.amount} for "${d.itemDescription}"` }),
  escrow_active:         (d)    => ({ title: '💰 Funds Secured!', body: `EGP ${d.amount} held in escrow. Safe to ship now.` }),
  insufficient_funds:    (d)    => ({ title: 'Top Up Required', body: `Please top up your SettePay wallet to complete the EGP ${d.amount} payment` }),
  payment_error:         (d)    => ({ title: 'Payment Failed', body: `Payment could not be processed. No charge made. Please try again.` }),
  shipped:               (d)    => ({ title: '📦 Item Shipped', body: `Your item is on the way! Track via waybill: ${d.waybillId || 'N/A'}` }),
  delivery_confirmed:    (d)    => ({ title: '✅ Delivered!', body: `Delivery confirmed. You have 48 hours to raise a dispute.` }),
  deal_settled:          (d, m) => ({ title: '💸 Funds Released', body: `EGP ${m?.netPayout} sent to your wallet (commission: EGP ${m?.commission})` }),
  dispute_raised:        (d)    => ({ title: '⚠️ Dispute Opened', body: `A dispute has been raised on deal #${d.id}. Please submit evidence within 24 hours.` }),
  dispute_resolved:      (d, m) => ({ title: '🏛 Dispute Resolved', body: `Resolution: ${m?.resolution?.replace('_', ' ')}` }),
  auto_refunded:         (d)    => ({ title: 'Refund Issued', body: `EGP ${d.amount} refunded. ${d.cancelReason || ''}` }),
  wallet_topup_confirmed:(d, m) => ({ title: '✅ Wallet Topped Up', body: `EGP ${m?.amount} added to your SettePay wallet` }),
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendDealNotification(deal: any, type: string, meta?: Record<string, any>) {
    const msgFn = DEAL_MESSAGES[type];
    if (!msgFn) { this.logger.warn(`No message template for type: ${type}`); return; }
    const { title, body } = msgFn(deal, meta);

    const partyIds = [deal.buyerId, deal.sellerId].filter(Boolean);
    for (const userId of partyIds) {
      await this.notifyUser(userId, type, { title, body, dealId: deal.id }, ['messenger', 'sms', 'push']);
    }
  }

  async notifyUser(userId: string, type: string, payload: Record<string, any>, channels: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    for (const channel of channels) {
      const event = await this.prisma.notificationEvent.create({
        data: { userId, dealId: payload.dealId, channel: channel.toUpperCase() as any, type, payload },
      });
      try {
        if (channel === 'messenger' && user.facebookId) {
          await this.sendMessengerMessage(user.facebookId, payload);
        }
        if (channel === 'sms' && user.mobile && !user.mobile.startsWith('fb_')) {
          await this.sendSms(user.mobile, payload.body || type);
        }
        await this.prisma.notificationEvent.update({ where: { id: event.id }, data: { status: 'SENT', sentAt: new Date() } });
      } catch (err) {
        this.logger.error(`Notification failed [${channel}] for user ${userId}: ${err.message}`);
        await this.prisma.notificationEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: err.message } });
      }
    }
  }

  async sendMessengerMessage(psid: string, payload: Record<string, any>) {
    const token = this.config.get<string>('meta.pageAccessToken');
    if (!token) { this.logger.warn('META_PAGE_ACCESS_TOKEN not set — Messenger skipped'); return; }

    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      recipient: { id: psid },
      message:   { text: `${payload.title}\n${payload.body}` },
    });
  }

  async sendMessengerEscrowTemplate(psid: string, deal: any) {
    const token = this.config.get<string>('meta.pageAccessToken');
    if (!token) return;
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: [{
              title:    `Secure Payment — ${deal.itemDescription}`,
              subtitle: `Amount: EGP ${deal.amount} | Seller: ${deal.seller?.firstName} | Escrow Protected`,
              buttons: [
                { type: 'web_url', url: `${this.config.get('app.frontendUrl')}/deals/${deal.id}/pay`, title: `Pay EGP ${deal.amount}`, webview_height_ratio: 'tall' },
                { type: 'postback', title: 'Cancel Deal', payload: `CANCEL_DEAL_${deal.id}` },
              ],
            }],
          },
        },
      },
    });
  }

  async sendMessengerWelcome(psid: string) {
    const token = this.config.get<string>('meta.pageAccessToken');
    if (!token) return;
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      recipient: { id: psid },
      message:   { text: `👋 Welcome to SettePay Marketplace!\n\nI'm your escrow payment assistant. Send any Facebook Marketplace deal safely.\n\n• Seller shares a payment link\n• Buyer pays securely\n• Funds released on delivery\n\nType the amount and item to start a deal.` },
    });
  }

  private async sendSms(mobile: string, message: string) {
    const url    = this.config.get<string>('sms.gatewayUrl');
    const apiKey = this.config.get<string>('sms.apiKey');
    const sender = this.config.get<string>('sms.senderId') || 'SettePay';
    if (!url || !apiKey) { this.logger.warn('SMS gateway not configured'); return; }
    await axios.post(url, { to: mobile, from: sender, message, api_key: apiKey });
  }

  async alertOpsTeam(dealId: string, message: string) {
    this.logger.error(`OPS ALERT — Deal ${dealId}: ${message}`);
    // In production: send to Slack/PagerDuty/Email
  }
}
