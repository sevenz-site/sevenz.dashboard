import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import Image from "next/image";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TourProvider } from "@/components/dashboard/tour-provider";
import { NotificationsButton } from "@/components/dashboard/notifications-button";
import { SidebarMenuTrigger } from "@/components/dashboard/sidebar-menu-trigger";
import { UnreadNotificationsProvider } from "@/components/dashboard/unread-notifications-context";
import { MixpanelIdentify } from "@/components/dashboard/mixpanel-identify";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { AppMain } from "@/components/dashboard/app-main";
import { AppHeader } from "@/components/dashboard/app-header";
import { ImportProvider } from "@/components/import/import-provider";
import { UnsavedChangesProvider } from "@/components/unsaved-changes-context";
import { getUnreadNotificationCount } from "@/app/(app)/actions";
import { getImportUsageForOwner } from "@/lib/import-usage";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: owner }, unreadCount, importUsage] = await Promise.all([
    supabase.from("owners").select("business_name, onboarding_completed_at, plan").eq("id", user.id).single(),
    getUnreadNotificationCount(),
    getImportUsageForOwner(supabase, user.id),
  ]);

  return (
    <ImportProvider initialUsage={importUsage}>
      <MixpanelIdentify ownerId={user.id} email={user.email ?? ""} plan={owner?.plan ?? "free"} />
      <TourProvider active={!owner?.onboarding_completed_at}>
        <UnsavedChangesProvider>
          <UnreadNotificationsProvider initialCount={unreadCount}>
          <SidebarProvider>
            <AppSidebar businessName={owner?.business_name || user.email || "Mi negocio"} />
            <SidebarInset>
              <AppHeader>
                {/* Phone: the sidebar trigger on the left, the full wordmark on
                    the right — the business name moved under Cartera's greeting
                    and the bottom bar no longer carries "Menú", so this trigger
                    is the only way into the sidebar there. Desktop keeps its own
                    trigger on the left beside the business name. Swapped with
                    CSS rather than a JS check so neither version flashes on
                    load. */}
                <SidebarMenuTrigger className="-ml-1 md:hidden" />
                <SidebarTrigger className="-ml-1 hidden md:flex" />
                <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
                <span className="hidden text-sm font-medium text-muted-foreground md:inline">
                  {owner?.business_name || "Mi negocio"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {/* Desktop only: a phone reaches the same list through the
                      bottom bar's Notificaciones and the /notificaciones page. */}
                  <div className="hidden md:block">
                    <NotificationsButton />
                  </div>
                  <Image
                    src="/logo.svg"
                    alt="Sevenz"
                    width={96}
                    height={30}
                    className="h-7 w-auto md:hidden"
                    priority
                  />
                </div>
              </AppHeader>
              {/* Reserves the bar's height plus the iPhone home-indicator strip, so
                  the last row of a list is never stranded underneath it. Kept
                  constant whether the bar is currently visible or not —
                  otherwise the page would jump every time a dialog opened. */}
              <AppMain>{children}</AppMain>
              <MobileNav />
            </SidebarInset>
          </SidebarProvider>
          </UnreadNotificationsProvider>
        </UnsavedChangesProvider>
      </TourProvider>
    </ImportProvider>
  );
}
