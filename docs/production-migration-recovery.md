# Production migration recovery (manual, separately approved)

This document is intentionally separate from the production wrapper. None of
these actions is automated, and **none is authorized by default**: each
needs explicit approval for the specific situation, after diagnosis.

## Do not

- Rerun `migrate deploy` after a failure (Prisma stops with `P3009` while a
  failed migration is recorded).
- Edit `20261017200000_add_customer_soft_delete/migration.sql`. Its checksum
  is recorded in E2E and would be recorded in Production; corrections ship
  as a new migration.
- Run `migrate dev`, `migrate reset`, `db push`, or seed against Production.

## Atomicity is not assumed

The migration file has no explicit `BEGIN`/`COMMIT`. PostgreSQL rolls back a
whole multi-statement script sent as one simple-query message when a later
statement fails (confirmed on the isolated E2E database with session temp
tables). Whether Prisma sends this file as one message has not been verified,
so both outcomes below must be considered.

## Diagnose (read-only)

Use `npm.cmd run prod:db -- status` and
`npm.cmd run prod:db -- verify-post --expect-customers=500` (its output lists
each object and history row), and the logs saved from the deploy.

| State | Meaning | Recovery (approval required for each step) |
|---|---|---|
| No history row, no objects | Failed before applying (connection, migration lock) | Fix the cause; repeat the migration in the window |
| Failed row, no objects | Rolled back as a whole | Fix the cause from the logs (data issues need their own plan), then `prisma migrate resolve --rolled-back 20261017200000_add_customer_soft_delete`, then deploy again |
| Failed row, `deletedAt` (and maybe the index) present, no CHECK | **Partial application** | Preferred: confirm 0 rows have `deletedAt` set (the new code is not deployed), then `DROP INDEX IF EXISTS "Customer_deletedAt_createdAt_idx";` and `ALTER TABLE "Customer" DROP COLUMN "deletedAt";`, then `resolve --rolled-back` and deploy the unchanged file, so history reflects a clean application of the whole file |
| Failed row, all objects present | Failed after the last statement | Confirm the catalog matches the file exactly, then `resolve --applied` |
| Finished row but an object is missing | Inconsistent | Stop; do not change anything without further diagnosis |

Completing missing statements manually and marking the migration applied is
possible but discouraged: history would claim the file ran completely when
it did not.

## Last resort: restore

Restoring the production branch from the `pre-customer-management` snapshot
or within the 6-hour window discards every write made after that point. Use
it only with explicit approval and after confirming the restore scope in the
Neon console. Dropping `deletedAt` after the new code has run would lose the
record of which customers were deleted and when.
