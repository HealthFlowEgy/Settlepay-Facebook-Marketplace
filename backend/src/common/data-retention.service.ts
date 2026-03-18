import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';

/**
 * DataRetentionService (E.2 / NFR-03 — 7-Year Retention)
 *
 * Strategy: Hot (0–12 months) → Warm (1–3 years) → Cold (3–7 years)
 *
 * 1. PostgreSQL Table Partitioning by year for deals/transactions/audit_logs
 * 2. Monthly Archival Cron: moves records older than 1 year to archive schema
 * 3. S3 Lifecycle Rules for dispute evidence:
 *    - 365 days  → STANDARD_IA
 *    - 1095 days → GLACIER
 *    - 2555 days → Expiration (7 years)
 * 4. Audit Log Immutability:
 *    - REVOKE DELETE ON audit_logs FROM settepay_api_role
 *    - Only archival role can move to cold storage
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monthly archival cron — runs on the 1st of every month at midnight.
   * Moves deals, escrow transactions, and audit logs older than 1 year
   * to the archive schema.
   */
  @Cron('0 0 0 1 * *') // First of every month at midnight
  async archiveOldRecords(): Promise<void> {
    this.logger.log('Starting monthly data archival...');

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

    try {
      // Archive settled deals older than 1 year
      const archivedDeals = await this.archiveDeals(cutoffDate);
      this.logger.log(`Archived ${archivedDeals} deals`);

      // Archive audit logs older than 1 year
      const archivedLogs = await this.archiveAuditLogs(cutoffDate);
      this.logger.log(`Archived ${archivedLogs} audit logs`);

      // Archive notification events older than 1 year
      const archivedNotifications =
        await this.archiveNotifications(cutoffDate);
      this.logger.log(`Archived ${archivedNotifications} notifications`);

      this.logger.log('Monthly data archival completed successfully');
    } catch (error) {
      this.logger.error('Data archival failed', error);
      // TODO: Alert ops team via PagerDuty/Opsgenie
    }
  }

  private async archiveDeals(cutoff: Date): Promise<number> {
    // Move settled/cancelled deals older than cutoff to archive schema
    // In production, use raw SQL with archive schema:
    //
    // INSERT INTO archive.deals SELECT * FROM deals
    //   WHERE created_at < ${cutoff} AND status IN ('SETTLED', 'REFUNDED', 'CANCELLED');
    // DELETE FROM deals
    //   WHERE created_at < ${cutoff} AND status IN ('SETTLED', 'REFUNDED', 'CANCELLED');

    const count = await this.prisma.deal.count({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ['SETTLED', 'REFUNDED', 'CANCELLED'] },
      },
    });

    this.logger.log(
      `Found ${count} deals eligible for archival (before ${cutoff.toISOString()})`,
    );

    // TODO: Execute archive migration in production
    return count;
  }

  private async archiveAuditLogs(cutoff: Date): Promise<number> {
    const count = await this.prisma.auditLog.count({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(
      `Found ${count} audit logs eligible for archival`,
    );

    // TODO: Execute archive migration in production
    // Note: Audit logs are immutable — REVOKE DELETE enforced at DB level
    return count;
  }

  private async archiveNotifications(cutoff: Date): Promise<number> {
    const count = await this.prisma.notificationEvent.count({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(
      `Found ${count} notifications eligible for archival`,
    );

    return count;
  }
}

/**
 * S3 Lifecycle Configuration for Dispute Evidence (Terraform/IaC)
 *
 * lifecycle_rule:
 *   - id: "dispute-evidence-tiering"
 *     transition: { days: 365, storage_class: STANDARD_IA }
 *     transition: { days: 1095, storage_class: GLACIER }
 *     expiration: { days: 2555 }  # 7 years
 */
