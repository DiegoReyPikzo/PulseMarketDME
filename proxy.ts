import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { isProxyProviderIdentityAllowed } from "./lib/authorized-accounts";

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const loginUrl = new URL("/login", request.url);
  const redirectStatus =
    request.method === "GET" || request.method === "HEAD" ? 307 : 303;

  if (!token) return NextResponse.redirect(loginUrl, redirectStatus);

  const authorized = isProxyProviderIdentityAllowed(
    token.provider,
    token.providerAccountId,
    token.e2eRunId,
    process.env,
  );
  if (!authorized) {
    loginUrl.searchParams.set("error", "AccessDenied");
    return NextResponse.redirect(loginUrl, redirectStatus);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
