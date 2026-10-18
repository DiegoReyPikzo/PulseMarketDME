# Production migration: customer soft delete

Procedure for applying `20261017200000_add_customer_soft_delete` to the
Neon project **PulseMarketDME**, branch **production**, database `neondb`.
Every step that connects to Production needs explicit approval at the time
it runs.

**Status:** applied to Production on 2026-10-18. `status`, `verify-pre`, and
`diff-main` passed before the migration; `deploy` succeeded once; `status`,
`diff`, and `verify-post --expect-customers=500` passed afterwards. The code
was merged and deployed only after that. Recovery steps are in
[production-migration-recovery.md](production-migration-recovery.md) and are
deliberately not part of the wrapper.

## Prerequisites (already confirmed manually in Neon)

- `Customer`: 500 rows, 0 emails failing `email = lower(btrim(email))`,
  0 duplicate groups by normalized email.
- `_prisma_migrations`: the two migrations from `main`, finished, none rolled
  back.
- `deletedAt`, `Customer_deletedAt_createdAt_idx`, and
  `Customer_email_normalized_check` do not exist.
- Snapshot `pre-customer-management` exists for the production branch
  (expires: never); the restore window is 6 hours.

## Local configuration (operator workstation only)

Both files are ignored by Git (`.env*`). Create them with an editor, not by
pasting values into a terminal, and never commit, share, or print them.

`.env.production.target.local` — independent, non-secret description of the
approved target. Copy each value from the Neon console, branch
**production**, *Connection details*:

```
PROD_ALLOWED_DIRECT_HOST=<host shown with "Connection pooling" off, ep-…>
PROD_ALLOWED_POOLED_HOST=<host shown with "Connection pooling" on, ep-…-pooler…>
PROD_ALLOWED_DATABASE=neondb
PROD_ALLOWED_ROLE=<role shown in Connection details>
```

Confirm in the console that the `ep-…` endpoint ID belongs to the
production branch, not to the E2E branch. The wrapper refuses a target that
shares an endpoint with `.env.e2e.target.local`.

`.env.production.local` — the secret connection strings for that same
branch, database, and role:

```
PROD_DATABASE_URL=<pooled connection string>
PROD_DIRECT_URL=<direct connection string>
```

Only `sslmode`, `channel_binding`, and `connect_timeout` query parameters are
accepted; the wrapper replaces `sslmode` with `verify-full`. Delete this
file after the migration window.

## The wrapper

```powershell
npm.cmd run prod:db -- check-target
npm.cmd run prod:db -- status
npm.cmd run prod:db -- diff
npm.cmd run prod:db -- diff-main
npm.cmd run prod:db -- verify-pre --expect-customers=500
npm.cmd run prod:db -- verify-post --expect-customers=500
npm.cmd run prod:db -- deploy --confirm-endpoint=<endpoint ID>
```

- It validates both files before running anything: Neon hostnames, direct
  vs. pooler naming of the same endpoint, exact host, database, and role
  match, no extra connection parameters, and no overlap with the E2E target.
  It prints only the endpoint ID, database, and role.
- The child process receives `DATABASE_URL` and `DIRECT_URL` from the
  verified target only. Inherited `DATABASE_URL`, `DIRECT_URL`,
  `SHADOW_DATABASE_URL`, `E2E_*`, `PULSEMARKET_E2E_*`, `PROD_*`, `DOTENV_*`,
  and libpq `PG*` variables are removed, and `DOTENV_PATH` points to an empty
  file so `prisma.config.ts` (which imports `dotenv/config`) never loads
  `.env`. This is enforced explicitly, not left to dotenv's no-override
  default.
- Only the commands above exist. There is no `migrate dev`, `reset`,
  `db push`, `db execute`, `migrate resolve`, seed, or E2E tooling. `deploy`
  requires `--confirm-endpoint` equal to the verified endpoint ID.
- It refuses to run when `CI`, `VERCEL`, `VERCEL_ENV`, or `GITHUB_ACTIONS` is
  set. Production credentials must never be configured for Vercel Preview or
  CI.
- Errors from configuration and commands never include connection strings
  or passwords; unexpected errors are suppressed. Prisma's own output may
  show the host name (not credentials).

`verify-pre` and `verify-post` run `scripts/database-migration-verify.ts` in
a `READ ONLY` transaction and print aggregates and catalog metadata only.
They compare the SHA-256 of each local migration file with the checksum
Prisma recorded. That comparison was validated on the isolated E2E database,
where all three migration checksums match the local files.
`applied_steps_count` is printed for diagnosis but is not a success
criterion: this Prisma version recorded `1` for every migration in E2E,
including the multi-statement initial migration.

Not used yet: a `lock_timeout` connection option. Whether Prisma's schema
engine and Neon honor `options=-c lock_timeout=…` has not been verified, so
the wrapper rejects an `options` parameter.

## Procedure

1. **Preparation (no connection):** check out the reviewed commit that
   contains the migration (PR #6). `git diff <that commit> --
   prisma/migrations` must be empty; the migration must not be edited.
2. **Target check (approved, no connection):**
   `npm.cmd run prod:db -- check-target`. Compare the printed endpoint ID with
   the Neon console.
3. **Pre-checks (approved, read-only):**
   - `status`: exit code 1 with exactly
     `20261017200000_add_customer_soft_delete` pending and no failed
     migration.
   - `verify-pre --expect-customers=500`: `VERIFY_PRE_OK=true`.
   - `diff-main`: exit code 0. It compares Production with the schema of
     `origin/main` (the wrapper prints the commit), written to a temporary
     file outside the repository and removed afterwards. The CHECK is not
     represented in Prisma diffs; `verify-pre` checks it in the catalog.
   Stop if any result differs.
4. **Recovery point:** confirm the `pre-customer-management` snapshot (or a
   newer one) and note the time. Keep the current `main` code deployed; it is
   compatible with the new schema.
5. **Migration (approved):**
   `npm.cmd run prod:db -- deploy --confirm-endpoint=<endpoint ID>`. Save the
   full output. Do not rerun it if it fails; go to the recovery document.
6. **Verification (read-only):**
   - `status`: "Database schema is up to date!".
   - `diff`: exit code 0.
   - `verify-post --expect-customers=500`: `VERIFY_POST_OK=true` (CHECK
     present with `convalidated = true` and the expected definition, nullable
     `deletedAt` without default, the index, clean history rows, matching
     checksums, and no customer with `deletedAt` yet).
   - The deployed `main` code still loads the customer and sales listings.
7. **Code:** only after a verified migration, take PR #6 out of draft, merge,
   deploy, and validate manually. If the new code misbehaves, revert the code
   deployment; the additive schema stays compatible with the previous code.
