import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { HealthPayError } from '../payment/healthpay.adapter';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse<Response>();
    const req  = ctx.getRequest<Request>();

    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code    = 'INTERNAL_ERROR';

    // NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      status  = exception.getStatus();
      const body = exception.getResponse() as any;
      message = typeof body === 'string' ? body : body.message || body.error || message;
      code    = typeof body === 'object' ? (body.code || body.error || 'HTTP_ERROR') : 'HTTP_ERROR';
    }
    // HealthPay API errors
    else if (exception instanceof HealthPayError) {
      const hpCodeMap: Record<string, number> = {
        '7001': HttpStatus.PAYMENT_REQUIRED,
        '5001': HttpStatus.TOO_MANY_REQUESTS,
        '5002': HttpStatus.UNPROCESSABLE_ENTITY,
        '6001': HttpStatus.BAD_GATEWAY,
        '3002': HttpStatus.UNAUTHORIZED,
        '2004': HttpStatus.UNAUTHORIZED,
      };
      status  = hpCodeMap[exception.code] || HttpStatus.BAD_REQUEST;
      message = exception.message;
      code    = `HP_${exception.code}`;
    }
    // Prisma errors
    else if ((exception as any)?.code?.startsWith('P')) {
      const prismaCode = (exception as any).code;
      if (prismaCode === 'P2002') {
        status  = HttpStatus.CONFLICT;
        message = 'A record with this value already exists';
        code    = 'DUPLICATE_ENTRY';
      } else if (prismaCode === 'P2025') {
        status  = HttpStatus.NOT_FOUND;
        message = 'Record not found';
        code    = 'NOT_FOUND';
      } else {
        status  = HttpStatus.BAD_REQUEST;
        message = 'Database operation failed';
        code    = `DB_${prismaCode}`;
      }
    }
    // Unknown errors
    else {
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        (exception as Error)?.stack,
      );
    }

    // Never leak stack traces in production
    const isProd = process.env.NODE_ENV === 'production';

    res.status(status).json({
      statusCode: status,
      code,
      message:    Array.isArray(message) ? message.join(', ') : message,
      path:       req.url,
      timestamp:  new Date().toISOString(),
      ...(isProd ? {} : { stack: (exception as Error)?.stack }),
    });
  }
}
