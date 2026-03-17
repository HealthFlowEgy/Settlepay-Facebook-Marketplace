import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_SERVICE, IPaymentService } from '../payment/payment.service.interface';
import { decryptToken } from '../common/crypto.util';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.hpUserToken) return { total: 0, balance: [], walletNotLinked: true };
    const token = decryptToken(user.hpUserToken);
    const wallet = await this.payment.getUserWallet(token);
    await this.audit.log({ userId, operation: 'userWallet', responseSuccess: true });
    return wallet;
  }

  async getTopupIframe(userId: string, amount: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.hpUserToken) throw new NotFoundException('Wallet not linked. Please complete registration.');
    const token = decryptToken(user.hpUserToken);
    const result = await this.payment.getTopupIframeUrl(token, amount);
    await this.audit.log({ userId, operation: 'topupWalletUser', requestSummary: { amount }, responseSuccess: true });
    return result;
  }

  async getPaymentRequests(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.hpUserToken) return [];
    const token = decryptToken(user.hpUserToken);
    return this.payment.getPaymentRequests(token);
  }
}
