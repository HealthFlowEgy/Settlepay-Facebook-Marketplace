import {
  Injectable, Inject, Logger, BadRequestException,
  NotFoundException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { decryptToken, generateIdempotencyKey } from '../common/crypto.util';
import { CommissionService } from '../commission/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { InsufficientFundsError, GatewayError } from '../payment/healthpay.adapter';
import { DealStatus } from '@prisma/client';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly commission: CommissionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  // ── 1. Initiate Deal ─────────────────────────────────────────────────────────
  async initiateDeal(
    sellerId: string,
    buyerId: string,
    amount: number,
    itemDescription: string,
    messengerThreadId?: string,
  ) {
    if (amount < 50) throw new BadRequestException('Minimum deal amount is EGP 50');
    if (amount > 50_000) throw new BadRequestException('Maximum deal amount is EGP 50,000 — contact support');

    const confirmDeadline = new Date(Date.now() + this.config.get('escrow.buyerConfirmTimeoutHours') * 3_600_000);

    const deal = await this.prisma.deal.create({
      data: {
        sellerId, buyerId, amount, itemDescription,
        messengerThreadId,
        status: DealStatus.PENDING,
        buyerConfirmDeadline: confirmDeadline,
      },
      include: { buyer: true, seller: true },
    });

    await this.audit.log({ dealId: deal.id, operation: 'initiateDeal', responseSuccess: true });
    await this.notifications.sendDealNotification(deal, 'deal_initiated');

    return deal;
  }

  // ── 2. Send Payment Request (Buyer Approval) ──────────────────────────────
  async sendPaymentRequestToBuyer(dealId: string) {
    const deal = await this.getDeal(dealId);
    if (deal.status !== DealStatus.PENDING) {
      throw new ConflictException(`Deal is in ${deal.status} state, expected PENDING`);
    }

    const buyerToken = this.getBuyerToken(deal);

    const result = await this.payment.sendPaymentRequest(buyerToken, deal.amount);
    await this.audit.log({ dealId, userId: deal.buyerId, operation: 'sendPaymentRequest',
      hpOperation: 'sendPaymentRequest', requestSummary: { amount: deal.amount },
      responseSuccess: result.isSuccess });

    if (result.isSuccess) {
      await this.prisma.deal.update({
        where: { id: dealId },
        data:  { status: DealStatus.AWAITING_BUYER_CONFIRMATION },
      });
      await this.notifications.sendDealNotification(deal, 'payment_request_sent');
    }

    return result;
  }

  // ── 3. Execute Escrow Deduction ───────────────────────────────────────────
  async executeEscrowDeduction(dealId: string) {
    const deal = await this.getDeal(dealId);
    if (deal.status !== DealStatus.AWAITING_BUYER_CONFIRMATION) {
      throw new ConflictException(`Deal is in ${deal.status} state`);
    }

    // Check idempotency — prevent double-charge
    const idempotencyKey = generateIdempotencyKey(dealId, 'deduct', String(deal.amount));
    const existing = await this.prisma.escrowTransaction.findUnique({ where: { dealId } });
    if (existing?.deductSuccess) {
      this.logger.warn(`Duplicate deduction attempt for deal ${dealId} — returning cached result`);
      return { isSuccess: true, cached: true };
    }

    await this.prisma.deal.update({
      where: { id: dealId },
      data:  { status: DealStatus.ESCROW_DEDUCTING, deductIdempotencyKey: idempotencyKey },
    });

    const buyerToken  = this.getBuyerToken(deal);
    const description = `SettePay Escrow - Deal#${dealId}`;

    try {
      const result = await this.payment.deductFromUser(buyerToken, deal.amount, description);
      await this.audit.log({ dealId, userId: deal.buyerId, operation: 'deductFromUser',
        hpOperation: 'deductFromUser', requestSummary: { amount: deal.amount, description },
        responseSuccess: result.isSuccess });

      if (result.isSuccess) {
        const expiresAt = new Date(Date.now() + this.config.get('escrow.deliveryExpiryDays') * 86_400_000);
        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: dealId },
            data:  { status: DealStatus.ESCROW_ACTIVE, escrowActivatedAt: new Date(), escrowExpiresAt: expiresAt },
          }),
          this.prisma.escrowTransaction.upsert({
            where:  { dealId },
            create: { dealId, hpDeductionRef: description, amount: deal.amount, deductedAt: new Date(), deductSuccess: true },
            update: { hpDeductionRef: description, deductedAt: new Date(), deductSuccess: true },
          }),
        ]);

        await this.notifications.sendDealNotification({ ...deal, status: DealStatus.ESCROW_ACTIVE }, 'escrow_active');
        await this.generateWaybill(deal);
      }
      return result;
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        await this.prisma.deal.update({
          where: { id: dealId },
          data:  { status: DealStatus.AWAITING_TOP_UP },
        });
        await this.notifications.sendDealNotification(deal, 'insufficient_funds');
        throw new BadRequestException('Insufficient wallet balance. Please top up your wallet.');
      }
      if (err instanceof GatewayError) {
        // Retry once after 5s
        await new Promise(r => setTimeout(r, 5000));
        try {
          const retry = await this.payment.deductFromUser(buyerToken, deal.amount, description);
          if (retry.isSuccess) {
            await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.ESCROW_ACTIVE, escrowActivatedAt: new Date() } });
            return retry;
          }
        } catch {}
        await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYMENT_ERROR } });
        await this.notifications.sendDealNotification(deal, 'payment_error');
        throw new BadRequestException('Payment gateway error. Deal cancelled. No charge made.');
      }
      throw err;
    }
  }

  // ── 4. Mark as Shipped ────────────────────────────────────────────────────
  async markShipped(dealId: string, sellerId: string, waybillId?: string) {
    const deal = await this.getDeal(dealId);
    if (deal.sellerId !== sellerId) throw new BadRequestException('Not authorized');
    if (deal.status !== DealStatus.ESCROW_ACTIVE) throw new ConflictException('Deal must be in ESCROW_ACTIVE state');

    const updatedDeal = await this.prisma.deal.update({
      where: { id: dealId },
      data:  { status: DealStatus.SHIPPED, shippedAt: new Date(), waybillId },
      include: { buyer: true, seller: true },
    });

    await this.notifications.sendDealNotification(updatedDeal, 'shipped');
    return updatedDeal;
  }

  // ── 5. Release Escrow on Delivery ─────────────────────────────────────────
  async releaseEscrowOnDelivery(dealId: string) {
    const deal = await this.getDeal(dealId, true);
    if (deal.status !== DealStatus.DELIVERY_CONFIRMED && deal.status !== DealStatus.SETTLING) {
      throw new ConflictException('Deal must be in DELIVERY_CONFIRMED state to release escrow');
    }

    // Idempotency
    const idempotencyKey = generateIdempotencyKey(dealId, 'payout', String(deal.amount));
    const existingTx = await this.prisma.escrowTransaction.findUnique({ where: { dealId } });
    if (existingTx?.payoutSuccess) {
      this.logger.warn(`Duplicate payout attempt for deal ${dealId}`);
      return { isSuccess: true, cached: true };
    }

    await this.prisma.deal.update({
      where: { id: dealId },
      data:  { status: DealStatus.SETTLING, payoutIdempotencyKey: idempotencyKey },
    });

    // Calculate commission
    const { commission, netPayout } = this.commission.calculate(deal.amount);

    // Record commission BEFORE calling payToUser
    await this.prisma.commissionRecord.upsert({
      where:  { dealId },
      create: { dealId, grossAmount: deal.amount, commissionRate: this.config.get('commission.rate'),
                commissionAmount: commission, netPayout },
      update: { commissionAmount: commission, netPayout },
    });

    const sellerToken = this.getSellerToken(deal);
    const description = `SettePay Release - Deal#${dealId}`;

    try {
      const result = await this.payment.payToUser(sellerToken, netPayout, description);
      await this.audit.log({ dealId, userId: deal.sellerId, operation: 'payToUser',
        hpOperation: 'payToUser', requestSummary: { amount: netPayout, description },
        responseSuccess: result.isSuccess });

      if (result.isSuccess) {
        const disputeWindowEnd = new Date(Date.now() +
          this.config.get('escrow.disputeWindowHours') * 3_600_000);

        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: dealId },
            data:  { status: DealStatus.SETTLED, settledAt: new Date(), commission, netPayout,
                     disputeWindowEnd },
          }),
          this.prisma.escrowTransaction.update({
            where:  { dealId },
            data:   { hpPayoutRef: description, paidOutAt: new Date(), payoutSuccess: true,
                      commissionAmount: commission, netPayout },
          }),
        ]);

        await this.notifications.sendDealNotification(
          { ...deal, status: DealStatus.SETTLED }, 'deal_settled',
          { netPayout, commission },
        );
      } else {
        await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } });
        await this.notifications.alertOpsTeam(dealId, 'payToUser failed after delivery confirmation');
      }
      return result;
    } catch (err) {
      // Retry once
      await new Promise(r => setTimeout(r, 5000));
      try {
        const retry = await this.payment.payToUser(sellerToken, netPayout, description);
        if (retry.isSuccess) {
          await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.SETTLED, settledAt: new Date() } });
          return retry;
        }
      } catch {}
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } });
      await this.notifications.alertOpsTeam(dealId, `payToUser failed: ${err.message}`);
      throw err;
    }
  }

  // ── 6. Auto-Refund (14-day expiry) ────────────────────────────────────────
  async autoRefund(dealId: string, reason = 'Delivery not confirmed within 14 days') {
    const deal = await this.getDeal(dealId, true);
    const buyerToken = this.getBuyerToken(deal);
    const description = `SettePay AutoRefund - Deal#${dealId}`;

    await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.REFUNDING } });

    const result = await this.payment.payToUser(buyerToken, deal.amount, description);
    if (result.isSuccess) {
      await this.prisma.deal.update({
        where: { id: dealId },
        data:  { status: DealStatus.REFUNDED, cancelReason: reason, cancelledAt: new Date() },
      });
      await this.notifications.sendDealNotification(deal, 'auto_refunded', { reason });
    }
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async getDeal(dealId: string, includeRelations = false) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: includeRelations ? { buyer: true, seller: true } : undefined,
    });
    if (!deal) throw new NotFoundException(`Deal ${dealId} not found`);
    return deal;
  }

  private getBuyerToken(deal: any): string {
    if (!deal.buyer?.hpUserToken) throw new BadRequestException('Buyer HealthPay token not found');
    return decryptToken(deal.buyer.hpUserToken);
  }

  private getSellerToken(deal: any): string {
    if (!deal.seller?.hpUserToken) throw new BadRequestException('Seller HealthPay token not found');
    return decryptToken(deal.seller.hpUserToken);
  }

  private async generateWaybill(deal: any) {
    // Bosta/Sprint waybill generation would be implemented here
    this.logger.log(`Generating waybill for deal ${deal.id}`);
  }
}
