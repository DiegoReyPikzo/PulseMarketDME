"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      type="button"
    >
      Cerrar sesión
    </button>
  );
}
