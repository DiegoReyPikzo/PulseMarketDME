export type SameOriginDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "fetch-site" | "missing-origin" | "origin-mismatch";
    };

// Policy for state-changing same-origin requests:
// - Origin is required and must exactly match an allowed origin; browsers
//   send it on every fetch POST, so a missing Origin fails closed.
// - Sec-Fetch-Site is optional (older clients omit it), but when present it
//   must be "same-origin".
export function evaluateSameOriginRequest(
  headers: Headers,
  allowedOrigins: readonly string[],
): SameOriginDecision {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return { allowed: false, reason: "fetch-site" };
  }

  const origin = headers.get("origin");
  if (origin === null) return { allowed: false, reason: "missing-origin" };
  if (!allowedOrigins.includes(origin)) {
    return { allowed: false, reason: "origin-mismatch" };
  }

  return { allowed: true };
}

function httpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function allowedRequestOrigins(
  requestUrl: string,
  nextAuthUrl: string | undefined,
): string[] {
  const origins = [httpOrigin(requestUrl), httpOrigin(nextAuthUrl)].filter(
    (origin): origin is string => origin !== null,
  );
  return [...new Set(origins)];
}
