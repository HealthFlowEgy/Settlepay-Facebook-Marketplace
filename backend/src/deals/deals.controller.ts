import {
  Controller, Post, Get, Patch, Body, Param, Req,
  UseGuards, HttpCode, Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EscrowService } from './escrow.service';
import { WalletService } from './wallet.service';
import { PrismaService } from '../common/prisma.service';
import { IsString, IsNumber, IsPositive, IsOptional, Min, Max } from 'class-validator';

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

  /** Get deal details */
  @Get(':id')
  getDeal(@Param('id') id: string) {
    return this.prisma.deal.findUniqueOrThrow({
      where: { id },
      include: { buyer: { select: { id: true, firstName: true, lastName: true, mobile: true } },
                 seller: { select: { id: true, firstName: true, lastName: true, mobile: true } },
                 escrowTx: true, dispute: true, commissionRecord: true },
    });
  }

  /** Get all deals for current user */
  @Get()
  getMyDeals(@Req() req: any, @Query('role') role: 'buyer' | 'seller', @Query('status') status?: string) {
    const where: any = role === 'buyer' ? { buyerId: req.user.sub } : { sellerId: req.user.sub };
    if (status) where.status = status;
    return this.prisma.deal.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 50,
      include: { buyer: { select: { id: true, firstName: true, lastName: true } },
                 seller: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  /** Step 1: Send payment request to buyer */
  @Post(':id/request-payment')
  @HttpCode(200)
  requestPayment(@Param('id') id: string) {
    return this.escrow.sendPaymentRequestToBuyer(id);
  }

  /** Step 2: Buyer confirms — execute escrow deduction */
  @Post(':id/confirm-payment')
  @HttpCode(200)
  confirmPayment(@Param('id') id: string, @Req() req: any) {
    return this.escrow.executeEscrowDeduction(id);
  }

  /** Seller marks deal as shipped */
  @Patch(':id/ship')
  markShipped(@Param('id') id: string, @Req() req: any, @Body('waybillId') waybillId?: string) {
    return this.escrow.markShipped(id, req.user.sub, waybillId);
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
