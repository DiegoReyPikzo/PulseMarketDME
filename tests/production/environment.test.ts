import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { devNull, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { test } from "vitest";

import {
  prepareMainSchemaFile,
  resolveProductionAction,
  runProductionWrapper,
} from "../../lib/production-command";
import {
  createProductionChildEnvironment,
  redactSecrets,
  validateProductionConfiguration,
  type ProductionConfiguration,
} from "../../lib/production-environment";

// Fictitious values only: no real host, role, or password.
const PASSWORD = "Fake-Pr0d-Secret";
const DIRECT_HOST = "ep-fake-prod-123456.c-1.us-east-2.aws.neon.tech";
const POOLED_HOST = "ep-fake-prod-123456-pooler.c-1.us-east-2.aws.neon.tech";
const E2E_DIRECT_HOST = "ep-fake-e2e-654321.c-1.us-east-2.aws.neon.tech";

function url(host: string, overrides: { role?: string; database?: string; query?: string } = {}) {
  return `postgresql://${overrides.role ?? "neondb_owner"}:${PASSWORD}@${host}/${
    overrides.database ?? "neondb"
  }${overrides.query ?? "?sslmode=require&channel_binding=require"}`;
}

const connections = {
  PROD_DATABASE_URL: url(POOLED_HOST),
  PROD_DIRECT_URL: url(DIRECT_HOST),
};
const target = {
  PROD_ALLOWED_DIRECT_HOST: DIRECT_HOST,
  PROD_ALLOWED_POOLED_HOST: POOLED_HOST,
  PROD_ALLOWED_DATABASE: "neondb",
  PROD_ALLOWED_ROLE: "neondb_owner",
};
const e2eTarget = {
  E2E_ALLOWED_DIRECT_HOST: E2E_DIRECT_HOST,
  E2E_ALLOWED_POOLED_HOST: E2E_DIRECT_HOST.replace("-654321", "-654321-pooler"),
};

function valid(): ProductionConfiguration {
  return validateProductionConfiguration(connections, target, e2eTarget);
}

function rejectionMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("Expected the configuration to be rejected.");
}

test("accepts a production configuration that matches the independent target", () => {
  const configuration = valid();
  assert.equal(configuration.endpointId, "ep-fake-prod-123456");
  assert.equal(configuration.direct.host, DIRECT_HOST);
  assert.equal(configuration.target.database, "neondb");
});

test("rejects wrong hosts, database, role, and connection parameters without echoing secrets", () => {
  const cases: [string, () => unknown][] = [
    ["direct host", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(E2E_DIRECT_HOST) }, target)],
    ["pooled host", () => validateProductionConfiguration({ ...connections, PROD_DATABASE_URL: url(DIRECT_HOST) }, target)],
    ["database", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(DIRECT_HOST, { database: "otherdb" }) }, target)],
    ["role", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(DIRECT_HOST, { role: "intruder" }) }, target)],
    ["target role", () => validateProductionConfiguration(connections, { ...target, PROD_ALLOWED_ROLE: "readonly" })],
    ["non-Neon host", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url("db.example.com") }, { ...target, PROD_ALLOWED_DIRECT_HOST: "db.example.com" })],
    ["swapped direct/pooler", () => validateProductionConfiguration(connections, { ...target, PROD_ALLOWED_DIRECT_HOST: POOLED_HOST, PROD_ALLOWED_POOLED_HOST: DIRECT_HOST })],
    ["different endpoints", () => validateProductionConfiguration(connections, { ...target, PROD_ALLOWED_POOLED_HOST: "ep-other-1-pooler.c-1.us-east-2.aws.neon.tech" })],
    ["host override parameter", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(DIRECT_HOST, { query: "?sslmode=require&host=evil.example.com" }) }, target)],
    ["options parameter", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(DIRECT_HOST, { query: "?options=-c%20lock_timeout%3D5s" }) }, target)],
    ["non-default port", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: url(`${DIRECT_HOST}:6543`) }, target)],
    ["missing values", () => validateProductionConfiguration({ PROD_DATABASE_URL: connections.PROD_DATABASE_URL }, target)],
    ["same endpoint as E2E", () => validateProductionConfiguration(connections, target, { E2E_ALLOWED_DIRECT_HOST: DIRECT_HOST })],
    ["malformed URL", () => validateProductionConfiguration({ ...connections, PROD_DIRECT_URL: `not a url ${PASSWORD}` }, target)],
  ];
  for (const [label, run] of cases) {
    const message = rejectionMessage(run);
    assert.ok(!message.includes(PASSWORD), `${label} leaked the password`);
    assert.ok(!message.includes("postgresql://"), `${label} leaked a connection string`);
  }
});

test("builds the child environment from the verified target only", () => {
  const inherited: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    PATH: "/usr/bin",
    DATABASE_URL: "postgresql://dev:dev-pass@dev.example/devdb",
    DIRECT_URL: "postgresql://dev:dev-pass@dev.example/devdb",
    SHADOW_DATABASE_URL: "postgresql://shadow",
    E2E_DATABASE_URL: "postgresql://e2e",
    E2E_ALLOWED_DATABASE: "neondb",
    PULSEMARKET_E2E_RUN_ID: "run",
    PROD_DIRECT_URL: url(DIRECT_HOST),
    DOTENV_OVERRIDE: "true",
    DOTENV_CONFIG_PATH: ".env",
    PGHOST: "pg.example",
    PGPASSWORD: "pg-pass",
    PGOPTIONS: "-c search_path=evil",
  };
  const child = createProductionChildEnvironment(valid(), inherited);

  assert.equal(child.PATH, "/usr/bin");
  assert.equal(child.NODE_ENV, "development");
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = new URL(child[key] ?? "");
    assert.equal(value.password, PASSWORD);
    assert.equal(value.searchParams.get("sslmode"), "verify-full");
  }
  assert.equal(new URL(child.DIRECT_URL ?? "").hostname, DIRECT_HOST);
  assert.equal(new URL(child.DATABASE_URL ?? "").hostname, POOLED_HOST);
  assert.equal(child.DOTENV_PATH, devNull);
  assert.equal(child.PULSEMARKET_DB_TARGET_KIND, "production");
  assert.equal(child.PULSEMARKET_DB_TARGET_ENDPOINT, "ep-fake-prod-123456");
  for (const key of [
    "SHADOW_DATABASE_URL",
    "E2E_DATABASE_URL",
    "E2E_ALLOWED_DATABASE",
    "PULSEMARKET_E2E_RUN_ID",
    "PROD_DIRECT_URL",
    "DOTENV_OVERRIDE",
    "DOTENV_CONFIG_PATH",
    "PGHOST",
    "PGPASSWORD",
    "PGOPTIONS",
  ]) {
    assert.equal(child[key], undefined, key);
  }
});

test("prevents dotenv from loading .env in the child even with inherited overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "prod-dotenv-"));
  try {
    writeFileSync(
      join(directory, ".env"),
      "FAKE_DOTENV_KEY=loaded\nDATABASE_URL=postgresql://dev:dev-pass@dev.example/devdb\nDIRECT_URL=postgresql://dev:dev-pass@dev.example/devdb\n",
    );
    const dotenvConfig = createRequire(`${process.cwd()}/package.json`).resolve("dotenv/config");
    const probe = `require(${JSON.stringify(dotenvConfig)});
      process.stdout.write(JSON.stringify({
        fake: process.env.FAKE_DOTENV_KEY ?? null,
        databaseHost: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : null,
        directHost: process.env.DIRECT_URL ? new URL(process.env.DIRECT_URL).hostname : null,
      }));`;
    const run = (environment: NodeJS.ProcessEnv) =>
      JSON.parse(
        spawnSync(process.execPath, ["-e", probe], {
          cwd: directory,
          env: environment,
          encoding: "utf8",
        }).stdout,
      );

    const controlled = run(
      createProductionChildEnvironment(valid(), {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        DOTENV_OVERRIDE: "true",
      }),
    );
    assert.deepEqual(controlled, {
      fake: null,
      databaseHost: POOLED_HOST,
      directHost: DIRECT_HOST,
    });

    // Control: without the wrapper's environment, dotenv does load .env.
    const uncontrolled = run({
      NODE_ENV: "test",
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    });
    assert.equal(uncontrolled.fake, "loaded");
    assert.equal(uncontrolled.directHost, "dev.example");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolves only the allowed production actions with fixed arguments", () => {
  const configuration = valid();
  const options = { nodePath: "node", verifyScript: "verify.ts" };
  assert.equal(resolveProductionAction(["check-target"], configuration, options), null);

  const status = resolveProductionAction(["status"], configuration, options);
  assert.deepEqual(status?.args.slice(1), ["migrate", "status"]);
  const diff = resolveProductionAction(["diff"], configuration, options);
  assert.deepEqual(diff?.args.slice(1), [
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--exit-code",
  ]);
  const verify = resolveProductionAction(
    ["verify-post", "--expect-customers=500"],
    configuration,
    options,
  );
  assert.deepEqual(verify, {
    command: "node",
    args: [
      "--import",
      "tsx",
      "verify.ts",
      "--target=production",
      "--phase=post",
      "--expect-customers=500",
    ],
    description: "read-only verification (verify-post)",
  });
  const deploy = resolveProductionAction(
    ["deploy", "--confirm-endpoint=ep-fake-prod-123456"],
    configuration,
    options,
  );
  assert.deepEqual(deploy?.args.slice(1), ["migrate", "deploy"]);
});

test("rejects unknown actions, recovery commands, extra arguments, and unconfirmed deploys", () => {
  const configuration = valid();
  for (const argv of [
    [],
    ["reset"],
    ["resolve"],
    ["migrate", "resolve", "--rolled-back", "x"],
    ["dev"],
    ["db", "push"],
    ["execute"],
    ["seed"],
    ["status", "--schema=other.prisma"],
    ["diff", "--script"],
    ["verify-pre", "--target=e2e"],
    ["verify-post", "--expect-customers=500", "--expect-customers=1"],
    ["deploy"],
    ["deploy", "--confirm-endpoint=ep-wrong"],
    ["deploy", "--confirm-endpoint=ep-fake-prod-123456", "--force"],
  ]) {
    assert.throws(() => resolveProductionAction(argv, configuration), Error, argv.join(" "));
  }
});

function fakeDependencies(overrides: Partial<Parameters<typeof runProductionWrapper>[0]> = {}) {
  const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const dependencies: Parameters<typeof runProductionWrapper>[0] = {
    argv: ["status"],
    environment: {
      NODE_ENV: "test",
      PATH: "/usr/bin",
      DATABASE_URL: "postgresql://dev:dev-pass@dev.example/devdb",
      E2E_DIRECT_URL: "postgresql://e2e",
    },
    loadConfiguration: valid,
    spawn: async (command, args, env) => {
      calls.push({ command, args, env });
      return 0;
    },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    nodePath: "node",
    ...overrides,
  };
  return { dependencies, calls, logs, errors };
}

test("runs an allowed command with the verified environment through a simulated spawn", async () => {
  const { dependencies, calls, logs } = fakeDependencies();
  assert.equal(await runProductionWrapper(dependencies), 0);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].env.DIRECT_URL ?? "").hostname, DIRECT_HOST);
  assert.equal(calls[0].env.E2E_DIRECT_URL, undefined);
  assert.ok(!logs.join("\n").includes(PASSWORD));
  assert.ok(logs[0].includes("endpoint ep-fake-prod-123456"));
});

test("refuses CI and Vercel environments and never spawns there", async () => {
  for (const key of ["CI", "VERCEL", "VERCEL_ENV", "GITHUB_ACTIONS"]) {
    const { dependencies, calls, errors } = fakeDependencies({
      environment: { NODE_ENV: "test", [key]: "1" },
    });
    assert.equal(await runProductionWrapper(dependencies), 1);
    assert.equal(calls.length, 0);
    assert.match(errors[0], /operator workstation/);
  }
});

test("rejects invalid configuration and commands without spawning or leaking secrets", async () => {
  const badConfig = fakeDependencies({
    loadConfiguration: () =>
      validateProductionConfiguration(
        { ...connections, PROD_DIRECT_URL: url(E2E_DIRECT_HOST) },
        target,
      ),
  });
  assert.equal(await runProductionWrapper(badConfig.dependencies), 1);
  assert.equal(badConfig.calls.length, 0);

  const badCommand = fakeDependencies({ argv: ["resolve", "--rolled-back", "x"] });
  assert.equal(await runProductionWrapper(badCommand.dependencies), 1);
  assert.equal(badCommand.calls.length, 0);

  const leakingSpawn = fakeDependencies({
    spawn: async () => {
      throw new Error(`connect failed for ${url(DIRECT_HOST)}`);
    },
  });
  assert.equal(await runProductionWrapper(leakingSpawn.dependencies), 1);
  const printed = [...badConfig.errors, ...badCommand.errors, ...leakingSpawn.errors].join("\n");
  assert.ok(!printed.includes(PASSWORD));
  assert.ok(!printed.includes("postgresql://"));
});

test("redacts connection strings and passwords from text", () => {
  const configuration = valid();
  const text = `a ${url(DIRECT_HOST)} b ${PASSWORD} c`;
  const redacted = redactSecrets(text, configuration);
  assert.ok(!redacted.includes(PASSWORD));
  assert.ok(redacted.includes("[redacted]"));
});

test("diff-main resolves only with a prepared schema path and no extra arguments", () => {
  const configuration = valid();
  const invocation = resolveProductionAction(["diff-main"], configuration, {
    nodePath: "node",
    mainSchemaPath: "/tmp/main/schema.prisma",
  });
  assert.deepEqual(invocation?.args.slice(1), [
    "migrate",
    "diff",
    "--from-config-datasource",
    "--to-schema",
    "/tmp/main/schema.prisma",
    "--exit-code",
  ]);
  assert.throws(() => resolveProductionAction(["diff-main"], configuration), Error);
  assert.throws(
    () =>
      resolveProductionAction(["diff-main", "--script"], configuration, {
        mainSchemaPath: "/tmp/main/schema.prisma",
      }),
    Error,
  );
});

test("the wrapper logs the origin/main commit, uses the temporary schema, and always cleans it up", async () => {
  const commit = "a".repeat(40);
  let cleanups = 0;
  const prepareMainSchema = () => ({
    path: "/tmp/pulsemarket-main-schema-x/schema.prisma",
    commit,
    cleanup: () => {
      cleanups += 1;
    },
  });

  const ok = fakeDependencies({ argv: ["diff-main"], prepareMainSchema });
  assert.equal(await runProductionWrapper(ok.dependencies), 0);
  assert.ok(ok.logs.some((line) => line.includes(commit)));
  assert.ok(ok.calls[0].args.includes("/tmp/pulsemarket-main-schema-x/schema.prisma"));
  assert.equal(cleanups, 1);

  const failing = fakeDependencies({
    argv: ["diff-main"],
    prepareMainSchema,
    spawn: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(await runProductionWrapper(failing.dependencies), 1);
  assert.equal(cleanups, 2);

  const rejected = fakeDependencies({ argv: ["diff-main", "--script"], prepareMainSchema });
  assert.equal(await runProductionWrapper(rejected.dependencies), 1);
  assert.equal(rejected.calls.length, 0);
  assert.equal(cleanups, 2);

  let prepared = 0;
  const status = fakeDependencies({
    argv: ["status"],
    prepareMainSchema: () => {
      prepared += 1;
      return prepareMainSchema();
    },
  });
  assert.equal(await runProductionWrapper(status.dependencies), 0);
  assert.equal(prepared, 0);
});

test("prepareMainSchemaFile writes the origin/main schema outside the repository and removes it", () => {
  // CI checkouts are shallow and may lack origin/main, so the ref lookup is
  // answered with HEAD while `git show` still runs for real.
  const gitCalls: string[][] = [];
  const file = prepareMainSchemaFile((args) => {
    gitCalls.push([...args]);
    return args[0] === "rev-parse"
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
      : execFileSync("git", [...args], { encoding: "utf8" });
  });
  assert.deepEqual(gitCalls[0], ["rev-parse", "--verify", "origin/main^{commit}"]);
  try {
    assert.match(file.commit, /^[0-9a-f]{40}$/);
    assert.ok(existsSync(file.path));
    // On Windows the temp directory can be on another drive, where relative()
    // returns an absolute path instead of one starting with "..".
    const fromRepository = relative(resolve("."), file.path);
    assert.ok(
      fromRepository.startsWith("..") || isAbsolute(fromRepository),
      "temporary file must be outside the repository",
    );
    // The file must be exactly the schema at the printed origin/main commit.
    const schema = readFileSync(file.path, "utf8");
    assert.equal(
      schema,
      execFileSync("git", ["show", `${file.commit}:prisma/schema.prisma`], {
        encoding: "utf8",
      }),
    );
    assert.match(schema, /model Customer \{/);
  } finally {
    file.cleanup();
  }
  assert.equal(existsSync(file.path), false);

  assert.throws(() => prepareMainSchemaFile(() => "not-a-commit\n"), /origin\/main/);
});
