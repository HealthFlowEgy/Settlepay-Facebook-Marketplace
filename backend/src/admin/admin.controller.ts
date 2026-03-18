import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { DisputesService } from '../disputes/disputes.service';
import { PrismaService } from '../common/prisma.service';
import { DisputeResolution, DealStatus, DisputeStatus, UserKycTier } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsNumber } from 'class-validator';

class ResolveDto {
  @IsEnum(DisputeResolution) resolution: DisputeResolution;
  @IsOptional() @IsString()  adminNotes?: string;
  @IsOptional() @IsNumber()  sellerPayout?: number;
  @IsOptional() @IsNumber()  buyerRefund?: number;
}

/**
 * AdminController — REM-03: Switched from per-method DB lookup to AdminGuard.
 * AdminGuard reads isAdmin from the JWT payload (no DB hit per request).
 * REM-05: All Prisma enum comparisons now use generated enum values, not string literals.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Disputes ──────────────────────────────────────────────────────────────
  @Get('disputes')
  getAllDisputes(@Query('status') status?: string) {
    // REM-05: Cast through DisputeStatus enum — invalid values become undefined (safe)
    const enumStatus = status && Object.values(DisputeStatus).includes(status as DisputeStatus)
      ? status as DisputeStatus
      : undefined;
    return this.disputes.getAllDisputes(enumStatus);
  }

  @Get('disputes/:id')
  getDispute(@Param('id') id: string) {
    return this.disputes.getDispute(id);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolveDispute(@Req() req: any, @Param('id') id: string, @Body() dto: ResolveDto) {
    return this.disputes.resolveDispute(id, req.user.sub, dto.resolution, dto.adminNotes, dto.sellerPayout, dto.buyerRefund);
  }

  // ── Deals ─────────────────────────────────────────────────────────────────
  @Get('deals')
  getDeals(@Query('status') status?: string, @Query('limit') limit = '50') {
    // REM-05: Use DealStatus enum values, reject invalid strings
    const enumStatus = status && Object.values(DealStatus).includes(status as DealStatus)
      ? status as DealStatus
      : undefined;
    return this.prisma.deal.findMany({
      where:   enumStatus ? { status: enumStatus } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    parseInt(limit, 10),
      include: {
        buyer:    { select: { id: true, firstName: true, lastName: true, mobile: true } },
        seller:   { select: { id: true, firstName: true, lastName: true, mobile: true } },
        escrowTx: true, dispute: true, commissionRecord: true,
      },
    });
  }

  @Get('deals/stats')
  async getStats() {
    // REM-05: Use Prisma DealStatus / DisputeStatus enum values, not raw strings
    const [total, active, settled, disputed, commissionTotal] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({
        where: { status: { in: [DealStatus.ESCROW_ACTIVE, DealStatus.SHIPPED, DealStatus.DELIVERY_CONFIRMED] } },
      }),
      this.prisma.deal.count({ where: { status: DealStatus.SETTLED } }),
      this.prisma.dispute.count({
        where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.EVIDENCE_COLLECTION, DisputeStatus.UNDER_REVIEW] } },
      }),
      this.prisma.commissionRecord.aggregate({ _sum: { commissionAmount: true } }),
    ]);
    return {
      totalDeals:      total,
      activeEscrows:   active,
      settledDeals:    settled,
      openDisputes:    disputed,
      totalCommission: commissionTotal._sum.commissionAmount ?? 0,
    };
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  @Get('users')
  getUsers(@Query('kycTier') kycTier?: string, @Query('limit') limit = '50') {
    // REM-05: Validate kycTier against UserKycTier enum — reject unknown strings
    const enumTier = kycTier && Object.values(UserKycTier).includes(kycTier as UserKycTier)
      ? kycTier as UserKycTier
      : undefined;
    return this.prisma.user.findMany({
      where:   enumTier ? { kycTier: enumTier } : undefined,
      take:    parseInt(limit, 10),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, firstName: true, lastName: true, mobile: true,
        email: true, isProvider: true, kycTier: true, kycStatus: true,
        isBlocked: true, blockReason: true, monthlyVolume: true,
        createdAt: true, facebookId: true, psid: true,
      },
    });
  }

  @Post('users/:id/block')
  @HttpCode(200)
  async blockUser(@Param('id') id: string, @Body('reason') reason: string) {
    await this.prisma.user.update({ where: { id }, data: { isBlocked: true, blockReason: reason || 'Blocked by admin' } });
    return { success: true };
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  async unblockUser(@Param('id') id: string) {
    await this.prisma.user.update({ where: { id }, data: { isBlocked: false, blockReason: null } });
    return { success: true };
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────
  @Get('audit')
  getAuditLogs(
    @Query('userId') userId?: string,
    @Query('dealId') dealId?: string,
    @Query('operation') operation?: string,
    @Query('limit') limit = '100',
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(userId    && { userId }),
        ...(dealId    && { dealId }),
        ...(operation && { operation }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });
  }
}
