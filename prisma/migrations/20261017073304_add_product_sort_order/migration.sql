-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Preserve a deterministic starting order for products already in the catalog.
WITH ranked_products AS (
    SELECT
        "id",
        (ROW_NUMBER() OVER (
            ORDER BY "deletedAt" ASC NULLS FIRST, "createdAt" DESC, "id" ASC
        ) - 1)::INTEGER AS position
    FROM "Product"
)
UPDATE "Product" AS product
SET "sortOrder" = ranked_products.position
FROM ranked_products
WHERE product."id" = ranked_products."id";

-- CreateIndex
CREATE INDEX "Product_deletedAt_sortOrder_id_idx" ON "Product"("deletedAt", "sortOrder", "id");
