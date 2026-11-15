import { ZonaDelNegocioProvider } from "@/components/fecha";
import { redirect } from "next/navigation";
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
import { SearchFocusProvider } from "@/components/dashboard/search-focus-context";
import { RevisionEnCursoProvider } from "@/components/import/revision-en-curso";
import { UnsavedChangesProvider } from "@/components/unsaved-changes-context";
import { CuentaPausadaProvider } from "@/components/dashboard/cuenta-pausada";
import { motivoDeBloqueo } from "@/lib/cuenta-pausada-server";
import { mustResetPassword } from "@/lib/security/new-device";
import { ResetRequired } from "@/components/reset-required";
import { cookies } from "next/headers";
import { countUnreadNotifications } from "@/lib/notifications/unread-count";
import { refreshStockAlerts } from "@/lib/stock-alerts";
import { STOCK_ALERTS_DAY_COOKIE, stockAlertsDayValue } from "@/lib/stock-alerts-day";
import { getCurrentUser, getOwnerShellRow, getRequestClient } from "@/lib/supabase/current-user";
import { getImportUsageForOwner } from "@/lib/import-usage";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await getRequestClient();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // The proxy already ran today's refresh on the first page visit of the day
  // and left this cookie; see lib/stock-alerts-day.ts for when it did not.
  const stockAlertsDue =
    (await cookies()).get(STOCK_ALERTS_DAY_COOKIE)?.value !== stockAlertsDayValue(user.id);

  const [{ data: owner }, unreadCount, importUsage, motivo, mustReset] = await Promise.all([
    // Shared with the page and the rate helpers through React cache(): one
    // `owners` read per request instead of one per caller.
    getOwnerShellRow(supabase, user.id),
    // Today's inventory notices (CT-162) before counting, so a product still
    // low since yesterday puts its notice in the badge on the first load of
    // the day. Chained, not parallel: the count has to see the new row.
    // Since 2026-11-15 only when the day's refresh has not happened yet, and
    // the count takes the user already validated above instead of asking Auth
    // again through the server action.
    (stockAlertsDue ? refreshStockAlerts(supabase) : Promise.resolve()).then(() =>
      countUnreadNotifications(supabase, user.id),
    ),
    getImportUsageForOwner(supabase, user.id),
    // Si la cuenta esta pausada. Va en el layout y no en la cartera porque
    // el aviso tiene que salir se entre por donde se entre, y porque desde
    // aqui lo ve cualquier pantalla que rechace una escritura.
    motivoDeBloqueo(supabase, user.id),
    // After «No fui yo» (C2 of PL-22): the whole app is replaced by one screen until the
    // password changes. In the layout and not a redirect because /login bounces a signed-in
    // visitor back to /dashboard. A read of one boolean, through `my_security_state`.
    mustResetPassword(supabase),
  ]);

  if (mustReset) {
    return <ResetRequired email={user.email ?? null} />;
  }

  return (
    <ZonaDelNegocioProvider country={owner?.country ?? null}>
    <CuentaPausadaProvider pausada={motivo !== null} motivo={motivo} correo={user.email ?? null}>
    <ImportProvider initialUsage={importUsage}>
    <SearchFocusProvider>
    <RevisionEnCursoProvider>
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
                    src="/logo-primary.svg"
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
    </RevisionEnCursoProvider>
    </SearchFocusProvider>
    </ImportProvider>
    </CuentaPausadaProvider>
    </ZonaDelNegocioProvider>
  );
}
