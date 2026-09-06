import Link from "next/link";

import { requireSuperadmin } from "@/lib/admin/guard";

// Never prerendered, never cached. This page reads a session to decide who may
// see it and then shows every owner's data, so a cached copy is a copy that
// could be served to the wrong person. Without this the build reported /admin
// as static (o) — prerendering it at build time, where there is no session, so
// the guard's notFound() would have been baked in and /admin would have
// answered 404 for everyone, superadmin included.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The gate lives here rather than in the page so that every screen added under
// /admin later inherits it. A page can forget to call requireSuperadmin(); a
// layout it renders inside cannot be bypassed.
//
// Deliberately outside the (app) route group: this shares nothing with the
// owner-facing shell — no sidebar, no bottom bar, no notifications — because
// none of it applies to a platform view, and pulling it in would mean the
// owner's own navigation appearing on a screen that shows every owner's data.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireSuperadmin();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col">
          <Link href="/admin" className="text-sm font-semibold">
            Sevenz · Métricas
          </Link>
          {/* Whose session is open. On a screen showing every owner's numbers,
              that is the one piece of state worth keeping visible. */}
          <span className="text-xs text-muted-foreground">{email}</span>
        </div>
        <Link href="/dashboard" className="text-xs text-muted-foreground underline underline-offset-4">
          Ir a mi cartera
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-6 p-4">{children}</main>
    </div>
  );
}
