// SettePay Marketplace — Shared Frontend Types
// Auto-generated from Prisma schema and API contracts

export type DealStatus =
  | 'PENDING'
  | 'AWAITING_BUYER_CONFIRMATION'
  | 'AWAITING_TOP_UP'
  | 'ESCROW_DEDUCTING'
  | 'ESCROW_ACTIVE'
  | 'SHIPPED'
  | 'DELIVERY_CONFIRMED'
  | 'SETTLING'
  | 'SETTLED'
  | 'DISPUTED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'PAYOUT_FAILED'
  | 'PAYMENT_ERROR'
  | 'CANCELLED';

export type KycTier    = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';
export type KycStatus  = 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW';
export type DisputeStatus = 'OPEN' | 'EVIDENCE_COLLECTION' | 'UNDER_REVIEW' | 'RESOLVED';
export type DisputeResolution = 'FULL_RELEASE' | 'PARTIAL' | 'FULL_REFUND';

export interface User {
  id:          string;
  mobile:      string;
  firstName:   string;
  lastName:    string;
  email?:      string;
  isProvider:  boolean;
  kycTier:     KycTier;
  kycStatus:   KycStatus;
  facebookId?: string;
  createdAt?:  string;
  monthlyVolume?: number;
}

export interface DealParty {
  id:        string;
  firstName: string;
  lastName:  string;
  mobile?:   string;
}

export interface Deal {
  id:              string;
  buyerId:         string;
  sellerId:        string;
  amount:          number;
  commission?:     number;
  netPayout?:      number;
  status:          DealStatus;
  itemDescription: string;
  waybillId?:      string;
  createdAt:       string;
  updatedAt?:      string;
  settledAt?:      string;
  cancelledAt?:    string;
  cancelReason?:   string;

  // Timestamps
  escrowActivatedAt?: string;
  buyerConfirmedAt?:  string;
  shippedAt?:         string;
  deliveredAt?:       string;
  disputeWindowEnd?:  string;

  // Relations
  buyer?:          DealParty;
  seller?:         DealParty;
  dispute?:        Dispute;
  escrowTx?:       EscrowTransaction;
  commissionRecord?: CommissionRecord;
}

export interface EscrowTransaction {
  id:              string;
  dealId:          string;
  hpDeductionRef?: string;
  hpPayoutRef?:    string;
  amount:          number;
  commissionAmount?: number;
  netPayout?:      number;
  deductedAt?:     string;
  paidOutAt?:      string;
}

export interface Dispute {
  id:                 string;
  dealId:             string;
  status:             DisputeStatus;
  resolution?:        DisputeResolution;
  buyerEvidence?:     string[];
  sellerEvidence?:    string[];
  adminNotes?:        string;
  sellerPayout?:      number;
  buyerRefund?:       number;
  evidenceDeadline?:  string;
  resolutionDeadline?:string;
  resolvedAt?:        string;
  raisedBy?:          DealParty;
}

export interface CommissionRecord {
  id:               string;
  grossAmount:      number;
  commissionRate:   number;
  commissionAmount: number;
  netPayout:        number;
}

export interface WalletBalance {
  total:    number;
  balance:  Array<{
    uid:       string;
    amount:    number;
    type:      'credit' | 'debit';
    createdAt: string;
  }>;
  walletNotLinked?: boolean;
}

export interface PaymentRequest {
  id:        string;
  amount:    number;
  status:    'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface AdminStats {
  total:            number;
  active:           number;
  settled:          number;
  disputed:         number;
  totalCommission:  number;
}

export interface CreateDealPayload {
  buyerId:          string;
  amount:           number;
  itemDescription:  string;
  messengerThreadId?: string;
}

export interface ApiError {
  statusCode: number;
  message:    string | string[];
  error?:     string;
}
