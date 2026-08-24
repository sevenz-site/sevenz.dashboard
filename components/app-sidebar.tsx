"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ShieldAlert, Camera, Building2, LogOut, Loader2 } from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { logout } from "@/app/(app)/actions";
import { useImportJobs } from "@/components/import/import-context";
import { useTour } from "@/components/dashboard/tour-context";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Cartera", icon: LayoutDashboard, dataTour: undefined },
  { href: "/malas-pagas", label: "Malas pagas", icon: ShieldAlert, dataTour: undefined },
  { href: "/import", label: "Importar cartera", icon: Camera, dataTour: "import-sidebar-link" },
  { href: "/profile", label: "Mi negocio", icon: Building2, dataTour: undefined },
];

export function AppSidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tour = useTour();
  const { setOpenMobile } = useSidebar();
  const { isProcessing, jobs } = useImportJobs();
  const { guard } = useUnsavedChangesGuard();
  const pendingCount = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;

  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-3">
        <Image
          src="/icon.svg"
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-md"
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold tracking-tight">Sevenz</span>
          <span className="truncate text-xs text-muted-foreground">{businessName}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                    <Link
                      href={item.href}
                      data-tour={item.dataTour}
                      onClick={(e) => {
                        // Let modifier/middle clicks open a new tab as usual —
                        // only a plain click actually leaves this page.
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        guard(() => {
                          if (item.href === "/import" && tour.step === 3) tour.advance();
                          setOpenMobile(false);
                          router.push(item.href);
                        });
                      }}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                      {item.href === "/import" && isProcessing ? (
                        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {pendingCount}
                        </span>
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => guard(() => logout())}>
              <LogOut />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
