import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import { handleCreateCustomerAction, handleUpdateCustomerAction } from "../../lib/customer-mutation-actions";
import {
  createCustomer,
  createCustomerInputSchema,
  createCustomerMutationRepository,
  CustomerMutationError,
  findCustomerForEdit,
  softDeleteCustomer,
  updateCustomer,
  updateCustomerInputSchema,
  type CustomerMutationRepository,
} from "../../lib/customer-mutations";
import { prisma } from "../../lib/prisma";
import { listCustomers } from "../../lib/queries/customers";
import { listSales } from "../../lib/queries/sales";

const customerIds = new Set<string>();
const productIds = new Set<string>();
const saleIds = new Set<string>();
const saleItemIds = new Set<string>();

afterAll(async () => {
  try {
    // Remove only this file's fixtures, children first (relations restrict).
    for (const [ids, remove] of [
      [saleItemIds, (in_: string[]) => prisma.saleItem.deleteMany({ where: { id: { in: in_ } } })],
      [saleIds, (in_: string[]) => prisma.sale.deleteMany({ where: { id: { in: in_ } } })],
      [productIds, (in_: string[]) => prisma.product.deleteMany({ where: { id: { in: in_ } } })],
      [customerIds, (in_: string[]) => prisma.customer.deleteMany({ where: { id: { in: in_ } } })],
    ] as const) {
      const list = [...ids];
      if (list.length > 0) {
        const result = await remove(list);
        assert.equal(result.count, list.length);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
});

function uniqueEmail(label = "customer"): string {
  return `${label}-test-${randomUUID()}@example.test`;
}

async function trackEmail(email: string): Promise<void> {
  const rows = await prisma.customer.findMany({
    where: { email },
    select: { id: true },
  });
  for (const { id } of rows) customerIds.add(id);
}

async function createFixture(email = uniqueEmail()) {
  const customer = await prisma.customer.create({
    data: { name: "Customer integration fixture", email, phone: "555 0100" },
    select: { id: true, email: true },
  });
  customerIds.add(customer.id);
  return customer;
}

async function readRow(id: string) {
  return prisma.customer.findUniqueOrThrow({
    where: { id },
    select: {
      name: true,
      email: true,
      phone: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      seedKey: true,
    },
  });
}

async function baselineFor(id: string) {
  const customer = await findCustomerForEdit(
    createCustomerMutationRepository(prisma),
    id,
  );
  return { name: customer.name, email: customer.email, phone: customer.phone ?? "" };
}

function editInput(
  id: string,
  original: Awaited<ReturnType<typeof baselineFor>>,
  changes: Partial<Awaited<ReturnType<typeof baselineFor>>>,
) {
  return updateCustomerInputSchema.parse({
    customerId: id,
    values: { ...original, ...changes },
    original,
  });
}

function runEdit(
  input: ReturnType<typeof editInput>,
  wrap: (repository: CustomerMutationRepository) => CustomerMutationRepository = (r) => r,
) {
  return prisma.$transaction((transaction) =>
    updateCustomer(wrap(createCustomerMutationRepository(transaction)), input),
  );
}

function createDependencies(
  wrap: (repository: CustomerMutationRepository) => CustomerMutationRepository = (r) => r,
) {
  return {
    requireSession: async () => ({}),
    create: (input: ReturnType<typeof createCustomerInputSchema.parse>) =>
      prisma.$transaction((transaction) =>
        createCustomer(wrap(createCustomerMutationRepository(transaction)), input),
      ),
    revalidate: () => {},
  };
}

function createForm(email: string, name = "Concurrent fixture"): FormData {
  const data = new FormData();
  data.set("name", name);
  data.set("email", email);
  data.set("phone", "");
  return data;
}

function isCheckViolation(error: unknown): boolean {
  return /Customer_email_normalized_check|23514/.test(
    `${error instanceof Error ? error.message : ""} ${JSON.stringify(error)}`,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    /Customer_email_key|23505/.test(
      `${error instanceof Error ? error.message : ""} ${JSON.stringify(error)}`,
    )
  );
}

test("creates a normalized customer that the active directory lists", async () => {
  const email = uniqueEmail("Mixed-Case");
  try {
    await prisma.$transaction((transaction) =>
      createCustomer(
        createCustomerMutationRepository(transaction),
        createCustomerInputSchema.parse({
          name: "  Normalized fixture  ",
          email: `  ${email.toUpperCase()}  `,
          phone: "  ",
        }),
      ),
    );
  } finally {
    await trackEmail(email.toLowerCase());
  }
  const stored = await prisma.customer.findUniqueOrThrow({
    where: { email: email.toLowerCase() },
    select: { name: true, email: true, phone: true, deletedAt: true },
  });
  assert.deepEqual(stored, {
    name: "Normalized fixture",
    email: email.toLowerCase(),
    phone: null,
    deletedAt: null,
  });
  const listed = await listCustomers({ search: email.toLowerCase() });
  assert.equal(listed.items.length, 1);
});

test("the database CHECK rejects non-normalized emails written without the application", async () => {
  const base = uniqueEmail("check");
  for (const email of [
    base.replace("check", "CHECK"),
    ` ${base} `,
    `${base} `,
  ]) {
    // Each attempt runs in its own transaction, so a rejected write cannot
    // invalidate later checks.
    await assert.rejects(
      prisma.$transaction((transaction) =>
        transaction.customer.create({
          data: { name: "Direct write fixture", email },
          select: { id: true },
        }),
      ),
      (error: unknown) => isCheckViolation(error),
      JSON.stringify(email),
    );
  }
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "Customer" (id, name, email, "updatedAt")
      VALUES (gen_random_uuid(), 'Raw SQL fixture', ${base.toUpperCase()}, now())`,
    (error: unknown) => isCheckViolation(error),
  );
  assert.equal(
    await prisma.customer.count({
      where: { email: { contains: base.slice(6, 42), mode: "insensitive" } },
    }),
    0,
  );
});

test("the UNIQUE index rejects a duplicate normalized email, including one held by a soft-deleted customer", async () => {
  const active = await createFixture();
  const deleted = await createFixture();
  await prisma.$transaction((transaction) =>
    softDeleteCustomer(createCustomerMutationRepository(transaction), deleted.id, new Date()),
  );

  for (const email of [active.email, deleted.email]) {
    await assert.rejects(
      prisma.$transaction((transaction) =>
        transaction.customer.create({
          data: { name: "Direct duplicate fixture", email },
          select: { id: true },
        }),
      ),
      (error: unknown) => isUniqueViolation(error),
    );
    assert.equal(await prisma.customer.count({ where: { email } }), 1);
  }

  await assert.rejects(
    prisma.$transaction((transaction) =>
      createCustomer(
        createCustomerMutationRepository(transaction),
        createCustomerInputSchema.parse({ name: "Reuse", email: deleted.email.toUpperCase(), phone: "" }),
      ),
    ),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "DUPLICATE_EMAIL",
  );
});

test("concurrent creates for the same normalized email persist one row and report the other as in use", async () => {
  const email = uniqueEmail("race-create");
  let winner: Awaited<ReturnType<typeof handleCreateCustomerAction>> | undefined;
  let loser: Awaited<ReturnType<typeof handleCreateCustomerAction>> | undefined;
  try {
    loser = await handleCreateCustomerAction(
      createForm(email.toUpperCase(), "Race loser"),
      createDependencies((repository) => ({
        ...repository,
        async findIdByEmail(value) {
          const owner = await repository.findIdByEmail(value);
          // Both requests pass the friendly pre-check; the competing create
          // commits from another connection before this one inserts.
          winner = await handleCreateCustomerAction(
            createForm(email, "Race winner"),
            createDependencies(),
          );
          return owner;
        },
      })),
    );
  } finally {
    await trackEmail(email);
  }
  assert.equal(winner?.status, "success");
  assert.equal(loser?.status === "error" && loser.code, "DUPLICATE_EMAIL");
  const rows = await prisma.customer.findMany({ where: { email }, select: { name: true } });
  assert.deepEqual(rows, [{ name: "Race winner" }]);
});

test("an edit and a create competing for the same email persist only one owner", async () => {
  const editor = await createFixture();
  const target = uniqueEmail("race-edit");
  const original = await baselineFor(editor.id);
  let created: Awaited<ReturnType<typeof handleCreateCustomerAction>> | undefined;
  const form = new FormData();
  form.set("customerId", editor.id);
  for (const [field, value] of Object.entries({ ...original, email: target })) {
    form.set(field, value);
  }
  for (const [field, value] of Object.entries(original)) form.set(`original.${field}`, value);

  let result: Awaited<ReturnType<typeof handleUpdateCustomerAction>>;
  try {
    result = await handleUpdateCustomerAction(form, {
      requireSession: async () => ({}),
      update: (input) =>
        runEdit(input, (repository) => ({
          ...repository,
          async findIdByEmail(value) {
            const owner = await repository.findIdByEmail(value);
            created = await handleCreateCustomerAction(
              createForm(target, "Created during edit"),
              createDependencies(),
            );
            return owner;
          },
        })),
      revalidate: () => {},
    });
  } finally {
    await trackEmail(target);
  }
  assert.equal(created?.status, "success");
  assert.equal(result.status === "error" && result.code, "DUPLICATE_EMAIL");
  assert.equal((await readRow(editor.id)).email, editor.email);
  assert.equal(await prisma.customer.count({ where: { email: target } }), 1);
});

test("edits persist only changed fields and leave internal fields untouched", async () => {
  const fixture = await createFixture();
  const before = await readRow(fixture.id);
  const original = await baselineFor(fixture.id);
  const newEmail = uniqueEmail("edited");

  const result = await runEdit(
    editInput(fixture.id, original, {
      name: "  Edited fixture  ",
      email: newEmail.toUpperCase(),
      phone: "",
    }),
  );
  const after = await readRow(fixture.id);
  assert.deepEqual(result, {
    status: "updated",
    changedFields: ["name", "email", "phone"],
  });
  assert.equal(after.name, "Edited fixture");
  assert.equal(after.email, newEmail);
  assert.equal(after.phone, null);
  assert.equal(after.deletedAt, null);
  assert.equal(after.seedKey, before.seedKey);
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
  // The previous email is free again once no row holds it.
  assert.equal(await prisma.customer.count({ where: { email: fixture.email } }), 0);
});

test("a concurrent edit committed before saving keeps untouched fields and conflicts on edited ones", async () => {
  const fixture = await createFixture();
  const original = await baselineFor(fixture.id);
  await runEdit(editInput(fixture.id, original, { phone: "555 0200" }));

  await runEdit(editInput(fixture.id, original, { name: "Renamed after other edit" }));
  let row = await readRow(fixture.id);
  assert.equal(row.name, "Renamed after other edit");
  assert.equal(row.phone, "555 0200");

  await assert.rejects(
    runEdit(editInput(fixture.id, original, { phone: "555 0300" })),
    (error: unknown) =>
      error instanceof CustomerMutationError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "phone",
  );
  row = await readRow(fixture.id);
  assert.equal(row.phone, "555 0200");
});

test("an edit committed between another edit's read and write is reported as a conflict", async () => {
  const fixture = await createFixture();
  const original = await baselineFor(fixture.id);
  let committed = false;
  await assert.rejects(
    runEdit(editInput(fixture.id, original, { name: "Loses the race" }), (repository) => ({
      ...repository,
      async updateIfUnchanged(id, expected, data) {
        await runEdit(editInput(fixture.id, original, { name: "Wins the race" }));
        committed = true;
        return repository.updateIfUnchanged(id, expected, data);
      },
    })),
    (error: unknown) =>
      error instanceof CustomerMutationError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "name",
  );
  assert.equal(committed, true);
  assert.equal((await readRow(fixture.id)).name, "Wins the race");
});

test("a delete committed between an edit's read and write rejects the edit", async () => {
  const fixture = await createFixture();
  const original = await baselineFor(fixture.id);
  await assert.rejects(
    runEdit(editInput(fixture.id, original, { name: "Should not persist" }), (repository) => ({
      ...repository,
      async updateIfUnchanged(id, expected, data) {
        await prisma.$transaction((transaction) =>
          softDeleteCustomer(createCustomerMutationRepository(transaction), fixture.id, new Date()),
        );
        return repository.updateIfUnchanged(id, expected, data);
      },
    })),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "DELETED",
  );
  const row = await readRow(fixture.id);
  assert.equal(row.name, "Customer integration fixture");
  assert.ok(row.deletedAt instanceof Date);
});

test("soft-deleting a customer keeps their sales, relations, and sales filters intact", async () => {
  const customer = await createFixture();
  const product = await prisma.product.create({
    data: {
      sku: `CUSTOMER-TEST-${randomUUID()}`,
      name: "Customer history fixture",
      category: "Customer test",
      price: new Prisma.Decimal("12.50"),
      stock: 3,
      sortOrder: 0,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  const sale = await prisma.sale.create({
    data: {
      customerId: customer.id,
      status: "COMPLETED",
      total: new Prisma.Decimal("25.00"),
    },
    select: { id: true },
  });
  saleIds.add(sale.id);
  const item = await prisma.saleItem.create({
    data: {
      saleId: sale.id,
      productId: product.id,
      quantity: 2,
      unitPrice: new Prisma.Decimal("12.50"),
      lineTotal: new Prisma.Decimal("25.00"),
    },
    select: { id: true },
  });
  saleItemIds.add(item.id);
  const saleBefore = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
  const itemBefore = await prisma.saleItem.findUniqueOrThrow({ where: { id: item.id } });

  await prisma.$transaction((transaction) =>
    softDeleteCustomer(createCustomerMutationRepository(transaction), customer.id, new Date()),
  );

  assert.deepEqual(await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } }), saleBefore);
  assert.deepEqual(
    await prisma.saleItem.findUniqueOrThrow({ where: { id: item.id } }),
    itemBefore,
  );
  assert.equal((await listCustomers({ search: customer.email })).items.length, 0);

  for (const filters of [{ customerId: customer.id }, { search: customer.email }]) {
    const result = await listSales(filters);
    assert.equal(result.items.length, 1, JSON.stringify(Object.keys(filters)));
    assert.equal(result.items[0].id, sale.id);
    assert.deepEqual(result.items[0].customer, {
      id: customer.id,
      name: "Customer integration fixture",
      email: customer.email,
      deleted: true,
    });
  }
});
