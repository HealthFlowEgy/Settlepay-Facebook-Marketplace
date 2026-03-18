import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module';
import { PaymentModule } from './payment/payment.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DealsModule } from './deals/deals.module';
import { DisputesModule } from './disputes/disputes.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { KycModule } from './kyc/kyc.module';
import { AuditModule } from './audit/audit.module';
import { AmlModule } from './common/aml.module';
import { LogisticsModule } from './common/logistics.module';
import { MessengerModule } from './messenger/messenger.module';
import { HealthController } from './health.controller';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PaymentModule,
    AuthModule,
    UsersModule,
    DealsModule,
    DisputesModule,
    WebhooksModule,
    NotificationsModule,
    AdminModule,
    KycModule,
    AuditModule,
    AmlModule,
    LogisticsModule,
    MessengerModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
