import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { EscrowService } from '../deals/escrow.service';
import { DealStatus, DisputeStatus } from '@prisma/client';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
  ) {}

  /** Every hour: cancel deals where buyer didn't confirm within 24h */
  @Cron(CronExpression.EVERY_HOUR)
  async cancelTimedOutBuyerConfirmations() {
    const timedOut = await this.prisma.deal.findMany({
      where: {
        status: { in: [DealStatus.AWAITING_BUYER_CONFIRMATION, DealStatus.AWAITING_TOP_UP] },
        buyerConfirmDeadline: { lt: new Date() },
      },
    });
    for (const deal of timedOut) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data:  { status: DealStatus.CANCELLED, cancelReason: 'Buyer did not confirm within 24 hours', cancelledAt: new Date() },
      });
      this.logger.log(`Auto-cancelled deal ${deal.id} — buyer confirmation timeout`);
    }
    if (timedOut.length) this.logger.log(`Cancelled ${timedOut.length} timed-out deals`);
  }

  /** Every 6 hours: auto-refund deals where delivery not confirmed within 14 days */
  @Cron('0 */6 * * *')
  async autoRefundExpiredEscrows() {
    const expired = await this.prisma.deal.findMany({
      where: {
        status: DealStatus.SHIPPED,
        escrowExpiresAt: { lt: new Date() },
      },
    });
    for (const deal of expired) {
      try {
        await this.escrow.autoRefund(deal.id, 'Delivery not confirmed within 14 days — auto-refunded');
        this.logger.log(`Auto-refunded deal ${deal.id}`);
      } catch (err) {
        this.logger.error(`Auto-refund failed for deal ${deal.id}: ${err.message}`);
      }
    }
  }

  /** Every 30 minutes: auto-release escrow after 48h dispute window with no dispute */
  @Cron('*/30 * * * *')
  async autoReleaseAfterDisputeWindow() {
    const readyToRelease = await this.prisma.deal.findMany({
      where: {
        status: DealStatus.DELIVERY_CONFIRMED,
        disputeWindowEnd: { lt: new Date() },
      },
    });
    for (const deal of readyToRelease) {
      try {
        await this.escrow.releaseEscrowOnDelivery(deal.id);
        this.logger.log(`Auto-released escrow for deal ${deal.id} — dispute window closed`);
      } catch (err) {
        this.logger.error(`Auto-release failed for deal ${deal.id}: ${err.message}`);
      }
    }
  }

  /** Daily: flag overdue disputes for ops team */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async flagOverdueDisputes() {
    const overdue = await this.prisma.dispute.findMany({
      where: {
        status: { in: [DisputeStatus.OPEN, DisputeStatus.EVIDENCE_COLLECTION, DisputeStatus.UNDER_REVIEW] },
        resolutionDeadline: { lt: new Date() },
      },
      include: { deal: true },
    });
    for (const d of overdue) {
      this.logger.error(`OVERDUE DISPUTE: ${d.id} — Deal ${d.dealId} — EGP ${d.deal.amount} — deadline was ${d.resolutionDeadline}`);
      // In production: send Slack/PagerDuty alert
    }
    if (overdue.length) this.logger.warn(`${overdue.length} overdue disputes requiring immediate action`);
  }

  /** Daily: reset monthly volume counters on 1st of each month */
  @Cron('0 0 1 * *')
  async resetMonthlyVolumes() {
    const result = await this.prisma.user.updateMany({
      data: { monthlyVolume: 0, monthlyVolumeResetAt: new Date() },
    });
    this.logger.log(`Monthly volume reset for ${result.count} users`);
  }
}
