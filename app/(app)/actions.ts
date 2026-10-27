"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BADGE_MAX } from "@/lib/types";
import type { LedgerCurrency, MovementCurrencyCode } from "@/lib/types";

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
      documentType: string | null;
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
      // En que libro vive este movimiento. Null en un negocio colombiano.
      // Sin este dato la ficha no puede formatear el monto y lo daba por
      // pesos: un cargo de 45 euros aparecia como "$ 45,00".
      currency: LedgerCurrency | null;
      // Lo que el dueño tecleo y a que tasa, para que un movimiento escrito
      // como Bs. 900 siga diciendo Bs. 900 aqui y no solo su equivalente.
      entryCurrency: MovementCurrencyCode | null;
      entryAmount: number | null;
      exchangeRateUsed: number | null;
      description: string | null;
      plazoDias: number | null;
      // Migration `118`. null = single payment, which is every row stored
      // before 2026-10-16.
      cuotas: number | null;
      photoUrl: string | null;
      // The deleted movement's own running_balance, frozen at the moment it
      // was deleted — recalc_client_running_balance only ever rewrites
      // non-deleted rows, so this still reflects "Por cobrar" at that time.
      runningBalance: number;
      movementCreatedAt: string;
      restored: boolean;
    }
  | {
      id: string;
      kind: "client_hidden";
      occurredAt: string;
      clientId: string;
      clientName: string;
      action: "trashed" | "restored" | "hidden";
      // Whether the Restaurar button belongs on this row. False once the
      // client has been restored by some other route, and false for a
      // permanent hide, which has nothing to undo.
      canRestore: boolean;
    }
  | {
      id: string;
      kind: "product_hidden";
      occurredAt: string;
      productId: string;
      productName: string;
      action: "trashed" | "restored";
      // Si el botón «Restaurar» va en esta fila. False cuando el producto ya
      // volvió por otra vía — si no, el botón prometería deshacer algo que ya
      // está deshecho.
      canRestore: boolean;
    }
  | {
      id: string;
      kind: "catalog_order";
      occurredAt: string;
      orderId: string;
      customerName: string;
      // How many lines it carries. The notice says "3 productos" rather than
      // listing them: the order's own page is one tap away and is where they
      // belong.
      itemCount: number;
      // ── QUÉ LE PASÓ AL PEDIDO ────────────────────────────────────
      //
      // Encargo del dueño el 2026-10-26: *«lo único que cambia es el color
      // según el estado del pedido»* -- verde al recibirlo, rojo al
      // eliminarlo, azul al restaurarlo.
      //
      // UN SOLO `kind` CON TRES ESTADOS Y NO TRES `kind`: es el mismo hecho
      // --un pedido-- en tres momentos, con el mismo icono, el mismo enlace
      // y la misma fila. Tres tipos obligarían a escribir esa fila tres
      // veces, y la tercera se quedaría atrás el día que cambie.
      estado: "recibido" | "descartado" | "restaurado";
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
    { data: hides, error: hidesError },
    { data: productHides, error: productHidesError },
    { data: orders, error: ordersError },
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
        // currency y el rastro de bolivares no estaban aqui, y esa ausencia era el
        // fallo: sin currency, la ficha formateaba TODO como pesos colombianos y
        // un movimiento de 45 euros se leia "$ 45,00".
        "id, client_id, deleted_at, restored_at, read_at, movements(id, type, amount, currency, description, plazo_dias, cuotas, photo_path, running_balance, created_at, entry_currency, entry_amount, exchange_rate_used)",
      )
      .eq("owner_id", user.id)
      .order("deleted_at", { ascending: false })
      .limit(20),
    supabase
      .from("client_hides")
      .select("id, client_id, action, occurred_at, read_at")
      .eq("owner_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(20),
    // Productos a la papelera y de vuelta (migración 090). Se lee el nombre y
    // el `trashed_at` del producto en el mismo viaje: el nombre porque una
    // notificación sin él no se puede accionar, y `trashed_at` para saber si
    // el botón «Restaurar» todavía tiene sentido.
    supabase
      .from("product_hides")
      .select("id, product_id, action, occurred_at, read_at, products(name, trashed_at)")
      .eq("owner_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(20),
    // CATALOGUE ORDERS, AND NOTE WHAT IS NOT SELECTED: there is no `read_at`
    // here, because this table has none and deliberately so.
    //
    // The owner decided on 2026-10-16 (CT-71) that an order's notice counts
    // while the order is UNATTENDED, not until somebody opens the bell. So
    // the filter is `status = 'new'` and nothing below marks these rows read:
    // they leave this list when the shopkeeper attends the order, which is
    // the only event that means anything here.
    supabase
      .from("catalog_orders")
      // `!inner` NO, y el filtro va en el embebido: un pedido cuyas líneas
      // estén TODAS quitadas sigue existiendo y debe salir en la lista con
      // cero productos, no desaparecer. Migración `161`.
      .select(
        "id, customer_name, created_at, status, discarded_at, restored_at, catalog_order_items(id)",
      )
      .is("catalog_order_items.deleted_at", null)
      .eq("owner_id", user.id)
      // ── YA NO SOLO LOS `new` ─────────────────────────────────────
      //
      // Hasta el 2026-10-26 el filtro era `status = 'new'`, y eso bastaba
      // porque solo había un aviso que dar: «te hizo un pedido». Desde que el
      // tendero puede DESCARTAR uno --y devolverlo-- hay dos avisos más, y el
      // descartado tiene por definición otro estado.
      //
      // ASÍ QUE LO QUE ENTRA ES: los pendientes, y los que alguien tocó
      // alguna vez. Un pedido ya REGISTRADO no entra por `status`, pero sí
      // por `discarded_at` si se descartó antes de registrarse -- y debe,
      // porque ese aviso cuenta algo que pasó.
      .or(`status.eq.new,discarded_at.not.is.null,restored_at.not.is.null`)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (opensError) console.error("getNotifications: link_opens query failed", opensError);
  if (importsError) console.error("getNotifications: import_notifications query failed", importsError);
  if (deletionsError) console.error("getNotifications: movement_deletions query failed", deletionsError);
  if (hidesError) console.error("getNotifications: client_hides query failed", hidesError);
  if (productHidesError)
    console.error("getNotifications: product_hides query failed", productHidesError);
  if (ordersError) console.error("getNotifications: catalog_orders query failed", ordersError);

  const openRows = opens ?? [];
  const importRows = imports ?? [];
  const hideRows = (hides ?? []) as {
    id: string;
    client_id: string;
    action: "trashed" | "restored" | "hidden";
    occurred_at: string;
    read_at: string | null;
  }[];
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
      currency: LedgerCurrency | null;
      description: string | null;
      plazo_dias: number | null;
      cuotas: number | null;
      photo_path: string | null;
      running_balance: number;
      created_at: string;
      entry_currency: MovementCurrencyCode | null;
      entry_amount: number | null;
      exchange_rate_used: number | null;
    } | null;
  }[];

  // Mismo casteo que `deletionRows` y por el mismo motivo: sin tipos generados
  // supabase-js infiere todo embed como array, y `product_id` es una FK simple
  // que vuelve como objeto.
  const productHideRows = (productHides ?? []) as unknown as {
    id: string;
    product_id: string;
    action: "trashed" | "restored";
    occurred_at: string;
    read_at: string | null;
    products: { name: string; trashed_at: string | null } | null;
  }[];

  // `catalog_order_items` IS embedded only to be counted. Selecting `id`
  // alone keeps the payload to one column per line: the notice says how many
  // products there are and nothing about them, because the order's own page
  // is one tap away and is where they belong.
  const orderRows = (orders ?? []) as unknown as {
    id: string;
    customer_name: string;
    created_at: string;
    status: string;
    discarded_at: string | null;
    restored_at: string | null;
    catalog_order_items: { id: string }[] | null;
  }[];

  const clientIds = [
    ...new Set([
      ...openRows.map((r) => r.client_id),
      ...deletionRows.map((r) => r.client_id),
      ...hideRows.map((r) => r.client_id),
    ]),
  ];
  // Read from `clients`, not client_summary — a Papelera notification is about
  // a client the filtered view no longer returns, and joining through it would
  // leave every one of these rows saying "Cliente".
  const clientById = new Map<
    string,
    {
      name: string;
      document_id: string | null;
      document_type: string | null;
      trashed_at: string | null;
      deleted_at: string | null;
    }
  >();
  if (clientIds.length > 0) {
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, document_id, document_type, trashed_at, deleted_at")
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
  const unreadHideIds = hideRows.filter((r) => !r.read_at).map((r) => r.id);
  const unreadProductHideIds = productHideRows.filter((r) => !r.read_at).map((r) => r.id);
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
    unreadHideIds.length > 0
      ? supabase.from("client_hides").update({ read_at: new Date().toISOString() }).in("id", unreadHideIds)
      : null,
    unreadProductHideIds.length > 0
      ? supabase
          .from("product_hides")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadProductHideIds)
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
        documentType: client?.document_type ?? null,
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
          currency: movement.currency,
          entryCurrency: movement.entry_currency,
          entryAmount: movement.entry_amount,
          exchangeRateUsed: movement.exchange_rate_used,
          description: movement.description,
          plazoDias: movement.plazo_dias,
          cuotas: movement.cuotas,
          photoUrl: movement.photo_path ? (deletionPhotoUrls.get(movement.photo_path) ?? null) : null,
          runningBalance: movement.running_balance,
          movementCreatedAt: movement.created_at,
          restored: r.restored_at !== null,
        };
      }),
    // A hide whose client row is gone entirely (owner deleted, cascading) has
    // nothing left to name — skipped, same as a deletion with no movement.
    ...hideRows
      .filter((r) => clientById.has(r.client_id))
      .map((r): NotificationItem => {
        const client = clientById.get(r.client_id)!;
        return {
          id: r.id,
          kind: "client_hidden",
          occurredAt: r.occurred_at,
          clientId: r.client_id,
          clientName: client.name,
          action: r.action,
          // Restaurar is offered against the client's state now, not against
          // what this row recorded: an owner who already restored them from
          // the Papelera should not see an undo button that does nothing.
          canRestore: r.action === "trashed" && client.trashed_at !== null && client.deleted_at === null,
        };
      }),
    // Un rastro cuyo producto ya no existe se descarta: la fila cuelga con
    // `on delete cascade`, asi que esto solo puede pasar en una carrera entre
    // la consulta y un borrado de verdad. Sin nombre no hay nada que contar.
    ...productHideRows
      .filter((r) => r.products != null)
      .map((r): NotificationItem => {
        const producto = r.products!;
        return {
          id: r.id,
          kind: "product_hidden",
          occurredAt: r.occurred_at,
          productId: r.product_id,
          productName: producto.name,
          action: r.action,
          // Se mira el estado de AHORA, no lo que esta fila registro: quien ya
          // restauro el producto por otra via no deberia ver un boton que no
          // hace nada.
          canRestore: r.action === "trashed" && producto.trashed_at !== null,
        };
      }),
    // ONE NOTICE PER ORDER, not one grouped per day -- the owner's decision of
    // 2026-10-16. Each order is attended separately (ring the customer,
    // prepare it), and grouping hides which is which exactly when they have
    // to be told apart.
    // ── CADA PEDIDO DA UN AVISO: EL DE LO ÚLTIMO QUE LE PASÓ ─────────
    //
    // Y no tres acumulados. El tendero que descarta un pedido no quiere ver
    // encima «te hizo un pedido» del mismo: el aviso es para enterarse de
    // algo, y lo que hay que enterarse es del estado de hoy.
    //
    // CUÁL GANA LO DICE LA FECHA MÁS RECIENTE, no el `status`. Son dos
    // columnas --`discarded_at` y `restored_at`, migración `162`-- justo
    // porque esto se puede repetir: descartar, devolver, volver a descartar.
    //
    // Y LA FECHA DEL AVISO ES LA DE ESE HECHO, no la del pedido: un pedido de
    // la semana pasada descartado hace un minuto tiene que salir ARRIBA, que
    // es donde lo busca quien acaba de tocarlo.
    ...orderRows.map((r): NotificationItem => {
      const descartado = r.discarded_at ? new Date(r.discarded_at).getTime() : 0;
      const restaurado = r.restored_at ? new Date(r.restored_at).getTime() : 0;
      const estado =
        descartado === 0 && restaurado === 0
          ? ("recibido" as const)
          : descartado > restaurado
            ? ("descartado" as const)
            : ("restaurado" as const);
      const cuando =
        estado === "descartado"
          ? (r.discarded_at as string)
          : estado === "restaurado"
            ? (r.restored_at as string)
            : r.created_at;
      return {
        id: r.id,
        kind: "catalog_order",
        occurredAt: cuando,
        orderId: r.id,
        customerName: r.customer_name,
        itemCount: r.catalog_order_items?.length ?? 0,
        estado,
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

  // The badge renders "9+" above nine, so nothing above ten is ever read —
  // and an exact count is the most expensive way to ask, because Postgres has
  // to walk (and RLS-check) every unread row just to reach a total nobody
  // sees. Fetching at most CAP ids per table answers the same question and
  // stops as soon as it has enough. This runs on a timer in every open tab,
  // so it's the query that scales with how many owners have the app open
  // rather than with what they're doing.
  const CAP = BADGE_MAX + 1;
  const [
    { data: opens, error: openError },
    { data: imports, error: importError },
    { data: deletions, error: deletionError },
    { data: hides, error: hideError },
    { data: productHides, error: productHideError },
    { data: unattendedOrders, error: ordersCountError },
  ] = await Promise.all([
    supabase.from("link_opens").select("id").is("read_at", null).limit(CAP),
    supabase
      .from("import_notifications")
      .select("id")
      .eq("owner_id", user.id)
      .is("read_at", null)
      .limit(CAP),
    supabase
      .from("movement_deletions")
      .select("id")
      .eq("owner_id", user.id)
      .is("read_at", null)
      .limit(CAP),
    supabase.from("client_hides").select("id").eq("owner_id", user.id).is("read_at", null).limit(CAP),
    supabase.from("product_hides").select("id").eq("owner_id", user.id).is("read_at", null).limit(CAP),
    // ORDERS COUNT BY `status`, NOT BY `read_at`, and that is the whole point
    // of the owner's decision on 2026-10-16 (CT-71). Every other row above
    // leaves this count when somebody opens the bell; an order leaves it when
    // somebody ATTENDS it. Counting them the same way would show zero with
    // orders still waiting, which is the one number this badge must never
    // show.
    supabase
      .from("catalog_orders")
      .select("id")
      .eq("owner_id", user.id)
      .eq("status", "new")
      .limit(CAP),
  ]);

  if (openError) console.error("getUnreadNotificationCount: link_opens query failed", openError);
  if (importError) console.error("getUnreadNotificationCount: import_notifications query failed", importError);
  if (deletionError) console.error("getUnreadNotificationCount: movement_deletions query failed", deletionError);
  if (hideError) console.error("getUnreadNotificationCount: client_hides query failed", hideError);
  if (productHideError)
    console.error("getUnreadNotificationCount: product_hides query failed", productHideError);
  if (ordersCountError)
    console.error("getUnreadNotificationCount: catalog_orders query failed", ordersCountError);

  return (
    (opens?.length ?? 0) +
    (imports?.length ?? 0) +
    (deletions?.length ?? 0) +
    (hides?.length ?? 0) +
    (productHides?.length ?? 0) +
    (unattendedOrders?.length ?? 0)
  );
}
