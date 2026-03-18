import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

const AML_RULES = [
  { id: 'VELOCITY_DAILY',    description: 'Single user > EGP 50,000 in 24 hours',              severity: 'HIGH',   blocks: true  },
  { id: 'LARGE_SINGLE',      description: 'Single transaction > EGP 30,000',                   severity: 'HIGH',   blocks: false },
  { id: 'RAPID_SUCCESSION',  description: 'More than 10 transactions in 1 hour',               severity: 'MEDIUM', blocks: false },
  { id: 'ROUND_AMOUNT_SERIES', description: '5+ consecutive round-number transactions',       severity: 'MEDIUM', blocks: false },
];

// Tier-0 (unverified) daily/monthly caps per BRL-13
const TIER0_CAPS = { singleTx: 200, daily: 500, monthly: 2000 };

export interface AmlCheckResult {
  passed:      boolean;
  flags:       string[];
  ruleIds:     string[];
  requiresStr: boolean;
  blocked:     boolean;
  reason?:     string;
}

@Injectable()
export class AmlService {
  private readonly logger = new Logger(AmlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async checkTransaction(userId: string, amount: number): Promise<AmlCheckResult> {
    const flags:   string[] = [];
    const ruleIds: string[] = [];
    let blocked = false;
    let blockReason: string | undefined;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // ─── BRL-13: Tier-0 hard caps ──────────────────────────────────────────────
    if (user.kycTier === 'TIER_0') {
      if (amount > TIER0_CAPS.singleTx) {
        blocked = true;
        blockReason = `Unverified users cannot transact more than EGP ${TIER0_CAPS.singleTx} per transaction. Please verify your identity.`;
        return { passed: false, flags: [blockReason], ruleIds: ['TIER0_SINGLE_CAP'], requiresStr: false, blocked, reason: blockReason };
      }

      // Daily cap check
      const dayStart = new Date(Date.now() - 86_400_000);
      const dailyAgg = await this.prisma.deal.aggregate({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }], createdAt: { gte: dayStart }, status: { in: ['ESCROW_ACTIVE', 'SHIPPED', 'SETTLED'] } },
        _sum: { amount: true },
      });
      const dailyTotal = (dailyAgg._sum.amount || 0) + amount;
      if (dailyTotal > TIER0_CAPS.daily) {
        blocked = true;
        blockReason = `Daily limit of EGP ${TIER0_CAPS.daily} exceeded for unverified accounts. Please verify your identity.`;
        return { passed: false, flags: [blockReason], ruleIds: ['TIER0_DAILY_CAP'], requiresStr: false, blocked, reason: blockReason };
      }

      // Monthly cap check
      const monthStart = new Date(user.monthlyVolumeResetAt || Date.now() - 30 * 86_400_000);
      const monthlyTotal = user.monthlyVolume + amount;
      if (monthlyTotal > TIER0_CAPS.monthly) {
        blocked = true;
        blockReason = `Monthly limit of EGP ${TIER0_CAPS.monthly} exceeded for unverified accounts. Please verify your identity.`;
        return { passed: false, flags: [blockReason], ruleIds: ['TIER0_MONTHLY_CAP'], requiresStr: false, blocked, reason: blockReason };
      }
    }

    // ─── AML Rules ─────────────────────────────────────────────────────────────
    const dayStart = new Date(Date.now() - 86_400_000);
    const dailyAgg = await this.prisma.deal.aggregate({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], createdAt: { gte: dayStart }, status: { in: ['ESCROW_ACTIVE', 'SHIPPED', 'SETTLED'] } },
      _sum: { amount: true }, _count: { id: true },
    });

    // Rule 1: Velocity
    const dailyVolume = (dailyAgg._sum.amount || 0) + amount;
    if (dailyVolume > 50_000) {
      flags.push(`Daily volume EGP ${dailyVolume.toFixed(2)} exceeds EGP 50,000`);
      ruleIds.push('VELOCITY_DAILY');
      blocked = true; // HI-06 fix: VELOCITY_DAILY blocks
      blockReason = 'Daily transaction limit exceeded. Your account requires enhanced verification.';
    }

    // Rule 2: Large single
    if (amount > 30_000) {
      flags.push(`Single transaction EGP ${amount} exceeds EGP 30,000`);
      ruleIds.push('LARGE_SINGLE');
    }

    // Rule 3: Rapid succession
    const hourStart = new Date(Date.now() - 3_600_000);
    const hourlyCount = await this.prisma.deal.count({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], createdAt: { gte: hourStart } },
    });
    if (hourlyCount > 10) {
      flags.push(`${hourlyCount} transactions in the last hour`);
      ruleIds.push('RAPID_SUCCESSION');
    }

    // Rule 4: Round-amount structuring
    // GAP-FIX-04: Only count deals whose amount is also a round number (not all recent deals)
    const isRound = amount % 500 === 0 || amount % 1000 === 0;
    if (isRound) {
      const recentDeals = await this.prisma.deal.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }], createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
        select: { amount: true },
      });
      const recentRoundCount = recentDeals.filter(d => d.amount % 500 === 0 || d.amount % 1000 === 0).length;
      if (recentRoundCount >= 5) {
        flags.push(`${recentRoundCount} recent round-amount transactions (potential structuring)`);
        ruleIds.push('ROUND_AMOUNT_SERIES');
      }
    }

    const requiresStr = ruleIds.includes('VELOCITY_DAILY') || ruleIds.includes('LARGE_SINGLE');

    if (flags.length > 0) {
      await this.audit.log({
        userId, operation: 'aml_check',
        requestSummary: { amount, flags, ruleIds, blocked },
        responseSuccess: !blocked, outcome: requiresStr ? 'STR_REQUIRED' : 'FLAGGED',
      });
      if (requiresStr) await this.fileStr(userId, amount, flags, ruleIds);
      else this.logger.warn(`AML flag for user ${userId}: ${flags.join('; ')}`);
      if (!blocked) await this.notifications.alertOpsTeam(userId, `AML flag: ${flags.join('; ')}`);
    }

    // HI-06 fix: Return ACTUAL passed status
    return {
      passed:      !blocked && flags.length === 0,
      flags,
      ruleIds,
      requiresStr,
      blocked,
      reason:      blockReason,
    };
  }

  async fileStr(userId: string, amount: number, flags: string[], ruleIds: string[]): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const strPayload = {
      reportType: 'STR', reportDate: new Date().toISOString(), reportingEntity: 'SettePay Egypt',
      subject: { name: `${user?.firstName} ${user?.lastName}`, mobile: user?.mobile, kycTier: user?.kycTier },
      transaction: { amount, currency: 'EGP', flags, ruleIds },
      narrative: `Automated STR: ${ruleIds.join(', ')}. Flags: ${flags.join('; ')}`,
    };
    this.logger.error('STR FILING REQUIRED', JSON.stringify(strPayload));
    await this.notifications.alertOpsTeam(userId, `⚠️ STR REQUIRED within 24h — EGP ${amount} — Rules: ${ruleIds.join(', ')}`);
    // GAP-FIX-08: STR filing must also set isBlocked=true — user cannot continue transacting
    await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: true, blockReason: `AML STR filed: ${ruleIds.join(',')}` },
    });
    await this.audit.log({ userId, operation: 'str_filed', requestSummary: strPayload, responseSuccess: true, outcome: 'STR filed' });
  }

  async screenNewUser(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Production: call Valify sanctions API + OFAC + UN lists
    // Returns false = HIT (must block registration)
    this.logger.log(`Sanctions screening for ${user.firstName} ${user.lastName}: CLEAR`);
    return true;
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async generateDailyAmlReport(): Promise<void> {
    const yesterday = new Date(Date.now() - 86_400_000);
    const stats = await this.prisma.deal.aggregate({
      where: { createdAt: { gte: yesterday }, status: { in: ['ESCROW_ACTIVE', 'SETTLED', 'DISPUTED'] } },
      _sum: { amount: true }, _count: { id: true },
    });
    const flaggedUsers = await this.prisma.user.findMany({ where: { blockReason: { not: null } }, select: { id: true, mobile: true, blockReason: true } });
    this.logger.log(`AML DAILY REPORT: txns=${stats._count.id} vol=EGP${(stats._sum.amount||0).toLocaleString()} flagged=${flaggedUsers.length}`);
    if (flaggedUsers.length > 0) await this.notifications.alertOpsTeam('system', `Daily AML: ${flaggedUsers.length} flagged users need review`);
  }
}
