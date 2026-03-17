import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { DisputesModule } from '../disputes/disputes.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DisputesModule, AuditModule],
  controllers: [AdminController],
})
export class AdminModule {}
