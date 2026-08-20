import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TourProvider } from "@/components/dashboard/tour-provider";
import { HelpButton } from "@/components/dashboard/help-button";
import { NotificationsButton } from "@/components/dashboard/notifications-button";
import { MixpanelIdentify } from "@/components/dashboard/mixpanel-identify";
import { ImportProvider } from "@/components/import/import-provider";
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
        <SidebarProvider>
          <AppSidebar businessName={owner?.business_name || user.email || "Mi negocio"} />
          <SidebarInset>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <span className="text-sm font-medium text-muted-foreground">
                {owner?.business_name || "Mi negocio"}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <HelpButton />
                <NotificationsButton initialUnreadCount={unreadCount} />
              </div>
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </TourProvider>
    </ImportProvider>
  );
}
