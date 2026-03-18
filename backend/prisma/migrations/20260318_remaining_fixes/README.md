# Migration: Remove MerchantToken, Add isAdmin

## Changes
1. **DROP MerchantToken table** (ME-06): Merchant JWT moved to Redis exclusively.
   HealthPayAdapter now uses `redis.setex('hp:merchant:token', 82800, token)`.
2. **ADD User.isAdmin** (boolean, default false): Required by AdminController role guard.
3. **CREATE archive schema** (HI-05): Prerequisite for DataRetentionService monthly archival.

## Run Instructions
```bash
# Apply migration
npx prisma migrate deploy

# OR for development
npx prisma migrate dev --name remove_merchant_token_add_isadmin

# Set first admin user (replace USER_ID)
psql $DATABASE_URL -c "UPDATE \"User\" SET \"isAdmin\" = true WHERE mobile = '+YOUR_ADMIN_MOBILE';"
```

## Rollback
```sql
-- Rollback: Recreate MerchantToken if needed (should not be necessary)
CREATE TABLE IF NOT EXISTS "MerchantToken" (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  token TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "refreshedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE "User" DROP COLUMN IF EXISTS "isAdmin";
```
