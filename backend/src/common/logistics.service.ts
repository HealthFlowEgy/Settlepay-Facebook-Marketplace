import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface CreateWaybillPayload {
  dealId:          string;
  sellerName:      string;
  sellerPhone:     string;
  sellerAddress:   string;
  buyerName:       string;
  buyerPhone:      string;
  buyerAddress:    string;
  itemDescription: string;
  cod:             number; // 0 for SettePay deals (escrow covers it)
  weight?:         number;
}

export interface WaybillResult {
  waybillId:    string;
  trackingUrl:  string;
  labelUrl?:    string;
  provider:     'bosta' | 'sprint';
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(private readonly config: ConfigService) {}

  async createBostaWaybill(payload: CreateWaybillPayload): Promise<WaybillResult> {
    const apiKey  = this.config.get<string>('bosta.apiKey');
    const baseUrl = 'https://app.bosta.co/api/v2';

    if (!apiKey) {
      this.logger.warn('Bosta API key not configured — using mock waybill');
      return this.mockWaybill(payload.dealId, 'bosta');
    }

    try {
      const response = await axios.post(`${baseUrl}/deliveries`, {
        type: 'SEND',
        specs: {
          packageDetails: {
            itemsCount: 1,
            description: payload.itemDescription,
            weight: payload.weight || 0.5,
          },
        },
        sender: {
          name:  payload.sellerName,
          phone: payload.sellerPhone,
        },
        dropOffAddress: {
          city:     payload.buyerAddress.split(',')[0]?.trim() || 'Cairo',
          firstLine: payload.buyerAddress,
          phone:    payload.buyerPhone,
          name:     payload.buyerName,
        },
        cod:  0, // SettePay escrow — no COD
        notes: `SettePay Marketplace Deal #${payload.dealId}`,
      }, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const { _id: waybillId, trackingNumber } = response.data;
      return {
        waybillId:   trackingNumber || waybillId,
        trackingUrl: `https://bosta.co/tracking/${trackingNumber}`,
        provider:    'bosta',
      };
    } catch (err) {
      this.logger.error(`Bosta waybill creation failed: ${err.message}`);
      return this.mockWaybill(payload.dealId, 'bosta');
    }
  }

  async getBostaTracking(waybillId: string) {
    const apiKey  = this.config.get<string>('bosta.apiKey');
    const baseUrl = 'https://app.bosta.co/api/v2';
    if (!apiKey) return { status: 'UNKNOWN', waybillId };
    try {
      const res = await axios.get(`${baseUrl}/deliveries/tracking/${waybillId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.data;
    } catch {
      return { status: 'UNKNOWN', waybillId };
    }
  }

  private mockWaybill(dealId: string, provider: 'bosta' | 'sprint'): WaybillResult {
    const id = `SETTE-${dealId.slice(0, 8).toUpperCase()}`;
    return {
      waybillId:   id,
      trackingUrl: `https://marketplace.sette.io/track/${id}`,
      provider,
    };
  }
}
