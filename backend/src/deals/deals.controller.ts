import {
  Controller, Post, Get, Patch, Delete, Body, Param, Req,
  UseGuards, HttpCode, Query, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EscrowService } from './escrow.service';
import { WalletService } from './wallet.service';
import { PrismaService } from '../common/prisma.service';
import { IsString, IsNumber, IsPositive, IsOptional, Min, Max } from 'class-validator';
import { DealStatus } from '@prisma/client';

export class CreateDealDto {
  @IsString()  buyerId: string;
  @IsNumber() @IsPositive() @Min(50) @Max(50000) amount: number;
  @IsString()  itemDescription: string;
  @IsOptional() @IsString() messengerThreadId?: string;
}

export class InitiateEscrowDto {
  @IsString() dealId: string;
}

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /** Seller creates a deal */
  @Post()
  createDeal(@Req() req: any, @Body() dto: CreateDealDto) {
    return this.escrow.initiateDeal(req.user.sub, dto.buyerId, dto.amount, dto.itemDescription, dto.messengerThreadId);
  }

  /**
   * Get deal details.
   * GAP-FIX-02: Only buyer or seller may view a deal's full details.
   */
  @Get(':id')
  async getDeal(@Param('id') id: string, @Req() req: any) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        buyer:  { select: { id: true, firstName: true, lastName: true, mobile: true } },
        seller: { select: { id: true, firstName: true, lastName: true, mobile: true } },
        escrowTx: true, dispute: true, commissionRecord: true,
      },
    });
    if (!deal) throw new NotFoundException(`Deal ${id} not found`);
    const userId = req.user.sub;
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Access denied: you are not a party to this deal');
    }
    return deal;
  }

  /**
   * Get all deals for current user.
   * GAP-FIX-08: Cursor-based pagination (cursor + limit) replaces the hard-coded take:50.
   */
  @Get()
  getMyDeals(
    @Req() req: any,
    @Query('role') role: 'buyer' | 'seller',
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    const take  = Math.min(parseInt(limit, 10) || 20, 100); // cap at 100
    const where: any = role === 'buyer' ? { buyerId: req.user.sub } : { sellerId: req.user.sub };
    if (status) where.status = status as DealStatus;
    return this.prisma.deal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        buyer:  { select: { id: true, firstName: true, lastName: true } },
        seller: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Step 1: Send payment request to buyer.
   * GAP-FIX-02: Only the seller of this deal may trigger payment requests.
   */
  @Post(':id/request-payment')
  @HttpCode(200)
  async requestPayment(@Param('id') id: string, @Req() req: any) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, select: { sellerId: true } });
    if (!deal) throw new NotFoundException(`Deal ${id} not found`);
    if (deal.sellerId !== req.user.sub) throw new ForbiddenException('Only the seller can send a payment request');
    return this.escrow.sendPaymentRequestToBuyer(id);
  }

  /**
   * Step 2: Buyer confirms — execute escrow deduction.
   * GAP-FIX-02: Only the buyer of this deal may confirm payment.
   */
  @Post(':id/confirm-payment')
  @HttpCode(200)
  async confirmPayment(@Param('id') id: string, @Req() req: any) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, select: { buyerId: true } });
    if (!deal) throw new NotFoundException(`Deal ${id} not found`);
    if (deal.buyerId !== req.user.sub) throw new ForbiddenException('Only the buyer can confirm payment');
    return this.escrow.executeEscrowDeduction(id);
  }

  /** Seller marks deal as shipped */
  @Patch(':id/ship')
  markShipped(@Param('id') id: string, @Req() req: any, @Body('waybillId') waybillId?: string) {
    return this.escrow.markShipped(id, req.user.sub, waybillId);
  }

  /**
   * GAP-FIX-15: Explicit cancellation endpoint.
   * Either party may cancel while the deal is in PENDING state.
   * After escrow is active, only admin-mediated resolution is allowed.
   */
  @Delete(':id/cancel')
  @HttpCode(200)
  async cancelDeal(@Param('id') id: string, @Req() req: any, @Body('reason') reason?: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) throw new NotFoundException(`Deal ${id} not found`);
    if (deal.buyerId !== req.user.sub && deal.sellerId !== req.user.sub) {
      throw new ForbiddenException('Only a party to this deal can cancel it');
    }
    const cancellableStates: DealStatus[] = [DealStatus.PENDING, DealStatus.AWAITING_BUYER_CONFIRMATION, DealStatus.AWAITING_TOP_UP];
    if (!cancellableStates.includes(deal.status)) {
      throw new ForbiddenException(`Deal in ${deal.status} state cannot be cancelled by users. Contact support.`);
    }
    await this.prisma.deal.update({
      where: { id },
      data: { status: DealStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason || 'Cancelled by user' },
    });
    return { success: true, message: 'Deal cancelled.' };
  }

  /** Get buyer's wallet balance */
  @Get('wallet/balance')
  getBalance(@Req() req: any) {
    return this.wallet.getBalance(req.user.sub);
  }

  /** Get top-up iframe URL */
  @Post('wallet/topup')
  @HttpCode(200)
  getTopupUrl(@Req() req: any, @Body('amount') amount: number) {
    return this.wallet.getTopupIframe(req.user.sub, amount);
  }

  /** Get payment requests for dispute review */
  @Get(':id/payment-requests')
  getPaymentRequests(@Param('id') id: string, @Req() req: any) {
    return this.wallet.getPaymentRequests(req.user.sub);
  }
}
