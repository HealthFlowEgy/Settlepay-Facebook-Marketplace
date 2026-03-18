import { Injectable } from '@nestjs/common';
import { GenericTemplate } from '../bot-session.types';

/**
 * TemplateFactory (A.7)
 *
 * BRD BR-24 and Journey 7.1 mandate structured Generic Templates for every
 * deal state change. Each template carries a CTA button that deep-links
 * to the SettePay PWA with the deal context.
 *
 * All 8 Required Generic Templates:
 *   1. deal_proposed      — Seller initiates escrow via bot
 *   2. topup_required     — deductFromUser returns error 7001
 *   3. escrow_active      — deductFromUser succeeds
 *   4. shipped            — Seller marks shipped
 *   5. delivered_confirm  — Bosta/Sprint delivery webhook fires
 *   6. settled            — payToUser to seller succeeds
 *   7. disputed           — Buyer raises dispute within 48h
 *   8. resolved           — Admin resolves dispute
 */
@Injectable()
export class TemplateFactory {
  // ─── 1. deal_proposed ────────────────────────────────────────────────────
  buildDealProposed(deal: {
    id: string;
    amount: number;
    itemDescription: string;
    sellerName: string;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: `🔒 Secure Escrow Deal — EGP ${deal.amount.toLocaleString('ar-EG')}`,
          subtitle: `${deal.itemDescription}\nSeller: ${deal.sellerName}\nProtected by SettePay`,
          image_url: 'https://cdn.sette.io/bot/escrow-badge.png',
          buttons: [
            {
              type: 'web_url',
              url: `https://app.sette.io/deals/${deal.id}/pay`,
              title: 'Pay Securely 🔐',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
            {
              type: 'postback',
              title: 'Decline ✕',
              payload: `DECLINE_DEAL|${deal.id}`,
            },
          ],
        },
      ],
    };
  }

  // ─── 2. topup_required ──────────────────────────────────────────────────
  buildTopupRequired(deal: {
    id: string;
    amount: number;
    iframeUrl: string;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: `💳 Top Up Required — EGP ${deal.amount.toLocaleString('ar-EG')}`,
          subtitle:
            'Insufficient wallet balance. Please top up to proceed with the escrow deal.',
          image_url: 'https://cdn.sette.io/bot/topup-badge.png',
          buttons: [
            {
              type: 'web_url',
              url: deal.iframeUrl,
              title: 'Top Up Now 💳',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
            {
              type: 'postback',
              title: 'Cancel Deal',
              payload: `DECLINE_DEAL|${deal.id}`,
            },
          ],
        },
      ],
    };
  }

  // ─── 3. escrow_active ───────────────────────────────────────────────────
  buildEscrowActive(deal: {
    id: string;
    amount: number;
    itemDescription: string;
    waybillUrl?: string;
  }): GenericTemplate {
    const buttons: any[] = [];
    if (deal.waybillUrl) {
      buttons.push({
        type: 'web_url',
        url: deal.waybillUrl,
        title: 'View Waybill 📦',
        webview_height_ratio: 'tall',
      });
    }
    buttons.push({
      type: 'web_url',
      url: `https://app.sette.io/deals/${deal.id}`,
      title: 'View Deal',
      webview_height_ratio: 'tall',
      messenger_extensions: true,
    });

    return {
      template_type: 'generic',
      elements: [
        {
          title: `✅ Escrow Active — EGP ${deal.amount.toLocaleString('ar-EG')}`,
          subtitle: `${deal.itemDescription}\nFunds secured by SettePay. Seller: please ship the item now.`,
          image_url: 'https://cdn.sette.io/bot/escrow-active-badge.png',
          buttons,
        },
      ],
    };
  }

  // ─── 4. shipped ─────────────────────────────────────────────────────────
  buildShipped(deal: {
    id: string;
    itemDescription: string;
    trackingUrl?: string;
  }): GenericTemplate {
    const buttons: any[] = [];
    if (deal.trackingUrl) {
      buttons.push({
        type: 'web_url',
        url: deal.trackingUrl,
        title: 'Track Shipment 🚚',
        webview_height_ratio: 'tall',
      });
    }
    buttons.push({
      type: 'web_url',
      url: `https://app.sette.io/deals/${deal.id}`,
      title: 'View Deal',
      webview_height_ratio: 'tall',
      messenger_extensions: true,
    });

    return {
      template_type: 'generic',
      elements: [
        {
          title: '🚚 Item Shipped',
          subtitle: `${deal.itemDescription}\nYour order is on the way!`,
          image_url: 'https://cdn.sette.io/bot/shipped-badge.png',
          buttons,
        },
      ],
    };
  }

  // ─── 5. delivered_confirm ───────────────────────────────────────────────
  buildDeliveredConfirm(deal: {
    id: string;
    amount: number;
    itemDescription: string;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: '📦 Item Delivered — Confirm or Dispute',
          subtitle: `${deal.itemDescription}\nEGP ${deal.amount}\nYou have 48 hours to confirm or raise a dispute.`,
          buttons: [
            {
              type: 'postback',
              title: '✅ Confirm Delivery',
              payload: `CONFIRM_DELIVERY|${deal.id}`,
            },
            {
              type: 'postback',
              title: '⚠ Raise Dispute',
              payload: `RAISE_DISPUTE|${deal.id}`,
            },
          ],
        },
      ],
    };
  }

  // ─── 6. settled ─────────────────────────────────────────────────────────
  buildSettled(deal: {
    id: string;
    amount: number;
    netPayout: number;
    commission: number;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: `💰 Deal Settled — EGP ${deal.netPayout.toLocaleString('ar-EG')}`,
          subtitle: `Gross: EGP ${deal.amount}\nCommission: EGP ${deal.commission}\nNet payout: EGP ${deal.netPayout}\nDeal complete!`,
          image_url: 'https://cdn.sette.io/bot/settled-badge.png',
          buttons: [
            {
              type: 'web_url',
              url: `https://app.sette.io/deals/${deal.id}/receipt`,
              title: 'View Receipt 🧾',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
            {
              type: 'postback',
              title: 'Rate Seller ⭐',
              payload: `VIEW_DEAL|${deal.id}`,
            },
          ],
        },
      ],
    };
  }

  // ─── 7. disputed ────────────────────────────────────────────────────────
  buildDisputed(deal: {
    id: string;
    disputeId: string;
    itemDescription: string;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: '⚠ Dispute Opened',
          subtitle: `${deal.itemDescription}\nA dispute has been raised. Please submit evidence within 24 hours.`,
          image_url: 'https://cdn.sette.io/bot/dispute-badge.png',
          buttons: [
            {
              type: 'web_url',
              url: `https://app.sette.io/disputes/${deal.disputeId}/evidence`,
              title: 'Submit Evidence 📎',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
            {
              type: 'web_url',
              url: `https://app.sette.io/deals/${deal.id}`,
              title: 'View Deal Status',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
          ],
        },
      ],
    };
  }

  // ─── 8. resolved ────────────────────────────────────────────────────────
  buildResolved(deal: {
    id: string;
    resolution: string;
    amount: number;
  }): GenericTemplate {
    return {
      template_type: 'generic',
      elements: [
        {
          title: '✅ Dispute Resolved',
          subtitle: `Resolution: ${deal.resolution}\nEGP ${deal.amount}\nSee the full outcome in the app.`,
          image_url: 'https://cdn.sette.io/bot/resolved-badge.png',
          buttons: [
            {
              type: 'web_url',
              url: `https://app.sette.io/deals/${deal.id}`,
              title: 'View Resolution 📋',
              webview_height_ratio: 'tall',
              messenger_extensions: true,
            },
          ],
        },
      ],
    };
  }
}
