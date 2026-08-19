"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("owners")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);
}

export async function recordImportNotification(params: {
  fileName: string;
  status: "done" | "error";
  movementsCount?: number;
  errorMessage?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("import_notifications").insert({
    owner_id: user.id,
    file_name: params.fileName,
    status: params.status,
    movements_count: params.movementsCount ?? null,
    error_message: params.errorMessage ?? null,
  });
}

export type NotificationItem =
  | {
      id: string;
      kind: "link_open";
      occurredAt: string;
      clientName: string;
      documentId: string | null;
    }
  | {
      id: string;
      kind: "import_result";
      occurredAt: string;
      fileName: string;
      status: "done" | "error";
      movementsCount: number | null;
      errorMessage: string | null;
    };

// Fetches recent notifications from every source and marks them read in the
// same call — notifications aren't real-time, they're computed each time the
// owner opens the panel.
export async function getNotifications(): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: opens, error: opensError }, { data: imports, error: importsError }] = await Promise.all([
    supabase
      .from("link_opens")
      .select("id, client_id, opened_at, read_at")
      .order("opened_at", { ascending: false })
      .limit(20),
    supabase
      .from("import_notifications")
      .select("id, file_name, status, movements_count, error_message, created_at, read_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (opensError) console.error("getNotifications: link_opens query failed", opensError);
  if (importsError) console.error("getNotifications: import_notifications query failed", importsError);

  const openRows = opens ?? [];
  const importRows = imports ?? [];

  const clientIds = [...new Set(openRows.map((r) => r.client_id))];
  const clientById = new Map<string, { name: string; document_id: string | null }>();
  if (clientIds.length > 0) {
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, document_id")
      .in("id", clientIds);
    if (clientsError) console.error("getNotifications: clients query failed", clientsError);
    for (const c of clients ?? []) clientById.set(c.id, c);
  }

  const unreadOpenIds = openRows.filter((r) => !r.read_at).map((r) => r.id);
  const unreadImportIds = importRows.filter((r) => !r.read_at).map((r) => r.id);
  await Promise.all([
    unreadOpenIds.length > 0
      ? supabase.from("link_opens").update({ read_at: new Date().toISOString() }).in("id", unreadOpenIds)
      : null,
    unreadImportIds.length > 0
      ? supabase
          .from("import_notifications")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadImportIds)
      : null,
  ]);

  const items: NotificationItem[] = [
    ...openRows.map((r): NotificationItem => {
      const client = clientById.get(r.client_id);
      return {
        id: r.id,
        kind: "link_open",
        occurredAt: r.opened_at,
        clientName: client?.name ?? "Cliente",
        documentId: client?.document_id ?? null,
      };
    }),
    ...importRows.map(
      (r): NotificationItem => ({
        id: r.id,
        kind: "import_result",
        occurredAt: r.created_at,
        fileName: r.file_name,
        status: r.status,
        movementsCount: r.movements_count,
        errorMessage: r.error_message,
      }),
    ),
  ];

  return items
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 20);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const [{ count: openCount, error: openError }, { count: importCount, error: importError }] =
    await Promise.all([
      supabase.from("link_opens").select("*", { count: "exact", head: true }).is("read_at", null),
      supabase
        .from("import_notifications")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .is("read_at", null),
    ]);

  if (openError) console.error("getUnreadNotificationCount: link_opens query failed", openError);
  if (importError) console.error("getUnreadNotificationCount: import_notifications query failed", importError);

  return (openCount ?? 0) + (importCount ?? 0);
}
