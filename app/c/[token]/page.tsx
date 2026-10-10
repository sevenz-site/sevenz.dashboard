import type { Metadata } from "next";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl, getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { SetupNotice } from "@/components/setup-notice";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";

// EL CATALOGO PUBLICO. Lo abre un cliente final, sin cuenta y sin sesion.
//
// `/c/<token>` por consistencia con `/s/<token>`, que es el saldo: una letra,
// la inicial de lo que se comparte, y un token de 16 bytes.
//
// ─────────────────────────────────────────────────────────────────────────
// SIN INDEXAR, AUNQUE ESTO SI ESTA HECHO PARA COMPARTIRSE
//
// `/s/[token]` no se indexa porque enseña el saldo de una persona. Este
// enseña precios de un negocio, que es otra cosa — pero el dueño compartio un
// enlace, no publico un sitio web. Que un buscador lo liste significaria que
// su catalogo se encuentra sin tener el enlace, que es precisamente lo que no
// pidio. El dia que alguien quiera eso, es una casilla, no un descuido.
export const metadata: Metadata = {
  title: "Catálogo — Sevenz",
  description: "Mira los productos y sus precios.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Catálogo",
    description: "Mira los productos y sus precios.",
    siteName: "Sevenz",
    locale: "es_VE",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sevenz" }],
  },
};

type SharedProduct = {
  id: string;
  name: string;
  unit: string | null;
  description: string | null;
  photo_path: string | null;
  price: number;
  // El escalon del NUMERO, que puede no ser el del enlace: un producto que
  // solo tiene precio de detal sale con el suyo incluso en un enlace de mayor,
  // y lo dice, en vez de desaparecer del catalogo sin explicacion.
  price_tier: PriceTier;
  // Los precios que el tendero FIJO A MANO para este escalon, por moneda. Es
  // lo que hace que el candado signifique algo aqui: si esta pagina calculara
  // la equivalencia por su cuenta, el candado seria cierto en la ficha y falso
  // justo en la pantalla donde se fijo para que se viera.
  pinned: Partial<Record<PriceCurrency, number>>;
  base_currency: PriceCurrency;
};

type SharedCatalog = {
  business_name: string | null;
  owner_logo_path: string | null;
  owner_whatsapp: string | null;
  owner_country: string | null;
  // El escalon del ENLACE. Sin esto, un mayorista no sabe si lo que ve es su
  // precio o el del publico.
  tier: PriceTier;
  products: SharedProduct[];
  rate_mode: string | null;
  current_bcv_usd: number | null;
  current_bcv_eur: number | null;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
};

// UN ENLACE QUE NO EXISTE NO CAE EN EL 404 DE NEXT.
//
// `notFound()` pinta la pagina por defecto de Next: en ingles, sin mencionar
// Sevenz ni al negocio. Es CT-14, que sigue abierto para `/s/[token]`, y no
// hay razon para estrenar una superficie publica nueva con el mismo problema.
//
// Y no dice por que falla. «El enlace no existe» y «el enlace fue revocado»
// son la misma pantalla a proposito: quien pruebe tokens al azar no aprende
// nada de la diferencia.
function EnlaceInvalido() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      <h1 className="text-xl font-semibold">Este enlace ya no sirve</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Puede que el negocio lo haya cambiado. Pídele el enlace nuevo por WhatsApp.
      </p>
    </main>
  );
}

export default async function CatalogoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await createClient();

  // ERRORES ENMASCARADOS, que es la regla de CLAUDE.md para todo lo que se
  // puede llamar sin sesion: el detalle real va a `console.error` y nunca a la
  // respuesta. Un mensaje de Postgres en pantalla cuenta la forma de la base
  // de datos a cualquiera que sepa leerlo.
  //
  // El `try` NO devuelve JSX, y eso no es estilo: `react-hooks/error-boundaries`
  // lo prohibe, porque construir el arbol dentro de un try hace que un error de
  // renderizado lo atrape este catch en vez de la frontera de error que le
  // corresponde. Asi que aqui solo se decide, y el JSX se devuelve despues.
  const shared = await (async (): Promise<SharedCatalog | null> => {
    try {
      const { data, error } = await supabase.rpc("get_shared_catalog", { p_token: token });
      if (error) {
        console.error("[catalogoPublico] rpc:", error.message);
        return null;
      }
      return data as SharedCatalog | null;
    } catch (error) {
      console.error("[catalogoPublico] threw:", error instanceof Error ? error.message : error);
      return null;
    }
  })();

  // UN FALLO Y UN TOKEN INEXISTENTE DAN LA MISMA PANTALLA, a proposito: quien
  // pruebe tokens al azar no aprende nada de la diferencia. El detalle real ya
  // quedo en `console.error` y nunca viaja en la respuesta.
  if (!shared) return <EnlaceInvalido />;

  const logoUrl = shared.owner_logo_path
    ? getPublicLogoUrl(shared.owner_logo_path)
    : "/fav-icon-primary.svg";

  // LA EQUIVALENCIA EN BOLIVARES, solo para un negocio venezolano y solo si
  // hay tasa. `usdt: null` a proposito: aqui no se pide el precio del USDT a
  // CriptoYa — un cliente que mira un catalogo quiere el precio en lo que
  // paga, y esta pagina es publica, asi que cada carga seria una llamada a un
  // tercero disparada por cualquiera con el enlace.
  const rates: BolivarRates | null =
    shared.owner_country === "VE" &&
    shared.current_bcv_usd != null &&
    shared.current_bcv_eur != null
      ? shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
        ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur, usdt: null }
        : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur, usdt: null }
      : null;

  const whatsappDigits = shared.owner_whatsapp?.replace(/\D/g, "");

  // LA CIFRA EN BOLIVARES DE CADA PRODUCTO, Y DE DONDE SALE.
  //
  // Se calcula aqui arriba y no dentro del bucle porque el pie de pagina
  // necesita saber si ALGUNA es calculada. Encontrado leyendo la pagina el
  // 2026-10-10: decia «las equivalencias se calculan con la tasa de hoy y
  // pueden cambiar» debajo de un precio que el tendero habia FIJADO en
  // Bs. 12.000 precisamente para que no cambiara. En una pagina publica sobre
  // dinero, esa frase de mas es una promesa falsa.
  const bolivares = new Map<string, { amount: number; pinned: boolean }>();
  if (rates) {
    for (const p of shared.products) {
      if (p.base_currency === "VES") continue;
      const row = priceIn("VES", { amount: p.price, currency: p.base_currency }, rates, p.pinned);
      if (row.amount != null) {
        bolivares.set(p.id, { amount: row.amount, pinned: row.origin === "manual" });
      }
    }
  }
  const hayCalculadas = [...bolivares.values()].some((b) => !b.pinned);
  const hayFijadas = [...bolivares.values()].some((b) => b.pinned);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Image
          src={logoUrl}
          alt=""
          width={48}
          height={48}
          unoptimized={Boolean(shared.owner_logo_path)}
          className="size-12 shrink-0 rounded-lg object-cover"
        />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-xl font-semibold">
            {shared.business_name || "Catálogo"}
          </h1>
          {/* EL ESCALON SE DICE ARRIBA, no solo producto a producto. Un
              mayorista que abre su enlace tiene que saber de entrada que estos
              son sus precios; si no, no sabe si le estan cobrando de mas. */}
          <p className="text-sm text-muted-foreground">
            {shared.tier === "wholesale"
              ? "Nuestros precios al mayor"
              : "Lo que vendemos, con sus precios"}
          </p>
        </div>
      </header>

      {shared.products.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Todavía no hay productos publicados. Escríbele al negocio y pregúntale qué tiene.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shared.products.map((p) => {
            // El fijado a mano manda sobre el calculado — es la precedencia que
            // `priceIn` ya respeta, y la razon por la que `pinned` viaja hasta
            // aqui en vez de quedarse en la ficha.
            const bs = bolivares.get(p.id) ?? null;
            return (
              <li
                key={p.id}
                className="flex flex-col overflow-hidden rounded-xl border bg-background"
              >
                <div className="relative aspect-square w-full bg-muted">
                  {p.photo_path ? (
                    <Image
                      src={getPublicProductPhotoUrl(p.photo_path)}
                      alt=""
                      fill
                      unoptimized
                      sizes="(min-width: 640px) 33vw, 50vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageOff className="size-6" aria-hidden="true" />
                      <span className="text-[11px]">Sin foto</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 p-3">
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="text-sm tabular-nums">
                    {formatPriceAmount(p.price, p.base_currency)}
                  </span>
                  {/* La equivalencia, con la palabra que ya decidio el dueño
                      el 2026-10-09: es «equivalente», no un segundo precio.
                      Aqui importa mas que en la ficha — quien lo lee va a
                      pagar con eso. */}
                  {/* «Precio en bolívares» cuando el tendero lo fijó, y
                      «equivale a» cuando lo calculamos nosotros. No es un
                      matiz: lo primero es un precio que él sostiene, lo
                      segundo es una conversión que se mueve con la tasa, y el
                      cliente paga distinto según cuál sea. Es la misma palabra
                      que ya decidió el dueño para la ficha el 2026-10-09. */}
                  {bs != null ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {bs.pinned ? "precio en " : "equivale a "}
                      {formatBs(bs.amount)}
                    </span>
                  ) : null}
                  {/* Solo cuando el numero NO es del escalon del enlace. En un
                      enlace de detal, repetir «al detal» en cada tarjeta es
                      ruido; decirlo cuando es el precio de mayor no lo es. */}
                  {p.price_tier !== shared.tier ? (
                    <span className="text-xs text-muted-foreground">
                      {p.price_tier === "wholesale" ? "precio al mayor" : "precio al detal"}
                    </span>
                  ) : p.unit ? (
                    <span className="text-xs text-muted-foreground">{p.unit}</span>
                  ) : null}
                  {p.description ? (
                    <span className="line-clamp-3 pt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.description}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {whatsappDigits ? (
        <a
          href={`https://wa.me/${whatsappDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors hover:bg-accent"
        >
          <WhatsappIcon className="size-5" /> Escríbenos por WhatsApp
        </a>
      ) : null}

      {/* Solo si queda alguna calculada de verdad. Con todos los precios
          fijados a mano, esta frase seria falsa. */}
      {hayCalculadas ? (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Las equivalencias en bolívares se calculan con la tasa de hoy y pueden cambiar.
          {/* La segunda frase solo donde HAY alguno fijado. En un catálogo sin
              ninguno explica una etiqueta que no aparece en la página, que es
              la version pequeña del mismo problema que la primera frase tenia:
              texto que no describe lo que se esta viendo. */}
          {hayFijadas
            ? " Los precios marcados «precio en Bs.» los fijó el negocio y no se mueven solos."
            : ""}
        </p>
      ) : null}

      {/* EL MISMO PIE ANTIFRAUDE QUE LLEVAN LAS PLANTILLAS DE WHATSAPP, y por
          la misma razon: este enlace llega por un mensaje sobre un negocio,
          desde un numero que el destinatario no tiene agendado. Esa secuencia
          es, en Venezuela, la estafa mas corriente que existe. Decision del
          dueño el 2026-10-08 para las plantillas; aplicarlo aqui es
          coherencia, no una regla nueva — si los mensajes lo llevan y la
          pagina a la que llevan no, el aviso enseña a desconfiar del mensaje
          en vez de del impostor. */}
      <p className="text-center text-xs text-muted-foreground">
        Sevenz no pide códigos ni pagos. Aquí solo ves precios.
      </p>
    </main>
  );
}
