import {
  Injectable, Inject, BadRequestException, UnauthorizedException,
  ConflictException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { encryptToken } from '../common/crypto.util';
import { OtpThrottleError, InvalidOtpError } from '../payment/healthpay.adapter';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  async sendOtp(mobile: string, firstName: string, lastName: string, email?: string) {
    const throttle = await this.prisma.otpThrottle.findUnique({ where: { mobile } });
    if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) {
      const minutesLeft = Math.ceil((throttle.blockedUntil.getTime() - Date.now()) / 60000);
      throw new BadRequestException(`OTP blocked for ${minutesLeft} more minutes.`);
    }

    try {
      const result = await this.payment.loginUser(mobile, firstName, lastName, email);
      await this.audit.log({ operation: 'loginUser', requestSummary: { mobile }, responseSuccess: true });
      return { success: true, uid: result.uid };
    } catch (err: any) {
      if (err instanceof OtpThrottleError) {
        await this.prisma.otpThrottle.upsert({
          where:  { mobile },
          create: { mobile, attempts: 1, blockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
          update: { attempts: { increment: 1 }, blockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
        });
        throw new BadRequestException('Too many OTP requests. Please wait 60 minutes.');
      }
      await this.audit.log({ operation: 'loginUser', requestSummary: { mobile }, responseSuccess: false, errorMessage: err.message });
      throw err;
    }
  }

  async verifyOtpAndAuth(mobile: string, otp: string, isProvider: boolean, firstName?: string, lastName?: string) {
    try {
      const hpResult      = await this.payment.authUser(mobile, otp, isProvider);
      const encryptedToken = encryptToken(hpResult.userToken);

      const user = await this.prisma.user.upsert({
        where:  { mobile },
        create: {
          mobile, firstName: firstName || 'User', lastName: lastName || '',
          isProvider, hpUserToken: encryptedToken, hpUid: hpResult.uid, hpTokenUpdatedAt: new Date(),
        },
        update: { hpUserToken: encryptedToken, hpUid: hpResult.uid, hpTokenUpdatedAt: new Date() },
      });

      await this.prisma.otpThrottle.deleteMany({ where: { mobile } }).catch(() => {});
      const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider });
      await this.audit.log({ userId: user.id, operation: 'authUser', responseSuccess: true });
      return { user, token };
    } catch (err: any) {
      if (err instanceof InvalidOtpError) throw new UnauthorizedException('Invalid OTP. Please try again.');
      throw err;
    }
  }

  /**
   * HI-09 fix: Facebook OAuth users get a synthetic mobile for DB unique constraint.
   * But we require them to verify a real mobile before initiating HealthPay operations.
   */
  async facebookAuth(facebookId: string, name: string, email?: string) {
    let user = await this.prisma.user.findUnique({ where: { facebookId } });

    if (!user) {
      const [firstName, ...rest] = name.split(' ');
      // HI-09 fix: Use `fb_` prefix mobile — intentionally synthetic, never used for HP calls
      // SMS skipped for fb_ prefix (handled in NotificationsService)
      user = await this.prisma.user.create({
        data: {
          facebookId,
          firstName,
          lastName: rest.join(' '),
          email,
          mobile: `fb_${facebookId}`,   // synthetic — marks as Facebook-only account
          // hpUserToken is NULL — user cannot initiate HP transactions until mobile is verified
          kycTier: 'TIER_0',
        },
      });
    }

    const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider });
    return {
      user,
      token,
      // HI-09: Signal to frontend that mobile verification is required for payments
      requiresMobileVerification: !user.hpUserToken,
    };
  }

  /**
   * HI-09 fix: Link real mobile to Facebook account (required before HealthPay operations)
   */
  async linkMobileToFacebookAccount(userId: string, mobile: string, firstName: string, lastName: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.facebookId) throw new BadRequestException('This account is not a Facebook OAuth account');

    // Check mobile not already taken
    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing && existing.id !== userId) throw new ConflictException('This mobile number is already registered');

    // Send OTP to real mobile
    await this.payment.loginUser(mobile, user.firstName, user.lastName);
    await this.prisma.user.update({ where: { id: userId }, data: { mobile } });
    return { success: true, message: 'OTP sent to mobile. Please verify.' };
  }

  async logout(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.hpUserToken && !user.mobile.startsWith('fb_')) {
      const { decryptToken } = await import('../common/crypto.util');
      const hpToken = decryptToken(user.hpUserToken);
      await this.payment.logoutUser(hpToken).catch(() => {});
    }
    await this.audit.log({ userId, operation: 'logoutUser', responseSuccess: true });
    return { success: true };
  }
}
