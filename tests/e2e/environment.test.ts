import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createE2eChildEnvironment,
  E2eConfigurationError,
  validateE2eConfiguration,
} from "../../lib/e2e-environment";
import { resolveE2eCommandInvocation } from "../../lib/e2e-command";
import {
  E2E_AUTH_PROVIDER_ID,
  getAuthProviderSelection,
  getE2eAuthConfiguration,
} from "../../lib/e2e-auth-config";

const e2eConnections = {
  E2E_DATABASE_URL:
    "postgresql://e2e_role:secret@ep-example-pooler.us-east-2.aws.neon.tech/e2e_db?sslmode=require",
  E2E_DIRECT_URL:
    "postgresql://e2e_role:secret@ep-example.us-east-2.aws.neon.tech/e2e_db?sslmode=require",
};

const approvedTarget = {
  E2E_ALLOWED_DIRECT_HOST: "ep-example.us-east-2.aws.neon.tech",
  E2E_ALLOWED_POOLED_HOST: "ep-example-pooler.us-east-2.aws.neon.tech",
  E2E_ALLOWED_DATABASE: "e2e_db",
  E2E_ALLOWED_ROLE: "e2e_role",
};

function assertConfigurationError(
  run: () => unknown,
  message: RegExp,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof E2eConfigurationError);
    assert.match(error.message, message);
    assert.doesNotMatch(error.message, /secret|ep-example|postgresql:\/\//i);
    return true;
  });
}

test("requires both E2E connections without using inherited development URLs", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        {
          DATABASE_URL: "postgresql://dev:secret@dev.neon.tech/dev",
          DIRECT_URL: "postgresql://dev:secret@dev.neon.tech/dev",
        },
        approvedTarget,
      ),
    /E2E_DATABASE_URL, E2E_DIRECT_URL/,
  );
});

test("rejects an invalid E2E URL without exposing its contents", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        { ...e2eConnections, E2E_DIRECT_URL: "not a URL secret" },
        approvedTarget,
      ),
    /E2E_DIRECT_URL is not a valid PostgreSQL URL/,
  );
});

test("requires a separately approved destination", () => {
  assertConfigurationError(
    () => validateE2eConfiguration(e2eConnections, {}),
    /E2E_ALLOWED_DIRECT_HOST/,
  );
});

test("rejects a destination not present in the approved host list", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(e2eConnections, {
        ...approvedTarget,
        E2E_ALLOWED_DIRECT_HOST: "other-endpoint.us-east-2.aws.neon.tech",
      }),
    /do not match the independently approved destination/,
  );
});

test("rejects pooled/direct host mismatch", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        {
          ...e2eConnections,
          E2E_DATABASE_URL:
            "postgresql://e2e_role:secret@ep-other-pooler.us-east-2.aws.neon.tech/e2e_db",
        },
        approvedTarget,
      ),
    /do not match the independently approved destination/,
  );
});

test("rejects a pooled host for a different Neon endpoint", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        {
          ...e2eConnections,
          E2E_DATABASE_URL:
            "postgresql://e2e_role:secret@ep-other-pooler.us-east-2.aws.neon.tech/e2e_db",
        },
        {
          ...approvedTarget,
          E2E_ALLOWED_POOLED_HOST:
            "ep-other-pooler.us-east-2.aws.neon.tech",
        },
      ),
    /do not identify the same Neon endpoint/,
  );
});

test("rejects a database mismatch", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        {
          ...e2eConnections,
          E2E_DIRECT_URL:
            "postgresql://e2e_role:secret@ep-example.us-east-2.aws.neon.tech/other_db",
        },
        approvedTarget,
      ),
    /database does not match/,
  );
});

test("rejects a role mismatch", () => {
  assertConfigurationError(
    () =>
      validateE2eConfiguration(
        {
          ...e2eConnections,
          E2E_DATABASE_URL:
            "postgresql://other_role:secret@ep-example-pooler.us-east-2.aws.neon.tech/e2e_db",
        },
        approvedTarget,
      ),
    /role does not match/,
  );
});

test("isolates child connection variables and removes URL TLS overrides", () => {
  const configuration = validateE2eConfiguration(
    e2eConnections,
    approvedTarget,
  );
  const childEnvironment = createE2eChildEnvironment(configuration, {
    DATABASE_URL: "postgresql://development",
    DIRECT_URL: "postgresql://development",
    NODE_ENV: "test",
  });
  const pooledUrl = new URL(childEnvironment.DATABASE_URL!);
  const directUrl = new URL(childEnvironment.DIRECT_URL!);

  assert.equal(pooledUrl.hostname, approvedTarget.E2E_ALLOWED_POOLED_HOST);
  assert.equal(directUrl.hostname, approvedTarget.E2E_ALLOWED_DIRECT_HOST);
  assert.equal(pooledUrl.searchParams.get("sslmode"), "verify-full");
  assert.equal(directUrl.searchParams.get("sslmode"), "verify-full");
  assert.equal(childEnvironment.NODE_ENV, "test");
});

test("resolves Windows npx Prisma to its installed Node entry point without changing arguments", () => {
  const args = [
    "prisma",
    "migrate",
    "status",
    "--schema",
    "schemas/e2e schema.prisma",
    "--message",
    "safe ; & $(not-executed)",
  ];
  const invocation = resolveE2eCommandInvocation("npx.cmd", args, {
    platform: "win32",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
  });

  assert.equal(invocation.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.ok(invocation.args[0]?.endsWith("\\prisma\\build\\index.js"));
  assert.deepEqual(invocation.args.slice(1), args.slice(1));
});

test("resolves Windows npm.cmd via npm's Node entry point and preserves arguments", () => {
  const args = ["run", "script with spaces", "--", "value; & safely"];
  const npmExecPath =
    "D:\\node modules\\npm\\bin\\npm-cli.js";
  const invocation = resolveE2eCommandInvocation("npm.cmd", args, {
    platform: "win32",
    npmExecPath,
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
  });

  assert.equal(invocation.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation.args, [npmExecPath, ...args]);
});

test("rejects arbitrary Windows command scripts instead of shell-interpolating arguments", () => {
  assert.throws(
    () =>
      resolveE2eCommandInvocation(
        "unsafe.cmd",
        ["argument with spaces", "& harmless-string"],
        { platform: "win32" },
      ),
    /Windows \.cmd tools must be invoked through npm\.cmd or npx\.cmd/,
  );
});

function validE2eAuthEnvironment(): Record<string, string> {
  validateE2eConfiguration(e2eConnections, approvedTarget);
  return {
    ...e2eConnections,
    ...approvedTarget,
    DATABASE_URL: `postgresql://e2e_role:secret@ep-example-pooler.us-east-2.aws.neon.tech/e2e_db?sslmode=verify-full`,
    DIRECT_URL: `postgresql://e2e_role:secret@ep-example.us-east-2.aws.neon.tech/e2e_db?sslmode=verify-full`,
    NODE_ENV: "development",
    NEXTAUTH_URL: "http://127.0.0.1:4317",
    NEXTAUTH_SECRET: "n".repeat(43),
    PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
    E2E_AUTH_PROVIDER_ORIGIN: "http://127.0.0.1:4320",
    E2E_AUTH_CLIENT_ID: "i".repeat(43),
    E2E_AUTH_CLIENT_SECRET: "s".repeat(43),
  };
}

test("uses only GitHub during normal startup", () => {
  assert.deepEqual(getAuthProviderSelection({}), {
    id: "github",
    label: "Continuar con GitHub",
    description: "Inicia sesión con tu cuenta de GitHub.",
  });
});

test("rejects an E2E activation flag without validated target and ephemeral credentials", () => {
  assert.throws(
    () =>
      getE2eAuthConfiguration({
        PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
      }),
    /local E2E OAuth configuration is incomplete/,
  );
});

test("rejects any E2E provider activation in production", () => {
  assert.throws(
    () =>
      getE2eAuthConfiguration({
        NODE_ENV: "production",
        PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
      }),
    /forbidden in production/,
  );
});

test("rejects an E2E provider if the runtime database differs from the approved E2E target", () => {
  const environment = validE2eAuthEnvironment();
  environment.DATABASE_URL = "postgresql://development";
  assert.throws(
    () => getE2eAuthConfiguration(environment),
    /requires isolated E2E database connections/,
  );
});

test("rejects E2E provider URLs that are not loopback HTTP", () => {
  const environment = validE2eAuthEnvironment();
  environment.E2E_AUTH_PROVIDER_ORIGIN = "https://provider.example.test:4320";
  assert.throws(
    () => getE2eAuthConfiguration(environment),
    /must use HTTP loopback URLs/,
  );
});

test("enables the local OAuth provider only with validated target and ephemeral secrets", () => {
  const configuration = getE2eAuthConfiguration(validE2eAuthEnvironment());
  assert.ok(configuration);
  assert.equal(
    getAuthProviderSelection(validE2eAuthEnvironment()).id,
    E2E_AUTH_PROVIDER_ID,
  );
});
