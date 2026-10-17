import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve, win32 } from "node:path";

export type E2eCommandInvocation = {
  command: string;
  args: string[];
};

type CommandResolutionOptions = {
  platform?: NodeJS.Platform;
  npmExecPath?: string;
  nodePath?: string;
};

const require = createRequire(import.meta.url);

function executableName(command: string, platform: NodeJS.Platform): string {
  const commandBase =
    platform === "win32" ? win32.basename(command) : basename(command);
  return commandBase.replace(/\.cmd$/i, "").toLowerCase();
}

function resolveInstalledPackageBin(packageName: string): string {
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error("Requested E2E tool is not installed in this project.");
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
      bin?: unknown;
    };
    if (manifest.name !== packageName) {
      throw new Error("Requested E2E tool package identity did not match.");
    }
    const bins =
      typeof manifest.bin === "string"
        ? { [packageName]: manifest.bin }
        : manifest.bin;
    if (!bins || typeof bins !== "object") {
      throw new Error("Requested E2E tool does not expose a CLI.");
    }
    const binEntries = Object.entries(bins);
    const matchingBin = bins as Record<string, unknown>;
    const binPath =
      typeof matchingBin[packageName] === "string"
        ? matchingBin[packageName]
        : binEntries.length === 1 && typeof binEntries[0]?.[1] === "string"
          ? binEntries[0][1]
          : undefined;
    if (typeof binPath !== "string") {
      throw new Error("Requested E2E tool CLI is ambiguous.");
    }
    return resolve(dirname(manifestPath), binPath);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Requested")) {
      throw error;
    }
    throw new Error("Could not resolve the installed E2E tool entry point.");
  }
}

export function resolveE2eCommandInvocation(
  command: string,
  args: readonly string[],
  options: CommandResolutionOptions = {},
): E2eCommandInvocation {
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const name = executableName(command, platform);

  if (name === "npm") {
    if (!options.npmExecPath) {
      throw new Error("Could not resolve npm's installed Node.js entry point.");
    }
    return { command: nodePath, args: [options.npmExecPath, ...args] };
  }

  if (name === "npx") {
    const [packageName, ...toolArgs] = args;
    if (!packageName || packageName.startsWith("-")) {
      throw new Error("Specify an installed E2E tool after npx.");
    }
    return {
      command: nodePath,
      args: [resolveInstalledPackageBin(packageName), ...toolArgs],
    };
  }

  if (platform === "win32" && /\.cmd$/i.test(command)) {
    throw new Error(
      "Windows .cmd tools must be invoked through npm.cmd or npx.cmd.",
    );
  }

  return { command, args: [...args] };
}
