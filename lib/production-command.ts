import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveE2eCommandInvocation } from "./e2e-command";
import {
  createProductionChildEnvironment,
  ProductionConfigurationError,
  redactSecrets,
  type ProductionConfiguration,
} from "./production-environment";

export type ProductionInvocation = {
  command: string;
  args: string[];
  description: string;
};

export class ProductionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionCommandError";
  }
}

export const PRODUCTION_ACTIONS = [
  "check-target",
  "status",
  "diff",
  "diff-main",
  "verify-pre",
  "verify-post",
  "deploy",
] as const;

export type ProductionAction = (typeof PRODUCTION_ACTIONS)[number];

const USAGE = `Usage: npm run prod:db -- <${PRODUCTION_ACTIONS.join("|")}> [options]
  diff-main compares with the origin/main schema (no arguments)
  verify-pre|verify-post accept --expect-customers=N
  deploy requires --confirm-endpoint=<verified endpoint ID>`;

// Only these fixed command lines can run against production. Recovery
// operations (migrate resolve, SQL DROP, restores) are intentionally absent.
export function resolveProductionAction(
  argv: readonly string[],
  configuration: ProductionConfiguration,
  options: { nodePath?: string; verifyScript?: string; mainSchemaPath?: string } = {},
): ProductionInvocation | null {
  const [action, ...rest] = argv;
  if (!action || !(PRODUCTION_ACTIONS as readonly string[]).includes(action)) {
    throw new ProductionCommandError(USAGE);
  }
  const prisma = (args: string[]) => {
    const invocation = resolveE2eCommandInvocation("npx", ["prisma", ...args], {
      nodePath: options.nodePath,
    });
    return { command: invocation.command, args: invocation.args };
  };

  switch (action as ProductionAction) {
    case "check-target":
      if (rest.length > 0) throw new ProductionCommandError(USAGE);
      return null;
    case "status":
      if (rest.length > 0) throw new ProductionCommandError(USAGE);
      return { ...prisma(["migrate", "status"]), description: "prisma migrate status" };
    case "diff":
      if (rest.length > 0) throw new ProductionCommandError(USAGE);
      return {
        ...prisma([
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          "prisma/schema.prisma",
          "--exit-code",
        ]),
        description: "prisma migrate diff (read-only)",
      };
    case "diff-main":
      if (rest.length > 0 || !options.mainSchemaPath) {
        throw new ProductionCommandError(USAGE);
      }
      return {
        ...prisma([
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          options.mainSchemaPath,
          "--exit-code",
        ]),
        description: "prisma migrate diff against the origin/main schema (read-only)",
      };
    case "verify-pre":
    case "verify-post": {
      const extra = rest.filter((argument) => /^--expect-customers=\d{1,9}$/.test(argument));
      if (extra.length !== rest.length || extra.length > 1) {
        throw new ProductionCommandError(USAGE);
      }
      return {
        command: options.nodePath ?? process.execPath,
        args: [
          "--import",
          "tsx",
          options.verifyScript ?? resolve("scripts/database-migration-verify.ts"),
          "--target=production",
          `--phase=${action === "verify-pre" ? "pre" : "post"}`,
          ...extra,
        ],
        description: `read-only verification (${action})`,
      };
    }
    case "deploy": {
      if (rest.length !== 1 || rest[0] !== `--confirm-endpoint=${configuration.endpointId}`) {
        throw new ProductionCommandError(
          "deploy requires exactly --confirm-endpoint=<verified endpoint ID>, matching the approved production target.",
        );
      }
      return { ...prisma(["migrate", "deploy"]), description: "prisma migrate deploy" };
    }
  }
}

export type MainSchemaFile = {
  path: string;
  commit: string;
  cleanup(): void;
};

// Writes the origin/main schema to a fresh temporary directory outside the
// repository, without touching the working tree. Callers must call cleanup().
export function prepareMainSchemaFile(
  run: (args: readonly string[]) => string = (args) =>
    execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
): MainSchemaFile {
  const commit = run(["rev-parse", "--verify", "origin/main^{commit}"]).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new ProductionCommandError("Could not resolve origin/main to a commit.");
  }
  const schema = run(["show", `${commit}:prisma/schema.prisma`]);
  const directory = mkdtempSync(join(tmpdir(), "pulsemarket-main-schema-"));
  const path = join(directory, "schema.prisma");
  try {
    writeFileSync(path, schema, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    commit,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export type ProductionWrapperDependencies = {
  argv: readonly string[];
  environment: NodeJS.ProcessEnv;
  loadConfiguration(): ProductionConfiguration;
  prepareMainSchema?: () => MainSchemaFile;
  spawn(
    command: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<number>;
  log(message: string): void;
  error(message: string): void;
  nodePath?: string;
  verifyScript?: string;
};

// Refuses CI and Vercel so production credentials are never used by builds,
// Preview deployments, or pipelines.
function assertOperatorWorkstation(environment: NodeJS.ProcessEnv): void {
  const automated = ["CI", "VERCEL", "VERCEL_ENV", "GITHUB_ACTIONS"].filter(
    (key) => environment[key] !== undefined && environment[key] !== "",
  );
  if (automated.length > 0) {
    throw new ProductionCommandError(
      `Production database tooling runs only from an operator workstation (found ${automated.join(", ")}).`,
    );
  }
}

export async function runProductionWrapper(
  dependencies: ProductionWrapperDependencies,
): Promise<number> {
  let configuration: ProductionConfiguration | undefined;
  let mainSchema: MainSchemaFile | undefined;
  try {
    assertOperatorWorkstation(dependencies.environment);
    configuration = dependencies.loadConfiguration();
    if (dependencies.argv[0] === "diff-main" && dependencies.argv.length === 1) {
      mainSchema = (dependencies.prepareMainSchema ?? prepareMainSchemaFile)();
      dependencies.log(`Comparing with the schema of origin/main at ${mainSchema.commit}.`);
    }
    const invocation = resolveProductionAction(dependencies.argv, configuration, {
      nodePath: dependencies.nodePath,
      verifyScript: dependencies.verifyScript,
      mainSchemaPath: mainSchema?.path,
    });
    dependencies.log(
      `Production target verified: endpoint ${configuration.endpointId}, database ${configuration.target.database}, role ${configuration.target.role}.`,
    );
    if (!invocation) return 0;
    dependencies.log(`Running ${invocation.description}.`);
    return await dependencies.spawn(
      invocation.command,
      invocation.args,
      createProductionChildEnvironment(configuration, dependencies.environment),
    );
  } catch (error: unknown) {
    const message =
      error instanceof ProductionConfigurationError ||
      error instanceof ProductionCommandError
        ? error.message
        : "Production tooling failed. Details were suppressed.";
    dependencies.error(redactSecrets(message, configuration));
    return 1;
  } finally {
    mainSchema?.cleanup();
  }
}
