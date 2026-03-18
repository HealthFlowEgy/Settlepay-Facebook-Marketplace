import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, ForbiddenException, Req,
} from '@nestjs/common';
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

/**
 * AdminController — Fixed: added isAdmin role guard
 * All admin endpoints require JWT + isAdmin flag on user record.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Role guard helper — checks isAdmin on the User record ─────────────────
  private async requireAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
  }

  // ── Disputes ──────────────────────────────────────────────────────────────
  @Get('disputes')
  async getAllDisputes(@Req() req: any, @Query('status') status?: string) {
    await this.requireAdmin(req.user.sub);
    return this.disputes.getAllDisputes(status as any);
  }

  @Get('disputes/:id')
  async getDispute(@Req() req: any, @Param('id') id: string) {
    await this.requireAdmin(req.user.sub);
    return this.disputes.getDispute(id);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  async resolveDispute(@Req() req: any, @Param('id') id: string, @Body() dto: ResolveDto) {
    await this.requireAdmin(req.user.sub);
    return this.disputes.resolveDispute(id, req.user.sub, dto.resolution, dto.adminNotes, dto.sellerPayout, dto.buyerRefund);
  }

  // ── Deals ─────────────────────────────────────────────────────────────────
  @Get('deals')
  async getDeals(@Req() req: any, @Query('status') status?: string, @Query('limit') limit = '50') {
    await this.requireAdmin(req.user.sub);
    return this.prisma.deal.findMany({
      where:   status ? { status: status as DealStatus } : undefined,
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
  async getStats(@Req() req: any) {
    await this.requireAdmin(req.user.sub);
    const [total, active, settled, disputed, commissionTotal] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({ where: { status: { in: ['ESCROW_ACTIVE', 'SHIPPED', 'DELIVERY_CONFIRMED'] } } }),
      this.prisma.deal.count({ where: { status: 'SETTLED' } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'] } } }),
      this.prisma.commissionRecord.aggregate({ _sum: { commissionAmount: true } }),
    ]);
    return {
      totalDeals:       total,
      activeEscrows:    active,
      settledDeals:     settled,
      openDisputes:     disputed,
      totalCommission:  commissionTotal._sum.commissionAmount ?? 0,
    };
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  @Get('users')
  async getUsers(@Req() req: any, @Query('kycTier') kycTier?: string, @Query('limit') limit = '50') {
    await this.requireAdmin(req.user.sub);
    return this.prisma.user.findMany({
      where:   kycTier ? { kycTier: kycTier as any } : undefined,
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
  async blockUser(@Req() req: any, @Param('id') id: string, @Body('reason') reason: string) {
    await this.requireAdmin(req.user.sub);
    await this.prisma.user.update({ where: { id }, data: { isBlocked: true, blockReason: reason || 'Blocked by admin' } });
    return { success: true };
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  async unblockUser(@Req() req: any, @Param('id') id: string) {
    await this.requireAdmin(req.user.sub);
    await this.prisma.user.update({ where: { id }, data: { isBlocked: false, blockReason: null } });
    return { success: true };
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────
  @Get('audit')
  async getAuditLogs(
    @Req() req: any,
    @Query('userId') userId?: string,
    @Query('dealId') dealId?: string,
    @Query('operation') operation?: string,
    @Query('limit') limit = '100',
  ) {
    await this.requireAdmin(req.user.sub);
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
