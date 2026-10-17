This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database

PulseMarket uses PostgreSQL through Prisma ORM 7. The schema defines:

- `Product`: unique SKU, name, optional description and category, current price
  (`Decimal(12,2)`), stock, timestamps, and nullable `deletedAt` for soft
  deletion. Catalog indexes support active/deleted filtering with recent-first
  ordering and category/name lookups.
- `Customer`: name, unique email, optional phone, and timestamps.
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
- Sales: case-insensitive `search` against the related customer's name/email;
  exact `customerId` and `status`; inclusive ISO `from`/`to` sale-date bounds.

Sorting uses `sortBy` and `sortOrder` (`asc` or `desc`): products allow
`name`, `sku`, `price`, or `createdAt`; customers allow `name`, `email`, or
`createdAt`; sales allow `saleDate`, `total`, or `createdAt`. Every ordering
adds `id ASC` as a unique tie-breaker. Sales select the customer summary only,
not sale items. Monetary Decimal values are serialized as fixed two-decimal
strings and dates as ISO strings. These uncached functions execute database
page queries and matching counts.

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

## GitHub authentication

Authentication uses stable NextAuth.js v4 with only the GitHub OAuth provider.
Sessions use encrypted JWT cookies, so this setup does not add auth tables to
PostgreSQL. Each protected dashboard page checks `getServerSession` on the
server before reading dashboard data. Unauthenticated visitors are redirected
to `/login`. The dashboard is a demonstration only: any GitHub account that
completes sign-in can see the same demo data; there are no per-user permissions
or roles.

Set `GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` in the
ignored `.env` file. To append a newly generated session secret locally without
printing it to the terminal, run this PowerShell command once, then fill the
GitHub OAuth values in `.env`:

```powershell
node -e "process.stdout.write('NEXTAUTH_SECRET=' + require('node:crypto').randomBytes(32).toString('base64url') + '\n')" | Add-Content -Path .env
```

For local development, set `NEXTAUTH_URL` to `http://localhost:3000`.
Register a GitHub OAuth App named `PulseMarket Local Development` with
homepage `http://localhost:3000` and callback
`http://localhost:3000/api/auth/callback/github`. The callback path is
NextAuth.js v4's default GitHub OAuth callback for the `/api/auth/[...nextauth]`
Route Handler. Do not reuse these local URLs as production settings; configure
the actual deployment origin separately when one exists.

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

Run the creation checks with:

```powershell
npm.cmd run test:product-creation:unit
npm.cmd run test:product-creation:integration
```

Unit tests mock persistence and action dependencies. Integration tests use
PostgreSQL, create unique fixture products, and clean up only those fixture
IDs. The serialization-conflict action test simulates Prisma `P2034`; it does
not claim to exercise real concurrent transactions.

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
