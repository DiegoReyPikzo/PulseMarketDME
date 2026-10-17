import "server-only";

import { getLoginProviderConfiguration } from "./auth-provider-config";

export function assertAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const configuration = getLoginProviderConfiguration(environment);
  if (configuration.error) {
    throw new Error(configuration.error);
  }
}
