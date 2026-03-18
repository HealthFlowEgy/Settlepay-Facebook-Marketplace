import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { EscrowService } from './escrow.service';
import { WalletService } from './wallet.service';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { PaymentModule } from '../payment/payment.module';
import { CommissionModule } from '../commission/commission.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KycModule } from '../kyc/kyc.module';
import { AmlService } from '../common/aml.service';
import { LogisticsService } from '../common/logistics.service';

@Module({
  imports: [PaymentModule, CommissionModule, AuditModule, NotificationsModule, KycModule],
  providers: [EscrowService, WalletService, ScheduledTasksService, AmlService, LogisticsService],
  controllers: [DealsController],
  exports: [EscrowService, WalletService, AmlService],
})
export class DealsModule {}
