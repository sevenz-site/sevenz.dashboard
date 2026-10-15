import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl, getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatCantidad } from "@/lib/products/cantidad";
import { SetupNotice } from "@/components/setup-notice";
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
  // TRES ESTADOS Y EL TERCERO ES `null`. Migración 107: `> 0` es «Disponible:
  // NN», `0` es «No disponible», y `null` es «Disponible» sin cifra — porque
  // hoy casi ningún producto tiene inventario escrito y nadie lo mantiene
  // (`CT-59`). Aplanar el null a 0 convertiría «no se sabe» en «no hay».
  stock: number | null;
};

type SharedCatalog = {
  business_name: string | null;
  owner_logo_path: string | null;
  // YA NO SE PINTA. Hasta el 2026-10-15 esta pagina tenia un boton
  // «Escribenos por WhatsApp» que abria `wa.me/<numero del dueno>`; el dueno
  // lo quito, y de paso cierra `CT-11` — ese enlace llevaba el numero del
  // tendero en la URL de una pagina que ve cualquiera con el enlace.
  //
  // Se queda en el tipo porque la funcion lo sigue devolviendo, y quitarlo de
  // los dos sitios a la vez es trabajo para nada: quien abre este catalogo
  // llego por un mensaje del propio negocio, asi que para escribirle solo
  // tiene que volver a esa conversacion. El dia que haga falta otra vez, el
  // dato esta.
  owner_whatsapp: string | null;
  owner_country: string | null;
  // El escalon del ENLACE. Sin esto, un mayorista no sabe si lo que ve es su
  // precio o el del publico.
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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  // `?previa=1` lo pone el «Vista previa» del menú del catálogo. Es LO ÚNICO
  // que distingue lo que ve el tendero de lo que ve su cliente — decisión del
  // dueño el 2026-10-15: «en la vista previa lo único que cambia es el botón
  // de regresar».
  //
  // Un marcador en la URL y no una ruta aparte, a propósito: una segunda ruta
  // sería una segunda copia de esta pantalla, y una copia se queda atrás del
  // original sin que nadie se entere. Lo que el tendero revisa tiene que ser
  // la página de verdad, byte por byte, o la revisión no vale.
  searchParams: Promise<{ previa?: string }>;
}) {
  const { token } = await params;
  const { previa } = await searchParams;
  const esVistaPrevia = previa === "1";

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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {/* LA CABECERA DEL FRAME `1190:5748`.
          
          Oscura y centrada, con el logotipo del negocio arriba y la marca de
          agua de Sevenz detrás. No es decoración: esta página la abre alguien
          que recibió un enlace por WhatsApp de un número que no tiene
          agendado, y lo primero que necesita es reconocer de quién es. El
          logotipo del NEGOCIO manda —es a quien le compra— y el de Sevenz
          queda detrás, diciendo quién responde por la página.

          `overflow-hidden` en la banda y la marca de agua recortada por
          arriba, como el frame. Sin él la marca se desborda y empuja el ancho
          de la página, que es el fallo de maquetación más fácil de meter aquí
          y el más difícil de ver en el escritorio. */}
      <header className="relative isolate overflow-hidden bg-brand-primary px-6 pt-10 pb-8 text-center">
        {/* SOLO EN LA VISTA PREVIA. Un cliente que abre este enlace desde un
            mensaje no tiene a dónde volver — no venía de ninguna parte— y un
            botón que lo saque de la página sería una salida que nadie pidió.

            El tendero sí: llegó desde su catálogo y quiere volver. Va a
            `/productos` con un `Link` y no con `history.back()`: la previa se
            abre en una pestaña NUEVA, así que no hay historial al que volver y
            el botón no haría nada.

            Si alguien copiara esta URL con el `?previa=1` y la compartiera, su
            cliente vería el botón y al tocarlo acabaría en la pantalla de
            entrar. Feo, no peligroso: `/productos` exige sesión. */}
        {esVistaPrevia ? (
          <Link
            href="/productos"
            aria-label="Volver al catálogo"
            className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : null}
        <Image
          src="/logo-secundary.svg"
          alt=""
          aria-hidden="true"
          width={520}
          height={160}
          priority={false}
          className="pointer-events-none absolute -top-6 left-1/2 -z-10 w-[130%] max-w-none -translate-x-1/2 opacity-[0.06] select-none"
        />
        <Image
          src={logoUrl}
          alt=""
          width={96}
          height={96}
          unoptimized={Boolean(shared.owner_logo_path)}
          className="mx-auto size-24 rounded-full border-2 border-white/10 object-cover"
        />
        <h1 className="pt-4 text-2xl font-semibold text-white">
          {shared.business_name || "Catálogo"}
        </h1>
        {/* EL AVISO DE LA TASA, Y SOLO DONDE HAY TASA.
            
            Un negocio colombiano cobra en pesos y no tiene equivalencia que
            advertir, así que la frase sobraría y además mentiría. Ya no dice
            «Lo que vendemos, con sus precios»: esa frase no informaba de nada
            que la pantalla no enseñe sola, y el frame la cambia por la única
            advertencia que el cliente necesita antes de mirar un precio.

            LA CONDICIÓN ES `hayCalculadas` Y NO `rates`, y la diferencia
            importa: con TODOS los precios fijados a mano por el tendero nada
            se calcula con la tasa, y entonces la frase es falsa. Esa precisión
            venía del aviso que esto sustituye, al pie de la página, y casi se
            pierde al subirlo: la primera versión miraba solo si el negocio es
            venezolano, y el aviso salía arriba Y abajo a la vez. */}
        {hayCalculadas ? (
          <p className="mx-auto max-w-sm pt-2 text-sm leading-relaxed text-brand-muted">
            Las equivalencias en bolívares se calculan con la tasa de hoy y pueden cambiar.
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 px-4 py-6">

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
              <li key={p.id} className="flex">
                {/* LA TARJETA ENTERA ES EL ENLACE al detalle, desde el
                    entregable B (2026-10-14). Un `Link` y no un `onClick`: así
                    el cliente puede abrirlo en otra pestaña, copiarlo para
                    mandárselo a alguien, y el navegador le enseña a dónde va
                    antes de tocar — tres cosas que un div con manejador no
                    hace, en una página donde quien mira no conoce a Sevenz y
                    no tiene por qué fiarse. */}
                <Link
                  href={`/c/${token}/${p.id}`}
                  className="flex w-full flex-col overflow-hidden rounded-xl border bg-background transition-colors hover:bg-accent/40"
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
                  {/* SIEMPRE SE DICE DE QUE PRECIO SE TRATA, y desde la
                      migracion 106 la tarjeta ensena el precio de UNA UNIDAD
                      -- detal si esta publicado, mayor si es lo unico que
                      hay-- en vez del mas bajo, que era el criterio de la 086.
                      Con un solo enlace, tarjeta y detalle son la misma
                      pagina en dos pasos: ensenar 4 en la tarjeta y cobrar 5
                      al entrar seria un cebo. */}
                  <span className="text-xs text-muted-foreground">
                    {p.price_tier === "wholesale" ? "precio al mayor" : "precio al detal"}
                  </span>

                  {/* LA ETIQUETA DE INVENTARIO, del frame `1190:5748`.

                      TRES ESTADOS Y EL FRAME DIBUJA DOS. Decisión del dueño el
                      2026-10-15, preguntada antes de construirla: con cantidad
                      sale el número, con cero sale «No disponible», y SIN
                      cantidad escrita sale «Disponible» a secas.

                      El tercero es el que importa: `stock_opening` nace nulo
                      salvo que el tendero lo ponga, y es un número que nadie
                      mantiene (`CT-59`). Con solo dos estados, 5 de los 6
                      productos de dev saldrían en rojo como «No disponible»
                      estando en el mostrador — y el tendero se enteraría por
                      un cliente que no le compró.

                      El color no sale de un token semántico de tema: esta
                      página la ve un cliente que no eligió el tema de nadie, y
                      el verde y el rojo tienen que significar lo mismo en los
                      dos. */}
                  <span
                    className={`mt-2 w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${
                      p.stock === 0
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {p.stock === 0
                      ? "No disponible"
                      : p.stock == null
                        ? "Disponible"
                        : `Disponible: ${formatCantidad(p.stock)}`}
                  </span>
                </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* EL AVISO DE LA TASA YA NO ESTÁ AQUÍ: subió a la cabecera con el frame
          `1190:5748` (2026-10-15). Durante un rato estuvo en los dos sitios a
          la vez — se vio rindiendo la página, no leyéndola.

          Lo que se queda abajo es esta otra frase, y solo donde HAY algún
          precio fijado a mano. En un catálogo sin ninguno explicaría una
          etiqueta que no aparece en la página: texto que no describe lo que se
          está viendo. */}
      {hayFijadas ? (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Los precios marcados «precio en Bs.» los fijó el negocio y no se mueven solos.
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
      {/* LA VERSIÓN LARGA, del frame 1192:4185 (2026-10-14).

          La corta —«Sevenz no pide códigos ni pagos. Aquí solo ves precios»—
          nació cuando esta página solo enseñaba precios, y esa segunda frase
          deja de ser cierta en cuanto el cliente puede armar un pedido.

          Lo que añade la nueva no es longitud por longitud: nombra LAS
          LLAMADAS, que es el canal por el que llega el impostor cuando el
          mensaje no le funcionó, y dice adónde va el dinero de verdad. Un
          cliente que acaba de mandar un pedido por WhatsApp es exactamente
          quien espera una llamada «del negocio» a continuación. */}
      <p className="text-center text-xs text-muted-foreground">
        Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. Pagos y abonos
        deben hacerse directamente con el dueño del comercio.
      </p>
      </div>
    </main>
  );
}
