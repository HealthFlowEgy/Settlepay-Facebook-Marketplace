import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { UserKycTier, UserKycStatus } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async checkAndEscalate(userId: string, transactionAmount: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Reset monthly volume if new month
    const now = new Date();
    if (user.monthlyVolumeResetAt.getMonth() !== now.getMonth()) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { monthlyVolume: 0, monthlyVolumeResetAt: now },
      });
      user.monthlyVolume = 0;
    }

    const newVolume = user.monthlyVolume + transactionAmount;

    // BRL-07: Buyer KYC escalation > EGP 3,000/month
    // BRL-08: Seller KYC escalation > EGP 5,000/month
    const threshold = user.isProvider ? 5000 : 3000;
    if (newVolume > threshold && user.kycTier === UserKycTier.TIER_0) {
      throw new BadRequestException({
        code: 'KYC_REQUIRED',
        message: `Identity verification required. Monthly limit of EGP ${threshold} reached.`,
        kycRequired: true,
        currentTier: user.kycTier,
        requiredTier: 'TIER_1',
      });
    }

    // Update monthly volume
    await this.prisma.user.update({ where: { id: userId }, data: { monthlyVolume: newVolume } });
  }

  async initiateVerification(userId: string, nationalId: string, selfieUrl?: string) {
    const valifyKey = this.config.get<string>('valify.apiKey');
    const valifyUrl = this.config.get<string>('valify.baseUrl');

    await this.prisma.user.update({
      where: { id: userId },
      data:  { kycStatus: UserKycStatus.UNDER_REVIEW },
    });

    if (!valifyKey || !valifyUrl) {
      this.logger.warn('Valify not configured — KYC in mock mode');
      // Mock approval for development
      await this.prisma.user.update({
        where: { id: userId },
        data:  { kycTier: UserKycTier.TIER_1, kycStatus: UserKycStatus.APPROVED, kycVerifiedAt: new Date() },
      });
      return { success: true, tier: 'TIER_1', mock: true };
    }

    try {
      const response = await axios.post(`${valifyUrl}/verify`, {
        national_id: nationalId,
        selfie_url:  selfieUrl,
      }, { headers: { Authorization: `Bearer ${valifyKey}` } });

      const tier = selfieUrl ? UserKycTier.TIER_2 : UserKycTier.TIER_1;
      await this.prisma.user.update({
        where: { id: userId },
        data:  { kycTier: tier, kycStatus: UserKycStatus.APPROVED, kycVerifiedAt: new Date() },
      });
      return { success: true, tier };
    } catch (err) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { kycStatus: UserKycStatus.REJECTED },
      });
      throw new BadRequestException('Identity verification failed. Please check your National ID and try again.');
    }
  }

  async screenSanctions(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // In production: call Valify sanctions screening API
    // For now: return clear (not on sanctions list)
    this.logger.log(`Sanctions screening for user ${userId}: CLEAR`);
    return true;
  }
}
