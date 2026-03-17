import { Test } from '@nestjs/testing';
import { AmlService } from './aml.service';
import { PrismaService } from './prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

const mockPrisma = {
  deal:    { aggregate: jest.fn(), count: jest.fn() },
  user:    { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
};
const mockNotify = { alertOpsTeam: jest.fn() };
const mockAudit  = { log: jest.fn() };

describe('AmlService', () => {
  let service: AmlService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AmlService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotify },
        { provide: AuditService,         useValue: mockAudit },
      ],
    }).compile();
    service = module.get<AmlService>(AmlService);
    jest.clearAllMocks();

    // Default: no prior volume
    mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } });
    mockPrisma.deal.count.mockResolvedValue(0);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', firstName: 'Test', lastName: 'User', mobile: '+201000000001', kycTier: 'TIER_1' });
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('passes clean transaction with no flags', async () => {
    const result = await service.checkTransaction('user-1', 500);
    expect(result.passed).toBe(true);
    expect(result.flags).toHaveLength(0);
    expect(result.requiresStr).toBe(false);
  });

  it('flags transaction over EGP 30,000 (LARGE_SINGLE rule)', async () => {
    const result = await service.checkTransaction('user-1', 31_000);
    expect(result.ruleIds).toContain('LARGE_SINGLE');
    expect(result.requiresStr).toBe(true);
  });

  it('flags when daily volume exceeds EGP 50,000 (VELOCITY_DAILY rule)', async () => {
    // Prior volume: EGP 45,000 — new transaction: EGP 8,000 → total EGP 53,000
    mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { amount: 45_000 }, _count: { id: 3 } });
    const result = await service.checkTransaction('user-1', 8_000);
    expect(result.ruleIds).toContain('VELOCITY_DAILY');
    expect(result.requiresStr).toBe(true);
  });

  it('flags rapid succession (>10 transactions in 1 hour)', async () => {
    // count returns 11 for hourly check
    mockPrisma.deal.count.mockResolvedValue(11);
    const result = await service.checkTransaction('user-1', 200);
    expect(result.ruleIds).toContain('RAPID_SUCCESSION');
  });

  it('files STR and alerts ops team when required', async () => {
    const result = await service.checkTransaction('user-1', 35_000);
    expect(mockNotify.alertOpsTeam).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalled();
  });
});
