import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  assertConfirmedEndpoint,
  expectedProductionSeedIdentity,
  parseProductionSeedArguments,
  runProductionSeed,
} from "../lib/production-seed";
import { createPrismaSeedStore } from "../prisma/seed";
import { buildSeedDataset } from "../prisma/seed-data";

// Loads the v2 sample data into Production. Run it only through
// `npm run prod:db -- seed-v2 ...` (see docs/production-seed-v2.md). It prints
// table names, counts and the endpoint ID only: no row values or connection
// strings.

const TABLES = ["products", "customers", "sales", "saleItems"] as const;

async function main(): Promise<void> {
  // Validate arguments and the wrapper's environment before any client exists.
  const args = parseProductionSeedArguments(process.argv.slice(2));
  const identity = expectedProductionSeedIdentity(process.env);
  assertConfirmedEndpoint(args, identity);

  console.log(`Target: production (endpoint ${identity.endpoint}).`);
  console.log(
    `Backup branch declared by the operator (not verified by this tool): ${args.backupBranch}.`,
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const dataset = buildSeedDataset();
    // Same transaction settings as prisma/seed.ts.
    const summary = await prisma.$transaction(
      (transaction) =>
        runProductionSeed(createPrismaSeedStore(transaction), dataset, {
          identity,
          baseline: args.baseline,
          readIdentity: async () => {
            const rows = await transaction.$queryRaw<Array<{ database: string; role: string }>>(
              Prisma.sql`SELECT current_database() AS database, current_user AS role`,
            );
            return rows[0] ?? { database: "", role: "" };
          },
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 600_000,
      },
    );
    console.log("Identity and baseline: verified in the transaction before writing.");
    for (const table of TABLES) {
      console.log(
        `${table}: inserted ${summary.inserted[table]}, already present ${summary.alreadyPresent[table]}, other rows unchanged ${summary.otherRowsUnchanged[table]}`,
      );
    }
    console.log("Seed v2 rows, relations, Decimal totals and other rows: verified");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Production seed failed. Nothing was committed unless the summary above was printed.");
  // Seed errors carry table names and counts only. Database and driver errors
  // may echo connection details or row values, so only their type and code
  // are shown.
  if (
    error instanceof Error &&
    /^(ProductionSeed|SeedConflict|SeedVerification)Error$/.test(error.name)
  ) {
    console.error(`${error.name}: ${error.message}`);
  } else if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    console.error(`${error.name}${typeof code === "string" ? ` (${code})` : ""}`);
  } else {
    console.error("Unknown error.");
  }
  process.exitCode = 1;
});
