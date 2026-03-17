import { Controller, Get, HttpCode } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** Kubernetes liveness probe — is the process alive? */
  @Get('live')
  @HttpCode(200)
  liveness() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }

  /** Kubernetes readiness probe — can the app serve requests? */
  @Get('ready')
  @HttpCode(200)
  async readiness() {
    const checks: Record<string, { status: string; latencyMs?: number }> = {};

    // Database check
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'healthy', latencyMs: Date.now() - start };
    } catch (err) {
      checks.database = { status: 'unhealthy' };
    }

    // HealthPay token check
    try {
      const token = await this.prisma.merchantToken.findUnique({ where: { id: 'singleton' } });
      if (token && token.expiresAt > new Date()) {
        checks.healthpayToken = { status: 'healthy' };
      } else {
        checks.healthpayToken = { status: 'token_expired_or_missing' };
      }
    } catch {
      checks.healthpayToken = { status: 'unknown' };
    }

    const allHealthy = Object.values(checks).every(c => c.status === 'healthy');

    return {
      status:    allHealthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
      version:   process.env.npm_package_version || '1.0.0',
      env:       process.env.NODE_ENV || 'development',
    };
  }

  /** Full status — includes operational metrics */
  @Get('status')
  @HttpCode(200)
  async status() {
    const [dealCount, activeEscrows, openDisputes] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({ where: { status: { in: ['ESCROW_ACTIVE', 'SHIPPED'] } } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'] } } }),
    ]);

    return {
      service:      'SettePay Marketplace API',
      version:      '1.0.0',
      env:          process.env.NODE_ENV || 'development',
      timestamp:    new Date().toISOString(),
      uptime:       Math.floor(process.uptime()),
      metrics: {
        totalDeals:    dealCount,
        activeEscrows,
        openDisputes,
      },
    };
  }
}
