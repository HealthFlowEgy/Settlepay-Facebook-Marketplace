import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CommissionService } from './commission.service';

const mockConfig = {
  get: (key: string) => key === 'commission.rate' ? 0.018 : key === 'commission.minEgp' ? 0.75 : undefined,
};

describe('CommissionService', () => {
  let service: CommissionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<CommissionService>(CommissionService);
  });

  it('calculates 1.8% of amount when above minimum', () => {
    const { commission, netPayout } = service.calculate(1000);
    expect(commission).toBe(18);
    expect(netPayout).toBe(982);
  });

  it('applies minimum floor of EGP 0.75 for tiny transactions', () => {
    const { commission, netPayout } = service.calculate(10);
    expect(commission).toBe(0.75);
    expect(netPayout).toBe(9.25);
  });

  it('calculates correctly for max deal amount (EGP 50,000)', () => {
    const { commission, netPayout, rate } = service.calculate(50_000);
    expect(commission).toBe(900);   // 50000 * 0.018
    expect(netPayout).toBe(49_100);
    expect(rate).toBe(0.018);
  });

  it('rounds to 2 decimal places', () => {
    const { commission } = service.calculate(111);
    expect(Number.isFinite(commission)).toBe(true);
    expect(String(commission).split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
  });

  it('commission + netPayout always equals grossAmount', () => {
    [50, 250, 750, 2500, 15000, 50000].forEach(amount => {
      const { commission, netPayout } = service.calculate(amount);
      expect(commission + netPayout).toBeCloseTo(amount, 1);
    });
  });
});
