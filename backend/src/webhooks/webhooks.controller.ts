import {
  Controller, Post, Get, Body, Headers, Query,
  RawBodyRequest, Req, HttpCode, BadRequestException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyHmacSignature } from '../common/crypto.util';
import { EscrowService } from '../deals/escrow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DealStatus } from '@prisma/client';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly escrow: EscrowService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── HealthPay Notification Webhook ─────────────────────────────────────────
  @Get('healthpay')
  @HttpCode(200)
  async healthPayWebhook(@Query() query: Record<string, string>) {
    // HealthPay uses GET — parse event from query params
    // Format TBD with HealthPay team — handle all known event types
    this.logger.log('HealthPay webhook received:', query);

    const { event, userUid, amount, status } = query;

    if (event === 'topup_complete' || status === 'paid') {
      // Top-up confirmed — find user and refresh their wallet display
      const user = await this.prisma.user.findFirst({ where: { hpUid: userUid } });
      if (user) {
        await this.notifications.notifyUser(user.id, 'wallet_topup_confirmed',
          { amount: parseFloat(amount || '0') }, ['push', 'messenger']);
        // Check if this unblocks a pending deal
        await this.resumePendingDeal(user.id);
      }
    }

    if (event === 'payment_accepted' || status === 'accepted') {
      // Buyer accepted payment request — trigger deduction
      const user = await this.prisma.user.findFirst({ where: { hpUid: userUid } });
      if (user) {
        const pendingDeal = await this.prisma.deal.findFirst({
          where: { buyerId: user.id, status: DealStatus.AWAITING_BUYER_CONFIRMATION },
          orderBy: { updatedAt: 'desc' },
        });
        if (pendingDeal) {
          await this.escrow.executeEscrowDeduction(pendingDeal.id).catch(err =>
            this.logger.error(`Deduction failed after payment acceptance: ${err.message}`));
        }
      }
    }

    return 'OK';
  }

  // ── Bosta Delivery Webhook ─────────────────────────────────────────────────
  @Post('delivery/bosta')
  @HttpCode(200)
  async bostaWebhook(
    @Body() payload: any,
    @Headers('x-bosta-signature') signature: string,
  ) {
    const secret = this.config.get<string>('bosta.webhookSecret');
    if (secret && signature) {
      const isValid = verifyHmacSignature(JSON.stringify(payload), signature, secret);
      if (!isValid) throw new BadRequestException('Invalid Bosta webhook signature');
    }

    this.logger.log(`Bosta webhook: ${payload.state} for waybill ${payload.waybillId || payload.trackingNumber}`);
    await this.audit.log({ operation: 'bostaWebhook', requestSummary: { state: payload.state, waybillId: payload.waybillId } });

    const waybillId = payload.waybillId || payload.trackingNumber;
    if (!waybillId) return 'OK';

    // Find deal by waybill
    const deal = await this.prisma.deal.findFirst({
      where: { waybillId },
      include: { buyer: true, seller: true },
    });

    if (!deal) {
      this.logger.warn(`No deal found for waybill ${waybillId}`);
      return 'OK';
    }

    // Handle Bosta delivery states
    const deliveredStates = ['DELIVERED', 'delivered', '45']; // 45 = Bosta delivered state code
    const isDelivered = deliveredStates.includes(payload.state) ||
                        deliveredStates.includes(String(payload.stateCode));

    if (isDelivered && deal.status === DealStatus.SHIPPED) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data:  { status: DealStatus.DELIVERY_CONFIRMED, deliveredAt: new Date() },
      });

      await this.notifications.sendDealNotification(deal, 'delivery_confirmed');
      await this.escrow.releaseEscrowOnDelivery(deal.id);
    }

    return 'OK';
  }

  // ── Sprint Delivery Webhook ────────────────────────────────────────────────
  @Post('delivery/sprint')
  @HttpCode(200)
  async sprintWebhook(@Body() payload: any, @Headers('x-sprint-signature') signature: string) {
    this.logger.log(`Sprint webhook: ${payload.status} for shipment ${payload.shipmentId}`);

    const deal = await this.prisma.deal.findFirst({
      where: { waybillId: payload.shipmentId },
      include: { buyer: true, seller: true },
    });

    if (!deal) return 'OK';

    if (payload.status === 'DELIVERED' && deal.status === DealStatus.SHIPPED) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data:  { status: DealStatus.DELIVERY_CONFIRMED, deliveredAt: new Date() },
      });
      await this.notifications.sendDealNotification(deal, 'delivery_confirmed');
      await this.escrow.releaseEscrowOnDelivery(deal.id);
    }

    return 'OK';
  }

  // ── Meta Messenger Webhook ─────────────────────────────────────────────────
  @Get('messenger')
  messengerVerify(@Query('hub.mode') mode: string, @Query('hub.challenge') challenge: string, @Query('hub.verify_token') token: string) {
    const expected = this.config.get<string>('meta.verifyToken');
    if (mode === 'subscribe' && token === expected) return parseInt(challenge);
    throw new BadRequestException('Verification failed');
  }

  @Post('messenger')
  @HttpCode(200)
  async messengerEvent(@Body() body: any) {
    if (body.object !== 'page') return 'OK';
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.postback?.payload) {
          await this.handleMessengerPostback(event);
        } else if (event.message?.text) {
          await this.handleMessengerMessage(event);
        }
      }
    }
    return 'OK';
  }

  private async handleMessengerPostback(event: any) {
    const payload = event.postback.payload;
    this.logger.log(`Messenger postback: ${payload}`);
    if (payload.startsWith('CONFIRM_PAYMENT_')) {
      const dealId = payload.replace('CONFIRM_PAYMENT_', '');
      await this.escrow.executeEscrowDeduction(dealId).catch(err =>
        this.logger.error(`Escrow failed from postback: ${err.message}`));
    }
    if (payload.startsWith('CANCEL_DEAL_')) {
      const dealId = payload.replace('CANCEL_DEAL_', '');
      await this.prisma.deal.update({
        where: { id: dealId },
        data:  { status: DealStatus.CANCELLED, cancelReason: 'Buyer declined in Messenger', cancelledAt: new Date() },
      });
    }
  }

  private async handleMessengerMessage(event: any) {
    const text = event.message.text?.toLowerCase() || '';
    if (text.includes('@settepay') || text.includes('settepay')) {
      // Bot activation — send welcome template
      await this.notifications.sendMessengerWelcome(event.sender.id);
    }
  }

  private async resumePendingDeal(userId: string) {
    const pendingDeal = await this.prisma.deal.findFirst({
      where: { buyerId: userId, status: DealStatus.AWAITING_TOP_UP },
    });
    if (pendingDeal) {
      this.logger.log(`Resuming deal ${pendingDeal.id} after top-up`);
      await this.prisma.deal.update({
        where: { id: pendingDeal.id },
        data:  { status: DealStatus.AWAITING_BUYER_CONFIRMATION },
      });
    }
  }
}
