import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DisputesService } from './disputes.service';
import { DisputeResolution } from '@prisma/client';
import { IsString, IsArray, IsOptional, IsEnum, IsNumber } from 'class-validator';

export class RaiseDisputeDto { @IsString() dealId: string; }
export class SubmitEvidenceDto { @IsArray() @IsString({ each: true }) evidenceUrls: string[]; }
export class ResolveDisputeDto {
  @IsEnum(DisputeResolution) resolution: DisputeResolution;
  @IsOptional() @IsString()  adminNotes?: string;
  @IsOptional() @IsNumber()  sellerPayout?: number;
  @IsOptional() @IsNumber()  buyerRefund?: number;
}

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post() @HttpCode(201)
  raise(@Req() req: any, @Body() dto: RaiseDisputeDto) {
    return this.disputes.raiseDispute(dto.dealId, req.user.sub);
  }

  @Get(':id')
  getDispute(@Param('id') id: string) {
    return this.disputes.getDispute(id);
  }

  @Patch(':id/evidence')
  submitEvidence(@Param('id') id: string, @Req() req: any, @Body() dto: SubmitEvidenceDto) {
    return this.disputes.submitEvidence(id, req.user.sub, dto.evidenceUrls);
  }

  /** Admin only */
  @Post(':id/resolve') @HttpCode(200)
  resolve(@Param('id') id: string, @Req() req: any, @Body() dto: ResolveDisputeDto) {
    return this.disputes.resolveDispute(id, req.user.sub, dto.resolution, dto.adminNotes, dto.sellerPayout, dto.buyerRefund);
  }
}
