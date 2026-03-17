import { Controller, Post, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { KycService } from './kyc.service';
import { IsString, IsOptional } from 'class-validator';

class VerifyDto {
  @IsString()           nationalId: string;
  @IsOptional() @IsString() selfieUrl?: string;
}

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('verify')
  @HttpCode(200)
  verify(@Req() req: any, @Body() dto: VerifyDto) {
    return this.kyc.initiateVerification(req.user.sub, dto.nationalId, dto.selfieUrl);
  }
}
