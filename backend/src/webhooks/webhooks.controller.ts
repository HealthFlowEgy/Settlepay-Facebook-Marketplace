import {
  Controller, Post, Get, Body, Headers, Query,
  Req, HttpCode, BadRequestException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyHmacSignature } from '../common/crypto.util';
import { EscrowService } from '../deals/escrow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessengerBotService } from '../messenger/messenger-bot.service';
import { DealStatus } from '@prisma/client';

/**
 * WebhooksController — Fixed: CR-08, HI-03, HI-04, ME-01, ME-03
 *
 * CR-08: Uses MessengerBotService (new dispatcher) — removes duplicate handling
 * ME-01: MessengerBotService.processEvent() wired to POST /webhooks/messenger
 * HI-03: Postback payload format aligned to new bot format (CONFIRM_DELIVERY|, DECLINE_DEAL|)
 * HI-04: HealthPay GET webhook signature verification added (defensive with feature flag)
 * ME-03: Sprint webhook HMAC verification added
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly escrow: EscrowService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly botService: MessengerBotService,  // ME-01: injected
  ) {}

  // ── HealthPay Notification Webhook (GET) ────────────────────────────────────
  // HI-04: HMAC verification added. In dev, logged but not enforced.
  @Get('healthpay')
  @HttpCode(200)
  async healthPayWebhook(@Query() query: Record<string, string>, @Req() req: any) {
    const secret = this.config.get<string>('healthpay.webhookSecret');

    // HI-04: Verify signature when secret is configured
    if (secret) {
      const sig = req.headers['x-healthpay-signature'] as string;
      if (!sig) {
        this.logger.warn('HealthPay webhook missing signature — check HP_WEBHOOK_SECRET config');
        // In production, reject; in dev, allow with warning
        if (process.env.NODE_ENV === 'production') {
          throw new BadRequestException('Missing HealthPay webhook signature');
        }
      } else {
        const payload = new URLSearchParams(query).toString();
        if (!verifyHmacSignature(payload, sig, secret)) {
          this.logger.error('HealthPay webhook HMAC verification FAILED');
          throw new BadRequestException('Invalid HealthPay webhook signature');
        }
      }
    }

    this.logger.log('HealthPay webhook received', query);
    const { event, userUid, amount, status } = query;

    if (event === 'topup_complete' || status === 'paid') {
      const user = await this.prisma.user.findFirst({ where: { hpUid: userUid } });
      if (user) {
        await this.notifications.notifyUser(user.id, 'wallet_topup_confirmed', { amount: parseFloat(amount || '0') }, ['push', 'messenger']);
        await this.resumePendingDeal(user.id);
      }
    }

    if (event === 'payment_accepted' || status === 'accepted') {
      const user = await this.prisma.user.findFirst({ where: { hpUid: userUid } });
      if (user) {
        const pendingDeal = await this.prisma.deal.findFirst({
          where: { buyerId: user.id, status: DealStatus.AWAITING_BUYER_CONFIRMATION },
          orderBy: { updatedAt: 'desc' },
        });
        if (pendingDeal) {
          await this.escrow.executeEscrowDeduction(pendingDeal.id).catch(err =>
            this.logger.error(`Deduction after payment acceptance: ${err.message}`));
        }
      }
    }

    await this.audit.log({ operation: 'healthpayWebhook', requestSummary: { event, status } });
    return 'OK';
  }

  // ── Bosta Delivery Webhook ───────────────────────────────────────────────────
  @Post('delivery/bosta')
  @HttpCode(200)
  async bostaWebhook(
    @Body() payload: any,
    @Headers('x-bosta-signature') signature: string,
  ) {
    const secret = this.config.get<string>('bosta.webhookSecret');
    if (secret) {
      if (!signature) {
        if (process.env.NODE_ENV === 'production') throw new BadRequestException('Missing Bosta signature');
      } else {
        const isValid = verifyHmacSignature(JSON.stringify(payload), signature, secret);
        if (!isValid) throw new BadRequestException('Invalid Bosta webhook signature');
      }
    }

    this.logger.log(`Bosta webhook: state=${payload.state} waybill=${payload.waybillId || payload.trackingNumber}`);
    await this.audit.log({ operation: 'bostaWebhook', requestSummary: { state: payload.state, waybillId: payload.waybillId } });

    const waybillId = payload.waybillId || payload.trackingNumber;
    if (!waybillId) return 'OK';

    const deal = await this.prisma.deal.findFirst({ where: { waybillId }, include: { buyer: true, seller: true } });
    if (!deal) { this.logger.warn(`No deal found for waybill ${waybillId}`); return 'OK'; }

    const deliveredStates = ['DELIVERED', 'delivered', '45'];
    const isDelivered = deliveredStates.includes(payload.state) || deliveredStates.includes(String(payload.stateCode));

    if (isDelivered && deal.status === DealStatus.SHIPPED) {
      await this.prisma.deal.update({ where: { id: deal.id }, data: { status: DealStatus.DELIVERY_CONFIRMED, deliveredAt: new Date() } });
      await this.notifications.sendDealNotification(deal, 'delivery_confirmed');

      // Send confirmation template to buyer via bot
      if (deal.buyer?.psid) {
        // This uses the new bot service — HI-03 fix: CONFIRM_DELIVERY|{dealId} format
        // The bot will send buildDeliveredConfirm template with correct postback
        await this.botService.processEvent({
          sender: { id: deal.buyer.psid },
          _internal: { type: 'delivery_confirmed', dealId: deal.id },
        }).catch(() => {});
      }

      await this.escrow.releaseEscrowOnDelivery(deal.id);
    }

    return 'OK';
  }

  // ── Sprint Delivery Webhook — ME-03: HMAC added ─────────────────────────────
  @Post('delivery/sprint')
  @HttpCode(200)
  async sprintWebhook(
    @Body() payload: any,
    @Headers('x-sprint-signature') signature: string,
  ) {
    // ME-03 fix: HMAC verification
    const secret = this.config.get<string>('sprint.webhookSecret') || process.env.SPRINT_WEBHOOK_SECRET;
    if (secret) {
      if (!signature) {
        if (process.env.NODE_ENV === 'production') throw new BadRequestException('Missing Sprint signature');
        this.logger.warn('Sprint webhook missing signature — dev mode only');
      } else {
        const isValid = verifyHmacSignature(JSON.stringify(payload), signature, secret);
        if (!isValid) throw new BadRequestException('Invalid Sprint webhook signature');
      }
    }

    this.logger.log(`Sprint webhook: status=${payload.status} shipment=${payload.shipmentId}`);
    await this.audit.log({ operation: 'sprintWebhook', requestSummary: { status: payload.status, shipmentId: payload.shipmentId } });

    const deal = await this.prisma.deal.findFirst({
      where: { waybillId: payload.shipmentId },
      include: { buyer: true, seller: true },
    });
    if (!deal) return 'OK';

    if (payload.status === 'DELIVERED' && deal.status === DealStatus.SHIPPED) {
      await this.prisma.deal.update({ where: { id: deal.id }, data: { status: DealStatus.DELIVERY_CONFIRMED, deliveredAt: new Date() } });
      await this.notifications.sendDealNotification(deal, 'delivery_confirmed');
      await this.escrow.releaseEscrowOnDelivery(deal.id);
    }

    return 'OK';
  }

  // ── Meta Messenger Verification ──────────────────────────────────────────────
  @Get('messenger')
  messengerVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ) {
    const expected = this.config.get<string>('meta.verifyToken');
    if (mode === 'subscribe' && token === expected) return parseInt(challenge, 10);
    throw new BadRequestException('Messenger webhook verification failed');
  }

  // ── Meta Messenger Events — ME-01: uses MessengerBotService ─────────────────
  @Post('messenger')
  @HttpCode(200)
  async messengerEvent(@Body() body: any, @Req() req: any) {
    // Verify app secret signature
    const appSecret = this.config.get<string>('meta.appSecret');
    if (appSecret) {
      const sig = (req.headers['x-hub-signature-256'] as string)?.replace('sha256=', '');
      if (sig) {
        const rawBody = req.rawBody || JSON.stringify(body);
        const isValid = verifyHmacSignature(typeof rawBody === 'string' ? rawBody : rawBody.toString(), sig, appSecret);
        if (!isValid) {
          this.logger.warn('Messenger webhook signature mismatch');
          throw new BadRequestException('Invalid Messenger webhook signature');
        }
      }
    }

    if (body.object !== 'page') return 'OK';

    // ME-01 fix: Route ALL events through MessengerBotService (new dispatcher)
    // CR-08 fix: No parallel old-style handling — one path only
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        await this.botService.processEvent(event).catch(err =>
          this.logger.error(`Bot event processing error: ${err.message}`));
      }
    }

    return 'OK';
  }

  private async resumePendingDeal(userId: string): Promise<void> {
    const pendingDeal = await this.prisma.deal.findFirst({
      where: { buyerId: userId, status: DealStatus.AWAITING_TOP_UP },
    });
    if (pendingDeal) {
      await this.prisma.deal.update({
        where: { id: pendingDeal.id },
        data: { status: DealStatus.AWAITING_BUYER_CONFIRMATION },
      });
      this.logger.log(`Resumed deal ${pendingDeal.id} after top-up`);
    }
  }
}
