import { spawn } from "node:child_process";

import { runProductionWrapper } from "../lib/production-command";
import { loadProductionConfiguration } from "../lib/production-environment";

// Operator-only wrapper for production schema work. It validates the local,
// Git-ignored production configuration against an independent target file,
// then runs one of a fixed set of commands with only the verified
// DATABASE_URL/DIRECT_URL. See docs/production-customer-migration.md.
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  process.exitCode = await runProductionWrapper({
    argv,
    environment: process.env,
    loadConfiguration: () => loadProductionConfiguration(),
    spawn: (command, args, environment) =>
      new Promise<number>((resolveExit) => {
        const child = spawn(command, [...args], {
          env: environment,
          stdio: "inherit",
          shell: false,
        });
        child.on("error", () => {
          console.error("Could not start the production command.");
          resolveExit(1);
        });
        child.on("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
      }),
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
}

main().catch(() => {
  console.error("Production tooling failed. Details were suppressed.");
  process.exitCode = 1;
});
