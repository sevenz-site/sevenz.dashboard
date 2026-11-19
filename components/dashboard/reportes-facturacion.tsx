"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Package,
  Undo2,
  UserRound,
  UserRoundMinus,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBsHoy } from "@/lib/exchange-rate/format";
import { IconoDeAbono, IconoDeFiado } from "@/components/dashboard/iconos-de-movimiento";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { RegisterSheet } from "@/components/dashboard/register-sheet";
import { marcarPantallaVacia } from "@/components/dashboard/pantalla-vacia";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import { PlazosSheet } from "@/components/dashboard/reportes-plazos-sheet";
import { MetodosDePago } from "@/components/dashboard/reportes-metodos-de-pago";
import {
  BotonDelOjo,
  ReportesCierreDelDia,
  ReportesCierreDelMes,
  type DesgloseDelCierre,
} from "@/components/dashboard/reportes-cierre-del-mes";
import type { CierreDelDia, CierreDelMes, FilaDelDia } from "@/lib/reports/cierre-del-mes";
import type {
  ClavePlazo,
  ClienteDePlazo,
  Facturacion,
  Libro,
} from "@/lib/reports/facturacion";

// ═══════════════════════════════════════════════════════════════════════
// LA PESTAÑA «FACTURACIÓN» — frame `1502:10283`
//
// Since the owner's frame of 2026-11-17 (2189:28237), in this order: the day's and the month's
// close, Por cobrar, Ventas de contado, Transacciones, Abonos, Fiados, Devoluciones, Pedidos,
// Métodos de pago, Plazos de pago and Mejores pagadores. Where each figure comes from, and the
// decisions the mock does not take, is in `lib/reports/facturacion.ts`.
// ═══════════════════════════════════════════════════════════════════════

const NOMBRE_DEL_LIBRO: Record<Libro, string> = {
  USD: "Dólares",
  // «Euro», en singular, que es como lo escribe el frame.
  EUR: "Euro",
  COP: "Pesos",
};

// «Total en Dólares», «Total en Euros», «Ventas en Euros»: the frame's plural, for the cards and
// the legend of «Ventas de contado» (read on 2026-11-17).
const NOMBRE_EN_PLURAL: Record<Libro, string> = { USD: "Dólares", EUR: "Euros", COP: "Pesos" };

function Monto({
  valor,
  libro,
  oculto,
  className,
}: {
  valor: number;
  libro: Libro;
  oculto: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1 tabular-nums", className)}>
      {/* THE FLAG BEFORE THE AMOUNT since the frame of 2026-11-17 (2189:28237); it went after
          until then. */}
      <CurrencyFlagIcon currency={libro as PriceCurrency} />
      {/* OCULTAR ES SUSTITUIR, NO BORRAR: el hueco conserva su sitio, así que
          la tarjeta no cambia de alto al taparse y la pantalla no salta. */}
      {oculto ? "•••••" : formatPriceAmount(valor, libro as PriceCurrency)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA EQUIVALENCIA EN BOLÍVARES DE UNA TARJETA
//
// Encargo del dueño el 2026-10-29: *«ninguna card de facturación tiene su
// equivalencia en bolívares, agrégalos»*. Y era cierto -- la llevaban el
// Inicio, las filas del historial y las hojas de Inventario, y las siete
// tarjetas de esta pestaña no.
//
// «HOY» Y NO UNA TASA SELLADA, porque estas cifras no son una transacción:
// son un total que se recalcula en cada carga. El mismo rótulo que ya usa la
// tarjeta de capital del Inicio, y la misma palabra que distingue una
// referencia de un hecho en el historial.
//
// SE TAPA CON EL OJO, al contrario que el puntaje de «Mejores pagadores»:
// esto SÍ es dinero, y taparlo a medias --la cifra oculta y su equivalencia a
// la vista-- no taparía nada.
//
// EL LIBRO COLOMBIANO NO LA LLEVA. `tasas` es `null` para él y no hay
// bolívares que enseñar; su propia moneda ya es la de la casa.
function EnBolivares({
  valor,
  libro,
  oculto,
  tasas,
}: {
  valor: number;
  libro: Libro;
  oculto: boolean;
  tasas: { usd: number; eur: number } | null;
}) {
  if (!tasas) return null;
  const tasa = libro === "USD" ? tasas.usd : libro === "EUR" ? tasas.eur : null;
  if (tasa == null || !(tasa > 0)) return null;
  // IT WRAPS, IT IS NOT CUT. With four decimals (2026-11-17) «Bs. 754.072,3612 hoy» needs 119px
  // and a half-width card on a phone gives it 116: `truncate` turned «hoy» into «h…», and that
  // word is the one that says the figure moves with the rate. Wrapped, «hoy» drops to a second
  // line and nothing is lost. Found by the v0.10.0 checklist at 375px.
  return (
    <span className="text-xs break-words text-muted-foreground tabular-nums">
      {oculto ? "•••••" : `${formatBsHoy(valor * tasa)}`}
    </span>
  );
}

function TarjetaDeMonto({
  rotulo,
  valor,
  libro,
  oculto,
  tasas,
  icono,
  color,
  grande = false,
}: {
  rotulo: string;
  valor: number;
  libro: Libro;
  oculto: boolean;
  tasas: { usd: number; eur: number } | null;
  /** The amount's colour, as the frame of 2026-11-17 paints it per block. None: the text's. */
  color?: string;
  /** 24px, «Por cobrar» in that frame; the rest are 20. */
  grande?: boolean;
  // EL FRAME LE RESERVA UNA COLUMNA A LA DERECHA (el «Icons Container» de
  // `card_total_debt`, 24px de ancho). Entra como ranura y no como un icono
  // fijo porque cada tarjeta lleva el suyo.
  icono?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2 rounded-[10px] border px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{rotulo}</span>
        <Monto
          valor={valor}
          libro={libro}
          oculto={oculto}
          className={cn(grande ? "text-2xl leading-8" : "text-xl leading-7", color)}
        />
        <EnBolivares valor={valor} libro={libro} oculto={oculto} tasas={tasas} />
      </div>
      {icono ? <span className="shrink-0">{icono}</span> : null}
    </div>
  );
}

// ── EL GRÁFICO DE BARRAS ────────────────────────────────────────────
//
// A mano y no con una librería: son siete cubos y dos o tres series, y
// `@tanstack/react-table` ya enseñó lo que cuesta atar una pantalla a una
// dependencia que luego hay que migrar (ver `CLAUDE.md`). Aquí no hay ejes,
// ni tooltips, ni zoom -- el frame no los dibuja.
//
// LA ALTURA ES RELATIVA AL MÁXIMO DE TODO EL GRÁFICO, no de cada barra: si
// cada una se escalara sola, siete barras distintas se dibujarían iguales.
function Barras({
  puntos,
  series,
  oculto,
}: {
  puntos: { etiqueta: string; valores: number[] }[];
  series: { nombre: string; clase: string }[];
  oculto: boolean;
}) {
  const maximo = Math.max(0, ...puntos.flatMap((p) => p.valores));

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border px-4 pt-4 pb-2">
      {/* 92px: el alto del `Chart container` del frame (nodo `1505:...`). */}
      {/* `items-stretch` Y LA COLUMNA CON `h-full`, y no es cosmético: con
          `items-end` en el padre, cada columna coge el alto de su contenido, y
          entonces el `height: N%` de cada barra se resuelve contra CERO. Las
          barras medían 0,0px --medido en el navegador el 2026-10-27-- mientras
          las de valor cero, que llevan 2px fijos, sí se veían. Un gráfico donde
          solo se dibuja lo que vale cero. */}
      <div className="flex h-[92px] items-stretch justify-between gap-2">
        {puntos.map((p, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end justify-center gap-0.5">
              {p.valores.map((v, j) => {
                // CERO SE DIBUJA COMO UNA RAYA y no como nada. El frame lo hace
                // así --sus cubos vacíos llevan un guion-- y resuelve una
                // ambigüedad real: una barra ausente se lee como «no hay dato»,
                // y esto es «ese día no hubo».
                const alto = maximo > 0 ? Math.round((v / maximo) * 100) : 0;
                return (
                  <div
                    key={j}
                    className={cn(
                      "w-1.5 rounded-sm",
                      v > 0 ? series[j].clase : "bg-muted",
                    )}
                    style={{ height: v > 0 ? `${Math.max(alto, 6)}%` : "2px" }}
                  />
                );
              })}
            </div>
            <span className="text-[11px] text-muted-foreground">{p.etiqueta}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.nombre} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn("size-2 rounded-[2px]", s.clase)} aria-hidden />
            {s.nombre}
          </span>
        ))}
      </div>
      {oculto ? (
        <span className="sr-only">Importes ocultos</span>
      ) : null}
    </div>
  );
}

function TituloDeBloque({
  texto,
  subtitulo,
  accion,
}: {
  texto: string;
  subtitulo?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 pt-3 pb-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{texto}</h2>
        {accion}
      </div>
      {subtitulo ? (
        <p className="text-xs leading-4 text-muted-foreground">{subtitulo}</p>
      ) : null}
    </div>
  );
}

export function ReportesFacturacion({
  datos,
  periodoTexto,
  tasas,
  cierreDelDia,
  desgloseDelDia,
  ventasDelDia,
  cierreDelMes,
  desgloseDelMes,
  country,
}: {
  datos: Facturacion;
  /** Today so far, and its sales (`lib/reports/cierre-del-mes.ts`). Null: not drawn. */
  cierreDelDia: CierreDelDia | null;
  /** The four types of each close (Facturación's own arithmetic over its span). */
  desgloseDelDia: DesgloseDelCierre | null;
  desgloseDelMes: DesgloseDelCierre | null;
  ventasDelDia: FilaDelDia[];
  /** The last closed month. Null: not drawn. */
  cierreDelMes: CierreDelMes | null;
  country: string | null;
  /**
   * Bs por dólar y por euro, para la segunda línea de cada tarjeta.
   *
   * `null` en un negocio colombiano, que no tiene bolívares: entonces ninguna
   * tarjeta dibuja esa línea, igual que ninguna fila del historial la dibuja.
   */
  tasas: { usd: number; eur: number } | null;
  // YA VIENE CON SU PREPOSICIÓN DENTRO --«del 28 sep al 27 oct», «el 27 oct»--
  // así que las frases lo pegan tal cual. Escribir «en {periodoTexto}» daba
  // «en del 28 sep al 27 oct», que se vio en pantalla el 2026-10-27.
  periodoTexto: string;
}) {
  // ── EL OJO TACHADO DEL FRAME (nodo `1502:10315`) ──────────────────
  //
  // Tapa los importes, no las cuentas. Para qué sirve, en una frase: el
  // tendero abre Reportes con un cliente delante del mostrador, y lo que no
  // quiere es que se vea cuánto factura ni cuánto le deben los demás.
  //
  // NO SE RECUERDA ENTRE VISITAS a propósito: si quedara apagado, un tendero
  // que lo usó una vez abriría su propio informe tapado sin acordarse de por
  // qué, y lo leería como que la app no carga.
  const [oculto, setOculto] = useState(false);
  const alternarOculto = () => setOculto((v) => !v);
  const [registrando, setRegistrando] = useState(false);
  const { libros } = datos;

  const hayVentas = libros.some((l) => (datos.ventas[l] ?? 0) > 0);
  const hayCartera = libros.some((l) => (datos.porCobrar[l] ?? 0) > 0);
  // A range with nothing but returns of paid fiados still has something to say.
  const hayDevoluciones = libros.some((l) => (datos.devoluciones[l] ?? 0) > 0);

  // ── CUANDO NO HAY NADA, EL FLOTANTE SE APARTA ──────────────────────
  //
  // Encargo del dueño el 2026-10-27: *«al estar visible el empty state el
  // botón flotante "Registrar" no debe ser visible»*. Es el mismo que ya
  // pidió para el catálogo el 2026-10-20; el porqué entero está en
  // `pantalla-vacia.ts`.
  //
  // «VACÍA» ES LA PESTAÑA ENTERA, no un bloque suelto: con plazos que contar
  // o pedidos esperando, la pantalla sí tiene algo que decir y su flotante
  // sigue haciendo falta.
  const vacia =
    !hayCartera &&
    !hayVentas &&
    !hayDevoluciones &&
    datos.pedidosPorAtender === 0 &&
    datos.mejoresPagadores.length === 0 &&
    datos.plazos.porVencer + datos.plazos.vencido + datos.plazos.criticos + datos.plazos.malasPagas + datos.plazos.sinPlazo === 0;

  useEffect(() => {
    marcarPantallaVacia(vacia);
    // SE APAGA AL SALIR, y eso no es opcional: una bandera que se queda
    // encendida esconde el flotante en TODA la app hasta recargar.
    return () => marcarPantallaVacia(false);
  }, [vacia]);

  // ── EL ESTADO VACÍO GENERAL — frame `1756:15450` ─────────────────
  //
  // SUSTITUYE LA PESTAÑA ENTERA, no un bloque. Es lo que ese frame dibuja y lo
  // que el dueño describió: *«este es empty state de todas las secciones de
  // reportes»*. Hasta ahora cada bloque traía el suyo, así que un negocio sin
  // nada veía cuatro cajas vacías en fila en vez de una sola frase.
  //
  // SUS DOS BOTONES SON LOS DEL FRAME, y por eso el flotante se aparta: con
  // «Registrar» dentro de la tarjeta, el de la barra sería el mismo control
  // dos veces -- la misma razón escrita en `pantalla-vacia.ts`.
  //
  // «Registrar» Y NO «Registar», que es como lo escribe el frame.
  if (vacia) {
    return (
      <EmptyState
        title="Aún no hay clientes, ventas ni abonos registrados"
        subtitle="Registra tu primera transacción para generar tus reportes en esta sección."
      >
        {/* ABRE LA MISMA HOJA QUE EL BOTÓN FLOTANTE, montando `RegisterSheet`
            con su propio estado: esa hoja se controla desde fuera a propósito
            --lo dice su comentario-- justo para que cada disparador traiga su
            maquetación. Enlazar a una ruta en su lugar elegiría por el tendero
            entre venta, fiado y abono, que es lo que esa hoja existe para no
            hacer. */}
        <Button type="button" className="h-10 w-full" onClick={() => setRegistrando(true)}>
          Registrar
        </Button>
        <Button asChild variant="outline" className="h-10 w-full">
          <Link href="/productos/nuevo">Crear producto</Link>
        </Button>
        <RegisterSheet open={registrando} onOpenChange={setRegistrando} surface="report" />
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col">
      {/* ══ LOS CIERRES — owner's request of 2026-11-17 (frame 2189:28187) ══════════════
          At the top, under the assistant: «Cierre del día» (today so far) and «Cierre de …»
          (the last closed month, moved here from Inventario). Each is null when it could not
          be read or a client is picked; see `app/(app)/reportes/page.tsx`. */}
      {cierreDelDia ? (
        <section id="cierre-del-dia" className="flex scroll-mt-28 flex-col pt-3">
          <ReportesCierreDelDia
            cierre={cierreDelDia}
            desglose={desgloseDelDia}
            ventas={ventasDelDia}
            country={country}
            oculto={oculto}
            onAlternarOculto={alternarOculto}
          />
        </section>
      ) : null}
      {cierreDelMes ? (
        <section id="cierre-del-mes" className="flex scroll-mt-28 flex-col pt-3">
          <ReportesCierreDelMes
            cierre={cierreDelMes}
            desglose={desgloseDelMes}
            country={country}
            oculto={oculto}
            onAlternarOculto={alternarOculto}
          />
        </section>
      ) : null}

      {/* ══ POR COBRAR ═══════════════════════════════════════════════════
          «Cartera» until 2026-11-17, renamed by the owner. THE ANCHOR STAYS `cartera`: the
          `negocio_resumen` WhatsApp («Ver mi cartera») lands on it with an address Meta approved.
          `scroll-mt-28`: the sticky header measures 112px collapsed (`lib/reports/secciones.ts`). */}
      <section id="cartera" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque
          texto="Por cobrar"
          accion={<BotonDelOjo oculto={oculto} onClick={alternarOculto} />}
        />
        {!hayCartera && !hayVentas && !hayDevoluciones ? (
          <EmptyState
            title="Todavía no hay nada que resumir"
            subtitle={`No se registraron ventas ni fiados ${periodoTexto}.`}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              {libros.map((l) => (
                <TarjetaDeMonto
                  key={l}
                  rotulo={libros.length > 1 ? `Por cobrar en ${NOMBRE_DEL_LIBRO[l]}` : "Por cobrar"}
                  valor={datos.porCobrar[l] ?? 0}
                  libro={l}
                  oculto={oculto}
                  tasas={tasas}
                  // #BF4C00 at 24px, the frame's «warning» (read on 2026-11-17).
                  color="text-warning"
                  grande
                  // EL ICONO DEL FRAME `1752:14798` es `report` -- una
                  // admiración dentro de un círculo-- en #BF4C00, que es el
                  // token `--brand-report` creado para esto. `CircleAlert` de
                  // lucide es la misma forma; el dueño dijo que los iconos que
                  // pasó son referenciales y el COLOR es el requisito.
                  icono={<CircleAlert className="size-4 text-brand-report" aria-hidden />}
                />
              ))}
            </div>
            {/* ── ESTA CIFRA NO DEPENDE DEL PERIODO, Y HAY QUE DECIRLO ───
                Está dibujada debajo de un selector de fechas que no la toca:
                es el saldo de HOY, acumulado desde siempre.

                EL DUEÑO ESTUVO A PUNTO DE CAMBIARLO el 2026-10-29 --pidió
                que respetara el periodo-- y lo reabrió al ver la medición:
                con el rango de 30 días la tarjeta de euros pasaba de
                €5.456,21 a €431,76, porque €5.224,45 de deuda viva nació
                antes. El peor caso es un tendero que abre Reportes y cree
                que casi nadie le debe. Lo del periodo lo contestan «Fiados»
                y «Abonos», más abajo. */}
            <p className="text-xs leading-4 text-muted-foreground">
              Total de lo que te deben. No cambia con el periodo que elijas.
            </p>
          </div>
        )}
      </section>

      {/* ══ VENTAS DE CONTADO — its own block since the frame of 2026-11-17 ═══════════
          The cards that read «Ventas» inside «Cartera» until then, now «Total en …», and the
          sales chart under them. Same figure as before: what was collected in cash, minus the
          cash given back in returns. Hidden while there is nothing at all, like «Por cobrar». */}
      {hayCartera || hayVentas || hayDevoluciones ? (
        <section id="ventas-de-contado" className="flex scroll-mt-28 flex-col">
          <TituloDeBloque
            texto="Ventas de contado"
            accion={<BotonDelOjo oculto={oculto} onClick={alternarOculto} />}
          />
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              {libros.map((l) => (
                <TarjetaDeMonto
                  key={l}
                  rotulo={libros.length > 1 ? `Total en ${NOMBRE_EN_PLURAL[l]}` : "Total"}
                  valor={datos.ventas[l] ?? 0}
                  libro={l}
                  oculto={oculto}
                  tasas={tasas}
                  // #007956, the frame's «success».
                  color="text-brand-sales"
                  // `paid` en #007956 -- frame `1752:14744`. `CircleDollarSign`
                  // de lucide es la misma moneda; el dueño dijo que los iconos
                  // que pasó son referenciales y el COLOR es el requisito.
                  icono={<CircleDollarSign className="size-4 text-brand-sales" aria-hidden />}
                />
              ))}
            </div>
            {/* WHAT THIS FIGURE COUNTS, because it stopped counting the same thing on
                2026-10-29 and fell 88 %. A drop like that with no line explaining it reads
                as the app losing data. */}
            <p className="text-xs leading-4 text-muted-foreground">
              Solo lo que cobraste de contado. Lo que fiaste está más abajo, en «Fiados».
            </p>
            <Barras
              oculto={oculto}
              puntos={datos.serieVentas.map((p) => ({
                etiqueta: p.etiqueta,
                valores: libros.map((l) => p[l] ?? 0),
              }))}
              series={libros.map((l, i) => ({
                nombre: libros.length > 1 ? `Ventas en ${NOMBRE_EN_PLURAL[l]}` : "Ventas",
                clase: i === 0 ? "bg-money-in" : "bg-sky-600",
              }))}
            />
          </div>
        </section>
      ) : null}

      {/* ══ TRANSACCIONES ════════════════════════════════════════════ */}
      <section id="transacciones" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque
          texto="Transacciones"
          // EL SUBTÍTULO DICE QUE SON RECUENTOS, y no está en el frame.
          // Va porque sin él tres barras sin eje se leen como dinero, y el
          // porqué de que NO sean dinero está en el cargador: sumar dólares
          // con euros en una barra es el fallo del 2026-10-20.
          subtitulo={`Cuántas veces se registró cada cosa ${periodoTexto}.`}
        />
        <div className="flex flex-col gap-3">
          <Barras
            oculto={false}
            puntos={datos.serieTransacciones.map((p) => ({
              etiqueta: p.etiqueta,
              valores: [p.contado, p.abono, p.fiado, p.devolucion],
            }))}
            series={[
              { nombre: "De contado", clase: "bg-money-in" },
              { nombre: "Abono", clase: "bg-sky-600" },
              { nombre: "Fiado", clase: "bg-destructive" },
              // Owner's request of 2026-11-03; #BF4C00, «warning» in his Figma,
              // by his request of 2026-11-04.
              { nombre: "Devolución", clase: "bg-warning" },
            ]}
          />
          {/* «DE CONTADO Y FIADOS POR CATÁLOGO» — frame 2189:31547, owner's answer of
              2026-11-17. The figure did not change: everything that went through catalogue
              orders, credit and cash (his decision of 2026-10-29). Under «Ventas de contado»
              it could read larger than the cash total beside it; the label now says what it
              counts and the card lives with the counts. */}
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo="De contado y fiados por catálogo"
                valor={datos.ventasPorCatalogo[l] ?? 0}
                libro={l}
                oculto={oculto}
                tasas={tasas}
                color="text-brand-sales"
                // THE ICON IS «CATÁLOGO»'S IN THE BOTTOM BAR, owner's request of 2026-10-29:
                // the frame specifies `package_2`, and `Package` is the one `mobile-nav.tsx`
                // uses for the catalogue tab. Two drawings for the same thing on one screen ask
                // him to learn two. The green stays.
                icono={<Package className="size-4 text-brand-sales" aria-hidden />}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ══ ABONOS, FIADOS Y DEVOLUCIONES ═══════════════════════════════
          NOT IN THE FRAME OF 2026-11-17, AND THEY STAY: his answer the same day, «Se quedan,
          ponles el título con el mismo estilo y jerarquía que "Por cobrar", "Ventas de
          contado"». Each is its own block now, in the order of the chart's legend above. Their
          explanatory lines stay: each answers a doubt that was real. */}
      <section id="abonos" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque texto="Abonos" />
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={libros.length > 1 ? `Abonos en ${NOMBRE_DEL_LIBRO[l]}` : "Abonos"}
                valor={datos.abonos[l] ?? 0}
                libro={l}
                oculto={oculto}
                tasas={tasas}
                icono={<IconoDeAbono className="size-4 text-sky-600" aria-hidden />}
              />
            ))}
          </div>
          {/* WHAT WAS PAID WHEN LENDING COUNTS HERE TOO: a fiado with a first payment writes
              no abono movement, so without this that money was on no card of the screen. */}
          <p className="text-xs leading-4 text-muted-foreground">
            Lo que tus clientes pagaron de sus deudas, incluido lo que abonaron al momento de
            fiar.
          </p>
        </div>
      </section>

      <section id="fiados" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque texto="Fiados" />
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={libros.length > 1 ? `Fiados en ${NOMBRE_DEL_LIBRO[l]}` : "Fiados"}
                valor={datos.fiados[l] ?? 0}
                libro={l}
                oculto={oculto}
                tasas={tasas}
                icono={<IconoDeFiado className="size-4 text-destructive" aria-hidden />}
              />
            ))}
          </div>
          <p className="text-xs leading-4 text-muted-foreground">
            Lo que fiaste {periodoTexto}. «Por cobrar», arriba, es lo que te deben en total.
          </p>
        </div>
      </section>

      {/* «DEVOLUCIONES»: owner's request of 2026-11-03. The sentence below is not decoration:
          «Fiados» and «Abonos» already lost a part of each return, and read side by side with
          no explanation the same return looks counted twice. */}
      <section id="devoluciones" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque texto="Devoluciones" />
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={libros.length > 1 ? `Devoluciones en ${NOMBRE_DEL_LIBRO[l]}` : "Devoluciones"}
                valor={datos.devoluciones[l] ?? 0}
                libro={l}
                oculto={oculto}
                tasas={tasas}
                icono={<Undo2 className="size-4 text-warning" aria-hidden />}
              />
            ))}
          </div>
          <p className="text-xs leading-4 text-muted-foreground">
            El valor de lo que te devolvieron {periodoTexto}. «Fiados» ya descuenta lo que rebajó cada
            fiado. El dinero que devolviste ya está restado de «Ventas de contado» o de «Abonos», según
            cómo se había pagado.
          </p>
        </div>
      </section>

      {/* ══ PEDIDOS — its own block since the frame of 2026-11-17 (2189:28677) ══════════
          ONE CARD, not one per currency: an order not yet handled has no currency of its own --
          nobody has decided how it will be paid. The frame's layout: the count in #BF4C00 at
          24px with its label and the box icon on the first line; the money waiting, muted at
          16px with its flag, and the chevron on the second. */}
      <section id="pedidos" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque texto="Pedidos" />
        <Link
          href="/productos/ordenes"
          className="flex flex-col gap-1 rounded-[10px] border px-3 py-3 transition-colors active:bg-accent"
        >
          <span className="flex items-center gap-2">
            <span className="text-2xl leading-8 text-warning tabular-nums">{datos.pedidosPorAtender}</span>
            <span className="min-w-0 flex-1 text-xs">Pedidos por atender</span>
            <Package className="size-4 shrink-0 text-warning" aria-hidden />
          </span>
          <span className="flex items-center gap-2">
            {/* THE MONEY WAITING, and it is the reason for the card: owner's request of
                2026-10-27, *«mostrar el dinero pendiente por atender es un cue visual para
                incentivar a que atienda los pedidos»*. In its largest currency and not added
                up: see `pendingOrdersMoney`. */}
            <span className="min-w-0 flex-1">
              {datos.dineroPorAtender ? (
                <Monto
                  valor={datos.dineroPorAtender.amount}
                  libro={datos.dineroPorAtender.currency as Libro}
                  oculto={oculto}
                  className="text-base text-muted-foreground"
                />
              ) : null}
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </span>
        </Link>
      </section>

      {/* ══ MÉTODOS DE PAGO ═══════════════════════════════════════════ */}
      {/* Owner's request of 2026-11-17: «¿Cuáles son los métodos de pago que generan mayor
          ingreso?». After the money cards it splits, before the clients. See `MetodosDePago`. */}
      <section id="metodos-de-pago" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque
          texto="Métodos de pago"
          subtitulo={`Lo que cobraste ${periodoTexto} con cada método, de mayor a menor. Ya descuenta lo que devolviste por cada uno.`}
        />
        <MetodosDePago libros={libros} porMetodo={datos.porMetodo} oculto={oculto} />
      </section>

      {/* ══ PLAZOS DE PAGO ═══════════════════════════════════════════ */}
      {/* `id` + `scroll-mt-28`: el ancla sirve de poco si el titulo queda
          DEBAJO de la cabecera pegada, que mide 112px colapsada. Ver
          `lib/reports/secciones.ts`. */}
      <section id="plazos" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque texto="Plazos de pago" />
        <div className="grid grid-cols-2 gap-3">
          {/* LOS CUATRO ICONOS Y SUS DOS COLORES salen del frame `1618:12530`,
              leído el 2026-10-27. No son decorativos: separan «hay que
              vigilar» (#BF4C00) de «ya es un problema» (#E7000B), y la CIFRA
              se tiñe en otro eje -- roja solo donde el número en sí es la mala
              noticia. Por eso «Malas pagas» lleva icono rojo y cifra normal:
              la marca es grave, pero su cantidad no sube ni baja sola. */}
          <TarjetaDePlazo rotulo="Por vencer" cuenta={datos.plazos.porVencer} clave="porVencer" clientes={datos.clientesPorPlazo.porVencer} negocioSinNada={datos.negocioSinNada} Icono={UserRound} colorIcono="text-brand-report" />
          <TarjetaDePlazo rotulo="Plazo vencido" cuenta={datos.plazos.vencido} clave="vencido" clientes={datos.clientesPorPlazo.vencido} negocioSinNada={datos.negocioSinNada} Icono={UserRoundMinus} colorIcono="text-brand-report" enRojo />
          <TarjetaDePlazo rotulo="Críticos" cuenta={datos.plazos.criticos} clave="criticos" clientes={datos.clientesPorPlazo.criticos} negocioSinNada={datos.negocioSinNada} Icono={UserRoundMinus} colorIcono="text-destructive" enRojo />
          <TarjetaDePlazo rotulo="Malas pagas" cuenta={datos.plazos.malasPagas} clave="malasPagas" clientes={datos.clientesPorPlazo.malasPagas} negocioSinNada={datos.negocioSinNada} Icono={UserRoundX} colorIcono="text-destructive" />
          {/* LA QUINTA TARJETA NO ESTÁ EN EL FRAME Y SE DIBUJA SI HAY ALGUIEN.
              Un fiado vencido SIN plazo pactado cae en «Sin plazo», que no es
              ninguna de las cuatro de arriba. Sin esta tarjeta esos clientes no
              se cuentan en ninguna parte y las cuatro cifras sugieren que no
              existen -- que es peor que una tarjeta de más. */}
          {datos.plazos.sinPlazo > 0 ? (
            <TarjetaDePlazo rotulo="Sin plazo" cuenta={datos.plazos.sinPlazo} clave="sinPlazo" clientes={datos.clientesPorPlazo.sinPlazo} negocioSinNada={datos.negocioSinNada} Icono={UserRound} colorIcono="text-brand-report" />
          ) : null}
        </div>
      </section>

      {/* ══ MEJORES PAGADORES ════════════════════════════════════════ */}
      {/* `id` + `scroll-mt-28`: el ancla sirve de poco si el titulo queda
          DEBAJO de la cabecera pegada, que mide 112px colapsada. Ver
          `lib/reports/secciones.ts`. */}
      <section id="mejores-pagadores" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque
          texto="Mejores pagadores"
          // EL FRAME DEJA EL CRITERIO SIN DECIDIR --«<Agregar acá el criterio
          // objetivo…>»-- así que la pantalla lo ESCRIBE en vez de esconderlo.
          // Quien lea la lista sabe por qué sale ese cliente y no otro, y
          // puede decir que el criterio no le sirve, que es justo lo que un
          // placeholder impide.
          // YA NO LLEVA EL PERIODO, porque la lista ya no depende de él: el
          // puntaje mide toda la historia del cliente. Prometer un rango que
          // no se aplica es la clase de rótulo que hace dudar de la cifra.
          subtitulo="Tus clientes con mejor puntaje de crédito, de toda su historia contigo."
        />
        {datos.mejoresPagadores.length === 0 ? (
          <EmptyState
            // EL TEXTO DEL FRAME `1755:15157`, con dos arreglos que se dicen
            // en voz alta: su subtítulo escribe «Nadia» --errata-- y fija «los
            // últimos 7 días», que aquí depende del rango que el tendero haya
            // elegido.
            title="Aún no hay clientes calificados"
            // TAMPOCO LLEVA PERIODO, por lo mismo que el subtítulo de
            // arriba. Y dice la razón de verdad: el puntaje necesita fiados
            // CERRADOS para existir, así que un negocio joven --o uno que
            // solo vende de contado-- no tiene a nadie que calificar.
            subtitle="Un cliente califica cuando ha cerrado algún fiado. Todavía no hay ninguno con historial suficiente."
          >
            {/* EL ESTADO VACÍO OFRECE LA ACCIÓN, no solo informa. Encargo del
                dueño el 2026-10-27: *«al seleccionar el botón "Registrar
                abono" debe abrir el flujo de abono»*.

                VA A `/dashboard?nuevo=abono`, que es la MISMA puerta que usa
                el botón flotante (ver `register-sheet.tsx`). Enlazar
                directamente a `/abonos/nuevo` sería una segunda entrada al
                mismo flujo, y el día que esa puerta cambie una de las dos se
                queda atrás. */}
            <Button asChild className="h-10 w-full">
              <Link href="/dashboard?nuevo=abono&origen=reporte">Registrar abono</Link>
            </Button>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {datos.mejoresPagadores.map((m) => (
              <li key={m.clientId}>
                <Link
                  href={`/clients/${m.clientId}`}
                  className="flex items-center gap-3 rounded-[10px] border border-l-4 border-l-money-in px-3 py-3 transition-colors active:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.nombre}</span>
                  {/* ── EL PUNTAJE Y SU NIVEL, NO UN IMPORTE ─────────────
                      Desde el 2026-10-29 esta lista ordena por puntaje de
                      crédito, así que la cifra de al lado tiene que ser la
                      que la ordena. Un importe al lado de un orden que no
                      sale de él es la contradicción que esta tarjeta ya
                      tuvo: ordenaba por el abono más grande y decía «quien
                      más abonó».

                      NO SE OCULTA CON EL OJO, y es deliberado: `oculto`
                      tapa DINERO, y un puntaje no lo es. Esconderlo no
                      protege nada y dejaría la fila sin su única cifra. */}
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-medium tabular-nums">{m.puntaje}</span>
                    <span className="text-xs text-muted-foreground">{m.nivel}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TarjetaDePlazo({
  rotulo,
  cuenta,
  clave,
  clientes,
  negocioSinNada,
  Icono,
  colorIcono,
  enRojo = false,
}: {
  rotulo: string;
  cuenta: number;
  clave: ClavePlazo;
  clientes: ClienteDePlazo[];
  /** Decide cual de los dos textos ensena la hoja vacia. */
  negocioSinNada: boolean;
  Icono: LucideIcon;
  colorIcono: string;
  enRojo?: boolean;
}) {
  // ── «VER TODO» VA SIEMPRE, TAMBIÉN EN CERO ──────────────────────────
  //
  // Lo tuve escondido cuando la cifra era 0, con este argumento: «una hoja
  // vacía que se despliega y hay que cerrar es peor que un 0 que no
  // reacciona». El dueño lo reportó el 2026-10-27 -- *«hay un par que les
  // falta el botón»*-- y su frame `1618:12530` lo dibuja en las CUATRO.
  //
  // Y tiene razón por algo que yo no había mirado: cuatro tarjetas iguales de
  // las que dos reaccionan y dos no se lee como que la pantalla está a medio
  // cargar, no como que están vacías. La hoja en cero no queda muda: enseña su
  // propio estado vacío, que CONFIRMA la respuesta en vez de dejar al tendero
  // dudando de si tocó bien.
  return (
    <PlazosSheet clave={clave} clientes={clientes} negocioSinNada={negocioSinNada}>
      <button
        type="button"
        className="flex flex-col gap-1 rounded-[10px] border px-3 py-3 text-left transition-colors active:bg-accent"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-xs text-muted-foreground">{rotulo}</span>
          <Icono className={cn("size-4 shrink-0", colorIcono)} aria-hidden />
        </div>
        <span
          className={cn(
            "text-2xl leading-8 tabular-nums",
            enRojo && cuenta > 0 && "text-destructive",
          )}
        >
          {cuenta}
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Clientes</span>
          <span className="flex items-center gap-0.5 text-xs">
            Ver todo
            <ChevronRight className="size-3.5" aria-hidden />
          </span>
        </div>
      </button>
    </PlazosSheet>
  );
}
