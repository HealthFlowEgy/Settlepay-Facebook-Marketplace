import {
  Injectable, Inject, Logger, BadRequestException,
  NotFoundException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { decryptToken } from '../common/crypto.util';
import { CommissionService } from '../commission/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { DealStatus, DisputeStatus, DisputeResolution } from '@prisma/client';

/**
 * DisputesService — ME-07 fix: Uses CommissionService instead of hardcoded 0.018
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly commission: CommissionService,         // ME-07 fix: injected
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  async raiseDispute(dealId: string, buyerId: string) {
    const deal = await this.prisma.deal.findUniqueOrThrow({ where: { id: dealId }, include: { buyer: true, seller: true } });

    if (deal.buyerId !== buyerId) throw new BadRequestException('Only the buyer can raise a dispute');
    if (deal.status !== DealStatus.DELIVERY_CONFIRMED && deal.status !== DealStatus.SETTLING) {
      throw new ConflictException('Dispute can only be raised after delivery confirmation');
    }
    if (deal.disputeWindowEnd && deal.disputeWindowEnd < new Date()) {
      throw new BadRequestException('Dispute window has closed (48 hours after delivery)');
    }
    if (await this.prisma.dispute.findUnique({ where: { dealId } })) {
      throw new ConflictException('A dispute is already open for this deal');
    }

    const resolutionHours = this.config.get<number>('escrow.disputeResolutionHours') || 72;
    const dispute = await this.prisma.dispute.create({
      data: {
        dealId, raisedById: buyerId,
        status: DisputeStatus.EVIDENCE_COLLECTION,
        evidenceDeadline:   new Date(Date.now() + 24 * 3_600_000),
        resolutionDeadline: new Date(Date.now() + resolutionHours * 3_600_000),
      },
    });

    await this.prisma.deal.update({ where: { id: dealId }, data: { status: DealStatus.DISPUTED } });
    await this.notifications.sendDealNotification(deal, 'dispute_raised');
    await this.audit.log({ dealId, userId: buyerId, operation: 'raiseDispute', responseSuccess: true });
    return dispute;
  }

  async submitEvidence(disputeId: string, userId: string, evidenceUrls: string[]) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    const deal    = await this.prisma.deal.findUniqueOrThrow({ where: { id: dispute.dealId } });

    const isBuyer  = deal.buyerId  === userId;
    const isSeller = deal.sellerId === userId;
    if (!isBuyer && !isSeller) throw new BadRequestException('Not a party to this dispute');

    const updateData = isBuyer ? { buyerEvidence: evidenceUrls } : { sellerEvidence: evidenceUrls };
    return this.prisma.dispute.update({ where: { id: disputeId }, data: updateData });
  }

  async resolveDispute(
    disputeId: string, adminId: string, resolution: DisputeResolution,
    adminNotes?: string, sellerPayout?: number, buyerRefund?: number,
  ) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    if (dispute.status === DisputeStatus.RESOLVED) throw new ConflictException('Dispute already resolved');

    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dispute.dealId },
      include: { buyer: true, seller: true },
    });

    // GAP-FIX-03: Guard against missing HP tokens before attempting payment
    if (!deal.buyer.hpUserToken) throw new BadRequestException('Buyer HealthPay token missing — buyer must re-authenticate');
    if (!deal.seller.hpUserToken) throw new BadRequestException('Seller HealthPay token missing — seller must re-authenticate');
    const buyerToken  = decryptToken(deal.buyer.hpUserToken);
    const sellerToken = decryptToken(deal.seller.hpUserToken);

    if (resolution === DisputeResolution.FULL_RELEASE) {
      // ME-07 fix: Use CommissionService instead of hardcoded 0.018
      const { commission, netPayout } = this.commission.calculate(deal.amount);
      const desc   = `SettePay Dispute:FullRelease - Deal#${deal.id}`;
      const result = await this.payment.payToUser(sellerToken, netPayout, desc);
      if (!result.isSuccess) throw new BadRequestException('Payment to seller failed');
      await this.audit.log({ dealId: deal.id, userId: adminId, operation: 'resolveDispute:fullRelease', requestSummary: { netPayout }, responseSuccess: true });

    } else if (resolution === DisputeResolution.PARTIAL) {
      if (sellerPayout == null || buyerRefund == null) throw new BadRequestException('sellerPayout and buyerRefund required for PARTIAL');
      // GAP-FIX-10: Validate split amounts sum to exactly deal.amount (no money lost or created)
      const splitTotal = Math.round((sellerPayout + buyerRefund) * 100) / 100;
      const dealAmount = Math.round(deal.amount * 100) / 100;
      if (splitTotal !== dealAmount) {
        throw new BadRequestException(`sellerPayout (${sellerPayout}) + buyerRefund (${buyerRefund}) must equal deal amount (${deal.amount})`);
      }
      const [r1, r2] = await Promise.all([
        this.payment.payToUser(sellerToken, sellerPayout, `SettePay Dispute:PartialRelease - Deal#${deal.id}`),
        this.payment.payToUser(buyerToken,  buyerRefund,  `SettePay Dispute:PartialRefund - Deal#${deal.id}`),
      ]);
      if (!r1.isSuccess || !r2.isSuccess) throw new BadRequestException('One or more dispute payments failed');

    } else if (resolution === DisputeResolution.FULL_REFUND) {
      const desc   = `SettePay Dispute:FullRefund - Deal#${deal.id}`;
      const result = await this.payment.payToUser(buyerToken, deal.amount, desc);
      if (!result.isSuccess) throw new BadRequestException('Refund to buyer failed');
      await this.audit.log({ dealId: deal.id, userId: adminId, operation: 'resolveDispute:fullRefund', requestSummary: { amount: deal.amount }, responseSuccess: true });
    }

    await this.prisma.$transaction([
      this.prisma.dispute.update({
        where: { id: disputeId },
        data:  { status: DisputeStatus.RESOLVED, resolution, resolvedAt: new Date(), resolvedById: adminId, adminNotes, sellerPayout, buyerRefund },
      }),
      this.prisma.deal.update({ where: { id: deal.id }, data: { status: DealStatus.SETTLED, settledAt: new Date() } }),
    ]);

    await this.notifications.sendDealNotification(deal, 'dispute_resolved', { resolution, sellerPayout, buyerRefund });
    return { success: true, resolution };
  }

  async getDispute(disputeId: string) {
    return this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: { deal: { include: { buyer: true, seller: true } }, raisedBy: true },
    });
  }

  async getAllDisputes(status?: DisputeStatus) {
    return this.prisma.dispute.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { deal: { include: { buyer: true, seller: true } } },
    });
  }
}
