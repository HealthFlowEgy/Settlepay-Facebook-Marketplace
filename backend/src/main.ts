import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableCors({
    origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'health/status'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, transform: true, forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger — only in non-production
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SettePay Marketplace API')
      .setDescription('Facebook Commerce Escrow Payment Layer — HealthPay Integration Phase\n\nDocs: SETT-MKT-BRD-001 / SETT-MKT-SRS-001')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('auth',     'Authentication via HealthPay OTP')
      .addTag('deals',    'Escrow deal lifecycle')
      .addTag('wallet',   'Wallet balance and top-up')
      .addTag('disputes', 'Dispute management')
      .addTag('kyc',      'Identity verification')
      .addTag('users',    'User profiles')
      .addTag('admin',    'Admin operations')
      .addTag('webhooks', 'Inbound webhook receivers')
      .addTag('health',   'Health checks')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = Number(process.env.APP_PORT) || 3001;
  await app.listen(port);
  console.log(`SettePay Marketplace API running on port ${port}`);
  console.log(`Health: http://localhost:${port}/health/ready`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger: http://localhost:${port}/api/docs`);
  }
}
bootstrap();
