import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";

import {
  createE2eChildEnvironment,
  loadE2eConfiguration,
} from "../lib/e2e-environment";
import { resolveE2eCommandInvocation } from "../lib/e2e-command";
import { startE2eOAuthProvider } from "./e2e-oauth-provider";

const APP_HOST = "127.0.0.1";
const APP_PORT = "4317";
const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;

let activeChild: ChildProcess | undefined;
let receivedSignal: NodeJS.Signals | undefined;

function handleSignal(signal: NodeJS.Signals): void {
  receivedSignal = signal;
  activeChild?.kill(signal);
}

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

function spawnChild(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  sanitizeOutput = false,
  redactionEnvironment = environment,
): ChildProcess {
  const child = spawn(command, [...args], {
    cwd: process.cwd(),
    env: environment,
    stdio: sanitizeOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  if (sanitizeOutput) {
    const redact = (text: string) => {
      let sanitized = text
        .replace(
          /(https?:\/\/127\.0\.0\.1:\d+\/authorize)\?[^\s"'<>]*/gi,
          "$1?[REDACTED]",
        )
        .replace(
          /([?&](?:state|code|access_token|refresh_token|id_token|client_secret|client_id|code_verifier)=)[^&\s"'<>]*/gi,
          "$1[REDACTED]",
        )
        .replace(/((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]");
      for (const [key, value] of Object.entries(redactionEnvironment)) {
        if (
          value &&
          /(?:DATABASE_URL|DIRECT_URL|SECRET|TOKEN|RUN_ID)$/.test(key)
        ) {
          sanitized = sanitized.replaceAll(value, "[REDACTED]");
        }
      }
      return sanitized;
    };
    pipeSanitizedOutput(child.stdout, process.stdout, redact);
    pipeSanitizedOutput(child.stderr, process.stderr, redact);
  }
  activeChild = child;
  return child;
}

function pipeSanitizedOutput(
  source: Readable | null,
  destination: NodeJS.WriteStream,
  redact: (value: string) => string,
): void {
  if (!source) return;
  source.setEncoding("utf8");
  let buffered = "";
  source.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split(/(?<=\n)/);
    buffered = lines.pop() ?? "";
    for (const line of lines) destination.write(redact(line));
  });
  source.on("end", () => {
    if (buffered) destination.write(redact(buffered));
  });
}

function runChild(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  sanitizeOutput = false,
  redactionEnvironment = environment,
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawnChild(
      command,
      args,
      environment,
      sanitizeOutput,
      redactionEnvironment,
    );
    child.once("error", () => {
      if (activeChild === child) activeChild = undefined;
      reject(new Error("Could not start an E2E child process."));
    });
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      resolveCode(signal ? 1 : (code ?? 1));
    });
  });
}

async function waitForApp(
  child: ChildProcess,
  url: string,
  runId: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("The dedicated E2E Next.js server exited during startup.");
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_000),
        redirect: "manual",
      });
      if (response.status >= 200 && response.status < 500) {
        if (response.headers.get("x-pulsemarket-e2e-run") !== runId) {
          throw new Error(
            "The configured E2E port is serving an unrelated application.",
          );
        }
        return;
      }
    } catch (error: unknown) {
      if (receivedSignal) throw new Error("E2E server startup was interrupted.");
      if (
        error instanceof Error &&
        error.message.startsWith("The configured E2E port")
      ) {
        throw error;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("The dedicated E2E Next.js server did not become ready.");
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveExit();
    }, 8_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    if (!child.killed) child.kill("SIGTERM");
  });
}

async function assertAppPortAvailable(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolveListen, reject) => {
    probe.once("error", () => {
      reject(
        new Error(
          "The dedicated E2E port is already occupied; no existing server will be reused.",
        ),
      );
    });
    probe.listen(Number(APP_PORT), APP_HOST, resolveListen);
  });
  await new Promise<void>((resolveClose, reject) => {
    probe.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function main(): Promise<void> {
  const configuration = loadE2eConfiguration();
  const productSuite = process.argv.slice(2).includes("--products");
  const reorderSuite = process.argv.slice(2).includes("--reorder");
  const googleDenialSuite = process.argv
    .slice(2)
    .includes("--google-denial");
  const productEditSuite = process.argv.slice(2).includes("--product-edit");
  const customerSuite = process.argv.slice(2).includes("--customers");
  if (
    Number(productSuite) +
      Number(reorderSuite) +
      Number(googleDenialSuite) +
      Number(productEditSuite) +
      Number(customerSuite) >
    1
  ) {
    throw new Error("Choose one E2E suite per runner invocation.");
  }
  const productFixtureSuite = productSuite || reorderSuite || productEditSuite;
  const runnerArguments = process.argv
    .slice(2)
    .filter(
      (argument) =>
        argument !== "--products" &&
        argument !== "--reorder" &&
        argument !== "--google-denial" &&
        argument !== "--product-edit" &&
        argument !== "--customers",
    );
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...createE2eChildEnvironment(configuration),
    NODE_ENV: "development",
  };

  const preflightCode = await runChild(
    process.execPath,
    ["--import", "tsx", resolve("scripts/e2e-preflight.ts")],
    baseEnvironment,
  );
  if (preflightCode !== 0) {
    throw new Error("E2E preflight failed; no test services were started.");
  }

  const productRunId = randomBytes(16).toString("hex");
  const productSkus = reorderSuite
    ? [
        `PME2E-${productRunId}-DRAG-1`,
        `PME2E-${productRunId}-DRAG-2`,
        `PME2E-${productRunId}-DRAG-3`,
      ]
    : productEditSuite
      ? [
          `PME2E-${productRunId}-EDIT-A`,
          `PME2E-${productRunId}-EDIT-B`,
          `PME2E-${productRunId}-EDIT-C`,
          `PME2E-${productRunId}-EDIT-R`,
        ]
      : [
        `PME2E-${productRunId}-ZERO`,
        `PME2E-${productRunId}-DUP`,
        `PME2E-${productRunId}-INVALID`,
        `PME2E-${productRunId}-DEL-A1`,
        `PME2E-${productRunId}-DEL-A2`,
        `PME2E-${productRunId}-DEL-A3`,
        `PME2E-${productRunId}-DEL-B1`,
        `PME2E-${productRunId}-DEL-B2`,
        `PME2E-${productRunId}-DEL-C1`,
      ];
  const productRegistry = resolve(
    ".playwright-e2e",
    `product-fixtures-${productRunId}.json`,
  );
  const customerEmails = ["a", "b", "c", "r"].map(
    (suffix) => `pme2e-${productRunId}-cust-${suffix}@example.test`,
  );
  const customerRegistry = resolve(
    ".playwright-e2e",
    `customer-fixtures-${productRunId}.json`,
  );
  const runId = randomBytes(32).toString("base64url");
  const nextAuthSecret = randomBytes(32).toString("base64url");
  const clientId = `pulsemarket-e2e-${randomBytes(32).toString("base64url")}`;
  const clientSecret = randomBytes(32).toString("base64url");

  let provider: Awaited<ReturnType<typeof startE2eOAuthProvider>> | undefined;
  let nextChild: ChildProcess | undefined;
  try {
    provider = await startE2eOAuthProvider({
      clientId,
      clientSecret,
      callbackUrl: `${APP_ORIGIN}/api/auth/callback/${
        googleDenialSuite ? "google" : "local-oauth"
      }`,
      subject: googleDenialSuite ? "e2e-google-denial-subject" : runId,
    });

    const serverEnvironment: NodeJS.ProcessEnv = {
      ...baseEnvironment,
      NODE_ENV: "development",
      NEXTAUTH_URL: APP_ORIGIN,
      NEXTAUTH_SECRET: nextAuthSecret,
      PULSEMARKET_E2E_RUN_ID: runId,
      E2E_AUTH_PROVIDER_ORIGIN: provider.origin,
      E2E_AUTH_CLIENT_ID: clientId,
      E2E_AUTH_CLIENT_SECRET: clientSecret,
      ...(googleDenialSuite
        ? { PULSEMARKET_E2E_GOOGLE_DENIAL: "true" }
        : {}),
      NEXT_TELEMETRY_DISABLED: "1",
    };

    await assertAppPortAvailable();
    const nextCommand = resolveE2eCommandInvocation(
      "npx.cmd",
      ["next", "dev", "--hostname", APP_HOST, "--port", APP_PORT],
    );
    nextChild = spawnChild(
      nextCommand.command,
      nextCommand.args,
      serverEnvironment,
      true,
    );
    await waitForApp(nextChild, `${APP_ORIGIN}/login`, runId);
    const playwrightInvocation = resolveE2eCommandInvocation(
      "npx.cmd",
      [
        "@playwright/test",
        "test",
        ...(productSuite
          ? [
              "tests/e2e/browser/product-creation.spec.ts",
              "tests/e2e/browser/product-delete.spec.ts",
            ]
          : reorderSuite
            ? ["tests/e2e/browser/product-reorder.spec.ts"]
            : productEditSuite
              ? ["tests/e2e/browser/product-edit.spec.ts"]
              : customerSuite
              ? ["tests/e2e/browser/customers.spec.ts"]
              : googleDenialSuite
              ? ["tests/e2e/browser/google-access-request.spec.ts"]
              : ["tests/e2e/browser/auth.spec.ts"]),
        "--config=playwright.config.ts",
        ...runnerArguments,
      ],
    );
    const playwrightEnvironment: NodeJS.ProcessEnv = {
      ...createE2eChildEnvironment(configuration),
      PULSEMARKET_E2E_BASE_URL: APP_ORIGIN,
      PULSEMARKET_E2E_DISCLOSURE_TEST_SECRET: nextAuthSecret,
      PULSEMARKET_E2E_PRODUCT_SKUS: JSON.stringify(productSkus),
      PULSEMARKET_E2E_PRODUCT_REGISTRY: productRegistry,
      PULSEMARKET_E2E_CUSTOMER_EMAILS: JSON.stringify(customerEmails),
      PULSEMARKET_E2E_CUSTOMER_REGISTRY: customerRegistry,
    };
    for (const key of [
      "NEXTAUTH_URL",
      "NEXTAUTH_SECRET",
      "GITHUB_ID",
      "GITHUB_SECRET",
      "E2E_AUTH_PROVIDER_ORIGIN",
      "E2E_AUTH_CLIENT_ID",
      "E2E_AUTH_CLIENT_SECRET",
      "PULSEMARKET_E2E_RUN_ID",
    ]) {
      delete playwrightEnvironment[key];
    }
    const exitCode = await runChild(
      playwrightInvocation.command,
      playwrightInvocation.args,
      playwrightEnvironment,
      true,
      serverEnvironment,
    );
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    await stopChild(nextChild);
    if (provider) await provider.close();
    if (productFixtureSuite) {
      const fixtureEnvironment: NodeJS.ProcessEnv = {
        ...baseEnvironment,
        PULSEMARKET_E2E_PRODUCT_SKUS: JSON.stringify(productSkus),
        PULSEMARKET_E2E_PRODUCT_REGISTRY: productRegistry,
      };
      const cleanupCode = await runChild(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          resolve("scripts/e2e-cleanup-products.ts"),
        ],
        fixtureEnvironment,
      );
      if (cleanupCode !== 0) process.exitCode = 1;

      const postflightCode = await runChild(
        process.execPath,
        ["--import", "tsx", resolve("scripts/e2e-preflight.ts")],
        baseEnvironment,
      );
      if (postflightCode !== 0) process.exitCode = 1;
    }
    if (customerSuite) {
      const cleanupCode = await runChild(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          resolve("scripts/e2e-cleanup-customers.ts"),
        ],
        {
          ...baseEnvironment,
          PULSEMARKET_E2E_CUSTOMER_EMAILS: JSON.stringify(customerEmails),
          PULSEMARKET_E2E_CUSTOMER_REGISTRY: customerRegistry,
        },
      );
      if (cleanupCode !== 0) process.exitCode = 1;

      const postflightCode = await runChild(
        process.execPath,
        ["--import", "tsx", resolve("scripts/e2e-preflight.ts")],
        baseEnvironment,
      );
      if (postflightCode !== 0) process.exitCode = 1;
    }
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }

  if (receivedSignal) process.exitCode = receivedSignal === "SIGINT" ? 130 : 143;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error &&
      (error.message.startsWith("Missing required E2E") ||
        error.message.startsWith("Required E2E configuration") ||
        error.message.startsWith("E2E "))
      ? error.message
        : "The isolated E2E run failed.",
  );
  process.exitCode = receivedSignal === "SIGINT" ? 130 : receivedSignal ? 143 : 1;
  process.off("SIGINT", handleSignal);
  process.off("SIGTERM", handleSignal);
});
