import { Module } from '@nestjs/common';
import { HealthPayAdapter } from './healthpay.adapter';
import { ShadowPaymentService } from './shadow-payment.service';
import { SettepayPspAdapter } from './settepay-psp.adapter';
import { PAYMENT_SERVICE } from './payment.service.interface';
import { RedisModule } from '../common/redis.module';

// ── Injection tokens for ShadowPaymentService ─────────────────────────────────
export const PRIMARY_PAYMENT = 'PRIMARY_PAYMENT';
export const SHADOW_PAYMENT  = 'SHADOW_PAYMENT';

// PAYMENT_MODE env controls which adapter is returned for PAYMENT_SERVICE:
//   primary  → HealthPayAdapter (default, Phase 1)
//   shadow   → ShadowPaymentService (CBE migration 4-week shadow run)
//   settepay → SettepayPspAdapter (Phase 2, post-CBE license)
function paymentServiceFactory(
  healthPay: HealthPayAdapter,
  shadow:    ShadowPaymentService,
  settePay:  SettepayPspAdapter,
) {
  const mode = process.env.PAYMENT_MODE || 'primary';
  if (mode === 'shadow')   return shadow;
  if (mode === 'settepay') return settePay;
  return healthPay;
}

@Module({
  imports: [RedisModule],
  providers: [
    HealthPayAdapter,
    SettepayPspAdapter,
    // Provide named tokens so ShadowPaymentService can inject both adapters
    { provide: PRIMARY_PAYMENT, useClass: HealthPayAdapter },
    { provide: SHADOW_PAYMENT,  useClass: SettepayPspAdapter },
    ShadowPaymentService,
    {
      provide:    PAYMENT_SERVICE,
      useFactory: paymentServiceFactory,
      inject:     [HealthPayAdapter, ShadowPaymentService, SettepayPspAdapter],
    },
  ],
  exports: [PAYMENT_SERVICE],
})
export class PaymentModule {}
