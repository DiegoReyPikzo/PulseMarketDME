import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { getAuthenticatedSession } from "../../lib/auth-session";

async function RedirectToProducts(): Promise<never> {
  await connection();
  await getAuthenticatedSession();
  redirect("/dashboard/products");
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="p-8 text-slate-400">Cargando...</p>}>
      <RedirectToProducts />
    </Suspense>
  );
}
