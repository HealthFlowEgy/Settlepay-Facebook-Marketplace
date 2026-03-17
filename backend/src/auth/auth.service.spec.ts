import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE } from '../payment/payment.service.interface';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtpThrottleError, InvalidOtpError } from '../payment/healthpay.adapter';

jest.mock('../common/crypto.util', () => ({
  encryptToken: jest.fn(() => 'encrypted-token'),
  decryptToken: jest.fn(() => 'decrypted-token'),
}));

const mockPayment = {
  loginUser:  jest.fn(),
  authUser:   jest.fn(),
  logoutUser: jest.fn(),
};
const mockPrisma = {
  user:         { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
  otpThrottle:  { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
};
const mockJwt   = { sign: jest.fn(() => 'jwt-token') };
const mockAudit = { log: jest.fn() };
const mockNotify = {};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: JwtService,           useValue: mockJwt },
        { provide: ConfigService,        useValue: {} },
        { provide: AuditService,         useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotify },
        { provide: PAYMENT_SERVICE,      useValue: mockPayment },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockPrisma.otpThrottle.findUnique.mockResolvedValue(null); // no throttle by default
  });

  describe('sendOtp', () => {
    it('sends OTP successfully', async () => {
      mockPayment.loginUser.mockResolvedValue({ uid: 'hp-uid-1' });
      const result = await service.sendOtp('+201000000001', 'Ahmed', 'Mohamed');
      expect(result.success).toBe(true);
      expect(mockPayment.loginUser).toHaveBeenCalledWith('+201000000001', 'Ahmed', 'Mohamed', undefined);
    });

    it('blocks when throttle is active', async () => {
      mockPrisma.otpThrottle.findUnique.mockResolvedValue({
        mobile:       '+201000000001',
        blockedUntil: new Date(Date.now() + 3_600_000), // 1 hour from now
      });
      await expect(service.sendOtp('+201000000001', 'Test', 'User'))
        .rejects.toThrow(BadRequestException);
      expect(mockPayment.loginUser).not.toHaveBeenCalled();
    });

    it('sets 60-minute throttle on error 5001', async () => {
      mockPayment.loginUser.mockRejectedValue(new OtpThrottleError());
      await expect(service.sendOtp('+201000000001', 'Test', 'User'))
        .rejects.toThrow(BadRequestException);
      expect(mockPrisma.otpThrottle.upsert).toHaveBeenCalled();
    });
  });

  describe('verifyOtpAndAuth', () => {
    it('registers user and returns JWT on valid OTP', async () => {
      mockPayment.authUser.mockResolvedValue({ uid: 'hp-uid-1', userToken: 'raw-hp-token' });
      mockPrisma.user.upsert.mockResolvedValue({ id: 'user-1', mobile: '+201000000001', isProvider: false });

      const result = await service.verifyOtpAndAuth('+201000000001', '1234', false);
      expect(result.token).toBe('jwt-token');
      expect(result.user.id).toBe('user-1');
      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ hpUserToken: 'encrypted-token' }),
      }));
    });

    it('throws UnauthorizedException on invalid OTP (error 5002)', async () => {
      mockPayment.authUser.mockRejectedValue(new InvalidOtpError());
      await expect(service.verifyOtpAndAuth('+201000000001', 'wrong', false))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
