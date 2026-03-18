/**
 * HealthPayAdapter Unit Tests
 * CR-05 fix: Tests use REDIS_CLIENT mock (not PrismaService — merchant token is Redis-only now)
 * CR-06 fix: merchantToken lookup is Redis.get(), not prisma.merchantToken.findUnique()
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  HealthPayAdapter,
  InsufficientFundsError,
  GatewayError,
  OtpThrottleError,
  InvalidOtpError,
  HealthPayError,
} from './healthpay.adapter';
import { REDIS_CLIENT } from '../common/redis.module';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockConfig = {
  get: (key: string) => {
    const vals: Record<string, string> = {
      'healthpay.apiKey':    'k_test',
      'healthpay.apiHeader': 'H_test',
      'healthpay.baseUrl':   'https://sword.beta.healthpay.tech/graphql',
    };
    return vals[key];
  },
};

// CR-06: Redis mock — no longer PrismaService
const mockRedis = {
  get:    jest.fn(),
  setex:  jest.fn(),
  set:    jest.fn(),
};

function mockHpSuccess(data: object) {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ data }) });
}

// CR-05: Test multiple error field locations
function mockHpErrorInExtensions(code: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      errors: [{ message: 'HealthPay error', extensions: { code } }],
    }),
  });
}

function mockHpErrorInMessage(code: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      errors: [{ message: code }], // fallback: code in message
    }),
  });
}

describe('HealthPayAdapter', () => {
  let adapter: HealthPayAdapter;

  beforeEach(async () => {
    // CR-06: Return token from Redis (not DB)
    mockRedis.get.mockResolvedValue('mock-merchant-token');
    mockRedis.setex.mockResolvedValue('OK');

    const module = await Test.createTestingModule({
      providers: [
        HealthPayAdapter,
        { provide: ConfigService,  useValue: mockConfig },
        { provide: REDIS_CLIENT,   useValue: mockRedis },
      ],
    }).compile();

    adapter = module.get<HealthPayAdapter>(HealthPayAdapter);
    await adapter.onModuleInit();
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue('mock-merchant-token');
  });

  // ── deductFromUser ────────────────────────────────────────────────────────
  describe('deductFromUser', () => {
    it('returns { isSuccess: true } on success', async () => {
      mockHpSuccess({ deductFromUser: { isSuccess: true } });
      const result = await adapter.deductFromUser('user-token', 250, 'Escrow - Deal#1');
      expect(result.isSuccess).toBe(true);
    });

    it('throws InsufficientFundsError on error 7001 from extensions.code', async () => {
      mockHpErrorInExtensions('7001');
      await expect(adapter.deductFromUser('user-token', 50000, 'test'))
        .rejects.toThrow(InsufficientFundsError);
    });

    it('throws InsufficientFundsError on error 7001 from message (fallback)', async () => {
      mockHpErrorInMessage('7001');
      await expect(adapter.deductFromUser('user-token', 50000, 'test'))
        .rejects.toThrow(InsufficientFundsError);
    });

    it('throws GatewayError on error 6001', async () => {
      mockHpErrorInExtensions('6001');
      await expect(adapter.deductFromUser('user-token', 100, 'test'))
        .rejects.toThrow(GatewayError);
    });
  });

  // ── payToUser ─────────────────────────────────────────────────────────────
  describe('payToUser', () => {
    it('returns { isSuccess: true } on success', async () => {
      mockHpSuccess({ payToUser: { isSuccess: true } });
      const result = await adapter.payToUser('user-token', 245, 'Release - Deal#1');
      expect(result.isSuccess).toBe(true);
    });
  });

  // ── getUserWallet ─────────────────────────────────────────────────────────
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

  // ── authUser ──────────────────────────────────────────────────────────────
  describe('authUser', () => {
    it('throws OtpThrottleError on error 5001', async () => {
      mockHpErrorInExtensions('5001');
      await expect(adapter.authUser('+201000000001', '1234', false))
        .rejects.toThrow(OtpThrottleError);
    });

    it('throws InvalidOtpError on error 5002', async () => {
      mockHpErrorInExtensions('5002');
      await expect(adapter.authUser('+201000000001', 'wrong', false))
        .rejects.toThrow(InvalidOtpError);
    });

    it('returns userToken and uid on success', async () => {
      mockHpSuccess({ authUser: { userToken: 'hp-user-token', user: { uid: 'hp-uid-1' } } });
      const result = await adapter.authUser('+201000000001', '1234', true);
      expect(result.userToken).toBe('hp-user-token');
      expect(result.uid).toBe('hp-uid-1');
    });
  });

  // ── getTopupIframeUrl ─────────────────────────────────────────────────────
  describe('getTopupIframeUrl', () => {
    it('returns a valid iframeUrl', async () => {
      mockHpSuccess({ topupWalletUser: { uid: 'topup-uid-1', iframeUrl: 'https://healthpay.tech/topup/abc' } });
      const result = await adapter.getTopupIframeUrl('user-token', 500);
      expect(result.iframeUrl).toMatch(/^https:\/\//);
    });
  });

  // ── CR-06: Token stored in Redis only ─────────────────────────────────────
  describe('merchant token management (CR-06)', () => {
    it('loads merchant token from Redis on init', async () => {
      mockRedis.get.mockResolvedValue('cached-token');
      await adapter.onModuleInit();
      // Verify Redis was called, NOT prisma
      expect(mockRedis.get).toHaveBeenCalledWith('hp:merchant:token');
    });

    it('stores refreshed token in Redis with TTL', async () => {
      mockRedis.get.mockResolvedValue(null); // no cached token
      mockHpSuccess({ authMerchant: { token: 'fresh-token' } });
      await adapter.refreshMerchantToken();
      expect(mockRedis.setex).toHaveBeenCalledWith('hp:merchant:token', 82800, 'fresh-token');
    });
  });

  // ── CR-05: Error code parsing fallback chain ──────────────────────────────
  describe('error code parsing (CR-05)', () => {
    it('parses error code from extensions.code (preferred)', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          errors: [{ message: 'Some human message', extensions: { code: '7001' } }],
        }),
      });
      await expect(adapter.deductFromUser('t', 100, 'd')).rejects.toThrow(InsufficientFundsError);
    });

    it('parses error code from extensions.errorCode (variant)', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          errors: [{ message: 'error', extensions: { errorCode: '7001' } }],
        }),
      });
      await expect(adapter.deductFromUser('t', 100, 'd')).rejects.toThrow(InsufficientFundsError);
    });

    it('falls back to message field when no extensions', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ errors: [{ message: '7001' }] }),
      });
      await expect(adapter.deductFromUser('t', 100, 'd')).rejects.toThrow(InsufficientFundsError);
    });

    it('throws generic HealthPayError for unknown codes', async () => {
      mockHpErrorInExtensions('9999');
      await expect(adapter.deductFromUser('t', 100, 'd')).rejects.toThrow(HealthPayError);
    });
  });

  // ── 2004: Auto-refresh and retry ─────────────────────────────────────────
  describe('2004 token refresh and retry', () => {
    it('refreshes merchant token on 2004 and retries the original call', async () => {
      // First call: 2004 error
      mockFetch
        .mockResolvedValueOnce({ json: async () => ({ errors: [{ extensions: { code: '2004' } }] }) })
        // authMerchant refresh
        .mockResolvedValueOnce({ json: async () => ({ data: { authMerchant: { token: 'new-token' } } }) })
        // retry original call — success
        .mockResolvedValueOnce({ json: async () => ({ data: { deductFromUser: { isSuccess: true } } }) });

      const result = await adapter.deductFromUser('user-token', 100, 'test');
      expect(result.isSuccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
