import { Module } from '@nestjs/common';
import { HealthPayAdapter } from './healthpay.adapter';
import { PAYMENT_SERVICE } from './payment.service.interface';

@Module({
  providers: [
    { provide: PAYMENT_SERVICE, useClass: HealthPayAdapter },
  ],
  exports: [PAYMENT_SERVICE],
})
export class PaymentModule {}
