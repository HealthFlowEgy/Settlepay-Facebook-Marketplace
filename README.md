# SettePay Marketplace
## Facebook Commerce Escrow Payment Layer — HealthPay Integration Phase

> **SETT-MKT-BRD-001 / SETT-MKT-SRS-001** | Phase 1 — HealthPay Wallet API Backend

---

## Stack

| Layer | Technology |
|---|---|
| Backend API | NestJS 10 + TypeScript |
| Database | PostgreSQL 15 (Prisma ORM) |
| Cache / Queues | Redis 7 + BullMQ |
| Payment Backend | HealthPay GraphQL API (interim) |
| Frontend | React 18 + Vite + Zustand + Framer Motion |
| Auth | JWT + HealthPay OTP |
| Notifications | Meta Messenger API + SMS gateway |
| Logistics | Bosta / Sprint webhook integration |
| KYC | Valify (National ID + selfie) |

---

## Quick Start (Docker)

```bash
# 1. Clone and configure
cp backend/.env.example backend/.env
# Edit backend/.env with your HealthPay keys and secrets

# 2. Start all services
docker-compose up -d

# 3. Run database migrations
docker-compose exec api npx prisma migrate dev

# 4. Access
# API:      http://localhost:3001/api/v1
# Frontend: http://localhost:5173
```

---

## Local Development

### Backend
```bash
cd backend
npm install
cp .env.example .env       # fill in HealthPay keys
npx prisma migrate dev     # run migrations
npm run start:dev          # http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

---

## HealthPay Integration

### Test Credentials (Beta)
| Key | Value |
|---|---|
| API Header | `H_xxxx...` (from internal Postman collection / team 1Password) |
| API Key | `k_xxxx...` (from internal Postman collection / team 1Password) |
| Base URL | `https://sword.beta.healthpay.tech/graphql` |
| Portal | `https://portal.beta.healthpay.tech` |

> ⚠️ HealthPay integration credentials are distributed via the
> internal Postman collection (HealthpayGraphql_postman_collection.json).
> Contact the HealthFlow team for access.
>
> **Never commit production HealthPay credentials to version control.**
> Use AWS Secrets Manager or equivalent in production.

### PaymentService Abstraction
All HealthPay calls go through `PaymentService` (injected via `PAYMENT_SERVICE` token).
To migrate to SettePay's own CBE PSP license:
1. Implement `IPaymentService` in a new `SettepayPspAdapter`
2. Change `PaymentModule` to provide `SettepayPspAdapter` instead of `HealthPayAdapter`
3. Zero frontend changes required.

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/send-otp` | Send OTP to mobile via HealthPay |
| POST | `/api/v1/auth/verify-otp` | Verify OTP + get JWT |
| POST | `/api/v1/auth/logout` | Logout + invalidate HealthPay token |
| GET  | `/api/v1/auth/me` | Current user |

### Deals
| Method | Endpoint | Description |
|---|---|---|
| POST   | `/api/v1/deals` | Create escrow deal |
| GET    | `/api/v1/deals` | List my deals (role=buyer\|seller) |
| GET    | `/api/v1/deals/:id` | Get deal detail |
| POST   | `/api/v1/deals/:id/request-payment` | Send payment request to buyer |
| POST   | `/api/v1/deals/:id/confirm-payment` | Buyer confirms → escrow deduction |
| PATCH  | `/api/v1/deals/:id/ship` | Seller marks as shipped |
| GET    | `/api/v1/deals/wallet/balance` | Wallet balance |
| POST   | `/api/v1/deals/wallet/topup` | Get HealthPay top-up iframeUrl |

### Disputes
| Method | Endpoint | Description |
|---|---|---|
| POST   | `/api/v1/disputes` | Raise dispute |
| GET    | `/api/v1/disputes/:id` | Get dispute |
| PATCH  | `/api/v1/disputes/:id/evidence` | Submit evidence |

### Webhooks
| Method | Endpoint | Description |
|---|---|---|
| GET    | `/api/v1/webhooks/healthpay` | HealthPay payment notification |
| POST   | `/api/v1/webhooks/delivery/bosta` | Bosta delivery confirmation |
| POST   | `/api/v1/webhooks/delivery/sprint` | Sprint delivery confirmation |
| GET    | `/api/v1/webhooks/messenger` | Meta webhook verification |
| POST   | `/api/v1/webhooks/messenger` | Messenger events |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| GET    | `/api/v1/admin/disputes` | All disputes |
| POST   | `/api/v1/admin/disputes/:id/resolve` | Resolve dispute |
| GET    | `/api/v1/admin/deals` | All deals |
| GET    | `/api/v1/admin/deals/stats` | Dashboard stats |
| GET    | `/api/v1/admin/users` | All users |
| GET    | `/api/v1/admin/audit` | Audit logs |

---

## Deal State Machine

```
PENDING
  → AWAITING_BUYER_CONFIRMATION  (sendPaymentRequest)
    → ESCROW_DEDUCTING           (buyer confirms)
      → ESCROW_ACTIVE            (deductFromUser success)
        → SHIPPED                (seller marks shipped)
          → DELIVERY_CONFIRMED   (Bosta/Sprint webhook)
            → SETTLING           (48h window closed, no dispute)
              → SETTLED          (payToUser to seller success)
            → DISPUTED           (buyer raises dispute)
              → SETTLED          (admin resolves)
      → AWAITING_TOP_UP          (error 7001 — insufficient funds)
      → PAYMENT_ERROR            (error 6001 after retry)
  → CANCELLED                    (24h buyer confirm timeout)
SHIPPED → REFUNDING              (14-day expiry, no delivery)
  → REFUNDED                     (payToUser to buyer success)
```

---

## Business Rules Summary

| Rule | Value |
|---|---|
| Minimum deal | EGP 50 |
| Maximum deal (Phase 1) | EGP 50,000 |
| Commission | max(1.8% × amount, EGP 0.75) |
| Buyer confirm timeout | 24 hours |
| Escrow expiry | 14 days after ship |
| Dispute window | 48 hours after delivery |
| Dispute resolution deadline | 72 hours |
| Buyer KYC escalation | EGP 3,000/month |
| Seller KYC escalation | EGP 5,000/month |

---

## CBE License Migration

When SettePay's CBE PSP-B license is granted:

1. Create `src/payment/settepay-psp.adapter.ts` implementing `IPaymentService`
2. In `payment.module.ts`, change `useClass: HealthPayAdapter` → `useClass: SettepayPspAdapter`
3. Run shadow mode (both adapters) for 4 weeks to validate parity
4. Retire HealthPay adapter

**Zero frontend changes. Zero user impact.**

---

## Environment Variables

See `backend/.env.example` for full reference.

Critical for production:
- `HP_TOKEN_ENCRYPTION_KEY` — 32-byte hex (AES-256) from AWS KMS
- `HP_API_KEY` — from AWS Secrets Manager
- `JWT_SECRET` — 256-bit random string
- `META_PAGE_ACCESS_TOKEN` — from Meta Developer Portal
- `BOSTA_WEBHOOK_SECRET` — from Bosta dashboard

---

*SettePay Egypt · SETT-MKT-BRD-001 / SETT-MKT-SRS-001 · Confidential*
