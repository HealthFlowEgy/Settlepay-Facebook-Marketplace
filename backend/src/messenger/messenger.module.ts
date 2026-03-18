import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module';
import { MessengerBotService } from './messenger-bot.service';
import { MessengerApiService } from './messenger-api.service';
import { BotSessionService } from './bot-session.service';
import { TemplateFactory } from './templates/template.factory';
import { QuickReplyFactory } from './templates/quick-reply.factory';
import { PostbackHandler } from './handlers/postback.handler';
import { TextHandler } from './handlers/text.handler';
import { QuickReplyHandler } from './handlers/quick-reply.handler';
import { OptinHandler } from './handlers/optin.handler';

/**
 * MessengerModule (A.1)
 *
 * Wires all Messenger bot components together:
 *   - MessengerBotService: Central dispatcher
 *   - MessengerApiService: Meta Graph API wrapper
 *   - BotSessionService: Redis-backed conversation state
 *   - TemplateFactory: All 8 Generic Template builders
 *   - QuickReplyFactory: Quick reply option builders
 *   - Handlers: Postback, Text, QuickReply, Optin
 */
@Module({
  imports: [PrismaModule],
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
  exports: [MessengerBotService, MessengerApiService, TemplateFactory],
})
export class MessengerModule {}
