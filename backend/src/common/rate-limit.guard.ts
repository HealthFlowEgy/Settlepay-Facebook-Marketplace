import {
  Injectable, CanActivate, ExecutionContext,
  HttpException, HttpStatus, Logger, Inject,
} from '@nestjs/common';
import { REDIS_CLIENT } from './redis.module';
import Redis from 'ioredis';

export function RateLimit(limit: number, windowSeconds: number) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('rateLimit', { limit, windowSeconds }, descriptor.value);
    return descriptor;
  };
}

/**
 * RateLimitGuard — ME-04 fix: Redis-backed (not in-memory Map)
 * Works correctly under horizontal scaling.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const meta    = Reflect.getMetadata('rateLimit', handler);
    if (!meta) return true;

    const { limit, windowSeconds } = meta;
    const req  = context.switchToHttp().getRequest();
    const ip   = req.ip || req.connection?.remoteAddress || 'unknown';
    const key  = `ratelimit:${req.path}:${ip}`;

    // GAP-FIX-06: Use pipeline to make INCR + EXPIRE atomic, preventing a race
    // condition where two simultaneous first-requests both get current=1 and
    // compete to set TTL — leaving the key without expiry if one call is lost.
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds, 'NX'); // NX = only set if not already set
    const results  = await pipeline.exec();
    const current  = (results?.[0]?.[1] as number) ?? 0;

    if (current > limit) {
      const ttl = await this.redis.ttl(key);
      this.logger.warn(`Rate limit exceeded: ${ip} → ${req.path} (${current}/${limit})`);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${ttl} seconds.`, retryAfter: ttl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
