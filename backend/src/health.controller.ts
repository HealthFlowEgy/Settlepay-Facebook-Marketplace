import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { REDIS_CLIENT } from './common/redis.module';
import Redis from 'ioredis';

/**
 * HealthController — Fixed: removed @nestjs-modules/ioredis (not installed),
 * uses REDIS_CLIENT token instead. Readiness now checks Redis instead of DB-stored token.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Kubernetes liveness probe */
  @Get('live')
  @HttpCode(200)
  liveness() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  /** Kubernetes readiness probe — checks DB + Redis + HealthPay token */
  @Get('ready')
  @HttpCode(200)
  async readiness() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {};

    // Database check
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'healthy', latencyMs: Date.now() - start };
    } catch {
      checks.database = { status: 'unhealthy' };
    }

    // Redis check
    try {
      const start = Date.now();
      await this.redis.ping();
      checks.redis = { status: 'healthy', latencyMs: Date.now() - start };
    } catch {
      checks.redis = { status: 'unhealthy' };
    }

    // HealthPay merchant token check (Redis — CR-06 fix: no longer in DB)
    try {
      const token = await this.redis.get('hp:merchant:token');
      checks.healthpayToken = {
        status: token ? 'healthy' : 'token_missing_will_refresh_on_next_request',
      };
    } catch {
      checks.healthpayToken = { status: 'unknown' };
    }

    const allHealthy = Object.values(checks).every(
      c => c.status === 'healthy' || c.status.startsWith('token_missing'),
    );

    return {
      status:    allHealthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
      version:   process.env.npm_package_version || '1.0.0',
      env:       process.env.NODE_ENV || 'development',
    };
  }

  /** Operational metrics */
  @Get('status')
  @HttpCode(200)
  async status() {
    const [totalDeals, activeEscrows, openDisputes] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({ where: { status: { in: ['ESCROW_ACTIVE', 'SHIPPED'] } } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'] } } }),
    ]);
    return {
      service: 'SettePay Marketplace API', version: '1.0.0',
      env: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(), uptime: Math.floor(process.uptime()),
      metrics: { totalDeals, activeEscrows, openDisputes },
    };
  }
}
