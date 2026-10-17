import { spawn } from "node:child_process";

import {
  createE2eChildEnvironment,
  loadE2eConfiguration,
} from "../lib/e2e-environment";
import { resolveE2eCommandInvocation } from "../lib/e2e-command";

async function main(): Promise<void> {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();
  const [command, ...args] = commandArguments;

  if (!command) {
    throw new Error(
      "Usage: npm.cmd run e2e:with-env -- <command> [arguments].",
    );
  }

  const configuration = loadE2eConfiguration();
  let invocation: ReturnType<typeof resolveE2eCommandInvocation>;
  try {
    invocation = resolveE2eCommandInvocation(command, args, {
      npmExecPath: process.env.npm_execpath,
    });
  } catch (error: unknown) {
    console.error(
      error instanceof Error
        ? error.message
        : "Could not resolve the requested E2E command.",
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(invocation.command, invocation.args, {
    env: createE2eChildEnvironment(configuration),
    stdio: "inherit",
    shell: false,
  });

  child.on("error", () => {
    console.error("Could not start the requested E2E child process.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.message.startsWith("Missing required E2E")
      ? error.message
      : error instanceof Error &&
          error.message.startsWith("Required E2E configuration file")
        ? error.message
        : error instanceof Error && error.message.startsWith("E2E ")
          ? error.message
          : "Could not prepare the isolated E2E environment.",
  );
  process.exitCode = 1;
});
