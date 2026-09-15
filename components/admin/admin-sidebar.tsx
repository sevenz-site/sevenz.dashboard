"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Wallet } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// El menú de /admin.
//
// UNO PROPIO Y NO EL DEL TENDERO. AppSidebar lleva Cartera, Clientes, Malas
// pagas, Importar — la navegación de UN negocio. /admin mira la plataforma
// entera, así que compartir el menú pondría los accesos de una sola cuenta en
// la pantalla que mira las 24. Es la misma razón por la que /admin vive fuera
// del grupo de rutas (app).
const SECCIONES = [
  { href: "/admin", label: "Métricas", icon: BarChart3, exacto: true },
  { href: "/admin/cuentas", label: "Cuentas", icon: Building2, exacto: false },
];

export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex flex-col gap-0.5 px-2 py-1">
          <span className="text-sm font-semibold">Sevenz</span>
          {/* De quién es la sesión abierta. En una pantalla que enseña los
              números de todos los negocios, ese es el único estado que merece
              estar siempre a la vista. */}
          <span className="truncate text-xs text-muted-foreground">{email}</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SECCIONES.map((s) => {
                // "Métricas" es exacta porque /admin es prefijo de todo lo
                // demás: sin esto se quedaría marcada también dentro de
                // Cuentas, y el menú mentiría sobre dónde estás.
                const activa = s.exacto ? pathname === s.href : pathname.startsWith(s.href);
                return (
                  <SidebarMenuItem key={s.href}>
                    <SidebarMenuButton asChild isActive={activa} tooltip={s.label}>
                      <Link href={s.href}>
                        <s.icon />
                        <span>{s.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Ir a mi cartera">
              <Link href="/dashboard">
                <Wallet />
                <span>Ir a mi cartera</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
