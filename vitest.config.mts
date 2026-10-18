import { configDefaults, defineConfig } from "vitest/config";

const integrationSuites = "tests/**/integration.test.ts";

// Default mode runs only the offline suites, so a bare `vitest run` never
// reaches a database. Integration suites run with `--mode integration`, and
// their npm scripts are meant to be wrapped by `npm run e2e:with-env`, which
// points them at the isolated E2E database.
export default defineConfig(({ mode }) => {
  const integration = mode === "integration";

  return {
    // Vitest must not read .env files itself; database variables come only
    // from the calling environment or from the suites' own dotenv imports.
    envDir: false,
    test: {
      // Integration suites share one database: never run their files at once.
      fileParallelism: !integration,
      // node:test applied no timeout; these limits only stop a hung test.
      testTimeout: 60_000,
      hookTimeout: 60_000,
      projects: [
        {
          extends: true,
          ssr: {
            resolve: {
              // Equivalent of `node --conditions=react-server`, so
              // "server-only" and React's server build load as they do for
              // Next.js server code. The rest are Vite's default server
              // conditions.
              conditions: ["react-server", "module", "node", "development|production"],
            },
          },
          test: {
            name: "server",
            include: integration ? [integrationSuites] : ["tests/**/*.test.ts"],
            exclude: integration
              ? configDefaults.exclude
              : [...configDefaults.exclude, integrationSuites],
          },
        },
        // Browser form components (client React in jsdom). Offline only.
        ...(integration
          ? []
          : [
              {
                extends: true as const,
                test: {
                  name: "client",
                  environment: "jsdom" as const,
                  include: ["tests/**/*.test.tsx"],
                },
              },
            ]),
      ],
    },
  };
});
