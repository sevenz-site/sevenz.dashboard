import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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

  // WHICH OF THE TWO LEDGERS GOES BIG. The screen decides because the screen is
  // what holds both totals; the card only draws them. A tie goes to USD on
  // purpose: the normal tie is the zero-zero of an owner who has just signed
  // up, and in a Venezuelan business the dollar is the main ledger. An owner
  // with no fiado yet has to see the currency they are about to work in.
  const usdIsLarger = totalUsd >= totalEur;

  const visibleRows = rows.filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, visibleRows, ownerRate?.effectiveRate ?? null);

  // The three ledgers, figure only. The charts that used to hang off these
  // objects moved to `/reportes` with delivery 3; this page no longer reads a
  // single movement to draw them.
  //
  // Built here and not in the JSX because down there the only thing that should
  // be readable is which one goes big.
  // THE LABEL NAMES THE BIG CURRENCY, also when there are two ledgers. From
  // the Figma spec of 2026-10-04 plus the owner's call the same day: the figure
  // underneath is formatted in that currency, so a label that does not say
  // which one leaves the reader to infer it from a "$" that Colombia uses too.
  const mainLabel = !rateContext
    ? "Capital por cobrar"
    : usdIsLarger
      ? "Capital por cobrar en USD"
      : "Capital por cobrar en Euro";

  const usdLedger = { balance: totalUsd, currency: "USD" as const };
  const eurLedger = { balance: totalEur, currency: "EUR" as const };
  const copLedger = { balance: totalCop, currency: null };

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
      {/* One filter state for the whole screen: the search field lives inside
          the header, at the very top, and the list it filters is at the bottom,
          behind the capital card. Two separate states would leave the owner
          with a list filtered one way and a search box claiming another.

          It wraps the HEADER TOO, which is the 2026-10-03 change: the field
          lives inside it and needs this state. The provider renders no DOM, so
          the header is still the first element in the document — which is what
          its `-mt-4` assumes. */}
      <ClientFilterProvider rows={visibleRows} rateContext={ownerRate}>
        {/* THE HEADER, PINNED AT THE TOP AND EDGE TO EDGE. It takes over the
            greeting, the business name and the last sign-in, which until
            2026-10-03 were one more row of the screen's body, and it keeps the
            search field inside it.

            It goes first on purpose, ahead of the install banner: its `-mt-4`
            cancels `AppMain`'s padding, and that only works if nothing sits
            above it. And searching for a person is what the shopkeeper comes to
            do most of the time, so the field has to be the first thing they
            find, not something behind a banner. */}
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

        {/* 16px and not 20, from the Figma spec of 2026-10-04: both section
            titles on this screen are the same size as body text, bold rather
            than big. The screen already has one large figure and it is the
            money — a 20px heading above it was competing with it. */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Por cobrar</h2>
          <div className="flex shrink-0 items-center gap-2">
            {/* Importar vive aquí, no solo en el menú lateral: es la forma de
                cargar una cartera entera, y estaba escondida detrás de una
                navegación que muchos dueños no abren nunca.

                `responsive` y no `outline` desde el spec del 2026-10-04: ahí
                "Subir libreta" es texto con su icono, sin recuadro. En teléfono
                ya no lleva caja — compite menos con la cifra, que es lo único
                grande que debería haber aquí — y de `sm:` en adelante la
                conserva, que es lo que esta variante ya hacía en las otras tres
                pantallas y lo que la versión web necesita. El spec solo cubre el
                teléfono. */}
            <ImportarCartera variant="responsive" />
            {/* Desktop only: beside the title, hugging its own width.
                The breakpoint is `md` and not `sm` since delivery 3, so that it
                lines up with the bottom bar's: below md the floating "Agregar"
                is the trigger, at md and up there is no bottom bar and this
                button is the only one. With the old `sm` there was a 128px band
                — 640 to 768 — where BOTH were on screen. */}
            <HideWhileResults>
              <div className="hidden md:block">
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


        {/* THE CARD AND THE RATE STRIP ARE ONE SECTION, 14px apart, which is
            the spec's "Summary Section" of 2026-10-04. They used to be split by
            the install banner, which landed between the figure and the rate
            that figure converts at — the two things on this screen that are
            read together.

            ONE SINGLE CARD since 2026-10-03, for a Venezuelan business too.
            There used to be two — USD and Euro — side by side, and the problem
            was not the room they took: two figures of the same size, with the
            same label and the same colour, force you to read both to know what
            your cartera is. Now the larger goes big and the smaller on a small
            line below; which is which is decided by this screen, the one that
            holds both totals. The full reasoning is in `balance-card.tsx`.

            Both move aside with "Agregar movimiento", under the same condition:
            the match list lands right on top of them. */}
        <HideWhileResults>
          <div className="flex flex-col gap-3.5">
            <BalanceCard
              label={mainLabel}
              ledger={ledger}
              {...(rateContext
                ? {
                    main: usdIsLarger ? usdLedger : eurLedger,
                    secondary: usdIsLarger ? eurLedger : usdLedger,
                  }
                : { main: copLedger, secondary: null })}
            />
            {/* The rate goes AFTER the card, at the owner's request on
                2026-09-20. It used to go before, on the argument that a card's
                bolívar equivalent cannot be read without knowing what rate it
                was converted at; the rate is still on the same screen and a
                finger away, so that weighs less than the order the owner wants
                to read in. */}
            {rateContext ? <ExchangeRateStrip rateContext={rateContext} /> : null}
          </div>
        </HideWhileResults>

        {/* DOWN HERE AND NOT AT THE VERY TOP, since 2026-10-03, and now below
            the whole summary section rather than inside it. This notice is a
            dark card on purpose — `DESIGN-SYSTEM.md` puts it this way: "a dark
            piece in the middle of a light screen is saying this here is the new
            thing, look at me", and that only works if it contrasts with what
            surrounds it. Against the new header it stopped contrasting, and
            between the capital and its rate it also split a pair that is read
            together.

            The Figma spec does not model it at all. It stays because leaving it
            out is a product decision, not a layout one. Phone only, as always:
            Sevenz has been installable since August and no shopkeeper found
            out, because Android shows its own notice, discreet and easy to
            ignore, and on iPhone it never appears. */}
        <InstallAppBanner />

        {/* Phone only. This is the instance the mobile bar's "Agregar" opens, so
            autoOpen lives here; the desktop one must not also receive it or both
            would open and stack.

            NO VISIBLE BUTTON since delivery 3: the floating "Agregar" took over
            as the trigger. What stays is the DIALOG, and it has to — the
            floating button navigates to `?nuevo=1`, and this instance is what
            reads that marker and opens. Deleting the component instead of its
            button would leave that button pointing at a screen with nothing to
            open on it.

            It still moves aside while the match list is open, like the capital
            card: the dialog is invisible, but a mounted Radix trigger is not
            the only thing that can swallow a tap near the list's edge. */}
        <HideWhileResults>
          <div className="md:hidden">
            <ClientSearchDialog
              clients={clients ?? []}
              ownerId={user!.id}
              businessName={owner?.business_name || user!.email || "tu negocio"}
              ownerCountry={ownerCountry}
              autoOpen={nuevo === "1"}
              hideTrigger
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
        <div className="flex items-center justify-between gap-3 pt-3 pb-2.5">
          <h2 className="text-base font-semibold">Clientes</h2>
          {/* Esta lista está recortada —oculta las malas pagas y pagina de 15
              en 15—, así que hace falta una salida explícita a la completa. */}
          {/* 12px with a chevron since the spec of 2026-10-04, instead of the
              underlined ghost button it was. The underline existed to stop a
              ghost button reading as a label; a chevron says "this goes
              somewhere" without borrowing a button's shape at all, and it is
              the same treatment the capital card's own link uses. */}
          <Link
            href="/clients"
            className="flex shrink-0 items-center gap-0.5 text-xs text-foreground transition-colors hover:text-money-due"
          >
            Ver todos
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
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
