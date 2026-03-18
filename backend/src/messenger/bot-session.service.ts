import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { BotSession, BotSessionState } from './bot-session.types';

/**
 * BotSessionService (A.5)
 *
 * Manages Redis-backed conversation state for each Messenger PSID.
 * In the current implementation, falls back to Prisma (BotSession table)
 * when Redis is unavailable. Production should use @InjectRedis().
 *
 * Redis Key Patterns (A.3):
 *   bot:session:{psid}      → BotSession JSON (30 min TTL)
 *   bot:psid_map:{psid}     → SettePay userId (30 days TTL)
 *   bot:link_token:{token}  → psid + userId (15 min TTL)
 *   bot:deal_draft:{psid}   → Partial deal data (24h TTL)
 *   bot:otp_psid:{mobile}   → psid awaiting OTP (10 min TTL)
 *   bot:notif_lock:{dealId} → Idempotent notification lock (30 sec TTL)
 */
@Injectable()
export class BotSessionService {
  private readonly logger = new Logger(BotSessionService.name);

  // In-memory store as Redis fallback for development
  // Production: replace with @InjectRedis() private redis: Redis
  private sessionStore = new Map<string, string>();
  private psidMap = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async getSession(psid: string): Promise<BotSession> {
    // Try in-memory/Redis first
    const raw = this.sessionStore.get(`bot:session:${psid}`);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        // Corrupted session, reset
      }
    }

    // Fallback to DB
    const dbSession = await this.prisma.botSession.findUnique({
      where: { psid },
    });

    if (dbSession) {
      return {
        psid: dbSession.psid,
        state: dbSession.state as BotSessionState,
        context: (dbSession.context as Record<string, any>) || {},
        dealId: dbSession.dealId || undefined,
        userId: dbSession.userId || undefined,
      };
    }

    return { psid, state: BotSessionState.IDLE, context: {} };
  }

  async updateSession(
    psid: string,
    patch: Partial<BotSession>,
  ): Promise<void> {
    const current = await this.getSession(psid);
    const updated: BotSession = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    // Store in memory/Redis (30 min TTL)
    this.sessionStore.set(
      `bot:session:${psid}`,
      JSON.stringify(updated),
    );

    // Persist to DB
    await this.prisma.botSession.upsert({
      where: { psid },
      update: {
        state: updated.state,
        context: updated.context,
        dealId: updated.dealId || null,
        userId: updated.userId || null,
      },
      create: {
        psid,
        state: updated.state,
        context: updated.context,
        dealId: updated.dealId || null,
        userId: updated.userId || null,
      },
    });
  }

  async clearSession(psid: string): Promise<void> {
    this.sessionStore.delete(`bot:session:${psid}`);
    await this.prisma.botSession.deleteMany({ where: { psid } });
  }

  async linkPsidToUser(psid: string, userId: string): Promise<void> {
    // Cache PSID → userId mapping (30 days in Redis)
    this.psidMap.set(`bot:psid_map:${psid}`, userId);

    // Update User record with PSID
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        psid,
        messengerLinked: true,
        messengerLinkedAt: new Date(),
      },
    });

    this.logger.log(`Linked PSID ${psid} to user ${userId}`);
  }

  async getUserByPsid(psid: string): Promise<any | null> {
    // Try cache first
    const cachedUserId = this.psidMap.get(`bot:psid_map:${psid}`);
    if (cachedUserId) {
      return this.prisma.user.findUnique({ where: { id: cachedUserId } });
    }

    // Fallback to DB lookup by PSID
    return this.prisma.user.findUnique({ where: { psid } });
  }
}
