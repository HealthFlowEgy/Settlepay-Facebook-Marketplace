import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import {
  IPaymentService, WalletBalance, PaymentRequest,
  RegisterUserResult, TopupResult,
} from './payment.service.interface';

// ─── GraphQL Operations ───────────────────────────────────────────────────────
const GQL = {
  AUTH_MERCHANT: `
    mutation authMerchant($apiKey: String!) {
      authMerchant(apiKey: $apiKey) { token }
    }`,

  LOGIN_USER: `
    mutation loginUser($mobile: String!, $lastName: String!, $firstName: String!, $email: String) {
      loginUser(mobile: $mobile, lastName: $lastName, firstName: $firstName, email: $email) { uid }
    }`,

  AUTH_USER: `
    mutation authUser($mobile: String!, $otp: String!, $isProvider: Boolean!) {
      authUser(mobile: $mobile, otp: $otp, isProvider: $isProvider) {
        userToken
        user { uid }
      }
    }`,

  LOGOUT_USER: `
    mutation logoutUser($userToken: String!) {
      logoutUser(userToken: $userToken) { isSuccess }
    }`,

  TOPUP_WALLET: `
    mutation topupWalletUser($userToken: String!, $amount: Float!) {
      topupWalletUser(userToken: $userToken, amount: $amount) { uid iframeUrl }
    }`,

  DEDUCT_FROM_USER: `
    mutation deductFromUser($userToken: String!, $amount: Float!, $desc: String) {
      deductFromUser(userToken: $userToken, amount: $amount, description: $desc) { isSuccess }
    }`,

  SEND_PAYMENT_REQUEST: `
    mutation sendPaymentRequest($userToken: String!, $amount: Float!) {
      sendPaymentRequest(userToken: $userToken, amount: $amount) { isSuccess }
    }`,

  PAY_TO_USER: `
    mutation payToUser($userToken: String!, $amount: Float!, $desc: String) {
      payToUser(userToken: $userToken, amount: $amount, description: $desc) { isSuccess }
    }`,

  USER_WALLET: `
    query userWallet($userToken: String!) {
      userWallet(userToken: $userToken) {
        total
        balance { uid amount type createdAt }
      }
    }`,

  USER_PAYMENT_REQUESTS: `
    query userPaymentRequests($userToken: String!) {
      userPaymentRequests(userToken: $userToken) {
        id amount status createdAt
      }
    }`,
};

// ─── Error Codes ──────────────────────────────────────────────────────────────
export class HealthPayError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'HealthPayError';
  }
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
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Load cached token from DB or fetch fresh
    await this.loadOrRefreshMerchantToken();
  }

  // ── Token Management ────────────────────────────────────────────────────────
  @Cron('0 */23 * * *') // Every 23 hours
  async scheduledTokenRefresh() {
    this.logger.log('Scheduled HealthPay merchant token refresh');
    await this.loadOrRefreshMerchantToken();
  }

  private async loadOrRefreshMerchantToken(): Promise<void> {
    try {
      // Check DB cache first
      const cached = await this.prisma.merchantToken.findUnique({ where: { id: 'singleton' } });
      if (cached && cached.expiresAt > new Date(Date.now() + 60_000)) {
        this.merchantToken = cached.token;
        this.logger.log('Merchant token loaded from cache');
        return;
      }
      // Fetch fresh token
      await this.refreshMerchantToken();
    } catch (err) {
      this.logger.error('Failed to load/refresh merchant token', err);
    }
  }

  private async refreshMerchantToken(): Promise<void> {
    const apiKey = this.config.get<string>('healthpay.apiKey');
    const result = await this.executeGql(GQL.AUTH_MERCHANT, { apiKey }, false);
    const token = result.authMerchant.token;
    this.merchantToken = token;

    const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000);
    await this.prisma.merchantToken.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton', token, expiresAt },
      update: { token, expiresAt, refreshedAt: new Date() },
    });
    this.logger.log('Merchant token refreshed successfully');
  }

  // ── Core GraphQL Executor ───────────────────────────────────────────────────
  private async executeGql(
    query: string,
    variables: Record<string, unknown> = {},
    requiresAuth = true,
  ): Promise<any> {
    const baseUrl  = this.config.get<string>('healthpay.baseUrl');
    const apiHeader = this.config.get<string>('healthpay.apiHeader');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-header':   apiHeader,
    };
    if (requiresAuth && this.merchantToken) {
      headers['Authorization'] = `Bearer ${this.merchantToken}`;
    }

    const res = await fetch(baseUrl, {
      method:  'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    // GraphQL errors are in json.errors — HTTP status is not reliable
    if (json.errors?.length) {
      const code = json.errors[0].message;
      this.throwHealthPayError(code);
    }

    return json.data;
  }

  private throwHealthPayError(code: string): never {
    switch (code) {
      case '2001': throw new HealthPayError('2001', 'api-header is required');
      case '2002': throw new HealthPayError('2002', 'api-header is invalid');
      case '2004':
        // Token expired — trigger refresh asynchronously
        this.refreshMerchantToken().catch(() => {});
        throw new HealthPayError('2004', 'Authorization token invalid — refresh triggered');
      case '3001': throw new HealthPayError('3001', 'apiKey is invalid');
      case '3002': throw new InvalidUserTokenError();
      case '5001': throw new OtpThrottleError();
      case '5002': throw new InvalidOtpError();
      case '6001': throw new GatewayError();
      case '7001': throw new InsufficientFundsError();
      default:     throw new HealthPayError(code, `HealthPay error: ${code}`);
    }
  }

  // ── API Methods ─────────────────────────────────────────────────────────────
  async authenticateMerchant(): Promise<string> {
    const apiKey = this.config.get<string>('healthpay.apiKey');
    const data = await this.executeGql(GQL.AUTH_MERCHANT, { apiKey }, false);
    return data.authMerchant.token;
  }

  async loginUser(mobile: string, firstName: string, lastName: string, email?: string) {
    const data = await this.executeGql(GQL.LOGIN_USER, { mobile, firstName, lastName, email });
    return { uid: data.loginUser.uid };
  }

  async authUser(mobile: string, otp: string, isProvider: boolean): Promise<RegisterUserResult> {
    const data = await this.executeGql(GQL.AUTH_USER, { mobile, otp, isProvider });
    return {
      uid:       data.authUser.user.uid,
      userToken: data.authUser.userToken,
    };
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
    const data = await this.executeGql(GQL.DEDUCT_FROM_USER, {
      userToken, amount, desc: description,
    });
    return { isSuccess: data.deductFromUser.isSuccess };
  }

  async payToUser(userToken: string, amount: number, description: string) {
    const data = await this.executeGql(GQL.PAY_TO_USER, {
      userToken, amount, desc: description,
    });
    return { isSuccess: data.payToUser.isSuccess };
  }

  async getPaymentRequests(userToken: string): Promise<PaymentRequest[]> {
    const data = await this.executeGql(GQL.USER_PAYMENT_REQUESTS, { userToken });
    return data.userPaymentRequests;
  }
}
