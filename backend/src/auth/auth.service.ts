import {
  Injectable, Inject, BadRequestException, UnauthorizedException,
  ConflictException, Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { encryptToken, decryptToken } from '../common/crypto.util';
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

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────
  async verifyOtpAndAuth(mobile: string, otp: string, isProvider: boolean, firstName?: string, lastName?: string) {
    try {
      const hpResult       = await this.payment.authUser(mobile, otp, isProvider);
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
      // REM-03: Include isAdmin in the JWT so AdminGuard reads it from the token
      // without an extra DB round-trip on every admin request.
      const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider, isAdmin: user.isAdmin });
      await this.audit.log({ userId: user.id, operation: 'authUser', responseSuccess: true });
      return { user: this.sanitizeUser(user), token };
    } catch (err: any) {
      if (err instanceof InvalidOtpError) throw new UnauthorizedException('Invalid OTP. Please try again.');
      throw err;
    }
  }

  // ── Facebook OAuth ──────────────────────────────────────────────────────────
  async facebookAuth(facebookId: string, name: string, email?: string) {
    let user = await this.prisma.user.findUnique({ where: { facebookId } });
    if (!user) {
      const [firstName, ...rest] = name.split(' ');
      user = await this.prisma.user.create({
        data: {
          facebookId, firstName, lastName: rest.join(' '), email,
          mobile: `fb_${facebookId}`, // synthetic — no HP operations until mobile verified
          kycTier: 'TIER_0',
        },
      });
    }
    const token = this.jwt.sign({ sub: user.id, mobile: user.mobile, isProvider: user.isProvider, isAdmin: user.isAdmin });
    return {
      user: this.sanitizeUser(user),
      token,
      requiresMobileVerification: !user.hpUserToken,
    };
  }

  // ── HI-09: Link real mobile to Facebook account (Step 1 — send OTP) ────────
  // GAP-FIX-01: Do NOT update mobile in DB before OTP is verified (TOCTOU).
  // The intended mobile is only committed to the DB in step 2 (verifyMobileLinking),
  // after HealthPay confirms the OTP. This prevents a race condition where an
  // attacker could claim a mobile number belonging to another user.
  async linkMobileToFacebookAccount(userId: string, mobile: string, firstName: string, lastName: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.facebookId) throw new BadRequestException('This account is not a Facebook OAuth account');
    if (user.hpUserToken) throw new BadRequestException('Mobile already linked to this account');

    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing && existing.id !== userId) throw new ConflictException('This mobile number is already registered');

    // Trigger OTP via HealthPay — do NOT persist mobile until OTP is verified
    await this.payment.loginUser(mobile, firstName || user.firstName, lastName || user.lastName);

    await this.audit.log({ userId, operation: 'linkMobileSendOtp', requestSummary: { mobile }, responseSuccess: true });
    return { success: true, message: 'OTP sent. Verify to complete account linking.' };
  }

  // ── HI-09: Link real mobile (Step 2 — verify OTP + get HP token) ───────────
  async verifyMobileLinking(userId: string, mobile: string, otp: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Re-check mobile uniqueness at commit time (prevents race condition)
    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing && existing.id !== userId) {
      throw new ConflictException('This mobile number is already registered');
    }

    try {
      const hpResult       = await this.payment.authUser(mobile, otp, user.isProvider);
      const encryptedToken = encryptToken(hpResult.userToken);

      // GAP-FIX-01: Mobile is only persisted here, after successful OTP verification
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          mobile,
          hpUserToken:      encryptedToken,
          hpUid:            hpResult.uid,
          hpTokenUpdatedAt: new Date(),
        },
      });

      await this.audit.log({ userId, operation: 'linkMobileVerify', responseSuccess: true });
      return { success: true, message: 'Mobile linked. You can now use SettePay escrow.', user: this.sanitizeUser(updated) };
    } catch (err: any) {
      if (err instanceof InvalidOtpError) throw new UnauthorizedException('Invalid OTP. Please try again.');
      throw err;
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  // GAP-FIX-20: Use static import of decryptToken (was needlessly dynamic)
  async logout(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.hpUserToken && !user.mobile.startsWith('fb_')) {
      const hpToken = decryptToken(user.hpUserToken);
      await this.payment.logoutUser(hpToken).catch(() => {});
    }
    await this.audit.log({ userId, operation: 'logoutUser', responseSuccess: true });
    return { success: true };
  }

  private sanitizeUser(user: any) {
    const { hpUserToken, nationalId, passwordHash, ...safe } = user;
    return safe;
  }
}
