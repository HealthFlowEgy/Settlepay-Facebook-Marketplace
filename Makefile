# SettePay Marketplace — Developer Makefile
# Usage: make <target>

.PHONY: dev build test migrate logs clean help

# ── Local Development ─────────────────────────────────────────────────────────

## Start all services with Docker Compose
up:
	docker-compose up -d
	@echo "✅  Services started"
	@echo "   API:      http://localhost:3001/api/v1"
	@echo "   Frontend: http://localhost:5173"
	@echo "   DB:       localhost:5432"
	@echo "   Redis:    localhost:6379"

## Stop all services
down:
	docker-compose down

## Rebuild and restart
rebuild:
	docker-compose up -d --build

## View logs (all services)
logs:
	docker-compose logs -f

## View API logs only
logs-api:
	docker-compose logs -f api

## Start backend in dev mode (hot reload)
dev-api:
	cd backend && npm run start:dev

## Start frontend in dev mode
dev-fe:
	cd frontend && npm run dev

## Install all dependencies
install:
	cd backend  && npm install
	cd frontend && npm install
	@echo "✅  Dependencies installed"

# ── Database ──────────────────────────────────────────────────────────────────

## Run pending migrations
migrate:
	cd backend && npx prisma migrate dev

## Run migrations in production mode
migrate-prod:
	cd backend && npx prisma migrate deploy

## Open Prisma Studio (DB GUI)
studio:
	cd backend && npx prisma studio

## Reset database (DESTRUCTIVE — dev only)
db-reset:
	@echo "⚠️  This will drop all data. Press Ctrl+C to cancel, Enter to continue."
	@read confirm
	cd backend && npx prisma migrate reset --force
	@echo "✅  Database reset"

## Generate Prisma client
prisma-gen:
	cd backend && npx prisma generate

# ── Testing ────────────────────────────────────────────────────────────────────

## Run unit tests
test:
	cd backend && npm run test

## Run integration tests (requires running backend)
test-integration:
	cd backend && TEST_API_URL=http://localhost:3001/api/v1 npx jest test/integration.test.ts --testTimeout=60000

## Run tests with coverage
test-coverage:
	cd backend && npm run test -- --coverage

# ── Build ─────────────────────────────────────────────────────────────────────

## Build backend for production
build-api:
	cd backend && npm run build

## Build frontend for production
build-fe:
	cd frontend && npm run build

## Build both
build: build-api build-fe
	@echo "✅  Production build complete"

# ── Environment Setup ─────────────────────────────────────────────────────────

## Copy env files and show setup instructions
env-setup:
	cp backend/.env.example backend/.env
	@echo "✅  Created backend/.env from template"
	@echo ""
	@echo "📝  Configure these required values in backend/.env:"
	@echo "   HP_API_HEADER          — from HealthPay portal"
	@echo "   HP_API_KEY             — from HealthPay portal"
	@echo "   HP_TOKEN_ENCRYPTION_KEY — run: openssl rand -hex 32"
	@echo "   JWT_SECRET             — run: openssl rand -hex 32"
	@echo "   META_PAGE_ACCESS_TOKEN — from Meta Developer Portal"
	@echo "   BOSTA_API_KEY          — from Bosta dashboard"
	@echo ""
	@echo "🔑  Generate secrets:"
	@echo "   openssl rand -hex 32"

## Generate encryption keys
gen-secrets:
	@echo "HP_TOKEN_ENCRYPTION_KEY=$(shell openssl rand -hex 32)"
	@echo "JWT_SECRET=$(shell openssl rand -hex 32)"

# ── Utilities ─────────────────────────────────────────────────────────────────

## Clean build artifacts
clean:
	rm -rf backend/dist
	rm -rf frontend/dist
	rm -rf backend/coverage
	@echo "✅  Build artifacts cleaned"

## Check HealthPay API connectivity
ping-healthpay:
	@curl -s -X POST https://sword.beta.healthpay.tech/graphql \
	  -H "Content-Type: application/json" \
	  -H "api-header: H_0003rjeb7ke0dejn" \
	  -d '{"query":"{ __typename }"}' | python3 -m json.tool
	@echo ""
	@echo "✅  HealthPay API reachable"

## Show API routes
routes:
	@echo "=== Auth ==="
	@echo "  POST /api/v1/auth/send-otp"
	@echo "  POST /api/v1/auth/verify-otp"
	@echo "  POST /api/v1/auth/logout"
	@echo "  GET  /api/v1/auth/me"
	@echo ""
	@echo "=== Deals ==="
	@echo "  POST   /api/v1/deals"
	@echo "  GET    /api/v1/deals"
	@echo "  GET    /api/v1/deals/:id"
	@echo "  POST   /api/v1/deals/:id/request-payment"
	@echo "  POST   /api/v1/deals/:id/confirm-payment"
	@echo "  PATCH  /api/v1/deals/:id/ship"
	@echo "  GET    /api/v1/deals/wallet/balance"
	@echo "  POST   /api/v1/deals/wallet/topup"
	@echo ""
	@echo "=== Disputes ==="
	@echo "  POST   /api/v1/disputes"
	@echo "  GET    /api/v1/disputes/:id"
	@echo "  PATCH  /api/v1/disputes/:id/evidence"
	@echo ""
	@echo "=== Webhooks ==="
	@echo "  GET    /api/v1/webhooks/healthpay"
	@echo "  POST   /api/v1/webhooks/delivery/bosta"
	@echo "  POST   /api/v1/webhooks/delivery/sprint"
	@echo "  GET    /api/v1/webhooks/messenger  (verify)"
	@echo "  POST   /api/v1/webhooks/messenger  (events)"
	@echo ""
	@echo "=== Admin ==="
	@echo "  GET    /api/v1/admin/disputes"
	@echo "  POST   /api/v1/admin/disputes/:id/resolve"
	@echo "  GET    /api/v1/admin/deals"
	@echo "  GET    /api/v1/admin/deals/stats"
	@echo "  GET    /api/v1/admin/users"
	@echo "  GET    /api/v1/admin/audit"

## Help
help:
	@echo "SettePay Marketplace — Make Targets"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
