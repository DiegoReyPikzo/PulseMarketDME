import Image from "next/image";
import { Suspense } from "react";
import { connection } from "next/server";

import { listProducts } from "../../lib/queries/products";
import { getAuthenticatedSession } from "../../lib/auth-session";
import { SignOutButton } from "./sign-out-button";

async function ProtectedDashboard() {
  await connection();
  const session = await getAuthenticatedSession();
  const products = await listProducts({ page: 1, pageSize: 20 });
  const userName = session.user?.name ?? "Cuenta de GitHub";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {session.user?.image ? (
            <Image
              alt=""
              className="h-12 w-12 rounded-full"
              height={48}
              src={session.user.image}
              unoptimized
              width={48}
            />
          ) : null}
          <div>
            <h1 className="text-2xl font-semibold">PulseMarket</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {userName}
              {session.user?.email ? ` · ${session.user.email}` : ""}
            </p>
          </div>
        </div>
        <SignOutButton />
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Productos</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Página 1 · {products.items.length} de {products.total} productos
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.items.map((product) => (
                <tr
                  className="border-t border-zinc-200 dark:border-zinc-800"
                  key={product.id}
                >
                  <td className="px-4 py-3 font-mono">{product.sku}</td>
                  <td className="px-4 py-3">{product.name}</td>
                  <td className="px-4 py-3">{product.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {product.price}
                  </td>
                  <td className="px-4 py-3 text-right">{product.stock}</td>
                </tr>
              ))}
              {products.items.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-400"
                    colSpan={5}
                  >
                    No hay productos para mostrar.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-zinc-500">
        Cualquier cuenta GitHub que complete el acceso puede ver los datos de
        demostración en esta etapa.
      </p>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl px-6 py-12">
          <p className="text-zinc-600 dark:text-zinc-400">
            Cargando sesión...
          </p>
        </main>
      }
    >
      <ProtectedDashboard />
    </Suspense>
  );
}
