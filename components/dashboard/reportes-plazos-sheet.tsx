"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RegisterSheet } from "@/components/dashboard/register-sheet";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { MALA_PAGA_BADGE_CLASS } from "@/lib/types";
import type { ClavePlazo, ClienteDePlazo } from "@/lib/reports/facturacion";
import { foldForSearch } from "@/lib/search/fold";

// ═══════════════════════════════════════════════════════════════════════
// LAS CUATRO HOJAS DE «PLAZOS DE PAGO»
//
// Frames `1667:20645` (Por vencer), `1667:21438` (Plazo vencido),
// `1667:21230` (Críticos) y `1667:21622` (Malas pagas). Encargo del dueño el
// 2026-10-27: *«Al seleccionar las siguientes cards mostrarás su información
// en componentes sheets»*.
//
// ───────────────────────────────────────────────────────────────────────
// ANTES ESTO ERA UN ENLACE A LA LISTA DE CLIENTES FILTRADA
//
// Y era una decisión, no un atajo: lo escribí el 2026-10-27 porque la lista de
// Clientes ya es esa pantalla --mismo chip, mismo criterio, mismo buscador-- y
// duplicarla abre un segundo sitio donde el estado puede divergir.
//
// LO QUE LA DESPLAZA es que el dueño pidió hojas, y su frame las dibuja con
// título, subtítulo y buscador propios. LO QUE NO CAMBIA es de dónde sale el
// estado: estas filas las arma `estadoDeCliente`, el mismo juez que pinta el
// chip en Clientes. La hoja es otra ventana al mismo dato, no un segundo
// cálculo.
//
// `?estado=` SE QUEDA en `client-filters.tsx` aunque ya nadie lo enlace desde
// aquí: es una URL válida que alguien puede tener guardada, y quitarla rompería
// un enlace sin avisar.
//
// ───────────────────────────────────────────────────────────────────────
// EL SUBTÍTULO DE «CRÍTICOS» NO SE INVENTA
//
// Su frame lo deja escrito como `<Agregar descripción de lo que define a un
// cliente en estado crítico>`. La definición YA EXISTE en el repo, en
// `CLIENT_STATUS_DESCRIPTION.critico`: «Debe hace más de 30 días sin abonar».
// Se usa esa y no una frase nueva, porque es la que el resto de la app ya le
// enseña al tendero -- dos definiciones del mismo chip serían dos verdades.
// ═══════════════════════════════════════════════════════════════════════

const TITULO: Record<ClavePlazo, string> = {
  porVencer: "Plazos por vencer",
  vencido: "Plazo vencido",
  criticos: "Críticos",
  malasPagas: "Malas pagas",
  sinPlazo: "Sin plazo",
};

// ═══════════════════════════════════════════════════════════════════════
// LA HOJA VACÍA — frame `1762:14809`
//
// Encargo del dueño el 2026-10-27: *«Al seleccionar cualquiera de las
// opciones: por vencer, plazo vencido, críticos o malas pagas y no hay
// clientes para mostrar, muestra el empty state»*.
//
// ───────────────────────────────────────────────────────────────────────
// TRES COSAS DEL FRAME QUE NO SE COPIAN TAL CUAL, Y POR QUÉ
//
// 1. **EL FRAME DIBUJA DOS BOTONES Y EL SEGUNDO ESTÁ OCULTO.** Comprobado en
//    Figma: `outlined_button` («Crear producto») tiene `visible: false`, y por
//    eso el grupo mide 40px y no 96. Va UNO. Es además lo que el dueño ya
//    decidió el mismo día para el vacío de «Mejores pagadores», cuyo frame
//    dibujaba dos: *«déjalo afuera»*.
// 2. **EL FRAME ESCRIBE «Registar».** Errata; se escribe «Registrar».
// 3. **EL TÍTULO DEL FRAME NO SIEMPRE ES VERDAD, y eso se preguntó antes de
//    construir.** «Aún no hay clientes, ventas ni abonos registrados» describe
//    un negocio recién abierto. Una de estas cuatro hojas sale vacía también
//    cuando el negocio va BIEN --cero malas pagas con cuarenta clientes al día
//    es la mejor noticia posible-- y ahí esa frase es falsa.
//
//    EL PEOR CASO si se copiara tal cual: el tendero con todo en orden abre
//    «Malas pagas», la app le dice que no ha registrado nada, y lo que concluye
//    es que perdió sus datos. Un fallo que no revienta y que destruye la
//    confianza en la pantalla entera.
//
//    DECISIÓN DEL DUEÑO ese día, preguntado con el caso delante: **dos textos
//    según el caso**, mismo diseño y mismo botón. La frase del frame cuando el
//    negocio de verdad no tiene nada; una frase cierta cuando lo que pasa es
//    que nadie está en ese estado.
//
// ───────────────────────────────────────────────────────────────────────
// POR DÓNDE SE LLEGA A LA RAMA «NEGOCIO SIN NADA», QUE ES ESTRECHA
//
// Y hay que escribirlo o alguien la borrará por muerta. Con cero clientes, la
// pestaña ENTERA se sustituye por su propio estado vacío --`vacia` en
// `reportes-facturacion.tsx`-- así que las cuatro tarjetas ni se dibujan y
// estas hojas no se pueden abrir.
//
// La puerta que queda: `vacia` exige además CERO PEDIDOS POR ATENDER, y un
// pedido del catálogo lo manda alguien que todavía no es cliente. O sea un
// negocio que publicó su catálogo, recibió pedidos y no ha registrado nada —
// que es un negocio recién abierto, exactamente el caso del que habla la
// frase del frame.
//
// Comprobado en dev el 2026-10-27 montando ese caso: dueño sin clientes con
// un pedido esperando. La hoja enseña la frase del frame. El pedido se borró.
//
// ───────────────────────────────────────────────────────────────────────
// Y UN TERCER CASO QUE NO ES NINGUNO DE LOS DOS: EL BUSCADOR
//
// Si el tendero escribe «zzz» y no sale nadie, la lista está vacía y el
// negocio no. Decirle ahí «aún no hay clientes registrados» sería mentir con
// sus cuarenta clientes en la base. Ese caso conserva su propio mensaje y no
// ofrece «Registrar» -- lo que hay que hacer es corregir el nombre.
// ═══════════════════════════════════════════════════════════════════════

/** Lo que se promete que aparecerá aquí, en las palabras de cada tarjeta. */
const VACIO_CON_NEGOCIO: Record<ClavePlazo, { titulo: string; sub: string }> = {
  porVencer: {
    titulo: "Ningún plazo está por vencer",
    sub: "Aquí aparecerán los clientes a los que se les acerca la fecha de pago.",
  },
  vencido: {
    titulo: "Ningún plazo está vencido",
    sub: "Aquí aparecerán los clientes que se pasaron de la fecha que acordaron.",
  },
  criticos: {
    titulo: "Ningún cliente está en estado crítico",
    sub: "Aquí aparecerán los que deben hace más de 30 días sin abonar.",
  },
  malasPagas: {
    // «No has marcado a nadie» Y NO «ningún cliente está en este estado»:
    // mala paga es una MARCA que pone el tendero, no un estado que la app
    // calcula, y la frase tiene que decir de quién depende.
    titulo: "No has marcado a nadie como mala paga",
    sub: "Aquí aparecerán los clientes que marques como mala paga.",
  },
  sinPlazo: {
    titulo: "Ningún cliente debe sin plazo",
    sub: "Aquí aparecerán los que deben sin una fecha de pago acordada.",
  },
};

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fecha(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MES[d.getMonth()]}. ${d.getFullYear()}`;
}

function diasDesde(iso: string, ahora: Date): number {
  return Math.floor((ahora.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * La línea de debajo del nombre, que es distinta en cada hoja -- y así la
 * dibujan los cuatro frames:
 *
 *   · Por vencer   -> «Vence: 12 nov. 2026»
 *   · Vencido      -> «Venció: 2 oct. 2026, hace 25 días»
 *   · Críticos     -> igual que vencido
 *   · Malas pagas  -> «Debe: $120,00», porque la marca no habla de plazos y
 *                     un cliente marcado puede no tener ninguno
 */
function subtitulo(c: ClienteDePlazo, clave: ClavePlazo, ahora: Date): string {
  if (clave === "malasPagas") {
    // EL FRAME ESCRIBE «Debe: $00.00» AQUÍ Y REPITE EL IMPORTE A LA DERECHA.
    // En pantalla se leía «Debe: €500,00 … €500,00», dos veces la misma cifra
    // en una fila de cuatro datos. Se deja solo la de la derecha, que es donde
    // está en las otras tres hojas y donde el ojo ya la busca.
    //
    // LO QUE SE PIERDE es la palabra «Debe», que en esa hoja decía algo: un
    // cliente marcado puede no tener plazo ninguno. Lo recoge el chip «Mala
    // paga» de al lado, que es lo que de verdad distingue esa lista.
    return c.venceEl
      ? `Venció: ${fecha(c.venceEl)}`
      : "Sin plazo pactado";
  }
  if (!c.venceEl) return "Sin plazo pactado";
  if (clave === "porVencer") return `Vence: ${fecha(c.venceEl)}`;
  const d = diasDesde(c.venceEl, ahora);
  return `Venció: ${fecha(c.venceEl)}${d > 0 ? `, hace ${d} ${d === 1 ? "día" : "días"}` : ""}`;
}

export function PlazosSheet({
  clave,
  clientes,
  negocioSinNada,
  children,
}: {
  clave: ClavePlazo;
  clientes: ClienteDePlazo[];
  /** `true` solo si el negocio no tiene ni un cliente. Ver `facturacion.ts`. */
  negocioSinNada: boolean;
  /** La tarjeta que abre la hoja. */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  // LA HOJA PASA A ESTAR CONTROLADA para poder CERRARLA al tocar «Registrar».
  // Sin esto quedaban dos hojas apiladas y, al volver, la de plazos seguia
  // abierta detras de una pantalla que ya no tiene nada que ver con ella.
  const [abierta, setAbierta] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  // SE CONGELA AL ABRIR, no en cada render: `new Date()` dentro del cuerpo
  // haría que «hace 25 días» se recalculara en cada tecla del buscador. No
  // cambiaría el número, pero sí es trabajo por nada en una lista larga.
  const [ahora] = useState(() => new Date());

  const visibles = useMemo(() => {
    const q = foldForSearch(query.trim());
    if (!q) return clientes;
    // `foldForSearch`, the same as every other search box. The point this
    // comment used to make still holds: «jose» finding someone on one screen
    // and not on another is a bug nobody blames on the search. So the accent
    // rule changed everywhere at once on 2026-10-31, never here alone.
    return clientes.filter((c) => foldForSearch(c.nombre).includes(q));
  }, [clientes, query]);

  return (
    <>
    <Sheet open={abierta} onOpenChange={setAbierta}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      {/* `max-h-[90svh]` Y NO `vh`: `vh` mide el viewport GRANDE --el que
          habría sin la barra del navegador-- así que en un teléfono con la
          barra a la vista ese porcentaje es más alto que la pantalla. Es el
          mismo problema del `100vh` que `CLAUDE.md` nombra para iPhone. */}
      <SheetContent side="bottom" className="flex max-h-[90svh] flex-col rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{TITULO[clave]}</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
          {/* LA LÍNEA DE ARRIBA DESAPARECE CUANDO NO HAY A QUIÉN ELEGIR.
              Hasta el 2026-10-27 salía siempre, así que una hoja vacía decía
              «Selecciona un cliente.» justo encima de «Ningún plazo está por
              vencer» -- una instrucción imposible contradiciendo al mensaje
              que está debajo.

              Y en «Críticos» era peor: su línea es la definición del estado,
              o sea exactamente lo mismo que el subtítulo del estado vacío,
              escrito dos veces seguidas. */}
          {visibles.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {clave === "criticos"
                ? "Debe hace más de 30 días sin abonar."
                : "Selecciona un cliente."}
            </p>
          ) : null}

          {/* EL BUSCADOR SOLO SI HAY A QUIÉN BUSCAR. Con tres filas ocupa más
              de lo que ahorra, y con cero deja una hoja que pide filtrar una
              lista vacía. */}
          {clientes.length > 5 ? (
            <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />
          ) : null}

          {visibles.length === 0 ? (
            query.trim() ? (
              // EL BUSCADOR NO ENCONTRÓ A NADIE. Ni la frase del frame ni la
              // de «nadie en este estado» valen aquí: la lista tiene gente y
              // lo que falla es el nombre escrito. Sin botón: lo que hay que
              // hacer es corregirlo, no registrar nada.
              <EmptyState title={`No encontramos a «${query.trim()}»`} subtitle="Revisa el nombre." />
            ) : (
              <EmptyState
                title={
                  negocioSinNada
                    ? "Aún no hay clientes, ventas ni abonos registrados"
                    : VACIO_CON_NEGOCIO[clave].titulo
                }
                subtitle={
                  negocioSinNada
                    ? "Registra tu primera transacción para generar tus reportes en esta sección."
                    : VACIO_CON_NEGOCIO[clave].sub
                }
              >
                {/* ABRE `RegisterSheet`, la MISMA hoja que el botón flotante,
                    montándola con su propio estado -- que es el patrón que el
                    estado vacío de esta misma pantalla ya usa.

                    PROBÉ ANTES A ENLAZAR A `/dashboard?nuevo=1` y NO FUNCIONA:
                    ese marcador lo lee la barra de abajo, que es quien posee
                    la hoja, así que llegar ahí desde otra pantalla deja el
                    Inicio tal cual y no abre nada. Medido en el navegador --
                    navegaba y no pasaba nada más.

                    NINGUNA FLECHA DEL SITEMAP SALE DE ESTE FRAME --se
                    enumeraron los 173 conectores de la página y ninguno toca
                    `1762:*`-- así que el destino no estaba dibujado y lo
                    decidió el dueño el 2026-10-27, preguntado.

                    Y NO ENLAZA A `/ventas/nueva` NI A `/abonos/nuevo`: sería
                    una segunda entrada al mismo flujo, y el día que esa puerta
                    cambie una de las dos se queda atrás. Es la misma razón
                    escrita en el vacío de «Mejores pagadores». */}
                <Button
                  type="button"
                  className="h-10 w-full"
                  onClick={() => {
                    setAbierta(false);
                    // SE ESPERA A QUE LA HOJA SE CIERRE antes de abrir la
                    // otra. Las dos son dialogos de Radix: abiertas a la vez
                    // se apilan, y encadenadas en el mismo tick el cierre de
                    // la primera puede dejar el `pointer-events: none` que
                    // pone en el `body` -- con la segunda hoja a la vista y
                    // sin poder tocarla. 220ms es la animacion de salida.
                    setTimeout(() => setRegistrando(true), 220);
                  }}
                >
                  <Plus aria-hidden="true" />
                  Registrar
                </Button>
              </EmptyState>
            )
          ) : (
            // LA LISTA SE DESPLAZA DENTRO DE LA HOJA, no la hoja entera: con
            // cuarenta clientes el título y el buscador tienen que quedarse a
            // la vista mientras se baja.
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {visibles.map((c) => (
                <li key={c.clientId}>
                  <Link
                    href={`/clients/${c.clientId}`}
                    className="flex items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors active:bg-accent"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{c.nombre}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {subtitulo(c, clave, ahora)}
                      </span>
                      {/* DOS CHIPS CUANDO HACE FALTA, igual que la lista de
                          clientes: «mala paga» es una MARCA y no un estado --
                          `CLAUDE.md` lo deja escrito, y por eso tiene su
                          propia paleta--. Un cliente marcado que además lleva
                          dos meses vencido es las dos cosas, y esconder una
                          cambia a quién se cobra primero. */}
                      <span className="flex flex-wrap items-center gap-1">
                        <ChipDeEstado estado={c.status} />
                        {c.marcado ? (
                          <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                            Mala paga
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
                      {formatPriceAmount(c.monto, c.libro as PriceCurrency)}
                      <CurrencyFlagIcon currency={c.libro as PriceCurrency} />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
    {/* FUERA DE LA HOJA DE PLAZOS, a proposito: montada dentro, se
        desmontaria con ella justo cuando hay que abrirla. */}
    <RegisterSheet open={registrando} onOpenChange={setRegistrando} />
    </>
  );
}
