import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { REDIS_CLIENT } from '../common/redis.module';
import { BotSession, BotSessionState } from './bot-session.types';
import Redis from 'ioredis';
import { generateSecureToken } from '../common/crypto.util';

/**
 * BotSessionService (A.5 — Fixed: CR-02)
 * Redis-backed conversation state. No in-memory Map.
 */
@Injectable()
export class BotSessionService {
  private readonly logger = new Logger(BotSessionService.name);
  private readonly SESSION_TTL    = 1800;    // 30 min
  private readonly PSID_MAP_TTL   = 2592000; // 30 days
  private readonly LINK_TOKEN_TTL = 900;     // 15 min
  private readonly NOTIF_LOCK_TTL = 30;      // 30 sec

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async getSession(psid: string): Promise<BotSession> {
    const raw = await this.redis.get(`bot:session:${psid}`);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* corrupted — reset */ }
    }
    const db = await this.prisma.botSession.findUnique({ where: { psid } });
    if (db) {
      return {
        psid: db.psid,
        state: db.state as BotSessionState,
        context: (db.context as Record<string, any>) || {},
        dealId: db.dealId ?? undefined,
        userId: db.userId ?? undefined,
      };
    }
    return { psid, state: BotSessionState.IDLE, context: {} };
  }

  async updateSession(psid: string, patch: Partial<BotSession>): Promise<void> {
    const current = await this.getSession(psid);
    const updated: BotSession = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.redis.setex(`bot:session:${psid}`, this.SESSION_TTL, JSON.stringify(updated));
    // Persist async for durability
    this.prisma.botSession.upsert({
      where:  { psid },
      update: { state: updated.state, context: updated.context, dealId: updated.dealId ?? null, userId: updated.userId ?? null },
      create: { psid, state: updated.state, context: updated.context, dealId: updated.dealId ?? null, userId: updated.userId ?? null },
    }).catch(e => this.logger.warn(`BotSession DB upsert (non-critical): ${e.message}`));
  }

  async clearSession(psid: string): Promise<void> {
    await this.redis.del(`bot:session:${psid}`);
    await this.prisma.botSession.deleteMany({ where: { psid } }).catch(() => {});
  }

  async linkPsidToUser(psid: string, userId: string): Promise<void> {
    await this.redis.setex(`bot:psid_map:${psid}`, this.PSID_MAP_TTL, userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { psid, messengerLinked: true, messengerLinkedAt: new Date() },
    });
    this.logger.log(`Linked PSID ${psid} → user ${userId}`);
  }

  async getUserByPsid(psid: string): Promise<any | null> {
    const userId = await this.redis.get(`bot:psid_map:${psid}`);
    if (userId) return this.prisma.user.findUnique({ where: { id: userId } });
    return this.prisma.user.findUnique({ where: { psid } });
  }

  /** CR-03 fix: CSPRNG token for account linking (15-min TTL, single-use) */
  async createLinkToken(psid: string): Promise<string> {
    const token = generateSecureToken();
    await this.redis.setex(`bot:link_token:${token}`, this.LINK_TOKEN_TTL, psid);
    return token;
  }

  async resolveLinkToken(token: string): Promise<string | null> {
    const psid = await this.redis.get(`bot:link_token:${token}`);
    if (psid) await this.redis.del(`bot:link_token:${token}`); // single-use
    return psid;
  }

  /** Idempotency lock for notifications — prevents duplicate Messenger sends */
  async acquireNotifLock(dealId: string, type: string): Promise<boolean> {
    const result = await this.redis.set(`bot:notif_lock:${dealId}:${type}`, '1', 'EX', this.NOTIF_LOCK_TTL, 'NX');
    return result === 'OK';
  }
}
