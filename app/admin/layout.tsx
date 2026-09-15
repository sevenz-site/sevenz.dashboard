import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import { requireSuperadmin } from "@/lib/admin/guard";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

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
//
// El menú lateral es SUYO (AdminSidebar), no el del tendero. Misma razón: uno
// navega un negocio y el otro la plataforma entera.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireSuperadmin();

  return (
    <SidebarProvider>
      <AdminSidebar email={email} />
      <SidebarInset>
        {/* La cabecera se queda pegada arriba al desplazar. En una tabla de 24
            filas que va a crecer, el botón del menú y el título son lo único
            que orienta cuando ya no se ve el principio. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm font-medium">Panel de Sevenz</span>
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
