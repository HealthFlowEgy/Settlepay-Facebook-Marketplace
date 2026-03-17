import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { PaymentModule } from '../payment/payment.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PaymentModule, AuditModule],
  controllers: [UsersController],
})
export class UsersModule {}
