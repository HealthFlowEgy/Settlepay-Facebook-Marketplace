/**
 * DEPRECATED — CR-08 fix
 *
 * This file has been superseded by:
 *   src/messenger/messenger-bot.service.ts  (central bot dispatcher)
 *   src/messenger/messenger-api.service.ts  (Meta Graph API wrapper)
 *   src/messenger/templates/template.factory.ts  (Generic Templates)
 *
 * All Messenger operations now route through MessengerModule.
 * This file is kept as a redirect stub to avoid import errors during migration.
 * It will be deleted in the next cleanup sprint.
 *
 * DO NOT ADD NEW CODE HERE.
 */

export { MessengerBotService } from '../messenger/messenger-bot.service';
