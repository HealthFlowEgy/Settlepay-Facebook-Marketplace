import {
  Injectable, CanActivate, ExecutionContext,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// In-memory rate limit store (use Redis in production with the provided REDIS_URL)
// For production: replace with a Redis-backed implementation using ioredis
const store = new Map<string, { count: number; resetAt: number }>();

export function RateLimit(limit: number, windowSeconds: number) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('rateLimit', { limit, windowSeconds }, descriptor.value);
    return descriptor;
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const meta    = Reflect.getMetadata('rateLimit', handler);
    if (!meta) return true; // No rate limit on this handler

    const { limit, windowSeconds } = meta;
    const req  = context.switchToHttp().getRequest();
    const ip   = req.ip || req.connection?.remoteAddress || 'unknown';
    const key  = `ratelimit:${req.path}:${ip}`;
    const now  = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    }

    entry.count++;
    store.set(key, entry);

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      this.logger.warn(`Rate limit exceeded: ${ip} → ${req.path} (${entry.count}/${limit})`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code:       'RATE_LIMIT_EXCEEDED',
          message:    `Too many requests. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (val.resetAt < now) store.delete(key);
  }
}, 600_000);
