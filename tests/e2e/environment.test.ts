import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  createE2eChildEnvironment,
  E2eConfigurationError,
  validateE2eConfiguration,
} from "../../lib/e2e-environment";
import { resolveE2eCommandInvocation } from "../../lib/e2e-command";
import {
  E2E_AUTH_PROVIDER_ID,
  getE2eAuthConfiguration,
} from "../../lib/e2e-auth-config";
import { getLoginProviderConfiguration } from "../../lib/auth-provider-config";
import {
  isAuthorizedProviderIdentity,
} from "../../lib/auth-authorization";
import {
  isListedProviderIdentity,
  isProxyProviderIdentityAllowed,
  parseAuthorizedAccounts,
} from "../../lib/authorized-accounts";

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
  assert.ok(invocation.args[0]);
  assert.equal(existsSync(invocation.args[0]), true);
  assert.deepEqual(
    invocation.args[0].split(/[\\/]/).slice(-3),
    ["prisma", "build", "index.js"],
  );
  assert.deepEqual(invocation.args.slice(1), args.slice(1));
});

test("resolves Linux npx Prisma to its installed Node entry point without changing arguments", () => {
  const args = [
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    "schemas/e2e schema.prisma",
    "--message",
    "safe ; & $(not-executed)",
  ];
  const invocation = resolveE2eCommandInvocation("npx", args, {
    platform: "linux",
    nodePath: "/usr/bin/node",
  });

  assert.equal(invocation.command, "/usr/bin/node");
  assert.ok(invocation.args[0]);
  assert.equal(existsSync(invocation.args[0]), true);
  assert.deepEqual(
    invocation.args[0].split(/[\\/]/).slice(-3),
    ["prisma", "build", "index.js"],
  );
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

test("shows both normal providers when configured", () => {
  const configuration = getLoginProviderConfiguration({
    GITHUB_ID: "github-id",
    GITHUB_SECRET: "github-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    NEXTAUTH_SECRET: "session-secret",
    NEXTAUTH_URL: "https://pulsemarket.example",
  });
  assert.deepEqual(
    configuration.providers.map(({ id }) => id),
    ["github", "google"],
  );
  assert.equal(configuration.error, null);
});

test("reports incomplete OAuth configuration without rendering a provider", () => {
  const configuration = getLoginProviderConfiguration({
    GITHUB_ID: "github-id",
    NEXTAUTH_SECRET: "session-secret",
    NEXTAUTH_URL: "https://pulsemarket.example",
  });
  assert.deepEqual(configuration.providers, []);
  assert.match(configuration.error ?? "", /GITHUB_ID, GITHUB_SECRET/);
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

test("rejects the simulated Google denial provider in production", () => {
  assert.throws(
    () =>
      getE2eAuthConfiguration({
        NODE_ENV: "production",
        PULSEMARKET_E2E_GOOGLE_DENIAL: "true",
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
  const environment = validE2eAuthEnvironment();
  const configuration = getE2eAuthConfiguration(environment);
  assert.ok(configuration);
  assert.equal(
    getLoginProviderConfiguration(environment).providers[0]?.id,
    E2E_AUTH_PROVIDER_ID,
  );
  assert.equal(
    isAuthorizedProviderIdentity(
      {
        provider: E2E_AUTH_PROVIDER_ID,
        providerAccountId: environment.PULSEMARKET_E2E_RUN_ID,
        e2eRunId: environment.PULSEMARKET_E2E_RUN_ID,
      },
      environment,
    ),
    true,
  );
  assert.equal(
    isAuthorizedProviderIdentity(
      {
        provider: E2E_AUTH_PROVIDER_ID,
        providerAccountId: "other-run",
        e2eRunId: environment.PULSEMARKET_E2E_RUN_ID,
      },
      environment,
    ),
    false,
  );
});

test("exposes the simulated Google denial option only in the isolated E2E configuration", () => {
  const environment = {
    ...validE2eAuthEnvironment(),
    PULSEMARKET_E2E_GOOGLE_DENIAL: "true",
  };
  const configuration = getE2eAuthConfiguration(environment);
  assert.equal(configuration?.googleDenial, true);
  assert.deepEqual(
    getLoginProviderConfiguration(environment).providers.map(({ id }) => id),
    [E2E_AUTH_PROVIDER_ID, "google"],
  );
});

test("rejects malformed simulated Google denial activation", () => {
  const environment = {
    ...validE2eAuthEnvironment(),
    PULSEMARKET_E2E_GOOGLE_DENIAL: "yes",
  };
  assert.throws(
    () => getE2eAuthConfiguration(environment),
    /local E2E OAuth configuration is incomplete/,
  );
});

test("lists no normal provider for an incomplete local OAuth activation", () => {
  const configuration = getLoginProviderConfiguration({
    NODE_ENV: "development",
    PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
  });
  assert.deepEqual(configuration.providers, []);
  assert.equal(configuration.error, "La configuración de autenticación no está completa.");
});

test("authorizes only exact provider and provider account ID pairs", () => {
  const authorized = JSON.stringify([
    { provider: "github", providerAccountId: "12345" },
  ]);
  assert.equal(isListedProviderIdentity("github", "12345", authorized), true);
  assert.equal(isListedProviderIdentity("google", "12345", authorized), false);
  assert.equal(isListedProviderIdentity("github", "other", authorized), false);
  assert.equal(isListedProviderIdentity("github", undefined, authorized), false);
});

test("closes access for missing, empty, malformed, duplicate, or invalid account lists", () => {
  assert.equal(parseAuthorizedAccounts(undefined), null);
  assert.deepEqual(parseAuthorizedAccounts("[]"), []);
  assert.equal(parseAuthorizedAccounts("not-json"), null);
  assert.equal(
    parseAuthorizedAccounts(
      JSON.stringify([
        { provider: "github", providerAccountId: "1" },
        { provider: "github", providerAccountId: "1" },
      ]),
    ),
    null,
  );
  assert.equal(
    parseAuthorizedAccounts(
      JSON.stringify([{ provider: "github", providerAccountId: " 1 " }]),
    ),
    null,
  );
  assert.equal(
    isListedProviderIdentity("github", "1", "[]"),
    false,
  );
});

test("proxy accepts only an exact allowlisted account and rejects stale E2E identities", () => {
  const environment = {
    NODE_ENV: "development",
    PULSEMARKET_AUTHORIZED_ACCOUNTS: JSON.stringify([
      { provider: "google", providerAccountId: "stable-sub" },
    ]),
    PULSEMARKET_E2E_RUN_ID: "r".repeat(43),
  };
  assert.equal(
    isProxyProviderIdentityAllowed(
      "google",
      "stable-sub",
      undefined,
      environment,
    ),
    true,
  );
  assert.equal(
    isProxyProviderIdentityAllowed(
      "local-oauth",
      "r".repeat(43),
      "different-run",
      environment,
    ),
    false,
  );
  assert.equal(
    isProxyProviderIdentityAllowed(
      "local-oauth",
      "r".repeat(43),
      "r".repeat(43),
      { ...environment, NODE_ENV: "production" },
    ),
    false,
  );
});
