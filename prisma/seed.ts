import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, SaleStatus } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const seedPrefix = "pulsemarket-seed-v1";
const productCount = 100;
const customerCount = 500;
const saleCount = 2_000;
const itemsPerSale = 4;

function idFor(namespace: number, index: number): string {
  const suffix = (namespace * 1_000_000_000 + index)
    .toString(16)
    .padStart(12, "0");

  return `00000000-0000-4000-8000-${suffix}`;
}

function seedKeyFor(model: string, index: number): string {
  return `${seedPrefix}:${model}:${String(index).padStart(6, "0")}`;
}

function decimalFromCents(cents: number): Prisma.Decimal {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");

  return new Prisma.Decimal(`${whole}.${fraction}`);
}

const categories = ["Books", "Clothing", "Electronics", "Home", "Stationery"];
const firstNames = ["Alex", "Jordan", "Morgan", "Riley", "Taylor"];
const lastNames = ["Anderson", "Garcia", "Kim", "Patel", "Smith"];

const products: Prisma.ProductCreateManyInput[] = Array.from(
  { length: productCount },
  (_, offset) => {
    const index = offset + 1;

    return {
      id: idFor(1, index),
      sku: `PM-${String(index).padStart(4, "0")}`,
      name: `PulseMarket Product ${String(index).padStart(4, "0")}`,
      description: `Deterministic seed product ${index}.`,
      category: categories[offset % categories.length],
      price: decimalFromCents(499 + index * 137),
      stock: (index * 17) % 250,
      sortOrder: offset,
      seedKey: seedKeyFor("product", index),
    };
  },
);

const customers: Prisma.CustomerCreateManyInput[] = Array.from(
  { length: customerCount },
  (_, offset) => {
    const index = offset + 1;

    return {
      id: idFor(2, index),
      name: `${firstNames[offset % firstNames.length]} ${lastNames[Math.floor(offset / firstNames.length) % lastNames.length]} ${String(index).padStart(4, "0")}`,
      email: `customer-${String(index).padStart(5, "0")}@seed.pulsemarket.example`,
      phone: `+1555${String(index).padStart(7, "0")}`,
      seedKey: seedKeyFor("customer", index),
    };
  },
);

const sales: Prisma.SaleCreateManyInput[] = [];
const saleItems: Prisma.SaleItemCreateManyInput[] = [];

for (let saleIndex = 1; saleIndex <= saleCount; saleIndex += 1) {
  const itemRows: Prisma.SaleItemCreateManyInput[] = [];
  let total = new Prisma.Decimal(0);

  for (let itemOffset = 0; itemOffset < itemsPerSale; itemOffset += 1) {
    const productIndex =
      (((saleIndex - 1) * 7 + itemOffset * 13) % productCount) + 1;
    const quantity = ((saleIndex + itemOffset) % 5) + 1;
    const unitPrice = decimalFromCents(499 + productIndex * 137);
    const lineTotal = unitPrice.mul(quantity);

    total = total.add(lineTotal);
    itemRows.push({
      id: idFor(4, (saleIndex - 1) * itemsPerSale + itemOffset + 1),
      saleId: idFor(3, saleIndex),
      productId: idFor(1, productIndex),
      quantity,
      unitPrice,
      lineTotal,
      seedKey: seedKeyFor(
        "sale-item",
        (saleIndex - 1) * itemsPerSale + itemOffset + 1,
      ),
    });
  }

  sales.push({
    id: idFor(3, saleIndex),
    customerId: idFor(2, ((saleIndex - 1) % customerCount) + 1),
    status: SaleStatus.COMPLETED,
    saleDate: new Date(Date.UTC(2024, 0, 1 + ((saleIndex - 1) % 730))),
    total,
    seedKey: seedKeyFor("sale", saleIndex),
  });
  saleItems.push(...itemRows);
}

async function insertSeedData(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.product.createMany({ data: products, skipDuplicates: true });
    await transaction.customer.createMany({
      data: customers,
      skipDuplicates: true,
    });
    await transaction.sale.createMany({ data: sales, skipDuplicates: true });
    await transaction.saleItem.createMany({
      data: saleItems,
      skipDuplicates: true,
    });
  });
}

async function verifySeedData(): Promise<void> {
  const seeded = { seedKey: { startsWith: `${seedPrefix}:` } };
  const [productTotal, customerTotal, saleTotal, saleItemTotal] =
    await Promise.all([
      prisma.product.count({ where: seeded }),
      prisma.customer.count({ where: seeded }),
      prisma.sale.count({ where: seeded }),
      prisma.saleItem.count({ where: seeded }),
    ]);

  if (
    productTotal !== productCount ||
    customerTotal !== customerCount ||
    saleTotal !== saleCount ||
    saleItemTotal !== saleCount * itemsPerSale
  ) {
    throw new Error(
      `Seed count mismatch: Product=${productTotal}, Customer=${customerTotal}, Sale=${saleTotal}, SaleItem=${saleItemTotal}.`,
    );
  }

  const [relatedSales, relatedItems, seededSales] = await Promise.all([
    prisma.sale.count({
      where: {
        ...seeded,
        customer: { seedKey: { startsWith: `${seedPrefix}:customer:` } },
      },
    }),
    prisma.saleItem.count({
      where: {
        ...seeded,
        sale: { seedKey: { startsWith: `${seedPrefix}:sale:` } },
        product: { seedKey: { startsWith: `${seedPrefix}:product:` } },
      },
    }),
    prisma.sale.findMany({
      where: seeded,
      select: {
        total: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
      },
    }),
  ]);

  if (relatedSales !== saleCount || relatedItems !== saleItemTotal) {
    throw new Error(
      `Seed relation mismatch: related Sale=${relatedSales}, related SaleItem=${relatedItems}.`,
    );
  }

  for (const sale of seededSales) {
    let itemTotal = new Prisma.Decimal(0);

    for (const item of sale.items) {
      const calculatedLineTotal = item.unitPrice.mul(item.quantity);

      if (!calculatedLineTotal.equals(item.lineTotal)) {
        throw new Error(
          `Sale item line total is inconsistent for sale with ${sale.items.length} items.`,
        );
      }

      itemTotal = itemTotal.add(item.lineTotal);
    }

    if (!itemTotal.equals(sale.total)) {
      throw new Error(
        `Sale total is inconsistent for sale with ${sale.items.length} items.`,
      );
    }
  }

  console.log(`Seed Product records: ${productTotal}`);
  console.log(`Seed Customer records: ${customerTotal}`);
  console.log(`Seed Sale records: ${saleTotal}`);
  console.log(`Seed SaleItem records: ${saleItemTotal}`);
  console.log(
    `Seed total records: ${productTotal + customerTotal + saleTotal + saleItemTotal}`,
  );
  console.log("Seed relationships and Decimal totals: verified");
}

async function main(): Promise<void> {
  await insertSeedData();
  await verifySeedData();
}

main()
  .catch((error: unknown) => {
    console.error("PulseMarket seed failed.");
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
