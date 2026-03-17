import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { DealsModule } from '../deals/deals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DealsModule, NotificationsModule, AuditModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
