# SettePay Marketplace — Changelog

## v1.0.0 — March 2026 (Initial Release)

### SettePay Marketplace Phase 1 — HealthPay Integration

This release implements the full SettePay Marketplace product as defined in
**SETT-MKT-BRD-001** (Business Requirements Document) and **SETT-MKT-SRS-001**
(Software Requirements Specification).

---

### Backend (NestJS + TypeScript)

**Payment Layer**
- `PaymentService` abstraction interface — all HealthPay calls encapsulated
- `HealthPayAdapter` implementing all 10 HealthPay GraphQL operations
- Auto merchant token refresh every 23 hours via `@Cron` scheduler
- AES-256-CBC encryption for all stored HealthPay userTokens
- Error mapping: 2001→header, 2002→header, 2004→refresh, 3001→key, 3002→reauth, 5001→throttle, 5002→otp, 6001→retry, 7001→topup

**Authentication**
- Two-step OTP flow via HealthPay `loginUser` + `authUser`
- `isProvider` flag permanent — sellers register as `true`, buyers as `false`
- OTP throttle enforcement — 60-minute block on error 5001
- Facebook OAuth integration
- JWT session management

**Escrow Engine**
- Full 17-state deal state machine (PENDING → SETTLED / REFUNDED / CANCELLED)
- Buyer confirmation flow via `sendPaymentRequest`
- Atomic escrow deduction via `deductFromUser`
- Idempotency keys on all deductions and payouts (SHA-256)
- Auto-refund after 14-day delivery expiry
- Auto-release after 48-hour dispute window closes
- Auto-cancel after 24-hour buyer confirmation timeout

**Dispute Resolution**
- Three resolution paths: FULL_RELEASE, PARTIAL, FULL_REFUND
- All paths mapped to correct `payToUser` calls
- Evidence collection workflow (48-hour window)
- 72-hour resolution deadline enforcement
- 2% dispute reserve recommendation

**Commission Engine**
- `max(1.8% × amount, EGP 0.75)` formula
- Commission recorded BEFORE `payToUser` call (immutable ledger)
- Separate `CommissionRecord` model — audit-ready

**AML & Compliance**
- Velocity monitoring: daily volume > EGP 50,000; single transaction > EGP 30,000; hourly count > 10
- EMLCU STR filing trigger with structured payload
- Sanctions screening stub (Valify integration point)
- Monthly volume reset cron
- KYC tier escalation: buyers > EGP 3,000/month, sellers > EGP 5,000/month

**Notifications**
- Messenger Generic Template via Meta Graph API
- SMS fallback via configurable SMS gateway
- Push notification hooks
- Ops team alerting for critical failures

**Webhooks**
- HealthPay `GET /webhooks/healthpay` — top-up and payment acceptance events
- Bosta `POST /webhooks/delivery/bosta` — delivery confirmation → escrow release
- Sprint `POST /webhooks/delivery/sprint` — delivery confirmation → escrow release
- Meta Messenger webhook verify + event processing
- HMAC signature verification on all inbound webhooks

**Admin**
- Full dispute management with resolve UI
- Transaction monitoring with status filters
- User management with KYC visibility and block action
- Immutable audit log with token redaction
- Dashboard stats (total, active, disputed, commission)

**Infrastructure**
- Docker Compose: API + PostgreSQL 15 + Redis 7 + Frontend
- Prisma ORM with 10 models, migrations
- BullMQ job queues for async webhook processing
- Cron jobs: token refresh, escrow expiry, dispute deadlines, AML reports
- Database seed script with 6 sample deals

---

### Frontend (React 18 + Vite + TypeScript)

**Pages**
- `LoginPage` — Two-step OTP registration with buyer/seller role selection
- `DashboardPage` — Stats, recent activity, quick actions
- `DealsPage` — Deal list with status filters, create deal modal
- `DealDetailPage` — Full state machine UI, all contextual actions, dispute flow, timeline
- `WalletPage` — Balance display, HealthPay top-up iframe integration, transaction history
- `ProfilePage` — KYC tier display, verification prompt
- `AdminPage` — Disputes, Deals, Users, Audit Log with resolve modals

**Components**
- `ui.tsx` shared component library: Badge, Btn, Card, Input, Select, Spinner, EmptyState, Toast, Modal, StatCard, SectionHeader, PageLayout, DealRow, Timeline
- Zustand auth store with JWT persistence
- Axios API client with JWT interceptor and 401 redirect
- Framer Motion page transitions and micro-interactions
- PWA manifest for installability

---

### Architecture Decisions

**PaymentService abstraction**: Zero-friction CBE license migration. One line change in `payment.module.ts` swaps HealthPay for SettePay's own PSP. No frontend changes, no controller changes.

**Idempotency**: Every `deductFromUser` and `payToUser` call uses a SHA-256 idempotency key. Double-charge on network retry is architecturally impossible.

**Commission accounting**: Commission calculated in SettePay before calling `payToUser`. HealthPay sees only net amounts. Commission ledger is SettePay's internal record.

**Webhook-driven state transitions**: Delivery confirmation is the sole escrow release trigger. Manually marking a deal as delivered by either party cannot trigger a payout — only the courier webhook can.

---

### What Requires Production Configuration

1. **HealthPay production credentials** (replace beta keys in `.env`)
2. **Meta App Review** approval for Messenger payment-adjacent bot
3. **Bosta API key** and webhook secret from Bosta dashboard
4. **Valify production key** for live KYC (currently mock-approved in dev)
5. **AWS KMS** for `HP_TOKEN_ENCRYPTION_KEY` rotation
6. **SMS gateway** credentials (any Egyptian SMS provider)
7. **CBE compliance validation** — confirm SettePay as HealthPay sub-merchant is legally compliant before public launch

---

### Migration Path to CBE PSP License

When SettePay's CBE PSP-B license is granted:

1. Create `src/payment/settepay-psp.adapter.ts` implementing `IPaymentService`
2. In `payment.module.ts`, replace `useClass: HealthPayAdapter` → `useClass: SettepayPspAdapter`
3. Shadow-run both for 4 weeks — compare results
4. Retire HealthPay adapter
5. Update `.env` with SettePay PSP credentials

**Zero frontend changes. Zero user-facing disruption.**
