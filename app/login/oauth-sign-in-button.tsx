"use client";

import { signIn } from "next-auth/react";

export function OAuthSignInButton({
  providerId,
  label,
}: {
  providerId: string;
  label: string;
}) {
  return (
    <button
      className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      onClick={() => void signIn(providerId, { callbackUrl: "/dashboard" })}
      type="button"
    >
      {label}
    </button>
  );
}
