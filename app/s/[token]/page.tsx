import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ContactWhatsappLink } from "@/components/public/contact-whatsapp-link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import {
  MovementHistoryList,
  type SharedVentaDeContado,
} from "@/components/public/movement-history-list";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import type { PriceCurrency } from "@/lib/products/price";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import {
  getBalanceLabel,
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
} from "@/lib/types";
import type {
  ClientStatus,
  ExchangeRateMode,
  LedgerCurrency,
  MovementCurrencyCode,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { estadoPorLibro, libroDe, type CargoAbierto } from "@/lib/estado-del-plazo";
import {
  type LedgerDisplay,
} from "@/lib/exchange-rate/movement-display";
import { FeedbackBanner } from "@/components/public/feedback-banner";
import { ShareDialogs } from "@/components/public/share-dialogs";
import { ShareSettings } from "@/components/public/share-settings";
import { PublicHeader } from "@/components/public/public-header";
import {
  CatalogStrip,
  type CatalogStripProduct,
} from "@/components/public/catalog-strip";

// La vista previa que ve quien recibe el enlace por WhatsApp.
//
// Deliberadamente sin datos: ni el nombre del negocio, ni el del cliente, ni el
// saldo. Un mensaje reenviado a un grupo enseña su tarjeta sin que nadie abra
// nada, así que lo que viaje ahí tiene que ser cierto para cualquier enlace y
// no revelar de quién es la cuenta. El saldo solo se ve al abrirlo.
//
// noindex porque esta página es pública y muestra el saldo de una persona real.
// Bastaría con que un enlace se publicara una vez en un sitio rastreable para
// que acabara en un buscador. No había ninguna regla de indexación hasta hoy.
export const metadata: Metadata = {
  title: "Consulta tu saldo — Sevenz",
  description:
    "Revisa lo que debes y lo que has abonado, actualizado al instante.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Consulta tu saldo",
    description:
      "Revisa lo que debes y lo que has abonado, actualizado al instante.",
    siteName: "Sevenz",
    locale: "es_VE",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sevenz" }],
  },
};

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  currency: LedgerCurrency | null;
  description: string | null;
  running_balance: number;
  needs_review: boolean;
  plazo_dias: number | null;
  // Arrives through migration `121`. It is null for everything stored before
  // 2026-10-16, and the card only draws the table when it is not.
  cuotas: number | null;
  // A QUÉ FIADO SE DIRIGIÓ ESTE ABONO, `null` si no se dirigió a ninguno.
  // Lo manda `get_shared_balance` desde la `126`. Decide si la fila sale en
  // el historial: un abono dirigido vive dentro de su fiado.
  applies_to_movement_id?: string | null;
  // Arrives through migration `132`: what this fiado still owes, null on a
  // payment. Optional because a database where `132` has not run does not
  // send the key at all, and the history falls back to drawing no figure
  // rather than a zero that would read as «paid».
  pending?: number | null;
  created_at: string;
};

type SharedBalance = {
  business_name: string;
  owner_whatsapp: string | null;
  owner_logo_path: string | null;
  // Optional because migration 042 removes both from the payload. During the
  // window where code and database disagree — in either direction — these are
  // simply absent, and the page must cope rather than crash or mislead.
  payment_info?: string | null;
  client_name: string;
  document_id?: string | null;
  // What 042 adds in their place: the one bit the page actually needs.
  has_document_id?: boolean;
  whatsapp_last4: string;
  // The COP ledger (country='CO'). A VE client's debt lives in the two
  // per-currency balances below instead.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  movements: (SharedMovement & {
    rate_mode_used: ExchangeRateMode | null;
    exchange_rate_used: number | null;
    official_bcv_rate_at_time: number | null;
    entry_currency: MovementCurrencyCode | null;
    entry_amount: number | null;
    rate_usd_at_time: number | null;
    rate_eur_at_time: number | null;
  })[];
  // Only meaningful when owner_country = 'VE' — a 'CO' owner's payload
  // still includes these keys (the SQL function always returns them) but
  // every value is null, and the page falls back to the plain COP figure.
  // How many movements exist in total, counted before the limit is applied —
  // so the page can say what it's holding back and whether to offer "ver todo".
  movement_total: number;
  // LAS VENTAS PAGADAS ENTERAS — migración `131`, `CT-104`. Opcionales porque
  // entre desplegar este código y correr esa migración la clave no viene, y
  // una pantalla que enseña lo de siempre es mejor que una que revienta.
  ventas_de_contado?: SharedVentaDeContado[];
  contado_total?: number;
  owner_country: "CO" | "VE" | null;
  rate_mode: ExchangeRateMode | null;
  current_bcv_usd: number | null;
  current_bcv_eur: number | null;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
};

// One currency's balance as its own card, label left and figure right —
// matching how the owner's own client screen shows the same two numbers.
// LA BANDERA VA PEGADA AL RÓTULO, no a la cifra. Instrucción del dueño,
// 2026-10-16: *«todo lo que muestre moneda debe contener el ícono (flag)»*.
//
// Delante del rótulo y no detrás del número porque la fila ya tiene la cifra
// en el extremo derecho con su equivalente en bolívares debajo; meter ahí un
// icono más empuja los dos renglones y, a 375px, es justo donde menos sitio
// hay. El rótulo, en cambio, tiene el flanco izquierdo libre.
//
// Y no reemplaza a la palabra: "Dólares" se queda. La bandera es lo que se ve
// de un vistazo y la palabra lo que lo deja sin ambigüedad para quien no
// distingue dos banderas pequeñas —o no las ve.
function BalanceRowCard({
  label,
  currency,
  estado,
  children,
}: {
  label: string;
  currency?: PriceCurrency | null;
  // El estado de ESTE libro, debajo de la equivalencia. Mismo sitio y mismo
  // vocabulario que en la pantalla del dueño: un cliente que le pregunta por
  // WhatsApp tiene que estar mirando la misma palabra que él.
  estado?: ClientStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {currency ? <CurrencyFlagIcon currency={currency} /> : null}
          <span className="truncate">{label}</span>
        </p>
        {children}
      </div>
      {estado ? (
        <div className="flex justify-end pt-1.5">
          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[estado]}>
            {CLIENT_STATUS_LABEL[estado]}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

// How many movements a client sees before asking for the rest. Their own
// recent activity is what they open this link for; the full ledger of a
// years-old account was 203 KB of HTML with no ceiling, downloaded over
// mobile data every time.
const DEFAULT_MOVEMENT_LIMIT = 50;

export default async function SharedBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ historial?: string }>;
}) {
  const { token } = await params;
  const { historial } = await searchParams;
  // A plain link, not a button with state: the whole page is server-rendered,
  // so "ver todo" costs nothing to implement and still works with no JS.
  const showAll = historial === "todo";

  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_shared_balance", {
    p_token: token,
    p_limit: showAll ? null : DEFAULT_MOVEMENT_LIMIT,
  });

  if (error || !data) {
    notFound();
  }

  const shared = data as SharedBalance;
  const movements = [...shared.movements].reverse();

  // CUÁNTAS FILAS SE ENSEÑAN Y CUÁNTAS HAY, contando las dos clases. Ver el
  // comentario del pie de la lista, más abajo.
  const ventasDeContado = shared.ventas_de_contado ?? [];
  const filasVisibles = movements.length + ventasDeContado.length;
  const totalDeTodo = shared.movement_total + (shared.contado_total ?? 0);

  // Pulled out of the JSX because TWO dialogs now depend on it: this decides
  // whether the cédula is asked for, and the WhatsApp permission waits its turn
  // behind that answer. See the mount site below.
  //
  // Deliberately tolerant of three payload shapes, because neither deploy order
  // is safe otherwise. Migration first and the old code reads a field that has
  // vanished; code first and the new field does not exist yet. Both collapse to
  // Boolean(undefined) === false, which opens a dialog that cannot be closed —
  // no close button, no Escape, no click-outside — over the balance every client
  // came to read.
  //
  // So the fallback is `true`: when the page cannot tell, it does NOT ask. The
  // cost of that is one client not being prompted for a cédula. The cost of the
  // other default is every client locked out.
  const hasDocumentId =
    shared.has_document_id ??
    (shared.document_id !== undefined ? Boolean(shared.document_id) : true);

  // MS-25. A second RPC rather than a field on get_shared_balance(): that one
  // is called by this unauthenticated page on every visit, and changing its
  // signature means drop + create plus the deploy-order rule — on 2026-09-04
  // adding an argument to it would have 404ed every share link if the code had
  // shipped first. A separate function cannot break the page that works.
  //
  // The service client and not the anon one the page already holds:
  // client_whatsapp_consent_state() is granted to service_role only, by the
  // same reasoning as its write sibling. The anon key reaches the browser.
  //
  // FAILS TOWARD NOT ASKING, like hasDocumentId above and for a milder version
  // of the same reason: if this read is unavailable — mid-deploy, or the
  // migration not run in this environment yet — a client who sees no dialog
  // loses nothing they came for. Showing one on a guess would be a question we
  // cannot record the answer to.
  const consent = await (async () => {
    try {
      const { data: state, error: consentError } =
        await createServiceClient().rpc("client_whatsapp_consent_state", {
          p_token: token,
        });
      if (consentError) {
        console.error(
          "[sharedBalance] consent state failed:",
          consentError.message,
        );
        return null;
      }
      return state as { can_consent: boolean; granted: boolean } | null;
    } catch (consentError) {
      console.error(
        "[sharedBalance] consent state threw:",
        consentError instanceof Error ? consentError.message : consentError,
      );
      return null;
    }
  })();

  // EL ESTADO DE CADA LIBRO, para el chip de su tarjeta (2026-10-23).
  //
  // Se pide aparte y no se saca de `shared.movements` porque esa lista llega
  // recortada a los 50 últimos: el estado saldría bien en un historial corto
  // y mal en uno largo, y mal hacia el lado tranquilizador — la lista va del
  // más nuevo al más viejo, así que el fiado vencido más antiguo es justo el
  // que se cae de ella. La migración `144` lo cuenta entero.
  //
  // FALLA HACIA NO PINTAR CHIP, como el consentimiento de arriba: si la
  // migración no está corrida en este entorno, el cliente ve sus tarjetas sin
  // chip, que es la pantalla de ayer. Un chip adivinado sería peor.
  //
  // Y «no pintar chip» ES `null`, NO UNA LISTA VACÍA. Es la primera versión de
  // esto y el error cabe en una línea: una lista vacía es una respuesta —«este
  // cliente no tiene ningún fiado abierto»—, así que un saldo en deuda saldría
  // «Sin plazo», un chip inventado con cara de correcto. Vacío y no leído no
  // son lo mismo, y aquí la diferencia la ve el cliente.
  const abiertos: CargoAbierto[] | null = await (async () => {
    const { data, error: abiertosError } = await supabase.rpc("get_shared_open_charges", {
      p_token: token,
    });
    if (abiertosError) {
      console.error("[sharedBalance] open charges failed:", abiertosError.message);
      return null;
    }
    return ((data ?? []) as {
      charge_at: string;
      currency: string | null;
      amount: number;
      pending: number;
      plazo_dias: number | null;
      cuotas: number | null;
    }[]).map((c) => ({
      createdAt: c.charge_at,
      currency: c.currency,
      amount: Number(c.amount),
      pendiente: Number(c.pending),
      plazoDias: c.plazo_dias,
      cuotas: c.cuotas,
    }));
  })();

  // LOS DÍAS SIN PAGAR, lo único que le faltaba a esta pantalla para juzgar
  // igual que la del tendero. Migración `145`.
  //
  // FALLA HACIA EL ESTADO MÁS SUAVE, como todo lo demás de esta pantalla: si
  // la migración no está corrida, o la lectura falla, se queda en `null` y el
  // chip vuelve a tocar techo en «Plazo vencido». Un «Crítico» adivinado
  // sobre un cliente que sí paga sería mucho peor que uno que falta.
  const diasSinPagar = await (async () => {
    const { data, error: diasError } = await supabase.rpc("get_shared_days_since_payment", {
      p_token: token,
    });
    if (diasError) {
      console.error("[sharedBalance] days since payment failed:", diasError.message);
      return null;
    }
    return typeof data === "number" ? data : null;
  })();

  const ownerWhatsappDigits = shared.owner_whatsapp?.replace(/\D/g, "");
  const logoUrl = shared.owner_logo_path
    ? getPublicLogoUrl(shared.owner_logo_path)
    : "/fav-icon-primary.svg";

  // Absent (null) for a 'CO' owner, or a 'VE' owner before any rate has ever
  // been fetched — the balance then renders exactly like today's plain COP
  // figure, same as everywhere else this shape is used.
  const rateContext =
    shared.owner_country === "VE" &&
    shared.current_bcv_usd != null &&
    shared.current_bcv_eur != null
      ? {
          rateMode: shared.rate_mode ?? ("BCV_AUTO" as ExchangeRateMode),
          effectiveRate:
            shared.rate_mode === "CUSTOM" &&
            shared.custom_rate_usd &&
            shared.custom_rate_eur
              ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur }
              : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur },
          officialRate: {
            usd: shared.current_bcv_usd,
            eur: shared.current_bcv_eur,
          },
        }
      : null;
  const ledger: LedgerDisplay | null = rateContext
    ? { rate: rateContext.effectiveRate }
    : null;

  // LA MISMA FUNCIÓN QUE USA LA PANTALLA DEL TENDERO, a propósito: el chip que
  // el cliente ve no puede contradecir al que ve el dueño sobre la misma
  // cuenta.
  //
  // `diasSinPagar` LLEGA POR LA `145` Y ES LA MITAD QUE FALTABA. Hasta el
  // 2026-10-23 aquí iba un cero fijo, y con un cero `getClientStatus` no
  // puede llegar nunca a «Crítico»: el dueño borró un abono, su pantalla
  // volvió a «Crítico» y este enlace se quedó en «Sin plazo». Decisión suya
  // ese mismo día, preguntada con las dos pantallas delante: se igualan,
  // *«la propuesta de valor del producto es "Cuentas claras"»*, el adjetivo
  // duro incluido.
  //
  // EL `?? 0` NO ES UN DESCUIDO: si la `145` no está corrida en este entorno
  // el cero vuelve, y con él la pantalla de ayer — un estado más suave, nunca
  // uno inventado.
  const estadosDeLibro: Partial<Record<string, ClientStatus>> = abiertos
    ? estadoPorLibro({
        saldos: rateContext
          ? { USD: shared.balance_usd, EUR: shared.balance_eur }
          : { COP: shared.balance },
        abiertos,
        daysSincePayment: diasSinPagar ?? 0,
      })
    : {};

  // El mismo mensaje que manda el dueño desde su lado, para que el cliente que
  // reenvia un movimiento mande exactamente lo que habria mandado el.
  //
  // El enlace sale de la direccion que ya tiene abierta y no del servidor:
  // crear un enlace solo responde a un dueño con sesion, y aqui no hay ninguna.
  // EL CATÁLOGO DEL NEGOCIO, si tiene. Encargo del dueño el 2026-10-17, frame
  // `1378:7916`.
  //
  // La función es `service_role` (migración 123) y por eso va por el cliente
  // de servicio, igual que `client_whatsapp_consent_state` justo arriba y por
  // la misma razón: la clave anónima llega al navegador, y esto convierte el
  // token de un cliente en el del catálogo del negocio.
  //
  // FALLA HACIA NO ENSEÑAR NADA, que es la tercera vez que esta página toma
  // esa decisión y la más barata de las tres: un cliente que no ve la franja
  // no pierde nada de lo que vino a buscar. Si la migración todavía no corrió
  // en este entorno —que es el estado normal durante un despliegue— esto da
  // error, se registra en el servidor y la pantalla queda exactamente como
  // estaba. Nunca al revés: una cabecera «Productos» sobre una franja vacía
  // es peor que ninguna cabecera.
  const catalogo = await (async () => {
    try {
      const { data: preview, error: previewError } =
        await createServiceClient().rpc("get_shared_catalog_preview", {
          p_token: token,
        });
      if (previewError) {
        console.error(
          "[sharedBalance] catalog preview failed:",
          previewError.message,
        );
        return null;
      }
      return preview as {
        catalog_token: string | null;
        products: CatalogStripProduct[];
      } | null;
    } catch (previewError) {
      console.error(
        "[sharedBalance] catalog preview threw:",
        previewError instanceof Error ? previewError.message : previewError,
      );
      return null;
    }
  })();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* ONE QUESTION PER VISIT. The two dialogs are mounted together, by a
          client component, because the rule that orders them needs to remember
          something the server cannot: whether the cédula was asked for on THIS
          visit. `router.refresh()` erases that from the server's view the
          instant it is answered. See share-dialogs.tsx.

          BOOLEANS, NOT VALUES. This is a client component, so every prop here
          is serialised into the RSC payload and readable by anyone who opens
          devtools on a link that travelled through WhatsApp. The cédula is
          never passed, only whether one exists. `whatsappLast4` is the one
          exception and it is not a new one: get_shared_balance has always
          returned it and VerifyBadge already shows it. */}
      <ShareDialogs
        token={token}
        clientName={shared.client_name}
        ownerCountry={shared.owner_country ?? null}
        hasDocumentId={hasDocumentId}
        // `consent === null` means the read failed — see where it is fetched.
        // Collapses to "do not ask", the same direction as hasDocumentId's own
        // fallback.
        canConsent={consent?.can_consent === true}
        consentGranted={consent?.granted === true}
        whatsappLast4={shared.whatsapp_last4}
      />

      {/* LA MISMA BANDA OSCURA QUE ABRE EL CATÁLOGO, desde el 2026-10-17.
          Frame `1378:7916`, decisión del dueño.

          Antes esta pantalla abría con una cabecera blanca, el logo pequeño a
          la izquierda y el nombre al lado. Lo que la cambia no es el gusto: a
          partir de ahora se salta de aquí al catálogo y se vuelve, y dos
          pantallas de la misma bodega que no se parecen en nada hacen dudar
          de que sean la misma bodega — que es justo lo que no conviene en una
          página sobre dinero que llegó por un mensaje de WhatsApp.

          EL COMPONENTE ES COMPARTIDO, no copiado: `components/public/
          public-header.tsx`, que salió de `/c/[token]` el mismo día. Dos
          copias se separan sin que nadie lo note, porque nadie abre las dos
          pantallas en el mismo minuto.

          SIN FLECHA DE VOLVER, aunque el frame la dibuja. Quien abre este
          enlace llega desde un mensaje: no venía de ninguna parte, y la
          flecha lo sacaría de la página a un sitio que no existe. Es la misma
          razón escrita en el catálogo, donde la flecha solo sale en la vista
          previa del tendero. El catálogo que se abre DESDE aquí sí tendrá la
          suya, porque ahí sí hay a dónde volver.

          EL SUBTÍTULO ES EL NOMBRE DEL CLIENTE Y NADA MÁS. La cédula estuvo
          ahí y cualquiera con el enlace podía leerla — un enlace compartido
          viaja por grupos de WhatsApp y reenvíos, así que su público real es
          más ancho que el cliente al que se le mandó. Nombre más cédula es
          casi todo lo que hace falta para sonar convincente en una llamada
          haciéndose pasar por la bodega. Esto es un componente de servidor,
          así que con no pintarlo basta: `shared.document_id` se queda en
          memoria del servidor y nunca entra en el HTML ni en la carga RSC. */}
      <PublicHeader
        logoUrl={logoUrl}
        logoIsRemote={Boolean(shared.owner_logo_path)}
        title={shared.business_name}
        subtitle={`Cliente: ${shared.client_name}`}
        actions={
          <ShareSettings
            token={token}
            whatsappLast4={shared.whatsapp_last4}
            canConsent={consent?.can_consent === true}
            // Live, unlike the frozen copy ShareDialogs holds: this is the switch
            // the person came to look at, so it has to show what is true now.
            granted={consent?.granted === true}
          />
        }
      >
        {ownerWhatsappDigits ? (
          <ContactWhatsappLink
            token={token}
            href={`https://wa.me/${ownerWhatsappDigits}`}
          />
        ) : null}
      </PublicHeader>

      <div className="flex flex-col gap-4 p-4">
        {/* LOS TRES TÍTULOS DE ESTA PÁGINA LLEVAN LAS MISMAS CLASES desde el
          2026-10-17: `mt-1 text-xl font-semibold`. Es lo que `DESIGN-SYSTEM.md`
          manda y lo que la ficha del cliente del dueño ya usaba; aquí
          «Historial» iba en gris y pequeño y «Productos» nació a medio camino.

          El `mt-1` no es decoración: con el `gap-4` de esta columna produce
          los 20px sobre cada título que el documento mide. «Pendiente» gana
          esos 4px al unificarlos, que es lo único que cambia de él. */}
        <h2 className="mt-1 text-xl font-semibold">Pendiente</h2>

        {/* One card per currency, label left and figure right. The label is
          getBalanceLabel's, not a fixed "Deuda": a client who has overpaid
          reads "A favor en Dólares" rather than being told they owe a
          negative amount.

          AND THE FIGURE GOES WITHOUT ITS SIGN, because that label already
          carries it. Owner's instruction on 2026-10-21: *«quitemos el signo
          negativo a los saldos a favor porque el rótulo ya lo menciona»*. It
          read «A favor en Dólares · −$158.50» — «in your favour minus 158»,
          which states the direction twice and contradicts itself once.

          `Math.abs` HERE AND NOT INSIDE `ExchangeRateBalanceDisplay`: that
          component is mounted by the client table, the balance card and the
          owner's own screens, where the figure sits under a neutral label
          like «Por cobrar» and the minus sign is the only thing saying which
          way the money goes. Stripping it there would turn a credit into a
          debt. The rule is not «no negatives»; it is «not twice». */}
        {rateContext ? (
          <>
            <BalanceRowCard
              label={`${getBalanceLabel(shared.balance_usd)} en Dólares`}
              currency="USD"
              estado={estadosDeLibro[libroDe("USD")]}
            >
              <ExchangeRateBalanceDisplay
                balance={Math.abs(shared.balance_usd)}
                currency="USD"
                ledger={ledger}
                align="end"
                mainClassName="text-3xl"
              />
            </BalanceRowCard>
            <BalanceRowCard
              label={`${getBalanceLabel(shared.balance_eur)} en Euros`}
              currency="EUR"
              estado={estadosDeLibro[libroDe("EUR")]}
            >
              <ExchangeRateBalanceDisplay
                balance={Math.abs(shared.balance_eur)}
                currency="EUR"
                ledger={ledger}
                align="end"
                mainClassName="text-3xl"
              />
            </BalanceRowCard>
          </>
        ) : (
          <BalanceRowCard label={getBalanceLabel(shared.balance)} estado={estadosDeLibro[libroDe(null)]}>
            <ExchangeRateBalanceDisplay
              balance={Math.abs(shared.balance)}
              currency={null}
              ledger={null}
              align="end"
              mainClassName="text-3xl"
            />
          </BalanceRowCard>
        )}

        {/* "Cómo pagar" used to sit here, showing the owner's Nequi or bank
          details to anyone holding the link. That is the raw material for
          impersonating the shop: a stranger who can quote the real payment
          handle alongside a real balance is far more believable than one who
          cannot. The client asks over WhatsApp instead, which also puts a real
          conversation between them and any payment.

          It returns behind authentication rather than being deleted — the RPC
          still returns payment_info, this page simply stops rendering it. */}

        {/* EL BOTON DE WHATSAPP SUBIO A LA BANDA OSCURA el 2026-10-17, que es
          donde lo dibuja el frame `1378:7916`. Antes estaba aqui, debajo del
          saldo. */}

        <FeedbackBanner token={token} />

        {/* AQUÍ ESTUVO «¿Es tu cuenta? Verifica con tu WhatsApp», retirado el
          2026-10-17 a petición del dueño.

          LA RAZÓN POR LA QUE ESTABA, para el día que alguien se plantee
          devolverlo: el enlace viaja por grupos y reenvíos, así que quien lo
          abre no es necesariamente el cliente al que se le mandó, y el
          componente le dejaba comprobar los 4 últimos dígitos de su número
          para confirmar que la cuenta era suya. Se puso sin condición el
          2026-09-21, justo para que lo viera también quien no tiene número
          guardado.

          Y ESTO DESPLAZA UNA DECISIÓN DEL MISMO DÍA: horas antes el dueño
          había elegido conservar las cuatro cosas que el frame `1378:7916`
          no dibuja, la verificación entre ellas. Al ver la pantalla montada
          decidió lo contrario para esta. Las dos quedan escritas, que es lo
          que pide `CLAUDE.md` cuando una decisión del dueño desplaza a otra.

          El componente `VerifyBadge` NO se borra: sigue en
          `components/public/verify-badge.tsx` con su lógica intacta. Lo que
          se quita es el montaje. */}

        {/* LA FRANJA DEL CATALOGO, encima del historial y debajo de todo lo que
          el cliente vino a leer. Ese orden es del frame y tiene sentido: el
          saldo primero, porque es a lo que entra; los productos despues,
          porque es la invitacion; y el historial al final, que es lo largo.

          NO SE PINTA NADA si el negocio no tiene enlace de catalogo, si no
          tiene productos publicados, o si la lectura fallo. Son tres estados
          distintos y aqui dan el mismo resultado a proposito: una cabecera
          «Productos» sobre una franja vacia le dice al cliente que la bodega
          no vende nada. */}
        {catalogo?.catalog_token && catalogo.products.length > 0 ? (
          <CatalogStrip
            shareToken={token}
            catalogToken={catalogo.catalog_token}
            products={catalogo.products}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          {/* El rótulo viaja DENTRO de la lista para que el filtro por tipo
            pueda ir a su derecha, en la misma fila. */}
          <MovementHistoryList
            titulo={
              <h2 className="mt-1 text-xl font-semibold">Historial</h2>
            }
            movements={movements}
            ventasDeContado={ventasDeContado}
            token={token}
            ledger={ledger}
            saldoPorMoneda={{
              COP: shared.balance,
              USD: shared.balance_usd,
              EUR: shared.balance_eur,
            }}
          />
          {/* EL PIE CUENTA LAS DOS COSAS desde la `131`. Antes contaba solo
              movimientos, y con las ventas de contado en la lista decía
              «mostrando 50 de 60» debajo de una lista de 57 filas. Una cifra
              que no cuadra con lo que se ve encima es peor que no ponerla: el
              cliente no sabe cuál de las dos creer. */}
          {!showAll && totalDeTodo > filasVisibles ? (
            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Mostrando las {filasVisibles} transacciones más recientes de {totalDeTodo}.
              </p>
              {/* h-10 so it matches every other labelled button in the app and
                clears a thumb on a phone. */}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href={`/s/${token}?historial=todo`} scroll={false}>
                  Ver todo el historial
                </Link>
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center">
          <Image
            src="/logo-primary.svg"
            alt="Sevenz"
            width={120}
            height={44}
            className="mb-1"
          />
          <p className="text-sm font-medium">
            ¿Quieres tener las cuentas claras con tus clientes?
          </p>
          <Button asChild size="sm">
            <Link href="/signup">Regístrate en Sevenz</Link>
          </Button>
        </div>

        {rateContext ? <ExchangeRateLegalDisclaimer /> : null}
      </div>
    </div>
  );
}
