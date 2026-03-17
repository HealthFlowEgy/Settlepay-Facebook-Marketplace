import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DisputesService } from '../disputes/disputes.service';
import { PrismaService } from '../common/prisma.service';
import { DisputeResolution, DealStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsNumber } from 'class-validator';

class ResolveDto {
  @IsEnum(DisputeResolution) resolution: DisputeResolution;
  @IsOptional() @IsString()  adminNotes?: string;
  @IsOptional() @IsNumber()  sellerPayout?: number;
  @IsOptional() @IsNumber()  buyerRefund?: number;
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
// TODO: add AdminGuard to restrict to admin role
export class AdminController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Disputes ──────────────────────────────────────────────────────────────
  @Get('disputes')
  getAllDisputes(@Query('status') status?: string) {
    return this.disputes.getAllDisputes(status as any);
  }

  @Get('disputes/:id')
  getDispute(@Param('id') id: string) {
    return this.disputes.getDispute(id);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolveDispute(@Param('id') id: string, @Body() dto: ResolveDto) {
    // adminId would come from JWT in production
    return this.disputes.resolveDispute(id, 'admin', dto.resolution, dto.adminNotes, dto.sellerPayout, dto.buyerRefund);
  }

  // ── Deals Overview ────────────────────────────────────────────────────────
  @Get('deals')
  getDeals(@Query('status') status?: string, @Query('limit') limit = '50') {
    return this.prisma.deal.findMany({
      where:   status ? { status: status as DealStatus } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    parseInt(limit),
      include: {
        buyer:  { select: { id: true, firstName: true, lastName: true, mobile: true } },
        seller: { select: { id: true, firstName: true, lastName: true, mobile: true } },
        escrowTx: true, dispute: true,
      },
    });
  }

  @Get('deals/stats')
  async getStats() {
    const [total, active, settled, disputed, paidout] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({ where: { status: DealStatus.ESCROW_ACTIVE } }),
      this.prisma.deal.count({ where: { status: DealStatus.SETTLED } }),
      this.prisma.deal.count({ where: { status: DealStatus.DISPUTED } }),
      this.prisma.commissionRecord.aggregate({ _sum: { commissionAmount: true } }),
    ]);
    return { total, active, settled, disputed, totalCommission: paidout._sum.commissionAmount || 0 };
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  @Get('users')
  getUsers(@Query('limit') limit = '50', @Query('kycStatus') kycStatus?: string) {
    return this.prisma.user.findMany({
      where:   kycStatus ? { kycStatus: kycStatus as any } : undefined,
      orderBy: { createdAt: 'desc' },
      take:    parseInt(limit),
      select: {
        id: true, mobile: true, firstName: true, lastName: true,
        isProvider: true, kycTier: true, kycStatus: true,
        monthlyVolume: true, isBlocked: true, createdAt: true,
        _count: { select: { dealsAsBuyer: true, dealsAsSeller: true } },
      },
    });
  }

  @Post('users/:id/block')
  @HttpCode(200)
  blockUser(@Param('id') id: string, @Body('reason') reason: string) {
    return this.prisma.user.update({
      where: { id },
      data:  { isBlocked: true, blockReason: reason },
    });
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────
  @Get('audit')
  getAuditLogs(@Query('userId') userId?: string, @Query('operation') operation?: string) {
    return this.prisma.auditLog.findMany({
      where:   { ...(userId && { userId }), ...(operation && { operation }) },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }
}
