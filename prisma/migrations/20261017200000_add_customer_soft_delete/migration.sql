-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "deletedAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "Customer_deletedAt_createdAt_idx" ON "Customer"("deletedAt", "createdAt" DESC);

-- Manual constraint (not representable in schema.prisma).
-- Requires stored emails to be lowercase with no leading/trailing ordinary
-- spaces as removed by PostgreSQL btrim(). Together with the existing UNIQUE
-- index "Customer_email_key", this makes email uniqueness case-insensitive in
-- the database, including soft-deleted customers. It does not validate email
-- format. Existing rows are validated immediately; any non-normalized row
-- makes this statement fail instead of being rewritten.
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
