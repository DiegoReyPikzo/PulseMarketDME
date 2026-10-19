# Production data load: v2 sample data

Procedure for inserting the v2 sample data (1,000 products, 3,000 customers,
8,000 sales and 24,000 sale items) into the Neon project **PulseMarketDME**,
branch **production**, database `neondb`. Every step that connects to
Production, and the creation of the backup branch, needs explicit approval at
the time it runs.

**Status:** implemented and tested offline only. It has not been run against
Production.

## Why a separate path

`npx prisma db seed` (`prisma/seed.ts`, guarded by `lib/seed-target.ts`)
refuses Production by design, and that guard is unchanged. Production is
loaded only through `npm run prod:db -- seed-v2 ...`, which reuses the same
production wrapper as the schema work and the same, unchanged
`runSeedTransaction`.

## What the tool verifies and what the operator declares

| Item | Checked by the tool |
|---|---|
| Operator workstation (not CI, Vercel or GitHub Actions) | Yes, in the wrapper and again in the child |
| Production configuration matches the independent target file (hosts, database, role, E2E endpoint is different) | Yes, in the wrapper (`lib/production-environment.ts`) |
| `--confirm-endpoint` equals the verified endpoint ID | Yes, in the wrapper and again in the child |
| `DATABASE_URL` in the child points to that endpoint; no `E2E_*` variables | Yes, in the child |
| Connected `current_database()` and `current_user` | Yes, inside the transaction, before any write |
| `--expect-*` baseline (count and digest of every row outside the v2 data, per table) | Yes, inside the transaction, before any write |
| No row already holds a v2 ID, seed key, SKU or email; existing v2 rows identical | Yes, by `runSeedTransaction` |
| Inserted rows read back equal to the generated data; relations, totals and dates | Yes, by `runSeedTransaction` |
| Rows outside the v2 data unchanged after the inserts | Yes, by `runSeedTransaction` (same transaction) |
| `--backup-branch` exists in Neon and contains the current data | **No.** The tool only checks the name's format and prints it. The operator must create and inspect the branch. |
| The baseline values were read from Production | **No.** The tool only proves that the current data equals the values given. |

Everything runs in one serializable transaction. Any failed check or
concurrent conflicting write aborts it, and nothing is written.

## Before the load

1. **Quiet window.** No one uses the application during the load. A
   concurrent write to these tables makes the transaction fail safely, but the
   load would then have to be repeated.
2. **Backup branch.** In the Neon console, create a branch from **production**
   at its current head, named for example `prod-backup-pre-seed-v2`, with no
   expiration. Check that it lists the four tables. Also confirm the project's
   restore window in *Backup & Restore*. It was 6 hours on 2026-10-18; confirm
   it again.
3. **Schema.** Run `npm run prod:db -- status` and `npm run prod:db -- diff`.
   Both must report that the schema is up to date.
4. **Read-only baseline (T0).** After creating the backup branch, run this
   query in the Neon SQL Editor on branch **production**. It runs in a
   read-only transaction and ends with `ROLLBACK`.

   ```sql
   BEGIN READ ONLY;
   SELECT * FROM (
     SELECT 'database' AS metric, current_database() AS value
     UNION ALL SELECT 'role', current_user
     UNION ALL SELECT 'transaction_read_only', current_setting('transaction_read_only')
     UNION ALL SELECT 'products_total', count(*)::text FROM "Product"
     UNION ALL SELECT 'customers_total', count(*)::text FROM "Customer"
     UNION ALL SELECT 'sales_total', count(*)::text FROM "Sale"
     UNION ALL SELECT 'sale_items_total', count(*)::text FROM "SaleItem"
     UNION ALL SELECT 'v2_rows_product', count(*)::text FROM "Product" WHERE "seedKey" LIKE 'pulsemarket-seed-v2:%' OR sku LIKE 'PM2-%' OR id BETWEEN '00000000-0000-4000-8000-00028fa6ae01' AND '00000000-0000-4000-8000-00028fa6b1e8'
     UNION ALL SELECT 'v2_rows_customer', count(*)::text FROM "Customer" WHERE "seedKey" LIKE 'pulsemarket-seed-v2:%' OR email LIKE 'customer-v2-%@seed.pulsemarket.example' OR id BETWEEN '00000000-0000-4000-8000-0002cb417801' AND '00000000-0000-4000-8000-0002cb4183b8'
     UNION ALL SELECT 'v2_rows_sale', count(*)::text FROM "Sale" WHERE "seedKey" LIKE 'pulsemarket-seed-v2:%' OR id BETWEEN '00000000-0000-4000-8000-000306dc4201' AND '00000000-0000-4000-8000-000306dc6140'
     UNION ALL SELECT 'v2_rows_sale_item', count(*)::text FROM "SaleItem" WHERE "seedKey" LIKE 'pulsemarket-seed-v2:%' OR id BETWEEN '00000000-0000-4000-8000-000342770c01' AND '00000000-0000-4000-8000-0003427769c0'
     UNION ALL SELECT 'sales_total_mismatch', count(*)::text FROM "Sale" s WHERE s.total <> coalesce((SELECT sum(i."lineTotal") FROM "SaleItem" i WHERE i."saleId" = s.id), 0)
     UNION ALL SELECT 'baseline_products', count(*)::text || ':' || coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id)), '') FROM "Product" t WHERE t."seedKey" IS NULL OR t."seedKey" NOT LIKE 'pulsemarket-seed-v2:%'
     UNION ALL SELECT 'baseline_customers', count(*)::text || ':' || coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id)), '') FROM "Customer" t WHERE t."seedKey" IS NULL OR t."seedKey" NOT LIKE 'pulsemarket-seed-v2:%'
     UNION ALL SELECT 'baseline_sales', count(*)::text || ':' || coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id)), '') FROM "Sale" t WHERE t."seedKey" IS NULL OR t."seedKey" NOT LIKE 'pulsemarket-seed-v2:%'
     UNION ALL SELECT 'baseline_sale_items', count(*)::text || ':' || coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id)), '') FROM "SaleItem" t WHERE t."seedKey" IS NULL OR t."seedKey" NOT LIKE 'pulsemarket-seed-v2:%'
   ) AS checks;
   ROLLBACK;
   ```

   The query must report:
   - `database` `neondb`, the approved role, and `transaction_read_only` `on`;
   - the four `v2_rows_*` values at `0` (on a retry after a partial failure
     they are still `0`, because a failed load writes nothing);
   - `sales_total_mismatch` recorded.

   Each `baseline_*` value is `<count>:<md5>`, computed exactly as
   `fingerprintOtherRows` in `prisma/seed.ts` computes it. Keep the full
   output as the T0 record.

## Load

From the repository root on the operator workstation, with the files
described in [production-customer-migration.md](production-customer-migration.md)
(`.env.production.local` and `.env.production.target.local`):

```powershell
npm.cmd run prod:db -- check-target
npm.cmd run prod:db -- seed-v2 `
  --confirm-endpoint=<endpoint ID printed by check-target> `
  --backup-branch=<name of the branch created in step 2> `
  --expect-products=<baseline_products> `
  --expect-customers=<baseline_customers> `
  --expect-sales=<baseline_sales> `
  --expect-sale-items=<baseline_sale_items>
```

Copy the `baseline_*` values from the T0 output exactly. Do not type them from
memory.

A successful run prints the endpoint, the declared backup branch,
`Identity and baseline: verified in the transaction before writing.`, one line
per table (`inserted 1000/3000/8000/24000`, `already present 0`,
`other rows unchanged` equal to the baseline counts), and the final
`verified` line. Any other outcome exits with code 1. It prints only the error
type, table names and counts, and nothing was written.

## After the load

1. Run the T0 query again. Expected:
   - each `*_total` = T0 + 1,000 / 3,000 / 8,000 / 24,000;
   - `v2_rows_product` 1,000, `v2_rows_customer` 3,000, `v2_rows_sale` 8,000,
     `v2_rows_sale_item` 24,000;
   - every `baseline_*` value identical to T0 (the rows that already existed
     did not change);
   - `sales_total_mismatch` equal to T0.
2. Check the public URL: dashboard summary, products, customers and sales
   listings, filters and pagination. The v2 sales end on 2026-10-17, so the
   dashboard's default 30-day range shows them until 2026-11-15.
3. Keep the backup branch until the evaluation period ends.

The 400 ms first-call requirement is still open. Loading the data does not
change that, and the dashboard will be evaluated against this volume.

## Recovery

- **Failure during the load:** the transaction rolls back and nothing is
  written. This was shown on an isolated branch: a verification failure after
  all 36,000 inserts left no v2 rows and the other rows unchanged. Fix the
  cause, repeat the T0 query, and run the load again.
- **Problem found after a successful load (preferred recovery):** remove
  exactly the v2 rows and nothing else. Do it in one transaction, in
  foreign-key order: `SaleItem`, `Sale`, `Customer`, `Product`. Select rows by
  the v2 ID ranges **and** the `pulsemarket-seed-v2:` seed-key prefix, and
  check that the deleted counts are 24,000 / 8,000 / 3,000 / 1,000 before
  committing. Afterwards, the T0 query must match T0 again. This operation is
  **not implemented**. The wrapper deliberately has no delete action. A
  reviewed script and a separate approval are required before it exists or
  runs.
- **Last resort:** restore **production** from the backup branch, or to a
  point in time inside the restore window. This discards every write made
  after that point, including application data, so it needs its own approval.
