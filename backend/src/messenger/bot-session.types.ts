/**
 * Messenger Bot Session Types (A.4 — Conversation State Machine)
 *
 * Every Messenger conversation is tracked by PSID. The bot session
 * transitions through the following states.
 */

export enum BotSessionState {
  IDLE = 'IDLE',
  LINKING_ACCOUNT = 'LINKING_ACCOUNT',           // new user OTP flow
  DEAL_SETUP_AMOUNT = 'DEAL_SETUP_AMOUNT',       // wizard: enter amount
  DEAL_SETUP_ITEM = 'DEAL_SETUP_ITEM',           // wizard: describe item
  DEAL_SETUP_BUYER = 'DEAL_SETUP_BUYER',         // wizard: confirm buyer PSID
  DEAL_CONFIRM = 'DEAL_CONFIRM',                 // show summary, await confirm
  DEAL_ACTIVE = 'DEAL_ACTIVE',                   // escrow live
  AWAITING_DISPUTE_REASON = 'AWAITING_DISPUTE_REASON',
  AWAITING_EVIDENCE = 'AWAITING_EVIDENCE',
}

/**
 * Transition map (from → [allowed targets]):
 * IDLE → LINKING_ACCOUNT | DEAL_SETUP_AMOUNT
 * LINKING_ACCOUNT → IDLE (on OTP success)
 * DEAL_SETUP_AMOUNT → DEAL_SETUP_ITEM
 * DEAL_SETUP_ITEM → DEAL_SETUP_BUYER
 * DEAL_SETUP_BUYER → DEAL_CONFIRM
 * DEAL_CONFIRM → DEAL_ACTIVE | IDLE (cancel)
 * DEAL_ACTIVE → AWAITING_DISPUTE_REASON | IDLE (on settled)
 */
export const STATE_TRANSITIONS: Record<BotSessionState, BotSessionState[]> = {
  [BotSessionState.IDLE]: [BotSessionState.LINKING_ACCOUNT, BotSessionState.DEAL_SETUP_AMOUNT],
  [BotSessionState.LINKING_ACCOUNT]: [BotSessionState.IDLE],
  [BotSessionState.DEAL_SETUP_AMOUNT]: [BotSessionState.DEAL_SETUP_ITEM],
  [BotSessionState.DEAL_SETUP_ITEM]: [BotSessionState.DEAL_SETUP_BUYER],
  [BotSessionState.DEAL_SETUP_BUYER]: [BotSessionState.DEAL_CONFIRM],
  [BotSessionState.DEAL_CONFIRM]: [BotSessionState.DEAL_ACTIVE, BotSessionState.IDLE],
  [BotSessionState.DEAL_ACTIVE]: [BotSessionState.AWAITING_DISPUTE_REASON, BotSessionState.IDLE],
  [BotSessionState.AWAITING_DISPUTE_REASON]: [BotSessionState.AWAITING_EVIDENCE, BotSessionState.IDLE],
  [BotSessionState.AWAITING_EVIDENCE]: [BotSessionState.IDLE],
};

export interface BotSession {
  psid: string;
  state: BotSessionState;
  context: Record<string, any>;
  dealId?: string;
  userId?: string;
  updatedAt?: string;
}

export interface QuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

export interface GenericTemplateButton {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
  webview_height_ratio?: 'compact' | 'tall' | 'full';
  messenger_extensions?: boolean;
}

export interface GenericTemplateElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  buttons: GenericTemplateButton[];
}

export interface GenericTemplate {
  template_type: 'generic';
  elements: GenericTemplateElement[];
}

export interface MessengerProfile {
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}
