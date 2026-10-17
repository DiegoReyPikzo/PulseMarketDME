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
