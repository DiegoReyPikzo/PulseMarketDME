import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { assertAuthConfiguration } from "../../../../lib/auth-config";
import { authOptions } from "../../../../lib/auth";

const handler = NextAuth(authOptions);

type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

async function authHandler(
  request: NextRequest,
  context: AuthRouteContext,
) {
  assertAuthConfiguration();
  return handler(request, context);
}

export { authHandler as GET, authHandler as POST };
