import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  createE2eChildEnvironment,
  loadE2eConfiguration,
} from "../lib/e2e-environment";

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

// Each product suite owns one exact set of SKU suffixes, all sharing a single
// run ID; any other combination is rejected.
const FIXTURE_SUFFIX_SETS: readonly (readonly string[])[] = [
  ["ZERO", "DUP", "INVALID"],
  ["DRAG-1", "DRAG-2", "DRAG-3"],
  ["EDIT-A", "EDIT-B", "EDIT-C", "EDIT-R"],
];

function readFixtureSkus(): string[] {
  const encoded = process.env.PULSEMARKET_E2E_PRODUCT_SKUS;
  if (!encoded) throw new Error("E2E product fixture identifiers are missing.");
  const parsed: unknown = JSON.parse(encoded);
  if (!isStringArray(parsed)) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  const matches = parsed.map((sku) =>
    /^PME2E-([a-f0-9]{32})-((?:ZERO|DUP|INVALID|DRAG-[123]|EDIT-[ABCR]))$/.exec(sku),
  );
  const runIds = new Set(matches.map((match) => match?.[1]));
  const suffixes = matches.map((match) => match?.[2]);
  if (
    matches.some((match) => match === null) ||
    runIds.size !== 1 ||
    !FIXTURE_SUFFIX_SETS.some(
      (set) =>
        set.length === suffixes.length &&
        set.every((suffix, index) => suffixes[index] === suffix),
    )
  ) {
    throw new Error("E2E product fixture identifiers are invalid.");
  }
  return parsed;
}

function readRegistryPath(): string {
  const configuredPath = process.env.PULSEMARKET_E2E_PRODUCT_REGISTRY;
  if (!configuredPath) {
    throw new Error("E2E product fixture registry is not configured.");
  }
  const registryPath = resolve(configuredPath);
  const outputDirectory = resolve(".playwright-e2e");
  const relativePath = relative(outputDirectory, registryPath);
  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("E2E product fixture registry path is invalid.");
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
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  ) {
    throw new Error("E2E product fixture ID registry is invalid.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const configuration = loadE2eConfiguration();
  const expectedEnvironment = createE2eChildEnvironment(
    configuration,
    process.env,
  );
  if (
    process.env.DATABASE_URL !== expectedEnvironment.DATABASE_URL ||
    process.env.DIRECT_URL !== expectedEnvironment.DIRECT_URL
  ) {
    throw new Error("E2E product cleanup environment is not isolated.");
  }

  const skus = readFixtureSkus();
  const registryPath = readRegistryPath();
  const registeredIds = await readRegisteredIds(registryPath);
  const { prisma } = await import("../lib/prisma");
  let fixtureIds: string[] = [...registeredIds];
  let cleanedCount = 0;

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

    const matchingProducts = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true },
    });
    const registeredProducts =
      registeredIds.length === 0
        ? []
        : await prisma.product.findMany({
            where: { id: { in: registeredIds } },
            select: { id: true, sku: true },
          });
    if (registeredProducts.some(({ sku }) => !skus.includes(sku))) {
      throw new Error("E2E product registry refers to an unrelated product.");
    }
    fixtureIds = [
      ...new Set([
        ...matchingProducts.map(({ id }) => id),
        ...registeredProducts.map(({ id }) => id),
      ]),
    ];

    if (fixtureIds.length > 0) {
      const expectedDeletedCount = fixtureIds.length;
      const deleted = await prisma.product.deleteMany({
        where: {
          id: { in: fixtureIds },
          sku: { in: skus },
        },
      });
      const remaining = await prisma.product.findMany({
        where: { id: { in: fixtureIds } },
        select: { id: true },
      });
      fixtureIds = remaining.map(({ id }) => id);
      if (deleted.count !== expectedDeletedCount || fixtureIds.length > 0) {
        throw new Error("E2E product fixtures remain after cleanup.");
      }
      cleanedCount = expectedDeletedCount;
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
      `E2E product fixture cleanup passed; removed ${cleanedCount} product(s).`,
    );
  } catch {
    console.error(
      `E2E product fixture cleanup failed. Pending product IDs: ${
        fixtureIds.length > 0 ? fixtureIds.join(", ") : "could not be determined"
      }.`,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message.startsWith("E2E product fixture cleanup failed.")
  ) {
    console.error(error.message);
  } else {
    console.error(
      "E2E product fixture cleanup failed. Pending product IDs: could not be determined.",
    );
  }
  process.exitCode = 1;
});
