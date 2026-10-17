import { cookies } from "next/headers";

import {
  consumeGoogleAccountDisclosureToken,
  GOOGLE_ACCOUNT_DISCLOSURE_COOKIE,
  googleAccountDisclosureCookieOptions,
} from "../../../../lib/google-account-disclosure";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  "Content-Type": "text/plain; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(): Promise<Response> {
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
    return new Response("No hay un identificador Google disponible.", {
      status: 404,
      headers: RESPONSE_HEADERS,
    });
  }

  return new Response(providerAccountId, {
    status: 200,
    headers: RESPONSE_HEADERS,
  });
}
