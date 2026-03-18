import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { DealsModule } from '../deals/deals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { MessengerModule } from '../messenger/messenger.module';

@Module({
  imports: [DealsModule, NotificationsModule, AuditModule, MessengerModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
