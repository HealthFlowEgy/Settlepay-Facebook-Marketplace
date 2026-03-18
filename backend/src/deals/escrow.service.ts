import {
  Injectable, Inject, Logger, BadRequestException,
  NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { decryptToken, generateIdempotencyKey } from '../common/crypto.util';
import { CommissionService } from '../commission/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AmlService } from '../common/aml.service';
import { KycService } from '../kyc/kyc.service';
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
    private readonly aml: AmlService,
    private readonly kyc: KycService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  // ── 1. Initiate Deal ────────────────────────────────────────────────────────
  async initiateDeal(sellerId: string, buyerId: string, amount: number, itemDescription: string, messengerThreadId?: string) {
    if (amount < 50)      throw new BadRequestException('Minimum deal amount is EGP 50');
    if (amount > 50_000)  throw new BadRequestException('Maximum deal amount is EGP 50,000');

    // GAP-FIX-15: Run AML velocity check on the seller before creating a deal.
    // KYC escalation check ensures neither party is below their required tier.
    const sellerAml = await this.aml.checkTransaction(sellerId, amount);
    if (sellerAml.blocked) {
      throw new ForbiddenException(sellerAml.reason || 'Deal blocked by AML policy');
    }

    // Check seller KYC tier — will throw KYC_REQUIRED if threshold breached
    await this.kyc.checkAndEscalate(sellerId, amount);

    // Check buyer is not blocked
    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId }, select: { isBlocked: true, blockReason: true } });
    if (!buyer) throw new BadRequestException(`Buyer ${buyerId} not found`);
    if (buyer.isBlocked) throw new ForbiddenException(`Buyer account is restricted: ${buyer.blockReason || 'contact support'}`);

    const confirmDeadline = new Date(Date.now() + this.config.get<number>('escrow.buyerConfirmTimeoutHours') * 3_600_000);

    const deal = await this.prisma.deal.create({
      data: { sellerId, buyerId, amount, itemDescription, messengerThreadId, status: DealStatus.PENDING, buyerConfirmDeadline: confirmDeadline },
      include: { buyer: true, seller: true },
    });

    await this.audit.log({ dealId: deal.id, operation: 'initiateDeal', responseSuccess: true });
    await this.notifications.sendDealNotification(deal, 'deal_initiated');
    return deal;
  }

  // ── 2. Send Payment Request ─────────────────────────────────────────────────
  async sendPaymentRequestToBuyer(dealId: string) {
    // ME-05 fix: Always include relations when tokens are needed
    const deal = await this.getDeal(dealId, true);
    if (deal.status !== DealStatus.PENDING) throw new ConflictException(`Deal is in ${deal.status} state, expected PENDING`);

    const buyerToken = this.getBuyerToken(deal);
    const result = await this.payment.sendPaymentRequest(buyerToken, deal.amount);

    await this.audit.log({ dealId, userId: deal.buyerId, operation: 'sendPaymentRequest',
      hpOperation: 'sendPaymentRequest', requestSummary: { amount: deal.amount }, responseSuccess: result.isSuccess });

    if (result.isSuccess) {
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.AWAITING_BUYER_CONFIRMATION } });
      await this.notifications.sendDealNotification(deal, 'payment_request_sent');
    }
    return result;
  }

  // ── 3. Execute Escrow Deduction ─────────────────────────────────────────────
  async executeEscrowDeduction(dealId: string) {
    // ME-05 fix: include relations
    const deal = await this.getDeal(dealId, true);
    if (deal.status !== DealStatus.AWAITING_BUYER_CONFIRMATION) throw new ConflictException(`Deal is in ${deal.status} state`);

    // Idempotency
    const idempotencyKey = generateIdempotencyKey(dealId, 'deduct', String(deal.amount));
    const existing = await this.prisma.escrowTransaction.findUnique({ where: { dealId } });
    if (existing?.deductSuccess) {
      this.logger.warn(`Duplicate deduction attempt for deal ${dealId}`);
      return { isSuccess: true, cached: true };
    }

    await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.ESCROW_DEDUCTING, deductIdempotencyKey: idempotencyKey } });

    const buyerToken  = this.getBuyerToken(deal);
    const description = `SettePay Escrow - Deal#${dealId}`;

    try {
      const result = await this.payment.deductFromUser(buyerToken, deal.amount, description);
      await this.audit.log({ dealId, userId: deal.buyerId, operation: 'deductFromUser',
        hpOperation: 'deductFromUser', requestSummary: { amount: deal.amount, description }, responseSuccess: result.isSuccess });

      if (result.isSuccess) {
        // GAP-FIX-13: Set buyerConfirmedAt when escrow deduction succeeds
        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: dealId },
            data: { status: DealStatus.ESCROW_ACTIVE, escrowActivatedAt: new Date(), buyerConfirmedAt: new Date() },
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
    } catch (err: any) {
      if (err instanceof InsufficientFundsError) {
        await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.AWAITING_TOP_UP } });
        await this.notifications.sendDealNotification(deal, 'insufficient_funds');
        throw new BadRequestException('Insufficient wallet balance. Please top up your wallet.');
      }
      if (err instanceof GatewayError) {
        // HI-07 fix: Don't block thread — ScheduledTasksService polls every 5 min
        await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYMENT_ERROR } });
        this.scheduleRetry(dealId, 'deduction');
        await this.notifications.sendDealNotification(deal, 'payment_error');
        throw new BadRequestException('Payment gateway error. Your deal has been queued for retry.');
      }
      throw err;
    }
  }

  // ── 3b. Retry Deduction (called by ScheduledTasksService) ──────────────────
  async retryEscrowDeduction(dealId: string): Promise<void> {
    const deal = await this.getDeal(dealId, true);
    if (deal.status !== DealStatus.PAYMENT_ERROR) return; // Already resolved elsewhere

    const maxRetries = this.config.get<number>('escrow.maxRetryAttempts') ?? 3;
    const tx = await this.prisma.escrowTransaction.findUnique({ where: { dealId }, select: { deductionAttempts: true } });
    const attempts = tx?.deductionAttempts ?? 0;

    // REM-01: Enforce retry cap — escalate to ops and leave deal in PAYMENT_ERROR for manual resolution
    if (attempts >= maxRetries) {
      this.logger.error(`Deal ${dealId} deduction FAILED after ${attempts} attempts — requires MANUAL RESOLUTION`);
      await this.notifications.alertOpsTeam(dealId, `Deduction retry cap (${maxRetries}) reached — MANUAL RESOLUTION REQUIRED`);
      return;
    }

    const buyerToken  = this.getBuyerToken(deal);
    const description = `SettePay Escrow - Deal#${dealId}`;

    try {
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.ESCROW_DEDUCTING } });
      const result = await this.payment.deductFromUser(buyerToken, deal.amount, description);

      if (result.isSuccess) {
        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: dealId },
            data: { status: DealStatus.ESCROW_ACTIVE, escrowActivatedAt: new Date(), buyerConfirmedAt: new Date() },
          }),
          this.prisma.escrowTransaction.upsert({
            where:  { dealId },
            create: { dealId, hpDeductionRef: description, amount: deal.amount, deductedAt: new Date(), deductSuccess: true, deductionAttempts: 1 },
            update: { deductedAt: new Date(), deductSuccess: true, deductionAttempts: { increment: 1 } },
          }),
        ]);
        await this.notifications.sendDealNotification({ ...deal, status: DealStatus.ESCROW_ACTIVE }, 'escrow_active');
        this.logger.log(`Deal ${dealId} deduction succeeded on attempt ${attempts + 1}`);
      } else {
        // Increment attempt count and leave in PAYMENT_ERROR for next scheduler cycle
        await this.prisma.$transaction([
          this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYMENT_ERROR } }),
          this.prisma.escrowTransaction.upsert({
            where:  { dealId },
            create: { dealId, amount: deal.amount, deductionAttempts: 1 },
            update: { deductionAttempts: { increment: 1 } },
          }),
        ]);
        const newAttempts = attempts + 1;
        if (newAttempts >= maxRetries) {
          await this.notifications.alertOpsTeam(dealId, `Deduction retry cap (${maxRetries}) reached — MANUAL RESOLUTION REQUIRED`);
        } else {
          this.logger.warn(`Deal ${dealId} deduction retry ${newAttempts}/${maxRetries} failed — will retry`);
        }
      }
    } catch (err: any) {
      await this.prisma.$transaction([
        this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYMENT_ERROR } }),
        this.prisma.escrowTransaction.upsert({
          where:  { dealId },
          create: { dealId, amount: deal.amount, deductionAttempts: 1 },
          update: { deductionAttempts: { increment: 1 } },
        }),
      ]).catch(() => {});
      await this.notifications.alertOpsTeam(dealId, `Deduction retry exception: ${err.message}`);
    }
  }

  // ── 4. Mark as Shipped ──────────────────────────────────────────────────────
  async markShipped(dealId: string, sellerId: string, waybillId?: string) {
    const deal = await this.getDeal(dealId);
    if (deal.sellerId !== sellerId) throw new BadRequestException('Not authorized');
    if (deal.status !== DealStatus.ESCROW_ACTIVE) throw new ConflictException('Deal must be in ESCROW_ACTIVE state');

    // GAP-FIX-07: escrowExpiresAt is counted from shipment time, not from escrow activation.
    // A seller who ships on day 0 gets the full 14-day delivery window.
    const shippedAt  = new Date();
    const expiresAt  = new Date(shippedAt.getTime() + this.config.get<number>('escrow.deliveryExpiryDays') * 86_400_000);

    const updatedDeal = await this.prisma.deal.update({
      where: { id: dealId },
      data:  { status: DealStatus.SHIPPED, shippedAt, waybillId, escrowExpiresAt: expiresAt },
      include: { buyer: true, seller: true },
    });
    await this.notifications.sendDealNotification(updatedDeal, 'shipped');
    return updatedDeal;
  }

  // ── 5. Release Escrow on Delivery ───────────────────────────────────────────
  async releaseEscrowOnDelivery(dealId: string) {
    // ME-05 fix: include relations
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

    await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.SETTLING, payoutIdempotencyKey: idempotencyKey } });

    const { commission, netPayout } = this.commission.calculate(deal.amount);
    // Commission BEFORE payToUser
    await this.prisma.commissionRecord.upsert({
      where:  { dealId },
      create: { dealId, grossAmount: deal.amount, commissionRate: this.config.get<number>('commission.rate'), commissionAmount: commission, netPayout },
      update: { commissionAmount: commission, netPayout },
    });

    const sellerToken = this.getSellerToken(deal);
    const description = `SettePay Release - Deal#${dealId}`;

    try {
      const result = await this.payment.payToUser(sellerToken, netPayout, description);
      await this.audit.log({ dealId, userId: deal.sellerId, operation: 'payToUser',
        hpOperation: 'payToUser', requestSummary: { amount: netPayout, description }, responseSuccess: result.isSuccess });

      if (result.isSuccess) {
        await this.prisma.$transaction([
          this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.SETTLED, settledAt: new Date(), commission, netPayout } }),
          this.prisma.escrowTransaction.update({ where: { dealId }, data: { hpPayoutRef: description, paidOutAt: new Date(), payoutSuccess: true, commissionAmount: commission, netPayout } }),
        ]);
        await this.notifications.sendDealNotification({ ...deal, status: DealStatus.SETTLED }, 'deal_settled', { netPayout, commission });
      } else {
        await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } });
        this.scheduleRetry(dealId, 'payout');
      }
      return result;
    } catch (err: any) {
      // HI-07 fix: ScheduledTasksService will retry — do not block thread
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } });
      this.scheduleRetry(dealId, 'payout');
      await this.notifications.alertOpsTeam(dealId, `payToUser exception: ${err.message}`);
      throw err;
    }
  }

  // ── 5b. Retry Payout (called by ScheduledTasksService) ─────────────────────
  async retryPayout(dealId: string): Promise<void> {
    const deal = await this.getDeal(dealId, true);
    if (deal.status !== DealStatus.PAYOUT_FAILED) return;

    const maxRetries = this.config.get<number>('escrow.maxRetryAttempts') ?? 3;
    const tx = await this.prisma.escrowTransaction.findUnique({ where: { dealId }, select: { payoutAttempts: true } });
    const attempts = tx?.payoutAttempts ?? 0;

    // REM-01: Enforce retry cap — do not retry indefinitely; funds are safe, but ops must act
    if (attempts >= maxRetries) {
      this.logger.error(`Deal ${dealId} payout FAILED after ${attempts} attempts — requires MANUAL RESOLUTION`);
      await this.notifications.alertOpsTeam(dealId, `Payout retry cap (${maxRetries}) reached — MANUAL RESOLUTION REQUIRED. Seller funds are secured.`);
      return;
    }

    const { commission, netPayout } = this.commission.calculate(deal.amount);
    const sellerToken = this.getSellerToken(deal);
    const description = `SettePay Release - Deal#${dealId}`;

    try {
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.SETTLING } });
      const result = await this.payment.payToUser(sellerToken, netPayout, description);

      if (result.isSuccess) {
        await this.prisma.$transaction([
          this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.SETTLED, settledAt: new Date(), commission, netPayout } }),
          this.prisma.escrowTransaction.update({
            where: { dealId },
            data: { paidOutAt: new Date(), payoutSuccess: true, payoutAttempts: { increment: 1 } },
          }),
        ]);
        await this.notifications.sendDealNotification({ ...deal, status: DealStatus.SETTLED }, 'deal_settled', { netPayout, commission });
        this.logger.log(`Deal ${dealId} payout succeeded on attempt ${attempts + 1}`);
      } else {
        await this.prisma.$transaction([
          this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } }),
          this.prisma.escrowTransaction.update({ where: { dealId }, data: { payoutAttempts: { increment: 1 } } }),
        ]);
        const newAttempts = attempts + 1;
        if (newAttempts >= maxRetries) {
          await this.notifications.alertOpsTeam(dealId, `Payout retry cap (${maxRetries}) reached — MANUAL RESOLUTION REQUIRED`);
        } else {
          this.logger.warn(`Deal ${dealId} payout retry ${newAttempts}/${maxRetries} failed — will retry`);
        }
      }
    } catch (err: any) {
      await this.prisma.$transaction([
        this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.PAYOUT_FAILED } }),
        this.prisma.escrowTransaction.update({ where: { dealId }, data: { payoutAttempts: { increment: 1 } } }),
      ]).catch(() => {});
      await this.notifications.alertOpsTeam(dealId, `Payout retry exception: ${err.message} — MANUAL RESOLUTION REQUIRED`);
    }
  }

  // ── 6. Auto-Refund ─────────────────────────────────────────────────────────
  async autoRefund(dealId: string, reason = 'Delivery not confirmed within 14 days') {
    const deal = await this.getDeal(dealId, true);
    const buyerToken  = this.getBuyerToken(deal);
    const description = `SettePay AutoRefund - Deal#${dealId}`;

    await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.REFUNDING } });
    const result = await this.payment.payToUser(buyerToken, deal.amount, description);
    if (result.isSuccess) {
      await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.REFUNDED, cancelReason: reason, cancelledAt: new Date() } });
      await this.notifications.sendDealNotification(deal, 'auto_refunded', { reason });
    }
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  async getDeal(dealId: string, includeRelations = false) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: includeRelations ? { buyer: true, seller: true } : undefined,
    });
    if (!deal) throw new NotFoundException(`Deal ${dealId} not found`);
    return deal;
  }

  private getBuyerToken(deal: any): string {
    if (!deal.buyer?.hpUserToken) throw new BadRequestException('Buyer HealthPay token not found. Buyer must register via SettePay first.');
    return decryptToken(deal.buyer.hpUserToken);
  }

  private getSellerToken(deal: any): string {
    if (!deal.seller?.hpUserToken) throw new BadRequestException('Seller HealthPay token not found. Seller must register via SettePay first.');
    return decryptToken(deal.seller.hpUserToken);
  }

  private async generateWaybill(deal: any): Promise<void> {
    this.logger.log(`Waybill generation queued for deal ${deal.id}`);
    // Waybill generation is handled by LogisticsService on ESCROW_ACTIVE transition
    // This is intentionally non-blocking — deals proceed even if logistics API is slow
  }

  /**
   * REM-01/REM-02: scheduleRetry is intentionally a no-op here.
   * The deal is already in PAYMENT_ERROR or PAYOUT_FAILED state after the caller updates it.
   * ScheduledTasksService.retryFailedPayments() polls every 5 minutes for deals in those
   * states and calls retryEscrowDeduction() / retryPayout() with full cap enforcement.
   * No "touch" is needed — the cron picks up any deal in the error state.
   */
  private scheduleRetry(dealId: string, type: 'deduction' | 'payout'): void {
    this.logger.log(`Deal ${dealId} queued for ${type} retry — ScheduledTasksService will pick it up within 5 min`);
  }
}
