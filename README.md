This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database

PulseMarket uses PostgreSQL through Prisma ORM 7. The schema defines:

- `Product`: unique SKU, name, optional description and category, current price
  (`Decimal(12,2)`), stock, timestamps, and nullable `deletedAt` for soft
  deletion. Catalog indexes support active/deleted filtering with recent-first
  ordering and category/name lookups.
- `Customer`: name, unique normalized email, optional phone, timestamps, and
  nullable `deletedAt` for soft deletion (see Customer management).
- `Sale`: required customer relation, status, sale date, and `Decimal(14,2)`
  total. Customer/date and date indexes support sales history queries.
- `SaleItem`: required sale and product relations, quantity, historical
  `Decimal(12,2)` unit price, and `Decimal(14,2)` line total. A sale cannot
  contain the same product twice; product/sale indexes support product history.

All relations use restrictive deletes to protect sales history. Products are
retired by setting `deletedAt`, not by deleting their rows. Nullable unique
`seedKey` fields identify only the deterministic sample records.

Set `DATABASE_URL` to Neon’s pooled application connection and `DIRECT_URL` to
the direct migration connection in the ignored local `.env` file. Never commit
that file. Prepare a migration with:

```powershell
npx.cmd prisma migrate dev --name init
```

Regenerate the client after schema changes with:

```powershell
npx.cmd prisma generate
```

Apply the deterministic sample data with:

```powershell
npx.cmd prisma db seed
```

The seed creates 100 products, 500 customers, 2,000 sales, and 8,000 sale
items (10,600 records total). Its fixed IDs and unique seed keys make repeated
runs safe; it inserts only these records and never deletes existing data.

## Server-side list queries

The server-only functions `listProducts`, `listCustomers`, and `listSales`
are available from `lib/queries/products.ts`, `lib/queries/customers.ts`, and
`lib/queries/sales.ts`. Each accepts an unknown input object, validates it with
Zod, and returns `items`, `total`, `page`, `pageSize`, and `totalPages`.
Defaults are page 1 and 20 rows; page sizes must be between 1 and 100.
Invalid and unknown parameters throw Zod validation errors. Database errors
are not converted into empty results.

Supported filters:

- Products: case-insensitive `search` across name, SKU, and description;
  exact `category`. Soft-deleted products are excluded.
- Customers: case-insensitive `search` across name, email, and phone.
  Soft-deleted customers are excluded.
- Sales: case-insensitive `search` against the related customer's name/email;
  exact `customerId` and `status`; inclusive ISO `from`/`to` sale-date bounds.

Sorting uses `sortBy` and `sortOrder` (`asc` or `desc`): products allow
`name`, `sku`, `price`, or `createdAt`; customers allow `name`, `email`, or
`createdAt`; sales allow `saleDate`, `total`, or `createdAt`. Every ordering
adds `id ASC` as a unique tie-breaker. Sales select the customer summary only
(including a `deleted` flag, not the deletion time), not sale items. Sales of
soft-deleted customers remain in sales results, searches, and `customerId`
filters. Monetary Decimal values are serialized as fixed two-decimal
strings and dates as ISO strings. These uncached functions execute database
page queries and matching counts.

Unit and integration tests run on Vitest (`vitest.config.mts`). The default
mode only collects offline suites, so a bare `npx vitest run` never reaches a
database. Browser form tests (`tests/**/*.test.tsx`) run in a separate
`client` project on jsdom with React's client build, and mock the Server
Actions they call. The `*:integration` scripts use `--mode integration`, run their
files one at a time, and CI runs them through `npm run e2e:with-env` against
the isolated E2E database.

Unit tests exercise parsing, query construction, pagination, stable sorting,
and serialization without connecting to or changing Neon:

```powershell
npm.cmd run test:unit
```

Read-only integration tests query the configured database and do not create,
update, or delete records:

```powershell
npm.cmd run test:integration
```

Measure each full listing (including its count) against the configured Neon
connection with:

```powershell
npm.cmd run db:benchmark
```

The benchmark reports the first execution separately, then measures 20 more
executions per listing at page size 20. It reports minimum, median, p95, and
maximum for those 20 samples. The p95 uses the nearest-rank method:
`sorted[ceil(0.95 * n) - 1]` (the 19th ordered sample for 20 runs). Results
include local runtime and network latency and are not a server-only query plan.

## Authentication and authorization

Authentication uses NextAuth.js v4 with GitHub and Google OAuth. Sessions use
encrypted JWT cookies. Dashboard routes are checked by `proxy.ts` and again by
server-side page and Server Action guards. Authorization is based only on the
exact provider and stable provider account ID pair. Display names, usernames,
and email addresses do not grant access. The authorized-account list is
server-only; missing, empty, invalid, or duplicate entries deny access.

Configure `GITHUB_ID`, `GITHUB_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and
`PULSEMARKET_AUTHORIZED_ACCOUNTS` in the ignored `.env` file for local
development and in the appropriate Vercel environment. Either complete OAuth
provider pair can be enabled; a half-configured pair is an error. The account
list is JSON with exact stable identities, for example:

```json
[{"provider":"github","providerAccountId":"<stable numeric GitHub account ID>"}]
```

Supported provider values are `github` and `google`. An empty array denies all
accounts. Never use a `NEXT_PUBLIC_` prefix or expose the list to the browser.
To append a newly generated session secret locally without printing it to the
terminal, run this PowerShell command once, then fill the OAuth values in
`.env`:

```powershell
node -e "process.stdout.write('NEXTAUTH_SECRET=' + require('node:crypto').randomBytes(32).toString('base64url') + '\n')" | Add-Content -Path .env
```

For local development, set `NEXTAUTH_URL` to `http://localhost:3000`. Register
OAuth clients with these callback URLs:

- GitHub local: `http://localhost:3000/api/auth/callback/github`
- Google local: `http://localhost:3000/api/auth/callback/google`
- GitHub production: `https://<production-domain>/api/auth/callback/github`
- Google production: `https://<production-domain>/api/auth/callback/google`

Use the real production origin for `NEXTAUTH_URL` and the production redirect
URIs; do not substitute Preview or local URLs.

GitHub's stable account ID is the numeric `id` field from
`https://api.github.com/users/<github-username>`. Verify that it belongs to the
intended account; never authorize by username.

An authenticated but unapproved Google account is denied a session and access
to protected pages and actions. After that denial, the login page links to
`/login/request-access`, a card that shows only that browser's verified Google
`sub` (the `providerAccountId`) so the user can copy it into an access request.
The server transports the identity in a short-lived (120 s) encrypted, HttpOnly,
`SameSite=Strict` cookie scoped to `/api/auth/google-account-id`. The card
retrieves it with a same-origin `POST` to that endpoint, which returns no-store
JSON and clears the cookie in the browser; `GET` is not accepted, and requests
without a matching `Origin` (or with a non-same-origin `Sec-Fetch-Site`) are
rejected before the cookie is read or cleared. The token has no server-side
revocation: it expires after 120 seconds. The endpoint does not create a
session, authorize the account, use URL parameters for identity, or log the
identifier. Add the exact `provider: "google"` and `providerAccountId` pair
manually to `PULSEMARKET_AUTHORIZED_ACCOUNTS` only after approving the request.

Add the evaluator's provider and stable account ID to Production's
`PULSEMARKET_AUTHORIZED_ACCOUNTS` before delivery. Preview is closed by
default: do not copy Production credentials, authorization entries, or
database connections into Preview. Keep Preview deployments disabled or
protected until they have their own non-production database branch and
independent environment configuration. Use an empty authorization list there
until Preview access is explicitly approved.

The local OAuth simulator exists only for the isolated E2E runner. It requires
validated E2E database targeting and ephemeral loopback OAuth credentials and
is rejected in production. Do not configure simulator or E2E variables in
Vercel.

## Production builds and migrations

Use Node.js 24 (`.nvmrc` and `engines.node`); it meets the installed Next.js and
Prisma runtime requirements. `npm run build` generates the Prisma client
before `next build`. Generation needs `DIRECT_URL` to be configured, but does
not apply migrations. Development migrations use `npm run db:migrate`;
production migration deployment is a separate, explicit operation:

```powershell
npm.cmd run db:migrate:deploy
```

Before running it, confirm the selected environment's Neon direct connection
and migration status. Do not run the production command as part of the build.

The session-guard unit tests are separate from the query tests:

```powershell
npm.cmd run test:auth
```

These tests check the server guard's authenticated and unauthenticated branches;
they do not simulate or validate a live GitHub OAuth exchange.

Manual browser verification (performed by the user; not an automated E2E test)
confirmed:

- GitHub OAuth sign-in completed successfully.
- The dashboard displayed the signed-in identity and product list.
- Signing out redirected to `/login`.
- Opening `/dashboard` directly without a session was blocked and redirected to
  `/login`.

## Dashboard listings

The protected `/dashboard` route is the analytics summary. Protected listings
are available at `/dashboard/products`, `/dashboard/customers`, and
`/dashboard/sales`. Each route verifies the session on the server before
calling its existing Prisma-backed listing function. Filtering, sorting,
pagination, and matching counts therefore execute in PostgreSQL; no listing
loads a full table into application memory.

GET forms keep their current filters, sort, and page size in the URL. Applying
any form starts at page 1; previous/next links preserve those criteria. Each
listing offers page sizes 20, 50, and 100. Product filters use the current
search/category fields, customers use search, and sales use search, customer
UUID, status, and inclusive UTC date bounds. Order fields remain limited to
the allowlists documented in the server-query section. Invalid, repeated, or
unsupported URL parameters render a validation message and reset link without
querying the database. Database failures reach a retryable error boundary and
are not displayed as empty results.

Sales and product prices are shown as stored decimal strings without assigning
a currency. Sales rows include the existing related customer summary and do
not fetch sale items.

## Product catalog ordering

Products can be persistently reordered on `/dashboard/products` by selecting
“Posición personalizada” in ascending order. Reordering is enabled only when
search/category filters are clear and the page size is at most 50. Drag rows by
the handle, or use the accessible Subir/Bajar controls. The visible page is
reordered optimistically and saved atomically; a failed save restores its
previous order. Product positions are initialized deterministically by the
additive migration and the reproducible seed.

Each reorder request includes the page number, page size, and original ordered
IDs observed by the browser. The server compares that snapshot with the current
database page inside the serializable transaction. Stale-page submissions are
rejected with a reload-and-retry message; concurrent serializable transaction
conflicts return the same recovery guidance. Only the positions already
occupied by IDs on the submitted page are reassigned, so other pages retain
their positions.

## Form validation

The product creation and edit forms, the catalog bulk form, and the customer
creation and edit forms validate with the same Zod schemas in the browser and
in their Server Actions. The schemas live in `lib/validation/`, which has no
server-only or Prisma imports. In the browser, invalid values show the same
field messages the server would return, and the action is not called. The
server still validates every submission and remains the authority. Rules that
need the database (SKU and email uniqueness, edit conflicts, missing or
deleted records) are checked only on the server.

## Product catalog mutations

Authenticated users can soft-delete a product or apply a bulk catalog change
from `/dashboard/products`. Bulk operations accept 1–50 distinct product IDs
and reject missing or already deleted products. Category changes require a
non-empty category. Stock and price adjustments use signed deltas: positive
values increase and negative values decrease the selected field. Price results
are rounded to two decimal places; percentage-based stock results are rounded
to the nearest integer. Any result below zero or outside the database field
range is rejected. Bulk operations run in a Prisma transaction, and product
rows are never physically deleted by these actions.

Each price or stock adjustment is written only while the product still has the
value read when the adjustment was computed. If another change (for example an
individual edit) commits between that read and the write, the batch reports
that the catalog changed and the whole transaction is rolled back; no product
in the batch is adjusted. Bulk category changes set an explicit value and are
not conditioned on the previous category.

Run the mutation checks with:

```powershell
npm.cmd run test:mutations:unit
npm.cmd run test:mutations:integration
```

The integration checks create uniquely named product fixtures in the configured
database and remove those exact fixture IDs in `finally` cleanup. They do not
update or delete existing catalog rows.

### Creating catalog products

The protected `/dashboard/products` page includes a product creation form.
SKU, name, category, and price are required; outer whitespace is removed from
SKU, name, and category. Description is optional and blank/whitespace-only
values are stored as `NULL`. Price is validated as a decimal string with up to
two fractional digits and within `Decimal(12,2)`; stock defaults to zero and
must fit a non-negative PostgreSQL `Int`. The action rejects internal model
fields, authenticates before validation, and creates products inside a
serializable transaction.

SKU uniqueness applies to all product rows, including soft-deleted products,
so a retired SKU cannot be reused. The next sort position is assigned after
the current maximum active position (or zero when no active products exist);
existing positions are not changed. A serialization conflict asks the user to
retry. The submit control is disabled while pending and the SKU unique
constraint protects duplicate submissions; there is no persistent idempotency
token. A successful create revalidates and refreshes the current listing
without changing its filters, sort, or page, so the new product may not appear
in the current view.

Known limitation (pending, independent of the customer work): the product
creation and edit handlers recognize a SKU `UNIQUE` violation only through
Prisma's `target` metadata. With `@prisma/adapter-pg` the violation is
reported under `driverAdapterError.cause.constraint.index`, so two requests
racing for the same SKU still persist only one product, but the losing
request shows the generic error instead of the SKU field error. The
non-racing duplicate case is caught earlier by the SKU lookup.

Run the creation checks with:

```powershell
npm.cmd run test:product-creation:unit
npm.cmd run test:product-creation:integration
```

### Editing catalog products

Each product row on `/dashboard/products` has an “Editar” action that opens a
modal dialog. SKU, name, description, category, price, and stock can be
edited; `id`, `sortOrder`, `deletedAt`, timestamps, and `seedKey` cannot, and
submitting any of them is rejected. Both the lookup and the update Server
Actions verify the authorized session on the server before reading or writing.
Server Action IDs are not a security boundary: they appear in client bundles
and requests can be replayed, so every action performs its own authorization.

New values follow the creation rules (trimmed SKU/name/category, blank
description stored as `NULL`, required category, two-decimal price, and
non-negative `Int` stock). A legacy product without a category must have one
entered before it can be saved. SKU uniqueness applies to all product rows,
including soft-deleted ones. Changing a SKU releases the previous SKU, which
another product can then use. Missing and soft-deleted products cannot be
edited.

The dialog submits the values it loaded alongside the new values. Those
original values are untrusted browser input used only to detect conflicts.
Only fields that actually changed are written, in one conditional update that
requires each changed field to still hold its original value. A concurrent
change to a field the user did not edit is kept; a concurrent change to an
edited field is reported as a conflict with an option to reload the product.
Equivalent values (for example `10` and `10.00`) are not a change. Saving
revalidates the product listing only; edits do not affect dashboard
analytics, which use stored sale totals and the active-product count.

Run the edit checks with:

```powershell
npm.cmd run test:product-update:unit
npm.cmd run test:product-update:integration
npm.cmd run e2e:product-edit
```

The integration checks cover both concurrency orders deterministically by
committing one operation from another connection between the other's read and
write. The E2E suite covers editing, invalid values, duplicate SKUs, a product
deleted from another tab, Escape/Cancel/Enter behavior, duplicate submission
while saving, and HTTP replays without an authorized session. Those replays
are rejected by `proxy.ts` before reaching the action; the action's own
authorization is covered by direct handler unit tests.

Unit tests mock persistence and action dependencies. Integration tests use
PostgreSQL, create unique fixture products, and clean up only those fixture
IDs. The serialization-conflict action test simulates Prisma `P2034`; it does
not claim to exercise real concurrent transactions.

## Customer management

`/dashboard/customers` lets authorized users create customers, edit their
name, email, and phone, and soft-delete them. Restoring deleted customers,
bulk changes, and sale mutations are not available. The create, edit lookup,
update, and delete Server Actions each verify the authorized session on the
server before reading the form or the database. Submitted internal fields
(`id`, `deletedAt`, timestamps, `seedKey`), unknown keys, and repeated keys
are rejected.

- Name: trimmed, required, up to 160 characters.
- Email: trimmed, lowercased, valid email format, up to 254 characters.
- Phone: optional, trimmed, blank stored as `NULL`, up to 32 characters of
  digits, spaces, `+`, parentheses, hyphen, and period, with at least one
  digit. This is a character check, not validation of a real phone number.

Edits write only the fields that changed, conditioned on their original
values; a concurrent change to an untouched field is kept and a concurrent
change to an edited field is reported as a conflict with an option to reload.
Soft-deleted customers cannot be edited. Soft deletion sets `deletedAt` only:
the customer leaves the active directory, while their sales, sale items, and
relations are not modified. Sales listings, searches, and the `customerId`
filter keep including them and show “Cliente eliminado” next to the customer's
unchanged name and email.

### Email uniqueness

Emails stay reserved after soft deletion. Case-insensitive uniqueness is
enforced by PostgreSQL, not only by the application:

- The migration `20261017200000_add_customer_soft_delete` adds the manual
  constraint `Customer_email_normalized_check`,
  `CHECK (email = lower(btrim(email)))`. Prisma cannot represent CHECK
  constraints, so it lives only in the migration SQL; `schema.prisma` has a
  comment pointing to it. Prisma's drift diff does not show it, so verify it
  in `pg_constraint` (it must exist with `convalidated = true`).
- With every stored email normalized, the existing `UNIQUE` index
  `Customer_email_key` rejects duplicates that differ only in letter case,
  atomically under concurrency, including emails held by soft-deleted rows.
- The guarantee is exactly PostgreSQL `lower()` and `btrim()`. `btrim()` with
  no characters argument removes ordinary spaces only, not every kind of
  Unicode whitespace, and the CHECK does not validate email format. The
  application additionally trims and validates format before writing.
- The application maps a `UNIQUE` violation (including the
  `@prisma/adapter-pg` metadata shape) to the “email in use” field error, so
  concurrent creates or edits for the same email persist one row and report
  the other as in use.

The migration adds the nullable `deletedAt` column (existing customers stay
active) and the `Customer_deletedAt_createdAt_idx` index, then adds and
immediately validates the CHECK. Validation scans the table while holding a
lock that blocks other access to `Customer`; existing rows are not
normalized, so any stored email that is not already lowercase and trimmed
makes the migration fail. To undo, dropping the CHECK and the index loses no
data, but dropping `deletedAt` loses the record of which customers were
deleted and when.

#### Transactions and partial application

The migration file contains no explicit `BEGIN`/`COMMIT`. PostgreSQL runs a
multi-statement script sent as one simple-query message as a single implicit
transaction: a probe on the isolated E2E database (session temp tables only)
confirmed that when the last statement of such a script fails, the earlier
`CREATE TABLE`, `CREATE INDEX`, and `ADD CONSTRAINT` statements are rolled
back too. Whether Prisma Migrate sends this file as one message has **not**
been verified, so atomicity is not assumed:

- If it is sent as one message and the CHECK fails, nothing from the file
  remains (no column, index, or constraint), and `_prisma_migrations` records
  the migration as failed.
- If statements were applied separately, a CHECK failure could leave
  `deletedAt` and its index without the constraint.

Detect either case with `prisma migrate status` (it reports the failed
migration and later `migrate deploy` runs stop with `P3009`), the
`_prisma_migrations` row (`finished_at IS NULL`, `logs`), and the catalog:
`information_schema.columns` for `deletedAt`, `pg_indexes` for
`Customer_deletedAt_createdAt_idx`, and `pg_constraint` for
`Customer_email_normalized_check` with `convalidated`. Do not rerun the
deployment or edit the migration. Repairing requires a separately approved
plan: fix or normalize the offending data, remove any partially created
objects (or complete them manually), then mark the migration with
`prisma migrate resolve --rolled-back` (or `--applied` only after the schema
fully matches the file) and deploy again. The applied migration must not be
edited afterwards; its checksum is recorded, so a correction ships as a new
migration.

#### Compatibility and deployment order

The schema change is additive. The code on `main` before this change never
writes customers (only the seed does, with lowercase emails), reads customers
with explicit field selections, and does not reference `deletedAt`, so it
keeps working after the migration and the CHECK. The new code reads and
writes `deletedAt`, so it must not run before the migration. This order was
followed for Production on 2026-10-18 (pre-checks, migration through the
`prod:db` wrapper, and post-checks all passed before the code was merged):

1. Approved read-only review of Production data: emails where
   `email <> lower(btrim(email))`, duplicates by `lower(email)`, and the row
   count of `Customer`.
2. A verified backup or recovery point (for example a Neon branch or a
   restore point) taken immediately before the migration.
3. The approved migration (`npm.cmd run db:migrate:deploy` against the
   Production direct connection) in an agreed window. The E2E run took about
   4 seconds of wall time including CLI startup; that is neither the lock
   duration nor an estimate for Production.
4. Schema verification: `prisma migrate status`, the drift diff, and the
   catalog check of the CHECK (`convalidated = true`), the column, and the
   index.
5. Only then merge and deploy the new code, followed by manual validation.

The operator procedure, the `prod:db` wrapper (target verification against a
separate Git-ignored allowlist, controlled child environment, and a fixed set
of read-only checks plus `deploy`), and local configuration instructions are
in [docs/production-customer-migration.md](docs/production-customer-migration.md).
Manual recovery is documented separately in
[docs/production-migration-recovery.md](docs/production-migration-recovery.md);
the wrapper does not run any recovery command. Run its offline tests with:

```powershell
npm.cmd run test:production-tooling
```

Run the customer checks with:

```powershell
npm.cmd run test:customers:unit
npm.cmd run test:customers:integration
npm.cmd run e2e:customers
```

The integration checks write directly to PostgreSQL (bypassing application
normalization) to confirm that the CHECK rejects uppercase and outer-space
emails and that the `UNIQUE` index rejects duplicate and soft-deleted emails.
They also race creates and edits for the same email deterministically and
confirm that soft-deleting a customer leaves their sales unchanged.

## Dashboard summary and analytics

The protected `/dashboard` route shows aggregate metrics and daily trends for
the selected UTC date range. The range defaults to the current UTC day and the
previous 29 days, accepts at most 366 inclusive days, and is kept in the `from`
and `to` URL parameters. The selected final date is inclusive; database reads
use a UTC start-inclusive/end-exclusive interval.

Only `COMPLETED` sales contribute to the amount, count, average ticket, and
daily series. `PENDING`, `CANCELLED`, and `REFUNDED` are excluded. A refunded
sale is excluded from its original sale date in full; this is not accounting
for refund movements or partial refunds. Historical completed sales remain
included even if a referenced product is soft-deleted. Active products are a
current count where `deletedAt IS NULL`, independent of the selected period.
The summary does not assign a currency to monetary values.

The totals, average, current active-product count, and daily PostgreSQL
aggregate are read in one repeatable-read transaction. Decimal calculations
remain exact; amounts and averages are returned as strings. Days with no
completed sales are returned with zero amount and count. The page refreshes
when requested, every 60 seconds while visible, and when the tab becomes
visible again; this is periodic polling, not strict real-time data. Failed
refreshes retain the last successful data and identify it as potentially stale.

Unit tests cover UTC boundaries, parameter validation, the 366-day limit,
zero-filled dates, and refresh policy. Analytics integration tests create their
own customer, products, sales, and sale items, then clean up only those exact
fixture IDs:

```powershell
npm.cmd run test:analytics:unit
npm.cmd run test:analytics:integration
```

Measure the first query in a fresh Node process separately from 20 subsequent
queries in that process. The benchmark reports transaction establishment, the
combined aggregate query, transaction completion, local result processing,
and `EXPLAIN (ANALYZE, BUFFERS)` for the same parameterized SQL. Establishment
includes pool acquisition and any connection setup plus transaction start;
query timings include driver/network round trips and database response. Result
processing is local. The benchmark excludes authentication, the HTTP request,
React rendering, and browser/network latency. A new Node process does not imply
a cold database or cold provider compute. Explain plans and index definitions
are collected after the timed runs and are not used to warm the reported first
query.

```powershell
npm.cmd run db:analytics-benchmark
```

To inspect a populated seeded interval, pass a valid range explicitly:

```powershell
npm.cmd run db:analytics-benchmark -- --from=2024-01-01 --to=2024-01-30
```

The measured first query in a new Node process still exceeds the 400 ms
target: recent default-range runs took 640.09–743.17 ms initially, while the
20 subsequent queries had medians of 222.59–223.82 ms and maxima of
234.07–239.99 ms. A new application process does not prove that the database
compute or its caches were cold. The initial-query target remains open; these
measurements do not isolate connection-pool acquisition from transaction
startup.

## E2E database environment preparation

E2E database commands must not use the ordinary development `.env`. The
application connection is `DATABASE_URL`; Prisma migrations use `DIRECT_URL`.
The E2E loader reads only `.env.e2e.local` (`E2E_DATABASE_URL` and
`E2E_DIRECT_URL`) and requires a separate allowlist in
`.env.e2e.target.local`. Copy the committed placeholder file
`.env.e2e.target.example` to `.env.e2e.target.local`, then fill in the approved
Neon direct host, pooled host, database name, and role. Do not put connection
URLs or passwords in the allowlist file. Both local files are ignored by Git.

The preflight validates that the two URLs use the independently approved
Neon hosts, identify the same endpoint/database/role, and have the expected
pooled/direct host relationship. It then connects to both approved endpoints
with certificate verification enabled and inspects database identity, public
tables, and prior Prisma migration rows inside read-only transactions. It
does not apply migrations or write fixtures. A Neon project name cannot be
verified from a connection URL; confirm the hosts and database in the Neon
console before approving the allowlist.

Run the offline configuration tests and, only after the target allowlist is
approved and configured, the read-only preflight:

```powershell
npm.cmd run e2e:config:test
npm.cmd run e2e:preflight
```

For a future child process, `e2e:with-env` validates the same configuration
and overrides only that child’s `DATABASE_URL` and `DIRECT_URL` with the E2E
connections. On Windows, `npm.cmd` is launched through npm's Node.js entry
point and `npx.cmd` tools through their installed package CLI entry points.
Other `.cmd` scripts are rejected rather than passed through a shell. It does
not mutate the current development server environment.
For example, after a separate E2E build is prepared:

```powershell
npm.cmd run e2e:with-env -- npm.cmd run start
```

Do not run the existing integration test scripts for E2E preparation: they
load the ordinary development `.env` and use its application database
connection.

## E2E browser authentication

The local browser suites use Playwright with Chromium and an OAuth 2.0 provider
simulator on loopback. Run configuration/authentication tests with:

```powershell
npm.cmd run e2e:config:test
npm.cmd run e2e:auth
```

Run product-creation browser tests with:

```powershell
npm.cmd run e2e:products
```

Run product drag-and-drop browser tests with:

```powershell
npm.cmd run e2e:reorder
```

Run product edit browser tests with:

```powershell
npm.cmd run e2e:product-edit
```

Each product suite uses one exact set of run-unique fixture SKUs (`ZERO`,
`DUP`, `INVALID`; `DRAG-1`–`DRAG-3`; or `EDIT-A`, `EDIT-B`, `EDIT-C`,
`EDIT-R`). Cleanup rejects any other combination and removes only those SKUs
and the IDs the suite registered.

Run customer browser tests with:

```powershell
npm.cmd run e2e:customers
```

The customer suite uses four run-unique emails
(`pme2e-<run>-cust-a|b|c|r@example.test`). Its cleanup verifies the isolated
target, removes item-less sales it created for those customers (failing
instead if any sale item exists), then removes only those customers.

The runner validates the explicit E2E environment and completes the
read-only database preflight before starting either test service. It starts
the OAuth simulator on an ephemeral loopback port and a dedicated Next.js
development server at `127.0.0.1:4317` using `.next-e2e`; it does not reuse an
existing server and closes both services when the run ends. The E2E provider
is accepted only when the E2E URLs match the independent approved target,
the database environment is the validated E2E environment, all endpoints are
loopback, and per-run random OAuth and NextAuth secrets are present. It is
rejected in production. Normal application startup continues to configure
GitHub only.

The simulated provider exercises NextAuth's regular OAuth authorization-code
callback, state validation, and JWT session issuance. Its local approval and
denial screens do not contact GitHub. Passing this suite does **not** certify
the real GitHub OAuth exchange. Real GitHub OAuth needs a separately approved
test application and account and is not covered here.

The browser tests cover unauthenticated redirects, successful simulated
OAuth, generic accessible failure after provider denial, and sign-out
protection after reload. Playwright reporters are list-only; trace, screenshots,
video, cookies and storage-state output are disabled or ignored. The suite
covers product creation, zero-price persistence, duplicate SKU rejection and
server-side decimal validation. Product runs use unique SKUs, record created
product IDs under the ignored `.playwright-e2e` directory, and remove only those
IDs in the runner's finalization block. A second cleanup lookup is restricted
to the run's exact unique SKUs. The runner then repeats the read-only preflight.
The drag-and-drop suite creates three run-unique products through the form,
selects the unfiltered custom-position ascending catalog, uses Playwright's
pointer-driven `dragTo` interaction on the real drag handle, and verifies the
complete fixture order in the UI after reload and in PostgreSQL. It cleans only
the IDs/SKUs from that run. This covers browser HTML5 drag-and-drop through a
real pointer interaction, not the Subir/Bajar buttons.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
