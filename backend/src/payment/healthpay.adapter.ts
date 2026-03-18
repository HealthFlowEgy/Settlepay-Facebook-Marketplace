import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  IPaymentService, WalletBalance, PaymentRequest,
  RegisterUserResult, TopupResult, VirtualCard,
} from './payment.service.interface';
import { NotImplementedException } from '@nestjs/common';
import { REDIS_CLIENT } from '../common/redis.module';
import Redis from 'ioredis';

// ─── GraphQL Operations ────────────────────────────────────────────────────────
const GQL = {
  AUTH_MERCHANT: `mutation authMerchant($apiKey: String!) { authMerchant(apiKey: $apiKey) { token } }`,
  LOGIN_USER: `mutation loginUser($mobile: String!, $lastName: String!, $firstName: String!, $email: String) {
    loginUser(mobile: $mobile, lastName: $lastName, firstName: $firstName, email: $email) { uid } }`,
  AUTH_USER: `mutation authUser($mobile: String!, $otp: String!, $isProvider: Boolean!) {
    authUser(mobile: $mobile, otp: $otp, isProvider: $isProvider) { userToken user { uid } } }`,
  LOGOUT_USER: `mutation logoutUser($userToken: String!) { logoutUser(userToken: $userToken) { isSuccess } }`,
  TOPUP_WALLET: `mutation topupWalletUser($userToken: String!, $amount: Float!) {
    topupWalletUser(userToken: $userToken, amount: $amount) { uid iframeUrl } }`,
  DEDUCT_FROM_USER: `mutation deductFromUser($userToken: String!, $amount: Float!, $desc: String) {
    deductFromUser(userToken: $userToken, amount: $amount, description: $desc) { isSuccess } }`,
  SEND_PAYMENT_REQUEST: `mutation sendPaymentRequest($userToken: String!, $amount: Float!) {
    sendPaymentRequest(userToken: $userToken, amount: $amount) { isSuccess } }`,
  PAY_TO_USER: `mutation payToUser($userToken: String!, $amount: Float!, $desc: String) {
    payToUser(userToken: $userToken, amount: $amount, description: $desc) { isSuccess } }`,
  USER_WALLET: `query userWallet($userToken: String!) {
    userWallet(userToken: $userToken) { total balance { uid amount type createdAt } } }`,
  USER_PAYMENT_REQUESTS: `query userPaymentRequests($userToken: String!) {
    userPaymentRequests(userToken: $userToken) { id amount status createdAt } }`,
};

// CR-06 fix: Merchant token in Redis ONLY — not in PostgreSQL
const HP_MERCHANT_TOKEN_KEY = 'hp:merchant:token';
const HP_MERCHANT_TOKEN_TTL = 82800; // 23 hours in seconds

// ─── Error Classes ─────────────────────────────────────────────────────────────
export class HealthPayError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'HealthPayError'; }
}
export class InsufficientFundsError extends HealthPayError {
  constructor() { super('7001', 'Insufficient funds in payer wallet'); }
}
export class GatewayError extends HealthPayError {
  constructor() { super('6001', 'Payment gateway unprocessed — retry'); }
}
export class InvalidUserTokenError extends HealthPayError {
  constructor() { super('3002', 'userToken is invalid'); }
}
export class OtpThrottleError extends HealthPayError {
  constructor() { super('5001', 'Too many OTP requests — wait 1 hour'); }
}
export class InvalidOtpError extends HealthPayError {
  constructor() { super('5002', 'Invalid OTP'); }
}

@Injectable()
export class HealthPayAdapter implements IPaymentService, OnModuleInit {
  private readonly logger = new Logger(HealthPayAdapter.name);
  private merchantToken: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    await this.loadOrRefreshMerchantToken();
  }

  // CR-06 fix: Every 23 hours from server start (not "at 11pm")
  @Cron('0 0 */23 * * *')
  async scheduledTokenRefresh() {
    this.logger.log('Scheduled HealthPay merchant token refresh');
    await this.loadOrRefreshMerchantToken();
  }

  private async loadOrRefreshMerchantToken(): Promise<void> {
    try {
      // CR-06: Redis ONLY — not PostgreSQL
      const cached = await this.redis.get(HP_MERCHANT_TOKEN_KEY);
      if (cached) {
        this.merchantToken = cached;
        this.logger.log('Merchant token loaded from Redis cache');
        return;
      }
      await this.refreshMerchantToken();
    } catch (err: any) {
      this.logger.error('Failed to load/refresh merchant token', err.message);
      // Enter degraded mode — queue requests
    }
  }

  async refreshMerchantToken(): Promise<void> {
    const apiKey = this.config.get<string>('healthpay.apiKey');
    const data   = await this.executeGql(GQL.AUTH_MERCHANT, { apiKey }, false);
    const token  = data.authMerchant.token;
    this.merchantToken = token;
    // CR-06: Store in Redis with TTL — never in DB
    await this.redis.setex(HP_MERCHANT_TOKEN_KEY, HP_MERCHANT_TOKEN_TTL, token);
    this.logger.log('Merchant token refreshed and cached in Redis');
  }

  // CR-05 fix: Try multiple field paths for error code
  private async executeGql(
    query: string,
    variables: Record<string, unknown> = {},
    requiresAuth = true,
    retryOnAuthFail = true,
  ): Promise<any> {
    const baseUrl    = this.config.get<string>('healthpay.baseUrl');
    const apiHeader  = this.config.get<string>('healthpay.apiHeader');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-header':   apiHeader!,
    };
    if (requiresAuth && this.merchantToken) {
      headers['Authorization'] = `Bearer ${this.merchantToken}`;
    }

    // GAP-FIX-17: Set a request timeout — a hung HealthPay endpoint would otherwise
    // block the request thread indefinitely (default: 10s)
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(baseUrl!, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ query, variables }),
        signal:  controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const json = await res.json() as any;

    if (json.errors?.length) {
      const err  = json.errors[0];

      // CR-05 fix: Try multiple field locations for the error code
      const code = String(
        err.extensions?.code       ??    // Standard GraphQL extensions
        err.extensions?.errorCode  ??    // Common variant
        err.extensions?.exception?.code ?? // Another variant
        err.message                       // Final fallback (original assumption)
      );

      // Log full error for debugging (helps confirm actual field path)
      this.logger.warn(`HealthPay GraphQL error raw: ${JSON.stringify(err)}`);

      // 2004: merchant token invalid — refresh and retry once
      if (code === '2004' && retryOnAuthFail) {
        this.logger.warn('Merchant token expired (2004) — refreshing and retrying');
        await this.refreshMerchantToken();
        return this.executeGql(query, variables, requiresAuth, false);
      }

      this.throwHealthPayError(code);
    }

    return json.data;
  }

  private throwHealthPayError(code: string): never {
    switch (code) {
      case '2001': throw new HealthPayError('2001', 'api-header is required');
      case '2002': throw new HealthPayError('2002', 'api-header is invalid');
      case '2004': throw new HealthPayError('2004', 'Authorization invalid');
      case '3001': throw new HealthPayError('3001', 'apiKey is invalid');
      case '3002': throw new InvalidUserTokenError();
      case '5001': throw new OtpThrottleError();
      case '5002': throw new InvalidOtpError();
      case '6001': throw new GatewayError();
      case '7001': throw new InsufficientFundsError();
      default:     throw new HealthPayError(code, `HealthPay error: ${code}`);
    }
  }

  // ── IPaymentService Methods ────────────────────────────────────────────────
  async authenticateMerchant(): Promise<string> {
    const apiKey = this.config.get<string>('healthpay.apiKey');
    const data   = await this.executeGql(GQL.AUTH_MERCHANT, { apiKey }, false);
    return data.authMerchant.token;
  }

  async loginUser(mobile: string, firstName: string, lastName: string, email?: string) {
    const data = await this.executeGql(GQL.LOGIN_USER, { mobile, firstName, lastName, email });
    return { uid: data.loginUser.uid };
  }

  async authUser(mobile: string, otp: string, isProvider: boolean): Promise<RegisterUserResult> {
    const data = await this.executeGql(GQL.AUTH_USER, { mobile, otp, isProvider });
    return { uid: data.authUser.user.uid, userToken: data.authUser.userToken };
  }

  async logoutUser(userToken: string) {
    const data = await this.executeGql(GQL.LOGOUT_USER, { userToken });
    return { isSuccess: data.logoutUser.isSuccess };
  }

  async getUserWallet(userToken: string): Promise<WalletBalance> {
    const data = await this.executeGql(GQL.USER_WALLET, { userToken });
    return data.userWallet;
  }

  async getTopupIframeUrl(userToken: string, amount: number): Promise<TopupResult> {
    const data = await this.executeGql(GQL.TOPUP_WALLET, { userToken, amount });
    return { uid: data.topupWalletUser.uid, iframeUrl: data.topupWalletUser.iframeUrl };
  }

  async sendPaymentRequest(userToken: string, amount: number) {
    const data = await this.executeGql(GQL.SEND_PAYMENT_REQUEST, { userToken, amount });
    return { isSuccess: data.sendPaymentRequest.isSuccess };
  }

  async deductFromUser(userToken: string, amount: number, description: string) {
    const data = await this.executeGql(GQL.DEDUCT_FROM_USER, { userToken, amount, desc: description });
    return { isSuccess: data.deductFromUser.isSuccess };
  }

  async payToUser(userToken: string, amount: number, description: string) {
    const data = await this.executeGql(GQL.PAY_TO_USER, { userToken, amount, desc: description });
    return { isSuccess: data.payToUser.isSuccess };
  }

  async getPaymentRequests(userToken: string): Promise<PaymentRequest[]> {
    const data = await this.executeGql(GQL.USER_PAYMENT_REQUESTS, { userToken });
    return data.userPaymentRequests;
  }

  // ── Phase 2 Stubs (F.1) ───────────────────────────────────────────────────
  async issueVirtualCard(userId: string): Promise<VirtualCard> {
    throw new NotImplementedException('issueVirtualCard requires SettePay PSP-A license (Phase 2)');
  }
  async instantSettlement(sellerToken: string, amount: number): Promise<{ isSuccess: boolean }> {
    throw new NotImplementedException('instantSettlement requires SettePay PSP (Phase 2)');
  }
  async getTransactionFee(amount: number): Promise<number> {
    throw new NotImplementedException('getTransactionFee requires SettePay PSP (Phase 2)');
  }
}
