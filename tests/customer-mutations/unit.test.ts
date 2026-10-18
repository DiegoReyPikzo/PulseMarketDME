import assert from "node:assert/strict";
import { test } from "vitest";

import { Prisma } from "../../generated/prisma/client";
import {
  handleCreateCustomerAction,
  handleDeleteCustomerAction,
  handleGetCustomerForEditAction,
  handleUpdateCustomerAction,
} from "../../lib/customer-mutation-actions";
import {
  createCustomer,
  createCustomerInputSchema,
  CustomerMutationError,
  findCustomerForEdit,
  softDeleteCustomer,
  updateCustomer,
  updateCustomerInputSchema,
  type CustomerEditableValues,
  type CustomerForEdit,
  type CustomerMutationRepository,
} from "../../lib/customer-mutations";

const customerId = "00000000-0000-4000-8000-000000000201";
const otherId = "00000000-0000-4000-8000-000000000202";

function stored(values: Partial<CustomerForEdit> = {}): CustomerForEdit {
  return {
    id: customerId,
    name: "Cliente Ficticio",
    email: "cliente@example.test",
    phone: null,
    deletedAt: null,
    ...values,
  };
}

const formValues = {
  name: "Cliente Ficticio",
  email: "cliente@example.test",
  phone: "",
};

function memoryRepository(initial: CustomerForEdit[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const calls: string[] = [];
  const writes: {
    expected: Partial<CustomerEditableValues>;
    data: Partial<CustomerEditableValues>;
  }[] = [];
  const repository: CustomerMutationRepository = {
    async findById(id) {
      calls.push("findById");
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async findIdByEmail(email) {
      calls.push("findIdByEmail");
      const row = [...rows.values()].find((candidate) => candidate.email === email);
      return row ? { id: row.id } : null;
    },
    async create(data) {
      calls.push("create");
      const id = otherId;
      rows.set(id, { id, deletedAt: null, ...data });
      return { id };
    },
    async updateIfUnchanged(id, expected, data) {
      calls.push("updateIfUnchanged");
      writes.push({ expected, data });
      const row = rows.get(id);
      if (!row || row.deletedAt !== null) return 0;
      for (const [field, value] of Object.entries(expected)) {
        if (row[field as keyof CustomerEditableValues] !== value) return 0;
      }
      rows.set(id, { ...row, ...data });
      return 1;
    },
    async softDelete(id, deletedAt) {
      calls.push("softDelete");
      const row = rows.get(id);
      if (!row || row.deletedAt !== null) return 0;
      rows.set(id, { ...row, deletedAt });
      return 1;
    },
  };
  return { repository, rows, calls, writes };
}

function updateInput(
  values: Partial<typeof formValues> = {},
  original: Partial<typeof formValues> = {},
) {
  return updateCustomerInputSchema.parse({
    customerId,
    values: { ...formValues, ...values },
    original: { ...formValues, ...original },
  });
}

function updateForm(
  values: Record<string, string> = formValues,
  original: Record<string, string> = formValues,
  extra: [string, string][] = [],
): FormData {
  const data = new FormData();
  data.set("customerId", customerId);
  for (const [field, value] of Object.entries(values)) data.set(field, value);
  for (const [field, value] of Object.entries(original)) {
    data.set(`original.${field}`, value);
  }
  for (const [field, value] of extra) data.append(field, value);
  return data;
}

function idForm(id = customerId): FormData {
  const data = new FormData();
  data.set("customerId", id);
  return data;
}

class RedirectSignal extends Error {}
const deny = async () => {
  throw new RedirectSignal("redirect:/login?error=AccessDenied");
};

test("all four customer handlers reject an unauthorized request before parsing, reading, or writing", async () => {
  let calls = 0;
  const count = async () => {
    calls += 1;
    return undefined as never;
  };
  const createForm = new FormData();
  for (const [field, value] of Object.entries(formValues)) createForm.set(field, value);

  await assert.rejects(
    handleCreateCustomerAction(createForm, {
      requireSession: deny,
      create: count,
      revalidate: () => {
        calls += 1;
      },
    }),
    RedirectSignal,
  );
  await assert.rejects(
    handleGetCustomerForEditAction(idForm(), { requireSession: deny, find: count }),
    RedirectSignal,
  );
  await assert.rejects(
    handleUpdateCustomerAction(updateForm(), {
      requireSession: deny,
      update: count,
      revalidate: () => {
        calls += 1;
      },
    }),
    RedirectSignal,
  );
  await assert.rejects(
    handleDeleteCustomerAction(idForm(), {
      requireSession: deny,
      remove: count,
      revalidate: () => {
        calls += 1;
      },
    }),
    RedirectSignal,
  );
  assert.equal(calls, 0);
});

test("normalizes names, emails, and phones and enforces the approved limits", () => {
  const parsed = createCustomerInputSchema.parse({
    name: "  Cliente Ficticio  ",
    email: "  Cliente.Ficticio@Example.TEST  ",
    phone: "   ",
  });
  assert.deepEqual(parsed, {
    name: "Cliente Ficticio",
    email: "cliente.ficticio@example.test",
    phone: null,
  });
  assert.equal(
    createCustomerInputSchema.parse({ ...formValues, phone: " +52 (55) 1234-56.78 " })
      .phone,
    "+52 (55) 1234-56.78",
  );

  for (const [field, value] of [
    ["name", "   "],
    ["name", "x".repeat(161)],
    ["email", ""],
    ["email", "not-an-email"],
    ["email", `${"a".repeat(250)}@example.test`],
    ["phone", "555-ABC"],
    ["phone", "()+ -."],
    ["phone", "1".repeat(33)],
  ] as const) {
    const result = createCustomerInputSchema.safeParse({ ...formValues, [field]: value });
    assert.equal(result.success, false, `${field}=${value.slice(0, 20)}`);
  }
});

test("create handler rejects internal, unknown, and repeated fields and returns field errors", async () => {
  let creates = 0;
  const dependencies = {
    requireSession: async () => ({}),
    create: async () => {
      creates += 1;
      return { id: otherId };
    },
    revalidate: () => {},
  };
  for (const extra of [
    ["id", otherId],
    ["deletedAt", "2026-01-01T00:00:00.000Z"],
    ["createdAt", "2026-01-01T00:00:00.000Z"],
    ["updatedAt", "2026-01-01T00:00:00.000Z"],
    ["seedKey", "x"],
    ["email", "duplicado@example.test"],
  ] as [string, string][]) {
    const data = new FormData();
    for (const [field, value] of Object.entries(formValues)) data.set(field, value);
    data.append(extra[0], extra[1]);
    const result = await handleCreateCustomerAction(data, dependencies);
    assert.equal(result.status === "error" && result.code, "INVALID", extra[0]);
  }

  const invalid = new FormData();
  invalid.set("name", "");
  invalid.set("email", "no");
  invalid.set("phone", "abc");
  const result = await handleCreateCustomerAction(invalid, dependencies);
  assert.equal(result.status === "error" && result.code, "VALIDATION");
  assert.deepEqual(
    Object.keys(result.status === "error" ? result.fieldErrors : {}).sort(),
    ["email", "name", "phone"],
  );
  assert.equal(creates, 0);
});

test("create rejects an email already reserved by an active or soft-deleted customer", async () => {
  for (const owner of [stored(), stored({ deletedAt: new Date() })]) {
    const { repository, calls } = memoryRepository([owner]);
    await assert.rejects(
      createCustomer(
        repository,
        createCustomerInputSchema.parse({ ...formValues, email: "CLIENTE@example.test" }),
      ),
      (error: unknown) =>
        error instanceof CustomerMutationError && error.code === "DUPLICATE_EMAIL",
    );
    assert.ok(!calls.includes("create"));
  }
});

test("create and update handlers map an email UNIQUE violation to the email-in-use error", async () => {
  const uniqueViolation = new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "Customer", target: ["email"] },
  });
  const createForm = new FormData();
  for (const [field, value] of Object.entries(formValues)) createForm.set(field, value);
  const created = await handleCreateCustomerAction(createForm, {
    requireSession: async () => ({}),
    create: async () => {
      throw uniqueViolation;
    },
    revalidate: () => {},
  });
  assert.equal(created.status === "error" && created.code, "DUPLICATE_EMAIL");
  assert.ok(created.status === "error" && created.fieldErrors.email);

  const updated = await handleUpdateCustomerAction(
    updateForm({ ...formValues, email: "otro@example.test" }),
    {
      requireSession: async () => ({}),
      update: async () => {
        throw uniqueViolation;
      },
      revalidate: () => {},
    },
  );
  assert.equal(updated.status === "error" && updated.code, "DUPLICATE_EMAIL");
});

test("recognizes the adapter-pg UNIQUE violation shape for the email index only", async () => {
  const adapterMeta = (index: string) => ({
    modelName: "Customer",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        kind: "UniqueConstraintViolation",
        constraint: { index },
        table: "Customer",
      },
    },
  });
  const createForm = new FormData();
  for (const [field, value] of Object.entries(formValues)) createForm.set(field, value);

  const duplicate = await handleCreateCustomerAction(createForm, {
    requireSession: async () => ({}),
    create: async () => {
      throw new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: adapterMeta("Customer_email_key"),
      });
    },
    revalidate: () => {},
  });
  assert.equal(duplicate.status === "error" && duplicate.code, "DUPLICATE_EMAIL");

  const originalError = console.error;
  console.error = () => {};
  try {
    const other = await handleCreateCustomerAction(createForm, {
      requireSession: async () => ({}),
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: "test",
          meta: adapterMeta("Customer_seedKey_key"),
        });
      },
      revalidate: () => {},
    });
    assert.equal(other.status === "error" && other.code, "UNKNOWN");
  } finally {
    console.error = originalError;
  }
});

test("unexpected failures are logged without personal data", async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const createForm = new FormData();
    for (const [field, value] of Object.entries(formValues)) createForm.set(field, value);
    const result = await handleCreateCustomerAction(createForm, {
      requireSession: async () => ({}),
      create: async () => {
        throw new Error(`boom ${formValues.email}`);
      },
      revalidate: () => {},
    });
    assert.equal(result.status === "error" && result.code, "UNKNOWN");
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(logged).includes(formValues.email));
});

test("update handler rejects internal, unknown, repeated fields and malformed originals", async () => {
  let updates = 0;
  const dependencies = {
    requireSession: async () => ({}),
    update: async () => {
      updates += 1;
      return { status: "unchanged" as const };
    },
    revalidate: () => {},
  };
  for (const extra of [
    ["deletedAt", "2026-01-01T00:00:00.000Z"],
    ["seedKey", "x"],
    ["original.deletedAt", "x"],
    ["name", "repetido"],
  ] as [string, string][]) {
    const result = await handleUpdateCustomerAction(
      updateForm(formValues, formValues, [extra]),
      dependencies,
    );
    assert.equal(result.status === "error" && result.code, "INVALID", extra[0]);
  }
  for (const original of [
    { ...formValues, name: "" },
    { ...formValues, email: "" },
    { ...formValues, phone: "1".repeat(33) },
  ]) {
    const result = await handleUpdateCustomerAction(
      updateForm(formValues, original),
      dependencies,
    );
    assert.equal(result.status === "error" && result.code, "INVALID");
  }
  assert.equal(updates, 0);
});

test("update writes only changed fields conditioned on their original values", async () => {
  const { repository, rows, writes } = memoryRepository([stored()]);
  const result = await updateCustomer(
    repository,
    updateInput({ name: " Cliente Renombrado ", phone: "555 0101" }),
  );
  assert.deepEqual(result, { status: "updated", changedFields: ["name", "phone"] });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].expected, { name: "Cliente Ficticio", phone: null });
  assert.deepEqual(writes[0].data, { name: "Cliente Renombrado", phone: "555 0101" });
  assert.equal(rows.get(customerId)?.email, "cliente@example.test");
});

test("update treats normalized-equivalent values as unchanged", async () => {
  const { repository, writes } = memoryRepository([stored()]);
  const result = await updateCustomer(
    repository,
    updateInput({ email: " CLIENTE@Example.test ", phone: "   " }),
  );
  assert.deepEqual(result, { status: "unchanged" });
  assert.equal(writes.length, 0);
});

test("update rejects missing and soft-deleted customers and reserved emails", async () => {
  await assert.rejects(
    updateCustomer(memoryRepository([]).repository, updateInput({ name: "Nuevo" })),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "NOT_FOUND",
  );
  await assert.rejects(
    updateCustomer(
      memoryRepository([stored({ deletedAt: new Date() })]).repository,
      updateInput({ name: "Nuevo" }),
    ),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "DELETED",
  );
  for (const owner of [
    stored({ id: otherId, email: "otro@example.test" }),
    stored({ id: otherId, email: "otro@example.test", deletedAt: new Date() }),
  ]) {
    const { repository, writes } = memoryRepository([stored(), owner]);
    await assert.rejects(
      updateCustomer(repository, updateInput({ email: "Otro@Example.test" })),
      (error: unknown) =>
        error instanceof CustomerMutationError && error.code === "DUPLICATE_EMAIL",
    );
    assert.equal(writes.length, 0);
  }
});

test("update keeps concurrent changes to untouched fields and reports conflicts on edited ones", async () => {
  const kept = memoryRepository([stored({ phone: "555 9999" })]);
  await updateCustomer(kept.repository, updateInput({ name: "Solo nombre" }));
  assert.equal(kept.rows.get(customerId)?.phone, "555 9999");
  assert.equal(kept.rows.get(customerId)?.name, "Solo nombre");

  const stale = memoryRepository([stored({ name: "Cambiado por otro" })]);
  await assert.rejects(
    updateCustomer(stale.repository, updateInput({ name: "Mi cambio" })),
    (error: unknown) =>
      error instanceof CustomerMutationError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "name",
  );
  assert.equal(stale.writes.length, 0);
});

test("update reports a conflict when the row changes between the read and the write", async () => {
  const { repository, rows } = memoryRepository([stored()]);
  const racing: CustomerMutationRepository = {
    ...repository,
    async updateIfUnchanged(id, expected, data) {
      const row = rows.get(id);
      assert.ok(row);
      rows.set(id, { ...row, phone: "555 7777" });
      return repository.updateIfUnchanged(id, expected, data);
    },
  };
  await assert.rejects(
    updateCustomer(racing, updateInput({ phone: "555 1111" })),
    (error: unknown) =>
      error instanceof CustomerMutationError &&
      error.code === "CONFLICT" &&
      error.conflictFields.join() === "phone",
  );
  assert.equal(rows.get(customerId)?.phone, "555 7777");
});

test("soft delete marks only active customers and maps missing or already deleted ones", async () => {
  const { repository, rows } = memoryRepository([stored()]);
  const deletedAt = new Date("2026-03-01T00:00:00.000Z");
  await softDeleteCustomer(repository, customerId, deletedAt);
  assert.equal(rows.get(customerId)?.deletedAt, deletedAt);

  await assert.rejects(
    softDeleteCustomer(repository, customerId, new Date()),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "DELETED",
  );
  await assert.rejects(
    softDeleteCustomer(memoryRepository([]).repository, customerId, new Date()),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "NOT_FOUND",
  );
  await assert.rejects(
    findCustomerForEdit(repository, customerId),
    (error: unknown) =>
      error instanceof CustomerMutationError && error.code === "DELETED",
  );
});

test("handlers revalidate only after a confirmed write and validate customer IDs", async () => {
  let revalidations = 0;
  const base = {
    requireSession: async () => ({}),
    revalidate: () => {
      revalidations += 1;
    },
  };

  const unchanged = await handleUpdateCustomerAction(updateForm(), {
    ...base,
    update: async () => ({ status: "unchanged" }),
  });
  assert.equal(unchanged.status, "unchanged");
  const conflict = await handleUpdateCustomerAction(
    updateForm({ ...formValues, name: "Otro" }),
    {
      ...base,
      update: async () => {
        throw new CustomerMutationError("conflicto", "CONFLICT", ["name"]);
      },
    },
  );
  assert.equal(conflict.status === "error" && conflict.code, "CONFLICT");
  const invalidDelete = await handleDeleteCustomerAction(idForm("not-a-uuid"), {
    ...base,
    remove: async () => {},
  });
  assert.equal(invalidDelete.status === "error" && invalidDelete.code, "INVALID");
  assert.equal(revalidations, 0);

  const deleted = await handleDeleteCustomerAction(idForm(), {
    ...base,
    remove: async () => {},
  });
  assert.equal(deleted.status, "success");
  const lookup = await handleGetCustomerForEditAction(idForm(), {
    requireSession: async () => ({}),
    find: async () => stored({ phone: null }),
  });
  assert.deepEqual(lookup, {
    status: "found",
    customer: {
      id: customerId,
      name: "Cliente Ficticio",
      email: "cliente@example.test",
      phone: "",
    },
  });
  assert.equal(revalidations, 1);
});
