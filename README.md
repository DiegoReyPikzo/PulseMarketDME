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
