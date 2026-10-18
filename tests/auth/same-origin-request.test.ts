import assert from "node:assert/strict";
import { test } from "vitest";

import {
  allowedRequestOrigins,
  evaluateSameOriginRequest,
} from "../../lib/same-origin-request";

const APP_ORIGIN = "https://pulsemarket.example";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("accepts a same-origin browser request with matching Origin", () => {
  assert.deepEqual(
    evaluateSameOriginRequest(
      headers({ Origin: APP_ORIGIN, "Sec-Fetch-Site": "same-origin" }),
      [APP_ORIGIN],
    ),
    { allowed: true },
  );
});

test("accepts a matching Origin when the client omits Sec-Fetch-Site", () => {
  assert.deepEqual(
    evaluateSameOriginRequest(headers({ Origin: APP_ORIGIN }), [APP_ORIGIN]),
    { allowed: true },
  );
});

test("rejects any Sec-Fetch-Site other than same-origin, even with a matching Origin", () => {
  for (const site of ["cross-site", "same-site", "none", "unexpected"]) {
    assert.deepEqual(
      evaluateSameOriginRequest(
        headers({ Origin: APP_ORIGIN, "Sec-Fetch-Site": site }),
        [APP_ORIGIN],
      ),
      { allowed: false, reason: "fetch-site" },
      site,
    );
  }
});

test("fails closed when Origin is absent, with or without Sec-Fetch-Site", () => {
  const cases: Record<string, string>[] = [
    {},
    { "Sec-Fetch-Site": "same-origin" },
  ];
  for (const values of cases) {
    assert.deepEqual(
      evaluateSameOriginRequest(headers(values), [APP_ORIGIN]),
      { allowed: false, reason: "missing-origin" },
    );
  }
});

test("rejects opaque, foreign, or non-canonical Origin values", () => {
  for (const origin of [
    "null",
    "https://attacker.example",
    "http://pulsemarket.example",
    "https://pulsemarket.example:8443",
    "https://sub.pulsemarket.example",
    "https://pulsemarket.example/",
    "https://pulsemarket.example/path",
    "https://pulsemarket.example.attacker.example",
    "",
  ]) {
    assert.equal(
      evaluateSameOriginRequest(headers({ Origin: origin }), [APP_ORIGIN])
        .allowed,
      false,
      origin,
    );
  }
});

test("rejects every request when no allowed origin is configured", () => {
  assert.deepEqual(
    evaluateSameOriginRequest(headers({ Origin: APP_ORIGIN }), []),
    { allowed: false, reason: "origin-mismatch" },
  );
});

test("derives allowed origins from the request URL and a valid NEXTAUTH_URL only", () => {
  assert.deepEqual(
    allowedRequestOrigins(
      "http://127.0.0.1:4317/api/auth/google-account-id",
      "https://pulsemarket.example/some/path",
    ),
    ["http://127.0.0.1:4317", "https://pulsemarket.example"],
  );
  assert.deepEqual(
    allowedRequestOrigins(`${APP_ORIGIN}/api/auth/google-account-id`, APP_ORIGIN),
    [APP_ORIGIN],
  );
  assert.deepEqual(
    allowedRequestOrigins(`${APP_ORIGIN}/api/auth/google-account-id`, undefined),
    [APP_ORIGIN],
  );
  assert.deepEqual(
    allowedRequestOrigins(`${APP_ORIGIN}/api/auth/google-account-id`, "not a url"),
    [APP_ORIGIN],
  );
  assert.deepEqual(
    allowedRequestOrigins(
      `${APP_ORIGIN}/api/auth/google-account-id`,
      "javascript:alert(1)",
    ),
    [APP_ORIGIN],
  );
});
