import { cookies } from "next/headers";

import {
  consumeGoogleAccountDisclosureToken,
  GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
  googleAccountDisclosureCookieOptions,
} from "../../../../lib/google-account-disclosure";
import {
  allowedRequestOrigins,
  evaluateSameOriginRequest,
} from "../../../../lib/same-origin-request";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

// POST only: navigations, prefetches, and link previews cannot trigger it.
export async function POST(request: Request): Promise<Response> {
  const decision = evaluateSameOriginRequest(
    request.headers,
    allowedRequestOrigins(request.url, process.env.NEXTAUTH_URL),
  );
  // Reject before touching cookies so a refused request never clears one.
  if (!decision.allowed) return jsonResponse({ error: "forbidden" }, 403);

  const cookieStore = await cookies();
  const token = cookieStore.get(GOOGLE_ACCOUNT_DISCLOSURE_COOKIE)?.value;
  const providerAccountId = await consumeGoogleAccountDisclosureToken(
    token,
    process.env.NEXTAUTH_SECRET,
    () => {
      cookieStore.set(
        GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
        "",
        googleAccountDisclosureCookieOptions(
          process.env.NODE_ENV === "production",
          0,
        ),
      );
    },
  );

  if (!providerAccountId) {
    return jsonResponse({ error: "unavailable" }, 404);
  }

  return jsonResponse({ providerAccountId }, 200);
}
