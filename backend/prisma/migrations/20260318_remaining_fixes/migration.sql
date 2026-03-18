-- ME-06: Drop MerchantToken table — merchant JWT now lives in Redis only
-- CR-06: HealthPayAdapter uses Redis hp:merchant:token key (23h TTL)

-- First ensure no active records (token is transient — safe to drop)
DROP TABLE IF EXISTS "MerchantToken";

-- Add isAdmin field to User (AdminController role guard)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Archive schema for 7-year data retention (HI-05 prerequisite)
CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.deals AS 
  SELECT * FROM "Deal" WHERE FALSE;

CREATE TABLE IF NOT EXISTS archive.audit_logs AS 
  SELECT * FROM "AuditLog" WHERE FALSE;

CREATE TABLE IF NOT EXISTS archive.notification_events AS 
  SELECT * FROM "NotificationEvent" WHERE FALSE;

-- Audit log immutability (CBE NFR-03)
-- Note: Run as superuser / DBA, not app role
-- REVOKE DELETE ON "AuditLog" FROM settepay_api_role;
-- REVOKE TRUNCATE ON "AuditLog" FROM settepay_api_role;

-- Indexes for archive tables
CREATE INDEX IF NOT EXISTS idx_archive_deals_created ON archive.deals ("createdAt");
CREATE INDEX IF NOT EXISTS idx_archive_audit_created ON archive.audit_logs ("createdAt");
