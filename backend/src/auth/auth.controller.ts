import { Controller, Post, Get, Body, Req, UseGuards, HttpCode, Patch } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IsString, IsBoolean, IsEmail, IsOptional, Length, IsMobilePhone } from 'class-validator';
import { JwtAuthGuard } from './jwt.guard';
import { RateLimitGuard, RateLimit } from '../common/rate-limit.guard';

export class SendOtpDto {
  @IsString()  mobile: string;
  @IsString()  firstName: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class VerifyOtpDto {
  @IsString()  mobile: string;
  @IsString() @Length(4, 6) otp: string;
  @IsBoolean() isProvider: boolean;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
}

export class LinkMobileDto {
  @IsString() mobile: string;
  @IsString() firstName: string;
  @IsOptional() @IsString() lastName?: string;
}

export class LinkMobileVerifyDto {
  @IsString() mobile: string;
  @IsString() @Length(4, 6) otp: string;
}

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Step 1 — Send OTP. Rate limited: 5 per minute per IP. */
  @Post('send-otp')
  @HttpCode(200)
  @RateLimit(5, 60)
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto.mobile, dto.firstName, dto.lastName || '', dto.email);
  }

  /** Step 2 — Verify OTP and get SettePay JWT. Rate limited: 10 per minute. */
  @Post('verify-otp')
  @HttpCode(200)
  @RateLimit(10, 60)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtpAndAuth(dto.mobile, dto.otp, dto.isProvider, dto.firstName, dto.lastName);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logout(@Req() req: any) {
    return this.auth.logout(req.user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return req.user;
  }

  /**
   * HI-09 fix: Facebook OAuth users must link a real Egyptian mobile
   * before initiating any HealthPay escrow operations.
   * Step 1: Request OTP to the real mobile number.
   */
  @Post('link-mobile/send-otp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @RateLimit(3, 300) // 3 per 5 minutes — extra strict for account linking
  linkMobileSendOtp(@Req() req: any, @Body() dto: LinkMobileDto) {
    return this.auth.linkMobileToFacebookAccount(req.user.sub, dto.mobile, dto.firstName, dto.lastName || '');
  }

  /**
   * Step 2: Verify OTP to complete mobile linking.
   * After this, the user can initiate HealthPay wallet operations.
   */
  @Post('link-mobile/verify-otp')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @RateLimit(5, 60)
  linkMobileVerifyOtp(@Req() req: any, @Body() dto: LinkMobileVerifyDto) {
    return this.auth.verifyMobileLinking(req.user.sub, dto.mobile, dto.otp);
  }
}
