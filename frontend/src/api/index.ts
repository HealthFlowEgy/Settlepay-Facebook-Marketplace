import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({ baseURL: BASE, withCredentials: true });

// Attach JWT
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('sp_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Handle 401
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sp_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  sendOtp:   (mobile: string, firstName: string, lastName: string, email?: string) =>
    api.post('/auth/send-otp', { mobile, firstName, lastName, email }),
  verifyOtp: (mobile: string, otp: string, isProvider: boolean, firstName?: string, lastName?: string) =>
    api.post('/auth/verify-otp', { mobile, otp, isProvider, firstName, lastName }),
  logout:    () => api.post('/auth/logout'),
  me:        () => api.get('/auth/me'),
};

// ─── Deals ────────────────────────────────────────────────────────────────────
export const dealsApi = {
  create:          (data: CreateDealPayload) => api.post('/deals', data),
  get:             (id: string)              => api.get(`/deals/${id}`),
  list:            (role: 'buyer'|'seller', status?: string) =>
    api.get('/deals', { params: { role, status } }),
  requestPayment:  (id: string) => api.post(`/deals/${id}/request-payment`),
  confirmPayment:  (id: string) => api.post(`/deals/${id}/confirm-payment`),
  markShipped:     (id: string, waybillId?: string) => api.patch(`/deals/${id}/ship`, { waybillId }),
  getBalance:      ()           => api.get('/deals/wallet/balance'),
  getTopupUrl:     (amount: number) => api.post('/deals/wallet/topup', { amount }),
  getPaymentRequests: (id: string) => api.get(`/deals/${id}/payment-requests`),
};

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputesApi = {
  raise:          (dealId: string)                   => api.post('/disputes', { dealId }),
  get:            (id: string)                        => api.get(`/disputes/${id}`),
  submitEvidence: (id: string, evidenceUrls: string[]) => api.patch(`/disputes/${id}/evidence`, { evidenceUrls }),
};

// ─── KYC ──────────────────────────────────────────────────────────────────────
export const kycApi = {
  verify: (nationalId: string, selfieUrl?: string) =>
    api.post('/kyc/verify', { nationalId, selfieUrl }),
};

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersApi = {
  profile:       ()   => api.get('/users/profile'),
  updateProfile: (d: any) => api.patch('/users/profile', d),
  publicProfile: (id: string) => api.get(`/users/${id}/public`),
};

// ─── Admin ────────────────────────────────────────────────────────────────────
export const adminApi = {
  disputes: (status?: string) => api.get('/admin/disputes', { params: { status } }),
  resolveDispute: (id: string, data: any) => api.post(`/admin/disputes/${id}/resolve`, data),
  deals:    (status?: string) => api.get('/admin/deals', { params: { status } }),
  stats:    ()                => api.get('/admin/deals/stats'),
  users:    ()                => api.get('/admin/users'),
  audit:    (userId?: string) => api.get('/admin/audit', { params: { userId } }),
  blockUser: (id: string, reason: string) => api.post(`/admin/users/${id}/block`, { reason }),
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CreateDealPayload {
  buyerId: string;
  amount: number;
  itemDescription: string;
  messengerThreadId?: string;
}

export type DealStatus =
  | 'PENDING' | 'AWAITING_BUYER_CONFIRMATION' | 'AWAITING_TOP_UP'
  | 'ESCROW_DEDUCTING' | 'ESCROW_ACTIVE' | 'SHIPPED'
  | 'DELIVERY_CONFIRMED' | 'SETTLING' | 'SETTLED'
  | 'DISPUTED' | 'REFUNDING' | 'REFUNDED'
  | 'PAYOUT_FAILED' | 'PAYMENT_ERROR' | 'CANCELLED';

export interface Deal {
  id: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  commission?: number;
  netPayout?: number;
  status: DealStatus;
  itemDescription: string;
  waybillId?: string;
  createdAt: string;
  settledAt?: string;
  buyer?: { id: string; firstName: string; lastName: string; mobile: string };
  seller?: { id: string; firstName: string; lastName: string; mobile: string };
  dispute?: Dispute;
}

export interface Dispute {
  id: string;
  dealId: string;
  status: 'OPEN'|'EVIDENCE_COLLECTION'|'UNDER_REVIEW'|'RESOLVED';
  resolution?: 'FULL_RELEASE'|'PARTIAL'|'FULL_REFUND';
  evidenceDeadline?: string;
  resolutionDeadline?: string;
}

export interface User {
  id: string;
  mobile: string;
  firstName: string;
  lastName: string;
  email?: string;
  isProvider: boolean;
  kycTier: string;
  kycStatus: string;
}
