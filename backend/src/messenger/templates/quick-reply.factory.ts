import { Injectable } from '@nestjs/common';
import { QuickReply } from '../bot-session.types';

/**
 * QuickReplyFactory
 *
 * Builds quick reply option sets for common bot interactions.
 */
@Injectable()
export class QuickReplyFactory {
  buildWelcomeOptions(): QuickReply[] {
    return [
      {
        content_type: 'text',
        title: '🔒 Start Escrow Deal',
        payload: 'START_DEAL',
      },
      {
        content_type: 'text',
        title: '💼 My Active Deals',
        payload: 'LIST_DEALS',
      },
      {
        content_type: 'text',
        title: '💳 Wallet Balance',
        payload: 'WALLET_BALANCE',
      },
      {
        content_type: 'text',
        title: '❓ Help',
        payload: 'HELP',
      },
    ];
  }

  buildDealConfirmOptions(): QuickReply[] {
    return [
      {
        content_type: 'text',
        title: '✅ Confirm Deal',
        payload: 'CONFIRM_DEAL_WIZARD',
      },
      {
        content_type: 'text',
        title: '✏ Edit Amount',
        payload: 'EDIT_AMOUNT',
      },
      {
        content_type: 'text',
        title: '❌ Cancel',
        payload: 'CANCEL_DEAL_WIZARD',
      },
    ];
  }

  buildDisputeReasonOptions(): QuickReply[] {
    return [
      {
        content_type: 'text',
        title: 'Item not as described',
        payload: 'DISPUTE_NOT_AS_DESCRIBED',
      },
      {
        content_type: 'text',
        title: 'Item damaged',
        payload: 'DISPUTE_DAMAGED',
      },
      {
        content_type: 'text',
        title: 'Item not received',
        payload: 'DISPUTE_NOT_RECEIVED',
      },
      {
        content_type: 'text',
        title: 'Other',
        payload: 'DISPUTE_OTHER',
      },
    ];
  }

  buildYesNoOptions(yesPayload: string, noPayload: string): QuickReply[] {
    return [
      { content_type: 'text', title: '✅ Yes', payload: yesPayload },
      { content_type: 'text', title: '❌ No', payload: noPayload },
    ];
  }
}
