import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE } from '../payment/payment.service.interface';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { DealStatus, DisputeStatus, DisputeResolution } from '@prisma/client';

const mockPayment = { payToUser: jest.fn() };
const mockPrisma  = {
  dispute: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  deal:    { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
};
const mockConfig  = { get: jest.fn((k: string) => k.includes('Hours') ? 48 : 72) };
const mockNotify  = { sendDealNotification: jest.fn() };
const mockAudit   = { log: jest.fn() };

jest.mock('../common/crypto.util', () => ({
  decryptToken: jest.fn(() => 'decrypted-token'),
}));

const makeDeal = (status = DealStatus.DELIVERY_CONFIRMED) => ({
  id: 'deal-1', buyerId: 'buyer-1', sellerId: 'seller-1', amount: 1000, status,
  disputeWindowEnd: new Date(Date.now() + 48 * 3_600_000),
  buyer:  { id: 'buyer-1',  hpUserToken: 'enc-buyer'  },
  seller: { id: 'seller-1', hpUserToken: 'enc-seller' },
});

describe('DisputesService', () => {
  let service: DisputesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: PAYMENT_SERVICE,      useValue: mockPayment },
        { provide: ConfigService,        useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotify },
        { provide: AuditService,         useValue: mockAudit },
      ],
    }).compile();
    service = module.get<DisputesService>(DisputesService);
    jest.clearAllMocks();
  });

  describe('raiseDispute', () => {
    it('raises dispute on DELIVERY_CONFIRMED deal', async () => {
      const deal = makeDeal();
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(deal);
      mockPrisma.dispute.findUnique.mockResolvedValue(null);
      mockPrisma.dispute.create.mockResolvedValue({ id: 'dispute-1', status: DisputeStatus.EVIDENCE_COLLECTION });

      const result = await service.raiseDispute('deal-1', 'buyer-1');
      expect(mockPrisma.deal.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: DealStatus.DISPUTED },
      }));
    });

    it('rejects if buyer is not the caller', async () => {
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(makeDeal());
      await expect(service.raiseDispute('deal-1', 'wrong-user'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects if dispute already exists', async () => {
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(makeDeal());
      mockPrisma.dispute.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.raiseDispute('deal-1', 'buyer-1'))
        .rejects.toThrow(ConflictException);
    });

    it('rejects if dispute window has closed', async () => {
      const deal = { ...makeDeal(), disputeWindowEnd: new Date(Date.now() - 1000) };
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(deal);
      mockPrisma.dispute.findUnique.mockResolvedValue(null);
      await expect(service.raiseDispute('deal-1', 'buyer-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveDispute', () => {
    const makeDispute = () => ({
      id: 'dispute-1', dealId: 'deal-1', status: DisputeStatus.UNDER_REVIEW,
    });

    it('FULL_RELEASE: pays seller net amount minus commission', async () => {
      mockPrisma.dispute.findUniqueOrThrow.mockResolvedValue(makeDispute());
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(makeDeal());
      mockPayment.payToUser.mockResolvedValue({ isSuccess: true });

      await service.resolveDispute('dispute-1', 'admin-1', DisputeResolution.FULL_RELEASE);

      expect(mockPayment.payToUser).toHaveBeenCalledWith(
        'decrypted-token',
        expect.closeTo(982, 0), // 1000 - (1000 * 0.018)
        'SettePay Dispute:FullRelease - Deal#deal-1',
      );
    });

    it('FULL_REFUND: pays buyer full amount (no commission)', async () => {
      mockPrisma.dispute.findUniqueOrThrow.mockResolvedValue(makeDispute());
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(makeDeal());
      mockPayment.payToUser.mockResolvedValue({ isSuccess: true });

      await service.resolveDispute('dispute-1', 'admin-1', DisputeResolution.FULL_REFUND);

      expect(mockPayment.payToUser).toHaveBeenCalledWith(
        'decrypted-token',
        1000, // full amount
        'SettePay Dispute:FullRefund - Deal#deal-1',
      );
    });

    it('PARTIAL: makes two payToUser calls', async () => {
      mockPrisma.dispute.findUniqueOrThrow.mockResolvedValue(makeDispute());
      mockPrisma.deal.findUniqueOrThrow.mockResolvedValue(makeDeal());
      mockPayment.payToUser.mockResolvedValue({ isSuccess: true });

      await service.resolveDispute('dispute-1', 'admin-1', DisputeResolution.PARTIAL,
        undefined, 600, 400);

      expect(mockPayment.payToUser).toHaveBeenCalledTimes(2);
    });

    it('throws if already resolved', async () => {
      mockPrisma.dispute.findUniqueOrThrow.mockResolvedValue({
        ...makeDispute(), status: DisputeStatus.RESOLVED,
      });
      await expect(service.resolveDispute('dispute-1', 'admin', DisputeResolution.FULL_REFUND))
        .rejects.toThrow(ConflictException);
    });
  });
});
