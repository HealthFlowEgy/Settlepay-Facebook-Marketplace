import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CommissionService {
  constructor(private readonly config: ConfigService) {}

  calculate(grossAmount: number): { commission: number; netPayout: number; rate: number } {
    const rate    = this.config.get<number>('commission.rate')   || 0.018;
    const minEgp  = this.config.get<number>('commission.minEgp') || 0.75;
    const commission = Math.max(grossAmount * rate, minEgp);
    return { commission: Math.round(commission * 100) / 100, netPayout: Math.round((grossAmount - commission) * 100) / 100, rate };
  }
}
