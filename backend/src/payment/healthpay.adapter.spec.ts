import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthPayAdapter, InsufficientFundsError, GatewayError, OtpThrottleError, InvalidOtpError } from './healthpay.adapter';
import { PrismaService } from '../common/prisma.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockConfig = {
  get: (key: string) => {
    const vals: Record<string, string> = {
      'healthpay.apiKey':     'k_0003ijn47ke1x38o',
      'healthpay.apiHeader':  'H_0003rjeb7ke0dejn',
      'healthpay.baseUrl':    'https://sword.beta.healthpay.tech/graphql',
    };
    return vals[key];
  },
};

const mockPrisma = {
  merchantToken: {
    findUnique: jest.fn(),
    upsert:     jest.fn(),
  },
};

function mockHpSuccess(data: object) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ data }),
  });
}

function mockHpError(code: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      errors: [{ message: code, extensions: { code: 'UNAUTHENTICATED' } }],
      data: null,
    }),
  });
}

describe('HealthPayAdapter', () => {
  let adapter: HealthPayAdapter;

  beforeEach(async () => {
    // Pre-populate token so onModuleInit doesn't fetch
    mockPrisma.merchantToken.findUnique.mockResolvedValue({
      id: 'singleton', token: 'mock-merchant-token',
      expiresAt: new Date(Date.now() + 23 * 3_600_000),
    });

    const module = await Test.createTestingModule({
      providers: [
        HealthPayAdapter,
        { provide: ConfigService,  useValue: mockConfig },
        { provide: PrismaService,  useValue: mockPrisma },
      ],
    }).compile();

    adapter = module.get<HealthPayAdapter>(HealthPayAdapter);
    await adapter.onModuleInit();
    jest.clearAllMocks();
  });

  describe('deductFromUser', () => {
    it('returns { isSuccess: true } on success', async () => {
      mockHpSuccess({ deductFromUser: { isSuccess: true } });
      const result = await adapter.deductFromUser('user-token', 250, 'Escrow - Deal#1');
      expect(result.isSuccess).toBe(true);
    });

    it('throws InsufficientFundsError on error 7001', async () => {
      mockHpError('7001');
      await expect(adapter.deductFromUser('user-token', 50000, 'test'))
        .rejects.toThrow(InsufficientFundsError);
    });

    it('throws GatewayError on error 6001', async () => {
      mockHpError('6001');
      await expect(adapter.deductFromUser('user-token', 100, 'test'))
        .rejects.toThrow(GatewayError);
    });
  });

  describe('payToUser', () => {
    it('returns { isSuccess: true } on success', async () => {
      mockHpSuccess({ payToUser: { isSuccess: true } });
      const result = await adapter.payToUser('user-token', 245, 'Release - Deal#1');
      expect(result.isSuccess).toBe(true);
    });
  });

  describe('getUserWallet', () => {
    it('returns wallet with total and balance array', async () => {
      mockHpSuccess({
        userWallet: {
          total: 1500,
          balance: [{ uid: 'b1', amount: 500, type: 'credit', createdAt: '2025-01-01' }],
        },
      });
      const wallet = await adapter.getUserWallet('user-token');
      expect(wallet.total).toBe(1500);
      expect(wallet.balance).toHaveLength(1);
    });
  });

  describe('authUser', () => {
    it('throws OtpThrottleError on error 5001', async () => {
      mockHpError('5001');
      await expect(adapter.authUser('+201000000001', '1234', false))
        .rejects.toThrow(OtpThrottleError);
    });

    it('throws InvalidOtpError on error 5002', async () => {
      mockHpError('5002');
      await expect(adapter.authUser('+201000000001', 'wrong', false))
        .rejects.toThrow(InvalidOtpError);
    });

    it('returns userToken on success', async () => {
      mockHpSuccess({
        authUser: { userToken: 'hp-user-token', user: { uid: 'hp-uid-1' } },
      });
      const result = await adapter.authUser('+201000000001', '1234', true);
      expect(result.userToken).toBe('hp-user-token');
      expect(result.uid).toBe('hp-uid-1');
    });
  });

  describe('getTopupIframeUrl', () => {
    it('returns iframeUrl string', async () => {
      mockHpSuccess({
        topupWalletUser: { uid: 'topup-uid-1', iframeUrl: 'https://healthpay.tech/topup/abc' },
      });
      const result = await adapter.getTopupIframeUrl('user-token', 500);
      expect(result.iframeUrl).toMatch(/^https:\/\//);
    });
  });
});
