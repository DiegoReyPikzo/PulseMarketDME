import type { NextConfig } from "next";
import { getE2eAuthConfiguration } from "./lib/e2e-auth-config";

const isE2eRun = getE2eAuthConfiguration(process.env) !== null;

const nextConfig: NextConfig = {
  distDir: isE2eRun ? ".next-e2e" : ".next",
  agentRules: isE2eRun ? false : undefined,
  async headers() {
    if (!isE2eRun) return [];
    return [
      {
        source: "/login",
        headers: [
          {
            key: "x-pulsemarket-e2e-run",
            value: process.env.PULSEMARKET_E2E_RUN_ID ?? "",
          },
        ],
      },
    ];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
