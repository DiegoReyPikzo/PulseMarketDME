import Link from "next/link";

import { GitHubSignInButton } from "./github-sign-in-button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Acceso a PulseMarket</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Inicia sesión con tu cuenta de GitHub.
        </p>
      </div>
      <GitHubSignInButton />
      <Link className="text-sm underline underline-offset-4" href="/">
        Volver al inicio
      </Link>
    </main>
  );
}
