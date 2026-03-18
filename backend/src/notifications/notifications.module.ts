import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
// NOTE: notifications/messenger-bot.service.ts is DEPRECATED (CR-08 fix).
// All Messenger calls now route through MessengerModule -> MessengerBotService.
// NotificationsService uses MessengerApiService injected via MessengerModule.

@Module({
  providers: [NotificationsService],
  exports:   [NotificationsService],
})
export class NotificationsModule {}
