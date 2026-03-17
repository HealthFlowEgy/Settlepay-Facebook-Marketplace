import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscrowService } from './escrow.service';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE } from '../payment/payment.service.interface';
import { CommissionService } from '../commission/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { InsufficientFundsError, GatewayError } from '../payment/healthpay.adapter';
import { DealStatus } from '@prisma/client';

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockPayment = {
  sendPaymentRequest: jest.fn(),
  deductFromUser:     jest.fn(),
  payToUser:          jest.fn(),
  getUserWallet:      jest.fn(),
};

const mockPrisma = {
  deal:               { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  escrowTransaction:  { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  commissionRecord:   { upsert: jest.fn() },
  user:               { findUniqueOrThrow: jest.fn() },
  $transaction:       jest.fn(async (ops: any[]) => Promise.all(ops)),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, any> = {
      'escrow.buyerConfirmTimeoutHours': 24,
      'escrow.deliveryExpiryDays':       14,
      'escrow.disputeWindowHours':       48,
      'commission.rate':                 0.018,
      'commission.minEgp':               0.75,
    };
    return values[key];
  }),
};

const mockCommission = {
  calculate: jest.fn(() => ({ commission: 45, netPayout: 2455, rate: 0.018 })),
};

const mockNotifications = {
  sendDealNotification: jest.fn(),
  alertOpsTeam:         jest.fn(),
};

const mockAudit = { log: jest.fn() };

// ── Sample data ────────────────────────────────────────────────────────────────
const mockBuyer  = { id: 'buyer-1',  hpUserToken: 'encrypted-buyer-token',  firstName: 'Sara',  lastName: 'Ahmed' };
const mockSeller = { id: 'seller-1', hpUserToken: 'encrypted-seller-token', firstName: 'Ahmed', lastName: 'Mohamed' };

const mockDeal = (status = DealStatus.PENDING, extra = {}) => ({
  id:              'deal-123',
  buyerId:         mockBuyer.id,
  sellerId:        mockSeller.id,
  amount:          2500,
  status,
  itemDescription: 'iPhone 14 Pro',
  buyer:           mockBuyer,
  seller:          mockSeller,
  ...extra,
});

// Mock decryptToken
jest.mock('../common/crypto.util', () => ({
  decryptToken:           jest.fn(() => 'decrypted-hp-token'),
  generateIdempotencyKey: jest.fn(() => 'idempotency-key-abc'),
}));

// ── Test Suite ─────────────────────────────────────────────────────────────────
describe('EscrowService', () => {
  let service: EscrowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: ConfigService,        useValue: mockConfig },
        { provide: CommissionService,    useValue: mockCommission },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditService,         useValue: mockAudit },
        { provide: PAYMENT_SERVICE,      useValue: mockPayment },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
    jest.clearAllMocks();
  });

  // ── initiateDeal ─────────────────────────────────────────────────────────────
  describe('initiateDeal', () => {
    it('creates a deal with PENDING status', async () => {
      const deal = mockDeal();
      mockPrisma.deal.create.mockResolvedValue(deal);

      const result = await service.initiateDeal('seller-1', 'buyer-1', 2500, 'iPhone 14 Pro');
      expect(result.status).toBe(DealStatus.PENDING);
      expect(mockPrisma.deal.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ amount: 2500, status: DealStatus.PENDING }),
      }));
    });

    it('rejects amounts below EGP 50', async () => {
      await expect(service.initiateDeal('s', 'b', 49, 'item'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects amounts above EGP 50,000', async () => {
      await expect(service.initiateDeal('s', 'b', 50001, 'item'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ── sendPaymentRequestToBuyer ─────────────────────────────────────────────────
  describe('sendPaymentRequestToBuyer', () => {
    it('sends payment request and transitions to AWAITING_BUYER_CONFIRMATION', async () => {
      const deal = mockDeal(DealStatus.PENDING);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPayment.sendPaymentRequest.mockResolvedValue({ isSuccess: true });

      await service.sendPaymentRequestToBuyer('deal-123');

      expect(mockPayment.sendPaymentRequest).toHaveBeenCalledWith('decrypted-hp-token', 2500);
      expect(mockPrisma.deal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: DealStatus.AWAITING_BUYER_CONFIRMATION },
      }));
    });

    it('throws ConflictException if deal not in PENDING state', async () => {
      const deal = mockDeal(DealStatus.ESCROW_ACTIVE);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);

      await expect(service.sendPaymentRequestToBuyer('deal-123'))
        .rejects.toThrow(ConflictException);
    });
  });

  // ── executeEscrowDeduction ───────────────────────────────────────────────────
  describe('executeEscrowDeduction', () => {
    it('deducts funds and transitions to ESCROW_ACTIVE on success', async () => {
      const deal = mockDeal(DealStatus.AWAITING_BUYER_CONFIRMATION);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue(null);
      mockPayment.deductFromUser.mockResolvedValue({ isSuccess: true });

      const result = await service.executeEscrowDeduction('deal-123');
      expect(result.isSuccess).toBe(true);
      expect(mockPayment.deductFromUser).toHaveBeenCalledWith(
        'decrypted-hp-token',
        2500,
        'SettePay Escrow - Deal#deal-123',
      );
    });

    it('transitions to AWAITING_TOP_UP on error 7001 (insufficient funds)', async () => {
      const deal = mockDeal(DealStatus.AWAITING_BUYER_CONFIRMATION);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue(null);
      mockPayment.deductFromUser.mockRejectedValue(new InsufficientFundsError());

      await expect(service.executeEscrowDeduction('deal-123'))
        .rejects.toThrow(BadRequestException);

      expect(mockPrisma.deal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: DealStatus.AWAITING_TOP_UP },
      }));
      expect(mockNotifications.sendDealNotification).toHaveBeenCalledWith(
        deal, 'insufficient_funds'
      );
    });

    it('retries once on error 6001 (gateway error)', async () => {
      const deal = mockDeal(DealStatus.AWAITING_BUYER_CONFIRMATION);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue(null);
      // First call fails, second succeeds
      mockPayment.deductFromUser
        .mockRejectedValueOnce(new GatewayError())
        .mockResolvedValueOnce({ isSuccess: true });

      const result = await service.executeEscrowDeduction('deal-123');
      expect(mockPayment.deductFromUser).toHaveBeenCalledTimes(2);
    }, 10_000);

    it('returns cached result if idempotency key exists (no double-charge)', async () => {
      const deal = mockDeal(DealStatus.AWAITING_BUYER_CONFIRMATION);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue({ deductSuccess: true });

      const result = await service.executeEscrowDeduction('deal-123');
      expect(result.isSuccess).toBe(true);
      expect(result).toHaveProperty('cached', true);
      // Must NOT call HealthPay again
      expect(mockPayment.deductFromUser).not.toHaveBeenCalled();
    });
  });

  // ── releaseEscrowOnDelivery ──────────────────────────────────────────────────
  describe('releaseEscrowOnDelivery', () => {
    it('calls payToUser with net amount (minus commission) and transitions to SETTLED', async () => {
      const deal = mockDeal(DealStatus.DELIVERY_CONFIRMED);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue({ payoutSuccess: false });
      mockPrisma.commissionRecord.upsert.mockResolvedValue({});
      mockPayment.payToUser.mockResolvedValue({ isSuccess: true });

      await service.releaseEscrowOnDelivery('deal-123');

      // Commission: max(2500 * 0.018, 0.75) = 45
      // Net payout: 2500 - 45 = 2455
      expect(mockPayment.payToUser).toHaveBeenCalledWith(
        'decrypted-hp-token',
        2455, // net payout
        'SettePay Release - Deal#deal-123',
      );
    });

    it('sets PAYOUT_FAILED and alerts ops if payToUser fails', async () => {
      const deal = mockDeal(DealStatus.DELIVERY_CONFIRMED);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPrisma.escrowTransaction.findUnique.mockResolvedValue({ payoutSuccess: false });
      mockPrisma.commissionRecord.upsert.mockResolvedValue({});
      // Both attempts fail
      mockPayment.payToUser.mockRejectedValue(new GatewayError());

      await expect(service.releaseEscrowOnDelivery('deal-123'))
        .rejects.toThrow();

      expect(mockPrisma.deal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: DealStatus.PAYOUT_FAILED },
      }));
      expect(mockNotifications.alertOpsTeam).toHaveBeenCalled();
    }, 10_000);
  });

  // ── autoRefund ───────────────────────────────────────────────────────────────
  describe('autoRefund', () => {
    it('refunds full amount to buyer and transitions to REFUNDED', async () => {
      const deal = mockDeal(DealStatus.SHIPPED);
      mockPrisma.deal.findUnique.mockResolvedValue(deal);
      mockPayment.payToUser.mockResolvedValue({ isSuccess: true });

      await service.autoRefund('deal-123');

      expect(mockPayment.payToUser).toHaveBeenCalledWith(
        'decrypted-hp-token',
        2500, // FULL amount — no commission on refund
        'SettePay AutoRefund - Deal#deal-123',
      );
      expect(mockPrisma.deal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: DealStatus.REFUNDED }),
      }));
    });
  });
});
