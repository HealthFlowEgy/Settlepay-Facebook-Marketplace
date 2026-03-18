import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redis.url') || process.env.REDIS_URL || 'redis://localhost:6379';
        const client = new Redis(url, {
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          lazyConnect: false,
        });
        client.on('error', (err) => {
          if (process.env.NODE_ENV !== 'test') {
            console.error('[Redis] Connection error:', err.message);
          }
        });
        client.on('connect', () => {
          console.log('[Redis] Connected');
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
