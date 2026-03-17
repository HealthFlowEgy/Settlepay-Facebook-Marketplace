import { Module } from '@nestjs/common';
import { AmlService } from './aml.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports:   [NotificationsModule, AuditModule],
  providers: [AmlService],
  exports:   [AmlService],
})
export class AmlModule {}
