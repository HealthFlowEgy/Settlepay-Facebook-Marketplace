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

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────
  async sendOtp(mobile: string, firstName: string, lastName: string, email?: string) {
    // Check OTP throttle
    const throttle = await this.prisma.otpThrottle.findUnique({ where: { mobile } });
    if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) {
      const minutesLeft = Math.ceil((throttle.blockedUntil.getTime() - Date.now()) / 60000);
      throw new BadRequestException(`OTP blocked for ${minutesLeft} more minutes. Try again later.`);
    }

    try {
      const result = await this.payment.loginUser(mobile, firstName, lastName, email);
      await this.audit.log({ operation: 'loginUser', requestSummary: { mobile }, responseSuccess: true });
      return { success: true, uid: result.uid };
    } catch (err) {
      if (err instanceof OtpThrottleError) {
        // Set 60-minute block
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

  // ── Step 2: Verify OTP + Register/Login ─────────────────────────────────────
  async verifyOtpAndAuth(
    mobile: string,
    otp: string,
    isProvider: boolean,
    firstName?: string,
    lastName?: string,
  ) {
    try {
      // Authenticate on HealthPay
      const hpResult = await this.payment.authUser(mobile, otp, isProvider);
      const encryptedToken = encryptToken(hpResult.userToken);

      // Upsert user in SettePay DB
      const user = await this.prisma.user.upsert({
        where:  { mobile },
        create: {
          mobile,
          firstName: firstName || 'User',
          lastName:  lastName  || '',
          isProvider,
          hpUserToken:     encryptedToken,
          hpUid:           hpResult.uid,
          hpTokenUpdatedAt: new Date(),
        },
        update: {
          hpUserToken:     encryptedToken,
          hpUid:           hpResult.uid,
          hpTokenUpdatedAt: new Date(),
        },
      });

      // Clear OTP throttle
      await this.prisma.otpThrottle.deleteMany({ where: { mobile } }).catch(() => {});

      // Generate SettePay JWT
      const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider });

      await this.audit.log({ userId: user.id, operation: 'authUser', responseSuccess: true });
      return { user, token };
    } catch (err) {
      if (err instanceof InvalidOtpError) {
        throw new UnauthorizedException('Invalid OTP. Please try again.');
      }
      throw err;
    }
  }

  // ── Facebook OAuth ──────────────────────────────────────────────────────────
  async facebookAuth(facebookId: string, name: string, email?: string) {
    let user = await this.prisma.user.findUnique({ where: { facebookId } });
    if (!user) {
      const [firstName, ...rest] = name.split(' ');
      user = await this.prisma.user.create({
        data: { facebookId, firstName, lastName: rest.join(' '), email, mobile: `fb_${facebookId}` },
      });
    }
    const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider });
    return { user, token };
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async logout(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.hpUserToken) {
      const { decryptToken } = await import('../common/crypto.util');
      const hpToken = decryptToken(user.hpUserToken);
      await this.payment.logoutUser(hpToken).catch(() => {});
    }
    await this.audit.log({ userId, operation: 'logoutUser', responseSuccess: true });
    return { success: true };
  }
}
