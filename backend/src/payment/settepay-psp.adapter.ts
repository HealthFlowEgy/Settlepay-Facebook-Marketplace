/**
 * SettePay PSP Adapter — Phase 2 (Post-CBE PSP License)
 *
 * This is the migration stub for when SettePay's own CBE PSP-B license is granted.
 *
 * TO ACTIVATE:
 * 1. Implement all methods below using SettePay's own PSP API
 * 2. In payment.module.ts, change:
 *      { provide: PAYMENT_SERVICE, useClass: HealthPayAdapter }
 *    to:
 *      { provide: PAYMENT_SERVICE, useClass: SettepayPspAdapter }
 * 3. Run shadow mode (both adapters) for 4 weeks
 * 4. Retire HealthPayAdapter
 *
 * Zero frontend changes. Zero user disruption.
 * Timeline: Month 15-18 post-launch (see SETT-MKT-BRD-001 §8.2)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IPaymentService, WalletBalance, PaymentRequest,
  RegisterUserResult, TopupResult,
} from './payment.service.interface';

@Injectable()
export class SettepayPspAdapter implements IPaymentService {
  private readonly logger = new Logger(SettepayPspAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async authenticateMerchant(): Promise<string> {
    // TODO: POST to SettePay PSP /auth/merchant with CBE-issued credentials
    // Returns CBE-compliant merchant JWT
    throw new Error('SettepayPspAdapter.authenticateMerchant: not yet implemented — Phase 2');
  }

  async loginUser(mobile: string, firstName: string, lastName: string, email?: string) {
    // TODO: Create user in SettePay wallet system
    // Trigger OTP via SettePay's own SMS service
    // Returns { uid: string }
    throw new Error('SettepayPspAdapter.loginUser: not yet implemented — Phase 2');
  }

  async authUser(mobile: string, otp: string, isProvider: boolean): Promise<RegisterUserResult> {
    // TODO: Verify OTP against SettePay session store
    // isProvider=true → Seller (Provider in CBE terms)
    // isProvider=false → Buyer (User in CBE terms)
    // Returns { uid: string, userToken: string }
    throw new Error('SettepayPspAdapter.authUser: not yet implemented — Phase 2');
  }

  async logoutUser(userToken: string) {
    // TODO: Invalidate SettePay wallet session token
    throw new Error('SettepayPspAdapter.logoutUser: not yet implemented — Phase 2');
  }

  async getUserWallet(userToken: string): Promise<WalletBalance> {
    // TODO: Query SettePay internal wallet ledger
    // Returns { total: number, balance: WalletTransaction[] }
    throw new Error('SettepayPspAdapter.getUserWallet: not yet implemented — Phase 2');
  }

  async getTopupIframeUrl(userToken: string, amount: number): Promise<TopupResult> {
    // TODO: Generate SettePay-hosted top-up page URL
    // Accepts: Meeza, Visa/MC, InstaPay (direct integration — no HealthPay intermediary)
    // CBE PSP-B Art. 1-4: Electronic acceptance service
    throw new Error('SettepayPspAdapter.getTopupIframeUrl: not yet implemented — Phase 2');
  }

  async sendPaymentRequest(userToken: string, amount: number) {
    // TODO: Send internal payment request notification to buyer
    // Can use SettePay's own push/SMS instead of HealthPay notification
    throw new Error('SettepayPspAdapter.sendPaymentRequest: not yet implemented — Phase 2');
  }

  async deductFromUser(userToken: string, amount: number, description: string) {
    // TODO: Debit buyer's SettePay wallet, credit SettePay escrow sub-account
    // CBE PSP-B Art. 1-2: Payment transaction execution
    // CRITICAL: Must be atomic + idempotent
    throw new Error('SettepayPspAdapter.deductFromUser: not yet implemented — Phase 2');
  }

  async payToUser(userToken: string, amount: number, description: string) {
    // TODO: Credit seller's SettePay wallet from escrow sub-account
    // OR refund to buyer's wallet
    // CBE PSP-A Art. 1-8 required for holding escrow
    // CRITICAL: Must be atomic + idempotent
    throw new Error('SettepayPspAdapter.payToUser: not yet implemented — Phase 2');
  }

  async getPaymentRequests(userToken: string): Promise<PaymentRequest[]> {
    // TODO: Query SettePay internal transaction ledger for this user
    throw new Error('SettepayPspAdapter.getPaymentRequests: not yet implemented — Phase 2');
  }
}
