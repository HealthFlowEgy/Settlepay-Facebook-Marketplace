import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module';
import { RedisModule } from '../common/redis.module';
import { PaymentModule } from '../payment/payment.module';
import { CommissionModule } from '../commission/commission.module';
import { AuditModule } from '../audit/audit.module';
import { MessengerBotService } from './messenger-bot.service';
import { MessengerApiService } from './messenger-api.service';
import { BotSessionService } from './bot-session.service';
import { TemplateFactory } from './templates/template.factory';
import { QuickReplyFactory } from './templates/quick-reply.factory';
import { PostbackHandler } from './handlers/postback.handler';
import { TextHandler } from './handlers/text.handler';
import { QuickReplyHandler } from './handlers/quick-reply.handler';
import { OptinHandler } from './handlers/optin.handler';

@Module({
  imports: [PrismaModule, RedisModule, PaymentModule, CommissionModule, AuditModule],
  providers: [
    MessengerBotService,
    MessengerApiService,
    BotSessionService,
    TemplateFactory,
    QuickReplyFactory,
    PostbackHandler,
    TextHandler,
    QuickReplyHandler,
    OptinHandler,
  ],
  exports: [MessengerBotService, MessengerApiService, BotSessionService, TemplateFactory],
})
export class MessengerModule {}
