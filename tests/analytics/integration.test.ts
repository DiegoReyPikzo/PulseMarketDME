import "dotenv/config";

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma, SaleStatus } from "../../generated/prisma/client";
import { getDashboardAnalytics } from "../../lib/analytics/dashboard";
import { prisma } from "../../lib/prisma";

const customerIds: string[] = [];
const productIds: string[] = [];
const saleIds: string[] = [];
const saleItemIds: string[] = [];

after(async () => {
  try {
    if (saleItemIds.length > 0) {
      const result = await prisma.saleItem.deleteMany({
        where: { id: { in: saleItemIds } },
      });
      assert.equal(result.count, saleItemIds.length);
    }
    if (saleIds.length > 0) {
      const result = await prisma.sale.deleteMany({
        where: { id: { in: saleIds } },
      });
      assert.equal(result.count, saleIds.length);
    }
    if (productIds.length > 0) {
      const result = await prisma.product.deleteMany({
        where: { id: { in: productIds } },
      });
      assert.equal(result.count, productIds.length);
    }
    if (customerIds.length > 0) {
      const result = await prisma.customer.deleteMany({
        where: { id: { in: customerIds } },
      });
      assert.equal(result.count, customerIds.length);
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function createCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      name: "Analytics integration fixture",
      email: `analytics-${crypto.randomUUID()}@pulsemarket.example`,
    },
    select: { id: true },
  });
  customerIds.push(customer.id);
  return customer.id;
}

async function createProduct(deleted: boolean): Promise<string> {
  const product = await prisma.product.create({
    data: {
      sku: `ANALYTICS-${crypto.randomUUID()}`,
      name: "Analytics integration fixture",
      price: new Prisma.Decimal("20.02"),
      stock: 2,
      ...(deleted ? { deletedAt: new Date("2026-01-01T00:00:00.000Z") } : {}),
    },
    select: { id: true },
  });
  productIds.push(product.id);
  return product.id;
}

async function createSale(
  customerId: string,
  status: SaleStatus,
  total: string,
  saleDate: Date,
): Promise<string> {
  const sale = await prisma.sale.create({
    data: {
      customerId,
      status,
      total: new Prisma.Decimal(total),
      saleDate,
    },
    select: { id: true },
  });
  saleIds.push(sale.id);
  return sale.id;
}

test("aggregates only COMPLETED sales and counts active products independently", async () => {
  const customerId = await createCustomer();
  const activeProductId = await createProduct(false);
  const deletedProductId = await createProduct(true);
  const from = "2031-05-10";
  const to = "2031-05-12";

  const firstCompleted = await createSale(
    customerId,
    SaleStatus.COMPLETED,
    "10.01",
    new Date("2031-05-10T00:00:00.000Z"),
  );
  const lastDayCompleted = await createSale(
    customerId,
    SaleStatus.COMPLETED,
    "20.02",
    new Date("2031-05-12T23:59:59.999Z"),
  );
  await createSale(
    customerId,
    SaleStatus.PENDING,
    "500.00",
    new Date("2031-05-11T12:00:00.000Z"),
  );
  await createSale(
    customerId,
    SaleStatus.CANCELLED,
    "600.00",
    new Date("2031-05-11T12:00:00.000Z"),
  );
  await createSale(
    customerId,
    SaleStatus.REFUNDED,
    "700.00",
    new Date("2031-05-11T12:00:00.000Z"),
  );
  await createSale(
    customerId,
    SaleStatus.COMPLETED,
    "800.00",
    new Date("2031-05-13T00:00:00.000Z"),
  );

  const historicItem = await prisma.saleItem.create({
    data: {
      saleId: firstCompleted,
      productId: deletedProductId,
      quantity: 1,
      unitPrice: new Prisma.Decimal("10.01"),
      lineTotal: new Prisma.Decimal("10.01"),
    },
    select: { id: true },
  });
  saleItemIds.push(historicItem.id);
  const activeItem = await prisma.saleItem.create({
    data: {
      saleId: lastDayCompleted,
      productId: activeProductId,
      quantity: 1,
      unitPrice: new Prisma.Decimal("20.02"),
      lineTotal: new Prisma.Decimal("20.02"),
    },
    select: { id: true },
  });
  saleItemIds.push(activeItem.id);

  const expectedActiveProductCount = await prisma.product.count({
    where: { deletedAt: null },
  });
  const analytics = await getDashboardAnalytics({ from, to });

  assert.equal(analytics.completedSalesAmount, "30.03");
  assert.equal(analytics.completedSalesCount, 2);
  assert.equal(analytics.averageTicket, "15.02");
  assert.equal(analytics.activeProductsCount, expectedActiveProductCount);
  assert.deepEqual(analytics.daily, [
    { date: from, amount: "10.01", salesCount: 1 },
    { date: "2031-05-11", amount: "0.00", salesCount: 0 },
    { date: to, amount: "20.02", salesCount: 1 },
  ]);
});

test("returns zero totals, null average, and a complete zero-filled series without sales", async () => {
  const analytics = await getDashboardAnalytics({
    from: "2099-01-01",
    to: "2099-01-02",
  });

  assert.equal(analytics.completedSalesAmount, "0.00");
  assert.equal(analytics.completedSalesCount, 0);
  assert.equal(analytics.averageTicket, null);
  assert.deepEqual(analytics.daily, [
    { date: "2099-01-01", amount: "0.00", salesCount: 0 },
    { date: "2099-01-02", amount: "0.00", salesCount: 0 },
  ]);
});
