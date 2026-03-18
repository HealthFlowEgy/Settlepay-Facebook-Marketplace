// ─── PaymentService Interface ─────────────────────────────────────────────────
// ALL HealthPay GraphQL calls are abstracted behind this interface.
// Phase 1: Implemented by HealthPayAdapter
// Phase 2: Swapped to SettePay PSP Adapter — ZERO frontend changes needed.
//
// CRITICAL RULE: No controller, service, webhook, or component may call
// HealthPay directly. ALL payment operations must go through PaymentService.

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';

export interface WalletBalance {
  total: number;
  balance: Array<{
    uid: string;
    amount: number;
    type: string;
    createdAt: string;
  }>;
}

export interface PaymentRequest {
  id: string;
  amount: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface RegisterUserResult {
  uid: string;
  userToken: string;
}

export interface TopupResult {
  uid: string;
  iframeUrl: string;
}

export interface VirtualCard {
  id: string;
  cardNumber: string; // masked
  expiryMonth: number;
  expiryYear: number;
  status: 'active' | 'frozen' | 'expired';
}

export interface IPaymentService {
  // ── Merchant Auth ────────────────────────────────────────────────────────
  /** Authenticate merchant — returns JWT token. Auto-called by token manager. */
  authenticateMerchant(): Promise<string>;

  // ── User / Provider Auth ─────────────────────────────────────────────────
  /** Step 1: Send OTP to mobile. isProvider=true for sellers. */
  loginUser(mobile: string, firstName: string, lastName: string, email?: string): Promise<{ uid: string }>;

  /** Step 2: Verify OTP and get userToken. isProvider MUST be correct — permanent. */
  authUser(mobile: string, otp: string, isProvider: boolean): Promise<RegisterUserResult>;

  /** Logout user — invalidates userToken on HealthPay side. */
  logoutUser(userToken: string): Promise<{ isSuccess: boolean }>;

  // ── Wallet ───────────────────────────────────────────────────────────────
  /** Get wallet balance + last 10 transaction logs. */
  getUserWallet(userToken: string): Promise<WalletBalance>;

  /** Generate top-up iFrame URL. Embed in checkout PWA. */
  getTopupIframeUrl(userToken: string, amount: number): Promise<TopupResult>;

  // ── Escrow ───────────────────────────────────────────────────────────────
  /** Send payment request to buyer for explicit approval before deduction. */
  sendPaymentRequest(userToken: string, amount: number): Promise<{ isSuccess: boolean }>;

  /**
   * Deduct amount from user wallet to SettePay merchant wallet.
   * MUST include dealId in description: "SettePay Escrow - Deal#${dealId}"
   * ALWAYS use idempotency key to prevent double-charge.
   */
  deductFromUser(userToken: string, amount: number, description: string): Promise<{ isSuccess: boolean }>;

  /**
   * Transfer amount from SettePay merchant wallet to user/provider wallet.
   * Used for: (a) escrow release to seller, (b) refund to buyer on dispute.
   * ALWAYS deduct commission before calling for seller payouts.
   * description: "SettePay Release - Deal#${dealId}" or "SettePay Refund - Deal#${dealId}"
   */
  payToUser(userToken: string, amount: number, description: string): Promise<{ isSuccess: boolean }>;

  // ── Transaction History ──────────────────────────────────────────────────
  /** Get all payment requests for a user — used for dispute audit trail. */
  getPaymentRequests(userToken: string): Promise<PaymentRequest[]>;

  // ── Phase 2 Methods (F.1 — stub now, implement with SettePay PSP) ────────

  /**
   * Issue a virtual card for e-money issuance.
   * Requires SettePay PSP-A license.
   */
  issueVirtualCard?(userId: string): Promise<VirtualCard>;

  /**
   * Instant settlement (T+0) via SettePay PSP.
   * Bypasses standard settlement window.
   */
  instantSettlement?(sellerToken: string, amount: number): Promise<{ isSuccess: boolean }>;

  /**
   * Get dynamic transaction fee from PSP.
   * May vary by amount, user tier, or time of day.
   */
  getTransactionFee?(amount: number): Promise<number>;
}
