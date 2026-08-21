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
    }
  | {
      id: string;
      kind: "movement_deleted";
      occurredAt: string;
      movementId: string;
      clientName: string;
      type: "charge" | "payment";
      amount: number;
      description: string | null;
      plazoDias: number | null;
      photoUrl: string | null;
      // The deleted movement's own running_balance, frozen at the moment it
      // was deleted — recalc_client_running_balance only ever rewrites
      // non-deleted rows, so this still reflects "Por cobrar" at that time.
      runningBalance: number;
      movementCreatedAt: string;
      restored: boolean;
    };

const NOTIFICATION_PHOTO_SIGNED_URL_TTL_SECONDS = 300;

// Fetches recent notifications from every source and marks them read in the
// same call — notifications aren't real-time, they're computed each time the
// owner opens the panel.
export async function getNotifications(): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [
    { data: opens, error: opensError },
    { data: imports, error: importsError },
    { data: deletions, error: deletionsError },
  ] = await Promise.all([
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
    supabase
      .from("movement_deletions")
      .select(
        "id, client_id, deleted_at, restored_at, read_at, movements(id, type, amount, description, plazo_dias, photo_path, running_balance, created_at)",
      )
      .eq("owner_id", user.id)
      .order("deleted_at", { ascending: false })
      .limit(20),
  ]);

  if (opensError) console.error("getNotifications: link_opens query failed", opensError);
  if (importsError) console.error("getNotifications: import_notifications query failed", importsError);
  if (deletionsError) console.error("getNotifications: movement_deletions query failed", deletionsError);

  const openRows = opens ?? [];
  const importRows = imports ?? [];
  // Without generated DB types, supabase-js infers every embed as an array
  // regardless of actual cardinality — but movement_deletions.movement_id is
  // a plain FK to movements.id, so this comes back as a single object (or
  // null). Cast through unknown since the inferred and real shapes disagree.
  const deletionRows = (deletions ?? []) as unknown as {
    id: string;
    client_id: string;
    deleted_at: string;
    restored_at: string | null;
    read_at: string | null;
    movements: {
      id: string;
      type: "charge" | "payment";
      amount: number;
      description: string | null;
      plazo_dias: number | null;
      photo_path: string | null;
      running_balance: number;
      created_at: string;
    } | null;
  }[];

  const clientIds = [...new Set([...openRows.map((r) => r.client_id), ...deletionRows.map((r) => r.client_id)])];
  const clientById = new Map<string, { name: string; document_id: string | null }>();
  if (clientIds.length > 0) {
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, document_id")
      .in("id", clientIds);
    if (clientsError) console.error("getNotifications: clients query failed", clientsError);
    for (const c of clients ?? []) clientById.set(c.id, c);
  }

  const deletionPhotoPaths = deletionRows
    .map((r) => r.movements?.photo_path)
    .filter((p): p is string => Boolean(p));
  const deletionPhotoUrls = new Map<string, string>();
  if (deletionPhotoPaths.length > 0) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("attachments")
      .createSignedUrls(deletionPhotoPaths, NOTIFICATION_PHOTO_SIGNED_URL_TTL_SECONDS);
    if (signedError) console.error("getNotifications: signing deletion photos failed", signedError);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) deletionPhotoUrls.set(entry.path, entry.signedUrl);
    }
  }

  const unreadOpenIds = openRows.filter((r) => !r.read_at).map((r) => r.id);
  const unreadImportIds = importRows.filter((r) => !r.read_at).map((r) => r.id);
  const unreadDeletionIds = deletionRows.filter((r) => !r.read_at).map((r) => r.id);
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
    unreadDeletionIds.length > 0
      ? supabase
          .from("movement_deletions")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadDeletionIds)
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
    // A deletion whose movement was later hard-removed (e.g. its client was
    // deleted, cascading) has no movements row left — skip it rather than
    // show a broken "undefined" notification.
    ...deletionRows
      .filter((r) => r.movements !== null)
      .map((r): NotificationItem => {
        const client = clientById.get(r.client_id);
        const movement = r.movements!;
        return {
          id: r.id,
          kind: "movement_deleted",
          occurredAt: r.deleted_at,
          movementId: movement.id,
          clientName: client?.name ?? "Cliente",
          type: movement.type,
          amount: movement.amount,
          description: movement.description,
          plazoDias: movement.plazo_dias,
          photoUrl: movement.photo_path ? (deletionPhotoUrls.get(movement.photo_path) ?? null) : null,
          runningBalance: movement.running_balance,
          movementCreatedAt: movement.created_at,
          restored: r.restored_at !== null,
        };
      }),
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

  const [
    { count: openCount, error: openError },
    { count: importCount, error: importError },
    { count: deletionCount, error: deletionError },
  ] = await Promise.all([
    supabase.from("link_opens").select("*", { count: "exact", head: true }).is("read_at", null),
    supabase
      .from("import_notifications")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .is("read_at", null),
    supabase
      .from("movement_deletions")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .is("read_at", null),
  ]);

  if (openError) console.error("getUnreadNotificationCount: link_opens query failed", openError);
  if (importError) console.error("getUnreadNotificationCount: import_notifications query failed", importError);
  if (deletionError) console.error("getUnreadNotificationCount: movement_deletions query failed", deletionError);

  return (openCount ?? 0) + (importCount ?? 0) + (deletionCount ?? 0);
}
