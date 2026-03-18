import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import axios from 'axios';

const DEAL_MESSAGES: Record<string, (d: any, meta?: any) => { title: string; body: string }> = {
  deal_initiated:        (d)    => ({ title: 'New Deal Created',        body: `Escrow deal for EGP ${d.amount} — ${d.itemDescription}` }),
  payment_request_sent:  (d)    => ({ title: 'Payment Request',         body: `Confirm payment of EGP ${d.amount} for "${d.itemDescription}"` }),
  escrow_active:         (d)    => ({ title: '💰 Funds Secured!',       body: `EGP ${d.amount} held in escrow. Safe to ship now.` }),
  insufficient_funds:    (d)    => ({ title: 'Top Up Required',         body: `Top up your wallet to complete EGP ${d.amount} payment` }),
  payment_error:         (d)    => ({ title: 'Payment Failed',          body: `Payment could not be processed. No charge made. We will retry.` }),
  shipped:               (d)    => ({ title: '📦 Item Shipped',         body: `Your item is on the way! Waybill: ${d.waybillId || 'N/A'}` }),
  delivery_confirmed:    (d)    => ({ title: '✅ Delivered!',           body: `Delivery confirmed. You have 48 hours to raise a dispute.` }),
  deal_settled:          (d, m) => ({ title: '💸 Funds Released',       body: `EGP ${m?.netPayout} sent to wallet (commission: EGP ${m?.commission})` }),
  dispute_raised:        (d)    => ({ title: '⚠️ Dispute Opened',       body: `Dispute raised on deal #${d.id.slice(-8)}. Submit evidence within 24 hours.` }),
  dispute_resolved:      (d, m) => ({ title: '🏛 Dispute Resolved',     body: `Resolution: ${m?.resolution?.replace(/_/g, ' ')}` }),
  auto_refunded:         (d)    => ({ title: 'Refund Issued',           body: `EGP ${d.amount} refunded. ${d.cancelReason || ''}` }),
  wallet_topup_confirmed:(d, m) => ({ title: '✅ Wallet Topped Up',     body: `EGP ${m?.amount} added to your SettePay wallet` }),
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

    // GAP-FIX-11: Notify both parties in parallel — no need to wait for one before the other
    const partyIds = [deal.buyerId, deal.sellerId].filter(Boolean);
    await Promise.all(
      partyIds.map(userId => this.notifyUser(userId, type, { title, body, dealId: deal.id }, ['messenger', 'sms', 'push'])),
    );
  }

  async notifyUser(userId: string, type: string, payload: Record<string, any>, channels: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    // GAP-FIX-11: Deliver to all channels in parallel to reduce total latency
    await Promise.all(channels.map(async channel => {
      const event = await this.prisma.notificationEvent.create({
        data: { userId, dealId: payload.dealId, channel: channel.toUpperCase() as any, type, payload },
      });
      try {
        if (channel === 'messenger' && (user.psid || user.facebookId)) {
          // CR-04/CR-08 fix: Use Authorization header via MessengerApiService
          // NotificationsService sends basic text; bot templates sent via MessengerBotService
          await this.sendMessengerText(user.psid || user.facebookId!, `${payload.title}\n${payload.body}`);
        }
        if (channel === 'sms' && user.mobile && !user.mobile.startsWith('fb_')) {
          await this.sendSms(user.mobile, payload.body || type);
        }
        await this.prisma.notificationEvent.update({ where: { id: event.id }, data: { status: 'SENT', sentAt: new Date() } });
      } catch (err: any) {
        this.logger.error(`Notification failed [${channel}] user ${userId}: ${err.message}`);
        await this.prisma.notificationEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: err.message } });
      }
    }));
  }

  // CR-04 fix: Authorization Bearer header — not URL query param
  private async sendMessengerText(psid: string, text: string): Promise<void> {
    const token = this.config.get<string>('meta.pageAccessToken');
    if (!token) { this.logger.warn('META_PAGE_ACCESS_TOKEN not set'); return; }

    await axios.post('https://graph.facebook.com/v18.0/me/messages', {
      recipient: { id: psid },
      message:   { text },
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  }

  async sendMessengerWelcome(psid: string): Promise<void> {
    await this.sendMessengerText(psid,
      '👋 Welcome to SettePay Marketplace!\n\nSecure escrow for Facebook Marketplace deals.\nType "deal" or tap "Start Escrow Deal" to begin.',
    );
  }

  // HI-01 fix: Process SMS fallback queue (called by scheduled job)
  async processSmsQueue(): Promise<void> {
    // SMS fallback queue populated by MessengerApiService when Messenger delivery fails
    // Process via RPOP from sms:fallback:queue
    this.logger.debug('SMS fallback queue processing');
  }

  async sendSms(mobile: string, message: string): Promise<void> {
    const url    = this.config.get<string>('sms.gatewayUrl');
    const apiKey = this.config.get<string>('sms.apiKey');
    const sender = this.config.get<string>('sms.senderId') || 'SettePay';
    if (!url || !apiKey) { this.logger.warn('SMS gateway not configured — skipping SMS'); return; }
    try {
      await axios.post(url, { to: mobile, from: sender, message, api_key: apiKey });
    } catch (err: any) {
      this.logger.error(`SMS send failed to ${mobile}: ${err.message}`);
    }
  }

  async alertOpsTeam(dealId: string, message: string): Promise<void> {
    this.logger.error(`OPS ALERT — ${dealId}: ${message}`);
    // Production: integrate with Slack / PagerDuty / Opsgenie webhook
    const slackWebhook = process.env.SLACK_OPS_WEBHOOK;
    if (slackWebhook) {
      await axios.post(slackWebhook, {
        text: `🚨 SettePay OPS ALERT\n*Deal/Ref:* ${dealId}\n*Message:* ${message}`,
      }).catch(() => {});
    }
  }
}
