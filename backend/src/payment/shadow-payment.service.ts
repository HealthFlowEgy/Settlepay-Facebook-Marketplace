import { Injectable, Logger, Inject } from '@nestjs/common';
import { IPaymentService } from './payment.service.interface';

/**
 * ShadowPaymentService (E.3 / BRD Section 8.2)
 *
 * Runs both primary (HealthPay) and shadow (SettePay PSP) adapters
 * in parallel during the 4-week CBE migration shadow run.
 *
 * - Primary executes and returns the result
 * - Shadow runs in parallel (fire-and-forget, dry-run only)
 * - Divergences are logged for the comparison dashboard
 *
 * Enable via environment variable:
 *   PAYMENT_MODE=shadow  → ShadowPaymentService
 *   PAYMENT_MODE=primary → HealthPayAdapter (default)
 *   PAYMENT_MODE=settepay → SettepayPspAdapter (post-migration)
 */
@Injectable()
export class ShadowPaymentService implements IPaymentService {
  private readonly logger = new Logger(ShadowPaymentService.name);

  constructor(
    @Inject('PRIMARY_PAYMENT') private primary: IPaymentService,
    @Inject('SHADOW_PAYMENT') private shadow: IPaymentService,
  ) {}

  async authenticateMerchant(): Promise<string> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.authenticateMerchant(),
      this.shadow.authenticateMerchant(),
    ]);

    this.logDivergence('authenticateMerchant', primaryResult, shadowResult);

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async registerUser(
    mobile: string,
    firstName: string,
    lastName: string,
    isProvider: boolean,
  ): Promise<{ uid: string; userToken: string }> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.registerUser(mobile, firstName, lastName, isProvider),
      this.shadow.registerUser(mobile, firstName, lastName, isProvider),
    ]);

    this.logDivergence('registerUser', primaryResult, shadowResult, { mobile });

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async getTopupIframeUrl(
    userToken: string,
    amount: number,
  ): Promise<string> {
    // No shadow for iframe — HealthPay-specific
    return this.primary.getTopupIframeUrl(userToken, amount);
  }

  async deductFromUser(
    userToken: string,
    amount: number,
    description: string,
  ): Promise<{ isSuccess: boolean }> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.deductFromUser(userToken, amount, description),
      this.shadow.deductFromUser(userToken, amount, description),
    ]);

    this.logDivergence('deductFromUser', primaryResult, shadowResult, {
      amount,
      description,
    });

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async payToUser(
    userToken: string,
    amount: number,
    description: string,
  ): Promise<{ isSuccess: boolean }> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.payToUser(userToken, amount, description),
      this.shadow.payToUser(userToken, amount, description),
    ]);

    this.logDivergence('payToUser', primaryResult, shadowResult, {
      amount,
      description,
    });

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async sendPaymentRequest(
    userToken: string,
    amount: number,
  ): Promise<{ isSuccess: boolean }> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.sendPaymentRequest(userToken, amount),
      this.shadow.sendPaymentRequest(userToken, amount),
    ]);

    this.logDivergence('sendPaymentRequest', primaryResult, shadowResult, {
      amount,
    });

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async getUserWallet(
    userToken: string,
  ): Promise<{ total: number; balance: any[] }> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.getUserWallet(userToken),
      this.shadow.getUserWallet(userToken),
    ]);

    this.logDivergence('getUserWallet', primaryResult, shadowResult);

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    throw (primaryResult as PromiseRejectedResult).reason;
  }

  async getPaymentRequests(userToken: string): Promise<any[]> {
    return this.primary.getPaymentRequests(userToken);
  }

  async logoutUser(
    userToken: string,
  ): Promise<{ isSuccess: boolean }> {
    return this.primary.logoutUser(userToken);
  }

  // ─── Phase 2 stubs ───────────────────────────────────────────────────────

  async issueVirtualCard?(userId: string): Promise<any> {
    return this.primary.issueVirtualCard?.(userId);
  }

  async instantSettlement?(
    sellerToken: string,
    amount: number,
  ): Promise<{ isSuccess: boolean }> {
    return this.primary.instantSettlement?.(sellerToken, amount);
  }

  async getTransactionFee?(amount: number): Promise<number> {
    return this.primary.getTransactionFee?.(amount);
  }

  // ─── Divergence Logging ───────────────────────────────────────────────────

  private logDivergence(
    operation: string,
    primaryResult: PromiseSettledResult<any>,
    shadowResult: PromiseSettledResult<any>,
    context?: Record<string, any>,
  ): void {
    if (shadowResult.status === 'rejected') {
      this.logger.warn('Shadow adapter failed', {
        operation,
        error: (shadowResult as PromiseRejectedResult).reason?.message,
        ...context,
      });
      return;
    }

    if (shadowResult.status === 'fulfilled' && primaryResult.status === 'fulfilled') {
      const primarySuccess = primaryResult.value?.isSuccess;
      const shadowSuccess = shadowResult.value?.isSuccess;

      if (primarySuccess !== undefined && shadowSuccess !== undefined) {
        const divergence = primarySuccess !== shadowSuccess;
        if (divergence) {
          this.logger.warn('Shadow mode divergence detected', {
            operation,
            primary: primaryResult.value,
            shadow: shadowResult.value,
            ...context,
          });
          this.alertOps('shadow_divergence', { operation, ...context });
        }
      }
    }
  }

  private async alertOps(
    type: string,
    context: Record<string, any>,
  ): Promise<void> {
    this.logger.error(`OPS ALERT: ${type}`, context);
    // TODO: Integrate with PagerDuty / Opsgenie webhook
  }
}
