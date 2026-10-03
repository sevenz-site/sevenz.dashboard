import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { ClientSearchCartera } from "@/components/dashboard/client-search-cartera";
import {
  ClientFilterProvider,
  ClientFilterChipsRow,
  HideWhileResults,
} from "@/components/dashboard/client-filter-context";
import { ImportarCartera } from "@/components/dashboard/importar-cartera";
import { InstallAppBanner } from "@/components/install-app";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { PedirAvisosWhatsappDialog } from "@/components/dashboard/pedir-avisos-whatsapp-dialog";
import { tocaPreguntarAvisos } from "@/lib/whatsapp-opt-in";
import { readOwnerCountry } from "@/lib/owner-country";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { chartFetchWindowStart, computeWeeklyFiadoAbono } from "@/lib/lending-charts";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getMonedaHabitual } from "@/lib/moneda-habitual";
import { CuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { BalanceCard } from "@/components/dashboard/balance-card";
import { HomeHeader } from "@/components/dashboard/home-header";
import { ExchangeRateStrip } from "@/components/dashboard/exchange-rate-strip";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ nuevo?: string }>;
}) {
  // Set by the mobile bar's "Agregar", which navigates here because this
  // is where the movement will appear and where the client list already
  // lives. The dialog clears it from the address once open, so a reload
  // can't reopen it on its own.
  const { nuevo } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }, ownerRate, monedaHabitual] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .order("days_since_payment", { ascending: false }),
    // Feeds the "add a movement" search — hidden clients excluded (O2), same
    // as Clientes and Malas pagas.
    supabase
      .from("clients")
      .select("id, name, document_id")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("owners")
      .select(
        "business_name, country, first_name, whatsapp, onboarding_completed_at, whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_prompt_last_at, whatsapp_prompt_count",
      )
      .eq("id", user!.id)
      .single(),
    getOwnerRateContext(supabase, user!.id),
    // En que moneda escribio la ultima vez, para que el formulario abra ahi.
    getMonedaHabitual(supabase, user!.id),
  ]);

  // No saber el país no es saber que es CO. Esta pantalla monta el alta de
  // cliente con su primer movimiento, así que un país inventado aquí dibuja el
  // formulario sin selector de moneda y el servidor rechaza el fiado después,
  // pidiendo elegir algo que no está en pantalla. Y los totales de la cartera
  // se pintarían en formato colombiano, que para un negocio venezolano es una
  // cifra falsa. Sin país no se dibuja nada.
  // Si la primera lectura no trajo país, readOwnerCountry lo reintenta antes de
  // rendirse: un parpadeo de red no debería taparle la pantalla a nadie. Y si
  // tampoco así, deja constancia de que este aviso apareció.
  const ownerCountry =
    (owner?.country as OwnerCountry | undefined) ?? (await readOwnerCountry(supabase, user!.id));
  if (!ownerCountry) return <OwnerUnavailableDialog />;

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
        prevista: ownerRate.prevista,
        rateDate: ownerRate.rateDate,
        rateStatus: ownerRate.rateStatus,
        rateFetchedAt: ownerRate.fetchedAt,
      }
    : null;
  const ledger: LedgerDisplay | null = ownerRate ? { rate: ownerRate.effectiveRate } : null;

  const rows = (summaries ?? []) as ClientSummary[];
  // Capital por cobrar counts every client's debt regardless of flag status —
  // flagging only affects what's *visible* in the Cartera table below, never
  // this total. USD and EUR are independent ledgers, so each gets its own sum.
  const totalCop = rows.filter((r) => Number(r.balance) > 0).reduce((sum, r) => sum + Number(r.balance), 0);
  const totalUsd = rows.filter((r) => Number(r.balance_usd) > 0).reduce((sum, r) => sum + Number(r.balance_usd), 0);
  const totalEur = rows.filter((r) => Number(r.balance_eur) > 0).reduce((sum, r) => sum + Number(r.balance_eur), 0);
  // Solo se le ofrece el resumen semanal a quien tiene algo que resumir.
  // Ofrecerle "el resumen de tu cartera" a un dueño sin ningún cliente
  // debiendo es ofrecerle el resumen de nada — y enseña que los avisos de
  // Sevenz no sirven. El resto de condiciones están en tocaPreguntarAvisos().
  const pedirAvisos =
    owner !== null && tocaPreguntarAvisos(owner, totalCop > 0 || totalUsd > 0 || totalEur > 0);

  // CUAL DE LOS DOS LIBROS VA GRANDE. Lo decide la pantalla porque es la que
  // tiene los dos totales; la tarjeta solo los pinta. El empate manda a USD a
  // proposito: el caso normal de empate es el cero-cero de un dueno que acaba
  // de registrarse, y en un negocio venezolano el dolar es el libro principal.
  // Un dueno sin ningun fiado tiene que ver la moneda en la que va a trabajar.
  const usdIsLarger = totalUsd >= totalEur;

  const visibleRows = rows.filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, visibleRows, ownerRate?.effectiveRate ?? null);

  // The lending chart sums raw movement amounts, which only means something
  // within one currency — a VE owner sees one chart per currency (each
  // filtered to its own movements, no conversion) instead of one mixed total.
  const clientIds = (clients ?? []).map((c) => c.id);
  // Only the window the chart actually draws. This query used to have no date
  // filter at all: it pulled every movement the shop had ever recorded — 411 ms
  // and climbing forever on a 10,560-movement shop — to render a rolling 7-day
  // chart.
  const chartWindowStart = chartFetchWindowStart();
  const { data: weeklyMovements } =
    clientIds.length > 0
      ? await supabase
          .from("movements")
          .select("type, amount, currency, created_at")
          .in("client_id", clientIds)
          .is("deleted_at", null)
          .gte("created_at", chartWindowStart)
      : { data: [] };
  const weeklyMovementRows = (weeklyMovements ?? []) as {
    type: "charge" | "payment";
    amount: number;
    currency: "USD" | "EUR" | null;
    created_at: string;
  }[];
  const weeklyLendingCop = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => !m.currency));
  const weeklyLendingUsd = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => m.currency === "USD"));
  const weeklyLendingEur = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => m.currency === "EUR"));
  // Los tres libros posibles, cada uno con su gráfico. Se arman aquí y no en
  // el JSX porque ahí abajo lo único que tiene que leerse es cuál va grande.
  const usdLedger = {
    balance: totalUsd,
    currency: "USD" as const,
    chartData: weeklyLendingUsd,
    chartTitle: "Fiado vs. Abono (USD)",
  };
  const eurLedger = {
    balance: totalEur,
    currency: "EUR" as const,
    chartData: weeklyLendingEur,
    chartTitle: "Fiado vs. Abono (EUR)",
  };
  const copLedger = {
    balance: totalCop,
    currency: null,
    chartData: weeklyLendingCop,
  };

  // Both values ride along on work this page already does: first_name is one
  // more column on the owners query above, and last_sign_in_at is already in
  // the getUser() response. No extra round trip for either.
  //
  // The timezone is not cosmetic. Vercel runs its servers in UTC, so formatting
  // without naming a zone would show a Colombian owner 12:15 p. m. for a sign-in
  // that happened at 7:15 a. m. their time. The owner's own country is already
  // loaded, so it decides the zone.
  //
  // es-VE for the format itself: it renders "2 sept. 2026", where es-CO gives
  // the wordier "2 de sept de 2026" — the shorter one fits a two-line corner
  // label better and matches the format asked for.
  const lastSignIn = user!.last_sign_in_at
    ? new Intl.DateTimeFormat("es-VE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: owner?.country === "VE" ? "America/Caracas" : "America/Bogota",
      }).format(new Date(user!.last_sign_in_at))
    : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Un solo estado de filtros para toda la pantalla: el buscador va dentro
          de la cabecera, arriba del todo, y la lista que filtra está al final,
          detrás de las tarjetas de capital. Dos estados separados dejarían al
          dueño con una lista filtrada de una manera y un buscador diciendo otra.

          Envuelve TAMBIÉN a la cabecera, que es el cambio del 2026-10-03: el
          campo vive dentro de ella y necesita este estado. El proveedor no pinta
          nada, así que la cabecera sigue siendo el primer elemento del
          documento — que es lo que su `-mt-4` da por supuesto. */}
      <ClientFilterProvider rows={visibleRows} rateContext={ownerRate}>
        {/* LA CABECERA, PEGADA ARRIBA Y DE BORDE A BORDE. Se trae el saludo, el
            negocio y la última conexión, que hasta el 2026-10-03 eran una fila
            más del cuerpo de la pantalla, y se queda con el buscador dentro.

            Va primera a propósito, por delante del aviso de instalación: su
            `-mt-4` cancela el relleno de `AppMain` y eso solo funciona si no hay
            nada por encima. Y buscar a una persona es lo que el tendero viene a
            hacer la mayoría de las veces, así que el campo tiene que ser lo
            primero que encuentra, no algo detrás de un banner. */}
        <HomeHeader
          firstName={owner?.first_name ?? null}
          businessName={owner?.business_name || "Mi negocio"}
          lastSignIn={lastSignIn}
        >
          <ClientSearchCartera />
        </HomeHeader>

        {/* Solo para los dueños que ya estaban cuando esto se construyó y nunca
            vieron nada: a los nuevos se les pregunta en el registro. No se les
            enciende por migración — Meta exige consentimiento afirmativo, y con
            un solo número para toda la plataforma, tres dueños marcando el
            mensaje como no deseado bajan el rating de los 24 a la vez. */}
        {pedirAvisos ? <PedirAvisosWhatsappDialog whatsapp={owner?.whatsapp ?? null} /> : null}

        {/* El aviso va ARRIBA DEL TODO, antes de la cartera. Si estuviera junto
            al boton de agregar, el tendero solo se enteraria al ir a fiar — y ya
            habria escrito el monto. Aqui se entera al abrir.

            Se dibuja siempre y decide el solo: lee del contexto del layout, que
            es quien pregunta a la base. La pantalla ya no repite esa consulta. */}
        <CuentaPausada />

        {/* 20px of separation above a section title, measured on screen. The
            container is a flex column with gap-4, and a margin ADDS to a flex gap
            rather than collapsing into it — so mt-1 (4px) plus that 16px gap is
            the 20px. Changing the container's gap changes this too. */}
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Por cobrar</h2>
          <div className="flex shrink-0 items-center gap-2">
            {/* Importar vive aquí, no solo en el menú lateral: es la forma de
                cargar una cartera entera, y estaba escondida detrás de una
                navegación que muchos dueños no abren nunca. */}
            <ImportarCartera />
            {/* Desktop only: beside the title, hugging its own width. The phone
                keeps it full width below, which is a different place in the
                document — so it is rendered in both spots and each is shown at
                one breakpoint. */}
            <HideWhileResults>
              <div className="hidden sm:block">
                <ClientSearchDialog
                  clients={clients ?? []}
                  ownerId={user!.id}
                  businessName={owner?.business_name || user!.email || "tu negocio"}
                  ownerCountry={ownerCountry}
                  rateContext={rateContext}
                  monedaHabitual={monedaHabitual}
                />
              </div>
            </HideWhileResults>
          </div>
        </div>


        {/* Se aparta con "Agregar movimiento", bajo la misma condición: la lista
            de coincidencias cae justo encima de ella.

            UNA SOLA TARJETA desde el 2026-10-03, también para un negocio
            venezolano. Antes eran dos —USD y Euro— una al lado de la otra, y el
            problema no era el sitio que ocupaban: dos cifras del mismo tamaño,
            con el mismo rótulo y el mismo color, obligan a leer las dos para
            saber cuál es tu cartera. Ahora la mayor va grande y la menor en una
            línea pequeña debajo; cuál es cuál lo decide esta pantalla, que es la
            que tiene los dos totales. El porqué completo, en `balance-card.tsx`. */}
        <HideWhileResults>
          <BalanceCard
            label="Capital por cobrar"
            ledger={ledger}
            {...(rateContext
              ? {
                  main: usdIsLarger ? usdLedger : eurLedger,
                  secondary: usdIsLarger ? eurLedger : usdLedger,
                }
              : { main: copLedger, secondary: null })}
          />
        </HideWhileResults>

        {/* AQUÍ ABAJO Y NO ARRIBA DEL TODO, desde el 2026-10-03. Este aviso es
            una tarjeta oscura a propósito — `DESIGN-SYSTEM.md` lo explica así:
            "una pieza oscura en medio de una pantalla clara está diciendo esto
            de aquí es lo nuevo, mírame", y eso solo funciona si contrasta con lo
            que la rodea.

            Con la cabecera nueva dejó de contrastar: era un bloque oscuro pegado
            a otro bloque oscuro, separados por 16px de blanco, y los dos se
            leían como una sola mancha. El aviso no desapareció, pero dejó de
            destacar, que para un aviso es lo mismo.

            Debajo del capital sigue estando alto — lo primero después de la
            cifra que el dueño viene a ver — y vuelve a estar rodeado de blanco.
            Solo en teléfono, como siempre: Sevenz es instalable desde agosto y
            ningún tendero se enteró porque Android enseña su propio aviso,
            discreto y fácil de ignorar, y en iPhone no aparece nunca. */}
        <InstallAppBanner />

        {/* La tasa va DESPUÉS de las tarjetas desde el 2026-09-20, a petición
            del dueño. Antes iba delante, con el argumento de que el
            equivalente en bolívares de una tarjeta no se puede leer sin saber
            a qué tasa está convertido; la tasa sigue en la misma pantalla y a
            un dedo de distancia, así que el argumento pesa menos que el orden
            que el dueño quiere leer. Si vuelve a moverse, esta es la razón que
            había. */}
        {rateContext ? <ExchangeRateStrip rateContext={rateContext} /> : null}

        {/* Phone only. This is the instance the mobile bar's "Agregar" opens, so
            autoOpen lives here; the desktop one must not also receive it or both
            would open and stack.

            Cierra la sección, debajo de las tarjetas y de la tasa. Estuvo
            arriba, por delante de ellas; se bajó el 2026-09-20 a petición del
            dueño. En el teléfono lo tiene igual de a mano en la barra de abajo
            ("Agregar"), así que aquí no es el atajo sino el cierre de lo que
            acaba de leer.

            Se aparta mientras la lista de coincidencias está abierta, igual
            que las tarjetas: un toque que se pase unos píxeles abriría el alta
            de un movimiento en vez de la ficha del cliente. */}
        <HideWhileResults>
          <div className="sm:hidden">
            <ClientSearchDialog
              clients={clients ?? []}
              ownerId={user!.id}
              businessName={owner?.business_name || user!.email || "tu negocio"}
              ownerCountry={ownerCountry}
              autoOpen={nuevo === "1"}
              showTourTarget={false}
              rateContext={rateContext}
              monedaHabitual={monedaHabitual}
            />
          </div>
        </HideWhileResults>

        {/* Sin rótulo "Clientes" desde el 2026-09-20: lo que hay debajo son
            tarjetas con nombre y saldo, y ninguna otra pantalla lo lleva ya.
            Lo que sí hace falta es la salida, porque esta lista está
            recortada —oculta las malas pagas y pagina de 15 en 15— y sin
            ella el dueño no tiene forma de saber que hay más.

            Queda sola y alineada a la derecha, en la misma fila y el mismo
            sitio donde ya estaba. Moverla al final de la lista habría sido
            más natural de leer, pero ahí abajo ya vive la paginación y dos
            controles de "ir a más clientes" pegados se estorban. */}
        {/* La cabecera de la sección: qué es y cómo salir de ella. Nada más.
            Los chips estuvieron un rato en esta misma fila, en el sitio del
            título, y se leía como si "Ordenar por" fuese el nombre de la
            sección. */}
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Clientes</h2>
          {/* Esta lista está recortada —oculta las malas pagas y pagina de 15
              en 15—, así que hace falta una salida explícita a la completa. */}
          {/* Subrayado: es lo único de esta fila que lleva a otra pantalla, y
              un "ghost" sin subrayar no se distingue de una etiqueta. Va en el
              <Link> y no en el botón, para que siga al texto en vez de dibujar
              una raya del ancho de la caja.

              `decoration-1` y `underline-offset-2` no son gusto. Este botón es
              `size="sm"`, o sea `text-[0.8rem]` — 12,8px. A ese tamaño el
              grosor `auto` del navegador sale por debajo de 1px y se pinta como
              una línea gris lavada: el subrayado estaba puesto y no se veía. Y
              un offset de 4px, que va bien en texto de 14px, aquí separa tanto
              la raya de la palabra que deja de leerse como suya. Mismo
              tratamiento que el enlace pequeño de /admin/cuentas. */}
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href="/clients" className="underline decoration-1 underline-offset-2">
              Ver todos
            </Link>
          </Button>
        </div>

        {/* En su propia fila, debajo de la cabecera y pegados a la lista que
            ordenan. Vivían dentro de la hoja del buscador, arriba del todo, a
            una pantalla de distancia de lo que tocaban: elegir "Plazo vencido"
            no enseñaba ningún cambio. */}
        <ClientFilterChipsRow />

        <ClientTable
          rows={visibleRows}
          scores={scores}
          rateContext={ownerRate}
          ownerCountry={ownerCountry}
          source="cartera"
        />
      </ClientFilterProvider>

      {rateContext ? <ExchangeRateLegalDisclaimer /> : null}
    </div>
  );
}
