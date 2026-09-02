import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import Image from "next/image";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TourProvider } from "@/components/dashboard/tour-provider";
import { HelpButton } from "@/components/dashboard/help-button";
import { NotificationsButton } from "@/components/dashboard/notifications-button";
import { MixpanelIdentify } from "@/components/dashboard/mixpanel-identify";
import { MobileNav } from "@/components/dashboard/mobile-nav";
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
          <SidebarProvider>
            <AppSidebar businessName={owner?.business_name || user.email || "Mi negocio"} />
            <SidebarInset>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                {/* Below md the menu lives in the bottom bar, so the header
                    shows the mark instead of a trigger that would duplicate it.
                    Swapped with CSS rather than a JS check so neither version
                    flashes on load. */}
                <Image
                  src="/icon.svg"
                  alt="Sevenz"
                  width={28}
                  height={28}
                  className="size-7 rounded-md md:hidden"
                  priority
                />
                <SidebarTrigger className="-ml-1 hidden md:flex" />
                <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
                <span className="text-sm font-medium text-muted-foreground">
                  {owner?.business_name || "Mi negocio"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <HelpButton />
                  <NotificationsButton initialUnreadCount={unreadCount} />
                </div>
              </header>
              {/* Reserves the bar's height plus the iPhone home-indicator strip, so
                  the last row of a list is never stranded underneath it. Kept
                  constant whether the bar is currently visible or not —
                  otherwise the page would jump every time a dialog opened. */}
              <main className="flex flex-1 flex-col gap-4 p-4 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] md:pb-4">
                {children}
              </main>
              <MobileNav />
            </SidebarInset>
          </SidebarProvider>
        </UnsavedChangesProvider>
      </TourProvider>
    </ImportProvider>
  );
}
