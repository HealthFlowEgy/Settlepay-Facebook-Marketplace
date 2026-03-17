import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MessengerBotService } from './messenger-bot.service';

@Module({
  providers: [NotificationsService, MessengerBotService],
  exports:   [NotificationsService, MessengerBotService],
})
export class NotificationsModule {}
