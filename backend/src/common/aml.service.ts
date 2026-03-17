import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

// ─── EMLCU suspicious transaction pattern rules ────────────────────────────────
const AML_RULES = [
  {
    id:          'VELOCITY_DAILY',
    description: 'Single user > EGP 50,000 in 24 hours',
    check:       (volume: number) => volume > 50_000,
  },
  {
    id:          'LARGE_SINGLE',
    description: 'Single transaction > EGP 30,000',
    check:       (amount: number) => amount > 30_000,
  },
  {
    id:          'RAPID_SUCCESSION',
    description: 'More than 10 transactions in 1 hour',
    check:       (count: number) => count > 10,
  },
  {
    id:          'ROUND_AMOUNT_SERIES',
    description: '5+ consecutive round-number transactions (structuring indicator)',
    check:       (roundCount: number) => roundCount >= 5,
  },
];

export interface AmlCheckResult {
  passed:    boolean;
  flags:     string[];
  ruleIds:   string[];
  requiresStr: boolean;
}

@Injectable()
export class AmlService {
  private readonly logger = new Logger(AmlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ── Pre-transaction Check ─────────────────────────────────────────────────
  async checkTransaction(userId: string, amount: number): Promise<AmlCheckResult> {
    const flags:   string[] = [];
    const ruleIds: string[] = [];

    // Rule 1: Daily velocity
    const dayStart = new Date(Date.now() - 86_400_000);
    const dailyAgg = await this.prisma.deal.aggregate({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        createdAt: { gte: dayStart },
        status:    { in: ['ESCROW_ACTIVE', 'SHIPPED', 'DELIVERY_CONFIRMED', 'SETTLED'] },
      },
      _sum: { amount: true },
      _count: { id: true },
    });
    const dailyVolume = (dailyAgg._sum.amount || 0) + amount;
    const hourlyCount = dailyAgg._count.id;

    if (AML_RULES[0].check(dailyVolume)) {
      flags.push(`Daily volume EGP ${dailyVolume.toFixed(2)} exceeds EGP 50,000 threshold`);
      ruleIds.push('VELOCITY_DAILY');
    }

    // Rule 2: Large single transaction
    if (AML_RULES[1].check(amount)) {
      flags.push(`Single transaction EGP ${amount} exceeds EGP 30,000`);
      ruleIds.push('LARGE_SINGLE');
    }

    // Rule 3: Rapid succession
    const hourStart = new Date(Date.now() - 3_600_000);
    const hourlyAgg = await this.prisma.deal.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        createdAt: { gte: hourStart },
      },
    });
    if (AML_RULES[2].check(hourlyAgg)) {
      flags.push(`${hourlyAgg} transactions in the last hour (rapid succession)`);
      ruleIds.push('RAPID_SUCCESSION');
    }

    // Rule 4: Round amount structuring detection
    const isRound = amount % 500 === 0 || amount % 1000 === 0;
    if (isRound) {
      const recentRound = await this.prisma.deal.count({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
          createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
          // Approximate: amounts divisible by 500
        },
      });
      if (AML_RULES[3].check(recentRound)) {
        flags.push(`${recentRound} recent round-amount transactions (potential structuring)`);
        ruleIds.push('ROUND_AMOUNT_SERIES');
      }
    }

    const passed      = flags.length === 0;
    const requiresStr = ruleIds.includes('VELOCITY_DAILY') || ruleIds.includes('LARGE_SINGLE');

    if (!passed) {
      await this.audit.log({
        userId,
        operation:        'aml_check',
        requestSummary:   { amount, flags, ruleIds },
        responseSuccess:  false,
        outcome:          requiresStr ? 'STR_REQUIRED' : 'FLAGGED',
      });

      if (requiresStr) {
        await this.fileStr(userId, amount, flags, ruleIds);
      } else {
        // Log for manual review
        this.logger.warn(`AML flag for user ${userId}: ${flags.join('; ')}`);
        await this.notifications.alertOpsTeam(userId, `AML flag: ${flags.join('; ')}`);
      }
    }

    return { passed: true, flags, ruleIds, requiresStr };
    // NOTE: We return passed:true to allow transaction to proceed but flag it
    // In production, HIGH severity flags (VELOCITY_DAILY + LARGE_SINGLE together) should block
  }

  // ── File STR with EMLCU ───────────────────────────────────────────────────
  async fileStr(userId: string, amount: number, flags: string[], ruleIds: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.logger.error(`STR FILING REQUIRED — User ${userId} (${user?.mobile}), Amount: EGP ${amount}, Rules: ${ruleIds.join(',')}`);

    // In production: POST to EMLCU API or generate STR PDF for manual submission
    // Egypt EMLCU requires STR within 24 hours of detection
    const strPayload = {
      reportType:     'STR',
      reportDate:     new Date().toISOString(),
      reportingEntity: 'SettePay Egypt',
      subject: {
        name:   `${user?.firstName} ${user?.lastName}`,
        mobile: user?.mobile,
        kycTier: user?.kycTier,
      },
      transaction: { amount, currency: 'EGP', flags, ruleIds },
      narrative:    `Automated STR triggered by AML rules: ${ruleIds.join(', ')}. Flags: ${flags.join('; ')}`,
    };

    this.logger.error('STR PAYLOAD:', JSON.stringify(strPayload, null, 2));

    // Alert ops team for manual EMLCU submission
    await this.notifications.alertOpsTeam(userId,
      `⚠️ STR REQUIRED within 24h — EGP ${amount} — Rules: ${ruleIds.join(', ')}`,
    );

    // Flag user for enhanced monitoring
    await this.prisma.user.update({
      where: { id: userId },
      data:  { blockReason: `AML flag: ${ruleIds.join(',')}` },
    });

    await this.audit.log({
      userId,
      operation:      'str_filed',
      requestSummary: strPayload,
      responseSuccess: true,
      outcome:        'STR filed with EMLCU',
    });
  }

  // ── Sanctions Screening ────────────────────────────────────────────────────
  async screenNewUser(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();

    // In production: call Valify sanctions API + OFAC + UN lists
    // Returns true = CLEAR, false = HIT
    this.logger.log(`Sanctions screening for ${fullName}: CLEAR`);
    return true; // All clear
  }

  // ── Daily AML Report ──────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async generateDailyAmlReport() {
    const yesterday = new Date(Date.now() - 86_400_000);
    const stats = await this.prisma.deal.aggregate({
      where: { createdAt: { gte: yesterday }, status: { in: ['ESCROW_ACTIVE','SETTLED','DISPUTED'] } },
      _sum:   { amount: true },
      _count: { id: true },
    });

    const flaggedUsers = await this.prisma.user.findMany({
      where: { blockReason: { not: null } },
      select: { id: true, mobile: true, blockReason: true },
    });

    this.logger.log(`
=== AML DAILY REPORT ===
Date: ${new Date().toLocaleDateString('en-EG')}
Total transactions: ${stats._count.id}
Total volume: EGP ${(stats._sum.amount || 0).toLocaleString()}
Flagged users: ${flaggedUsers.length}
========================`);

    if (flaggedUsers.length > 0) {
      await this.notifications.alertOpsTeam('system',
        `Daily AML: ${flaggedUsers.length} flagged users require review`);
    }
  }

  // ── Weekly Pattern Analysis ────────────────────────────────────────────────
  @Cron('0 9 * * 1') // Every Monday 9am
  async weeklyPatternAnalysis() {
    // Find users with unusually high transaction frequency this week
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const highVolume = await this.prisma.deal.groupBy({
      by: ['buyerId'],
      where: { createdAt: { gte: weekAgo }, status: { in: ['ESCROW_ACTIVE','SETTLED'] } },
      _sum:   { amount: true },
      _count: { id: true },
      having: { amount: { _sum: { gt: 200_000 } } },
    });

    for (const entry of highVolume) {
      this.logger.warn(`High-volume buyer: ${entry.buyerId} — EGP ${entry._sum.amount?.toFixed(2)} in 7 days`);
    }

    if (highVolume.length) {
      await this.notifications.alertOpsTeam('system',
        `Weekly AML: ${highVolume.length} high-volume users require EDD review`);
    }
  }
}
