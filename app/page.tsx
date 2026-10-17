import { getServerSession } from "next-auth";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

import { authOptions } from "../lib/auth";
import { isAuthorizedProviderIdentity } from "../lib/auth-authorization";

export default function Home() {
  return (
    <Suspense fallback={<PulseMarketLanding />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  await connection();
  const session = await getServerSession(authOptions);
  const provider = session?.user?.provider;
  const providerAccountId = session?.user?.providerAccountId;

  if (provider && providerAccountId) {
    const authorized = isAuthorizedProviderIdentity({
      provider,
      providerAccountId,
      e2eRunId:
        provider === "local-oauth"
          ? process.env.PULSEMARKET_E2E_RUN_ID
          : undefined,
    });
    if (authorized) redirect("/dashboard");
  }

  return <PulseMarketLanding />;
}

function PulseMarketLanding() {
  return (
    <main className="login-page flex min-h-screen items-center justify-center px-6 py-12">
      <section
        aria-labelledby="home-heading"
        className="login-page__card flex w-full max-w-2xl flex-col items-center gap-6 rounded-xl p-8 text-center sm:p-12"
      >
        <p aria-hidden="true" className="login-page__ornament">
          ◆
        </p>
        <div className="space-y-3">
          <h1
            className="dashboard-brand text-4xl font-semibold sm:text-5xl"
            id="home-heading"
          >
            Pulse<span>Market</span>
          </h1>
          <p className="login-page__copy text-sm sm:text-base">
            Panel de gestión
          </p>
        </div>
        <Link
          className="login-page__provider-button inline-flex min-h-12 items-center justify-center rounded-lg px-8 py-3 font-medium no-underline"
          href="/login"
        >
          Iniciar sesión
        </Link>
      </section>
    </main>
  );
}
