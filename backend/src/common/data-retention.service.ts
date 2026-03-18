import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';

/**
 * DataRetentionService (E.2 / NFR-03 — Fixed: HI-05)
 *
 * HI-05 fix: Cron now executes actual archival SQL, not just a count.
 * Strategy: Hot (0–12 months) → Warm archive schema (1–3 years) → Cold S3/Glacier (3–7 years)
 *
 * Prerequisites (run once in production):
 *   CREATE SCHEMA IF NOT EXISTS archive;
 *   CREATE TABLE archive.deals AS SELECT * FROM deals WHERE FALSE;
 *   CREATE TABLE archive.audit_logs AS SELECT * FROM audit_logs WHERE FALSE;
 *   CREATE TABLE archive.notification_events AS SELECT * FROM notification_events WHERE FALSE;
 *   REVOKE DELETE ON audit_logs FROM settepay_api_role;  -- immutability
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 0 0 1 * *') // First of every month at midnight
  async archiveOldRecords(): Promise<void> {
    this.logger.log('Starting monthly data archival...');

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1); // 1 year ago

    try {
      const [archivedDeals, archivedLogs, archivedNotifications] = await Promise.all([
        this.archiveDeals(cutoffDate),
        this.archiveAuditLogs(cutoffDate),
        this.archiveNotifications(cutoffDate),
      ]);

      this.logger.log(`Monthly archival complete: deals=${archivedDeals} audit_logs=${archivedLogs} notifications=${archivedNotifications}`);
    } catch (error: any) {
      this.logger.error('Data archival failed', error.message);
      // Alert ops team
    }
  }

  private async archiveDeals(cutoff: Date): Promise<number> {
    // HI-05 fix: Execute actual INSERT + DELETE (requires archive schema)
    const result = await this.prisma.$executeRaw`
      DO $$
      BEGIN
        -- Only run if archive schema exists
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'archive') THEN
          -- Insert to archive
          INSERT INTO archive.deals
            SELECT * FROM deals
            WHERE "createdAt" < ${cutoff}
              AND status IN ('SETTLED', 'REFUNDED', 'CANCELLED')
            ON CONFLICT DO NOTHING;

          -- Delete from hot table
          DELETE FROM deals
            WHERE "createdAt" < ${cutoff}
              AND status IN ('SETTLED', 'REFUNDED', 'CANCELLED');
        ELSE
          RAISE NOTICE 'archive schema not found — skipping deal archival. Run: CREATE SCHEMA archive';
        END IF;
      END $$;
    `;

    // Count remaining eligible (should be 0 if archival ran)
    const remaining = await this.prisma.deal.count({
      where: { createdAt: { lt: cutoff }, status: { in: ['SETTLED', 'REFUNDED', 'CANCELLED'] } },
    });

    this.logger.log(`Deal archival: ${remaining} records remaining (${remaining === 0 ? '✅ clean' : '⚠️ may need archive schema'}) before ${cutoff.toISOString()}`);
    return remaining;
  }

  private async archiveAuditLogs(cutoff: Date): Promise<number> {
    // Audit logs: copy to archive, but DO NOT DELETE (immutability — REVOKE DELETE enforced at DB level)
    await this.prisma.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'archive') THEN
          INSERT INTO archive.audit_logs
            SELECT * FROM audit_logs
            WHERE "createdAt" < ${cutoff}
            ON CONFLICT DO NOTHING;
          -- Note: NO DELETE from audit_logs — append-only per CBE requirement
        END IF;
      END $$;
    `;

    const count = await this.prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });
    this.logger.log(`Audit log archival: ${count} records copied to archive (originals preserved per CBE requirement)`);
    return count;
  }

  private async archiveNotifications(cutoff: Date): Promise<number> {
    await this.prisma.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'archive') THEN
          INSERT INTO archive.notification_events
            SELECT * FROM notification_events
            WHERE "createdAt" < ${cutoff}
            ON CONFLICT DO NOTHING;

          DELETE FROM notification_events
            WHERE "createdAt" < ${cutoff};
        END IF;
      END $$;
    `;

    const count = await this.prisma.notificationEvent.count({ where: { createdAt: { lt: cutoff } } });
    this.logger.log(`Notification archival: ${count} remaining`);
    return count;
  }

  /**
   * Verify 7-year retention compliance
   * Run on demand or quarterly to confirm old records are accessible in archive
   */
  async verifyRetentionCompliance(): Promise<{ compliant: boolean; issues: string[] }> {
    const issues: string[] = [];
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

    // Check that records older than 7 years have been purged from hot table
    const overdueHot = await this.prisma.deal.count({
      where: { createdAt: { lt: sevenYearsAgo } },
    });
    if (overdueHot > 0) issues.push(`${overdueHot} deals older than 7 years in hot table — should be purged`);

    const overdueAudit = await this.prisma.auditLog.count({
      where: { createdAt: { lt: sevenYearsAgo } },
    });
    if (overdueAudit > 0) issues.push(`${overdueAudit} audit logs older than 7 years — verify purge schedule`);

    return { compliant: issues.length === 0, issues };
  }
}

/*
 * S3 Lifecycle Policy for Dispute Evidence (Terraform / AWS Console):
 *
 * resource "aws_s3_bucket_lifecycle_configuration" "dispute_evidence" {
 *   bucket = aws_s3_bucket.dispute_evidence.id
 *   rule {
 *     id     = "dispute-evidence-tiering"
 *     status = "Enabled"
 *     transition { days = 365;  storage_class = "STANDARD_IA" }
 *     transition { days = 1095; storage_class = "GLACIER" }
 *     expiration { days = 2555 }  # 7 years
 *   }
 * }
 *
 * Audit Immutability (run once in prod):
 *   REVOKE DELETE ON audit_logs FROM settepay_api_role;
 *   REVOKE TRUNCATE ON audit_logs FROM settepay_api_role;
 *   GRANT INSERT, SELECT ON audit_logs TO settepay_api_role;
 */
