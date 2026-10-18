import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  createE2eChildEnvironment,
  loadE2eConfiguration,
} from "../lib/e2e-environment";

const CUSTOMER_SUFFIXES = ["a", "b", "c", "r"] as const;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

// The customer suite owns exactly four run-unique emails sharing one run ID.
function readFixtureEmails(): string[] {
  const encoded = process.env.PULSEMARKET_E2E_CUSTOMER_EMAILS;
  if (!encoded) throw new Error("E2E customer fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed) || parsed.length !== CUSTOMER_SUFFIXES.length) {
    throw new Error("E2E customer fixture identifiers are invalid.");
  }
  const matches = parsed.map((email) =>
    /^pme2e-([a-f0-9]{32})-cust-([abcr])@example\.test$/.exec(email),
  );
  const runIds = new Set(matches.map((match) => match?.[1]));
  if (
    matches.some((match) => match === null) ||
    runIds.size !== 1 ||
    !CUSTOMER_SUFFIXES.every((suffix, index) => matches[index]?.[2] === suffix)
  ) {
    throw new Error("E2E customer fixture identifiers are invalid.");
  }
  return parsed;
}

function readRegistryPath(): string {
  const configuredPath = process.env.PULSEMARKET_E2E_CUSTOMER_REGISTRY;
  if (!configuredPath) {
    throw new Error("E2E customer fixture registry is not configured.");
  }
  const registryPath = resolve(configuredPath);
  const relativePath = relative(resolve(".playwright-e2e"), registryPath);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("E2E customer fixture registry path is invalid.");
  }
  return registryPath;
}

async function readRegisteredIds(registryPath: string): Promise<string[]> {
  let encoded: string;
  try {
    encoded = await readFile(registryPath, "utf8");
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(encoded);
  if (
    !isStringArray(parsed) ||
    parsed.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    )
  ) {
    throw new Error("E2E customer fixture ID registry is invalid.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const configuration = loadE2eConfiguration();
  const expectedEnvironment = createE2eChildEnvironment(configuration, process.env);
  if (
    process.env.DATABASE_URL !== expectedEnvironment.DATABASE_URL ||
    process.env.DIRECT_URL !== expectedEnvironment.DIRECT_URL
  ) {
    throw new Error("E2E customer cleanup environment is not isolated.");
  }

  const emails = readFixtureEmails();
  const registryPath = readRegistryPath();
  const registeredIds = await readRegisteredIds(registryPath);
  const { prisma } = await import("../lib/prisma");
  let pending = "could not be determined";
  let removedSales = 0;
  let removedCustomers = 0;

  try {
    const identities = await prisma.$queryRaw<
      Array<{ database: string; role: string }>
    >`SELECT current_database() AS database, current_user AS role`;
    const identity = identities[0];
    if (
      !identity ||
      identity.database !== configuration.target.database ||
      identity.role !== configuration.target.role
    ) {
      throw new Error("E2E cleanup connected to an unexpected database.");
    }

    const matching = await prisma.customer.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    const registered =
      registeredIds.length === 0
        ? []
        : await prisma.customer.findMany({
            where: { id: { in: registeredIds } },
            select: { id: true, email: true },
          });
    if (registered.some(({ email }) => !emails.includes(email))) {
      throw new Error("E2E customer registry refers to an unrelated customer.");
    }
    const customerIds = [
      ...new Set([...matching, ...registered].map(({ id }) => id)),
    ];
    pending = customerIds.join(", ") || "none";

    if (customerIds.length > 0) {
      const sales = await prisma.sale.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      const saleIds = sales.map(({ id }) => id);
      if (saleIds.length > 0) {
        // The suite creates item-less sales only; refuse to delete anything else.
        const items = await prisma.saleItem.count({
          where: { saleId: { in: saleIds } },
        });
        if (items > 0) {
          throw new Error("E2E customer fixtures have unexpected sale items.");
        }
        const deletedSales = await prisma.sale.deleteMany({
          where: { id: { in: saleIds }, customerId: { in: customerIds } },
        });
        if (deletedSales.count !== saleIds.length) {
          throw new Error("E2E customer fixture sales remain after cleanup.");
        }
        removedSales = deletedSales.count;
      }

      const deletedCustomers = await prisma.customer.deleteMany({
        where: { id: { in: customerIds }, email: { in: emails } },
      });
      const remaining = await prisma.customer.count({
        where: { OR: [{ id: { in: customerIds } }, { email: { in: emails } }] },
      });
      if (deletedCustomers.count !== customerIds.length || remaining > 0) {
        throw new Error("E2E customer fixtures remain after cleanup.");
      }
      removedCustomers = deletedCustomers.count;
    }

    await unlink(registryPath).catch((error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    });
    console.log(
      `E2E customer fixture cleanup passed; removed ${removedCustomers} customer(s) and ${removedSales} sale(s).`,
    );
  } catch {
    console.error(
      `E2E customer fixture cleanup failed. Pending customer IDs: ${pending}.`,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error(
    "E2E customer fixture cleanup failed. Pending customer IDs: could not be determined.",
  );
  process.exitCode = 1;
});
