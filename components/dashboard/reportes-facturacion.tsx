"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Eye,
  EyeOff,
  Package,
  UserRound,
  UserRoundMinus,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { IconoDeAbono, IconoDeFiado } from "@/components/dashboard/iconos-de-movimiento";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { RegisterSheet } from "@/components/dashboard/register-sheet";
import { marcarPantallaVacia } from "@/components/dashboard/pantalla-vacia";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import { PlazosSheet } from "@/components/dashboard/reportes-plazos-sheet";
import type {
  ClavePlazo,
  ClienteDePlazo,
  Facturacion,
  Libro,
} from "@/lib/reports/facturacion";

// ═══════════════════════════════════════════════════════════════════════
// LA PESTAÑA «FACTURACIÓN» — frame `1502:10283`
//
// Cuatro bloques, en el orden del frame: Cartera, Transacciones, Plazos de
// pago y Mejores pagadores. De dónde sale cada cifra y las decisiones que el
// mock no toma están en `lib/reports/facturacion.ts`.
// ═══════════════════════════════════════════════════════════════════════

const NOMBRE_DEL_LIBRO: Record<Libro, string> = {
  USD: "Dólares",
  // «Euro», en singular, que es como lo escribe el frame.
  EUR: "Euro",
  COP: "Pesos",
};

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
    <span className={cn("flex items-center gap-1.5 tabular-nums", className)}>
      {/* OCULTAR ES SUSTITUIR, NO BORRAR: el hueco conserva su sitio, así que
          la tarjeta no cambia de alto al taparse y la pantalla no salta. */}
      {oculto ? "•••••" : formatPriceAmount(valor, libro as PriceCurrency)}
      <CurrencyFlagIcon currency={libro as PriceCurrency} />
    </span>
  );
}

function TarjetaDeMonto({
  rotulo,
  valor,
  libro,
  oculto,
  icono,
}: {
  rotulo: string;
  valor: number;
  libro: Libro;
  oculto: boolean;
  // EL FRAME LE RESERVA UNA COLUMNA A LA DERECHA (el «Icons Container» de
  // `card_total_debt`, 24px de ancho). Entra como ranura y no como un icono
  // fijo porque cada tarjeta lleva el suyo.
  icono?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2 rounded-[10px] border px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{rotulo}</span>
        <Monto valor={valor} libro={libro} oculto={oculto} className="text-xl leading-7" />
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
}: {
  datos: Facturacion;
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
  const [registrando, setRegistrando] = useState(false);
  const { libros } = datos;

  const hayVentas = libros.some((l) => (datos.ventas[l] ?? 0) > 0);
  const hayCartera = libros.some((l) => (datos.porCobrar[l] ?? 0) > 0);

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
        <RegisterSheet open={registrando} onOpenChange={setRegistrando} />
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col">
      {/* ══ CARTERA ══════════════════════════════════════════════════ */}
      {/* `id` + `scroll-mt-28`: el ancla sirve de poco si el titulo queda
          DEBAJO de la cabecera pegada, que mide 112px colapsada. Ver
          `lib/reports/secciones.ts`. */}
      <section id="cartera" className="flex scroll-mt-28 flex-col">
        <TituloDeBloque
          texto="Cartera"
          accion={
            <button
              type="button"
              onClick={() => setOculto((v) => !v)}
              aria-pressed={oculto}
              aria-label={oculto ? "Mostrar importes" : "Ocultar importes"}
              className="-m-2 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {oculto ? <Eye className="size-6" /> : <EyeOff className="size-6" />}
            </button>
          }
        />
        {!hayCartera && !hayVentas ? (
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
            <div className="flex gap-3">
              {libros.map((l) => (
                <TarjetaDeMonto
                  key={l}
                  rotulo={libros.length > 1 ? `Ventas en ${NOMBRE_DEL_LIBRO[l]}` : "Ventas"}
                  valor={datos.ventas[l] ?? 0}
                  libro={l}
                  oculto={oculto}
                  // `paid` en #007956 -- frame `1752:14744`. `CircleDollarSign`
                  // de lucide es la misma moneda; el dueño dijo que los iconos
                  // que pasó son referenciales y el COLOR es el requisito.
                  icono={<CircleDollarSign className="size-4 text-brand-sales" aria-hidden />}
                />
              ))}
            </div>
            {/* QUÉ CUENTA «VENTAS», porque dejó de contar lo mismo el
                2026-10-29 y la cifra cae un 88 %. Una bajada así sin una
                línea que la explique se lee como que la app perdió datos. */}
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
                nombre: libros.length > 1 ? `Ventas en ${NOMBRE_DEL_LIBRO[l]}` : "Ventas",
                clase: i === 0 ? "bg-money-in" : "bg-sky-600",
              }))}
            />
          </div>
        )}
      </section>

      {/* ══ TRANSACCIONES ════════════════════════════════════════════ */}
      {/* `id` + `scroll-mt-28`: el ancla sirve de poco si el titulo queda
          DEBAJO de la cabecera pegada, que mide 112px colapsada. Ver
          `lib/reports/secciones.ts`. */}
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
              valores: [p.contado, p.abono, p.fiado],
            }))}
            series={[
              { nombre: "De contado", clase: "bg-money-in" },
              { nombre: "Abono", clase: "bg-sky-600" },
              { nombre: "Fiado", clase: "bg-destructive" },
            ]}
          />
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={
                  libros.length > 1
                    ? `Transacciones por catálogo en ${NOMBRE_DEL_LIBRO[l]}`
                    : "Transacciones por catálogo"
                }
                valor={datos.ventasPorCatalogo[l] ?? 0}
                libro={l}
                oculto={oculto}
                // ── EL ICONO ES EL DE «CATÁLOGO» DE LA BARRA DE ABAJO ────
                //
                // Encargo del dueño el 2026-10-29. SE APARTA DEL FRAME a
                // propósito: `1752:14808` especifica `package_2`, y aquí va
                // `Package`, que es el que `mobile-nav.tsx` usa para la
                // pestaña «Catálogo». El verde se queda.
                //
                // Por qué pesa más que el frame: esta tarjeta habla de lo que
                // entró por el catálogo, y el tendero llega al catálogo por
                // ese icono. Dos dibujos distintos para la misma cosa en la
                // misma pantalla le piden aprenderse dos.
                icono={<Package className="size-4 text-brand-sales" aria-hidden />}
              />
            ))}
          </div>
          {/* ── POR QUÉ PUEDE SALIR MAYOR QUE «VENTAS» ──────────────────
              Esta cuenta TODO lo que pasó por pedidos --fiado y contado,
              decisión del dueño el 2026-10-29-- y «Ventas» ya solo cuenta el
              contado. En dev son $1.729,00 contra $1.556,00: la parte mayor
              que el todo. Las dos son correctas; juntas y sin esta línea se
              leen como un error de la app. */}
          <p className="text-xs leading-4 text-muted-foreground">
            Todo lo que se movió por pedidos del catálogo, fiado y de contado. Por eso puede
            ser mayor que «Ventas».
          </p>

          {/* ── ABONOS Y FIADOS — encargo del dueño el 2026-10-29 ───────
              Van aquí, encima de «Pedidos por atender», y en este orden,
              que es el de la leyenda del gráfico de este mismo bloque:
              «De contado · Abono · Fiado». El contado ya tiene su tarjeta
              arriba, en Cartera, con el rótulo «Ventas».

              LOS COLORES DE LOS ICONOS SON LOS DE ESAS SERIES --sky para el
              abono, destructive para el fiado-- y no unos nuevos: es el
              único lenguaje visual que la pantalla ya tiene para estas dos
              cosas. Las FORMAS son propuestas: estas dos tarjetas no están
              en ningún frame, las pidió él hoy. */}
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={libros.length > 1 ? `Abonos en ${NOMBRE_DEL_LIBRO[l]}` : "Abonos"}
                valor={datos.abonos[l] ?? 0}
                libro={l}
                oculto={oculto}
                icono={<IconoDeAbono className="size-4 text-sky-600" aria-hidden />}
              />
            ))}
          </div>
          {/* LO QUE PAGÓ AL FIAR TAMBIÉN CUENTA AQUÍ, y es la mitad que
              sorprende: un fiado con abono inicial no escribe movimiento de
              abono --escribe un cargo por lo que queda-- así que sin esto
              ese dinero no salía en ninguna tarjeta de la pantalla. */}
          <p className="text-xs leading-4 text-muted-foreground">
            Lo que tus clientes pagaron de sus deudas, incluido lo que abonaron al momento de
            fiar.
          </p>
          <div className="flex gap-3">
            {libros.map((l) => (
              <TarjetaDeMonto
                key={l}
                rotulo={libros.length > 1 ? `Fiados en ${NOMBRE_DEL_LIBRO[l]}` : "Fiados"}
                valor={datos.fiados[l] ?? 0}
                libro={l}
                oculto={oculto}
                icono={<IconoDeFiado className="size-4 text-destructive" aria-hidden />}
              />
            ))}
          </div>
          <p className="text-xs leading-4 text-muted-foreground">
            Lo que fiaste {periodoTexto}. «Por cobrar», arriba, es lo que te deben en total.
          </p>
          {/* UNA SOLA TARJETA DE PEDIDOS, y el frame dibuja dos idénticas.
              No es una por moneda: un pedido sin atender no tiene moneda
              todavía --nadie ha decidido cómo se cobra--. Dos tarjetas con el
              mismo número se leen como dos cosas distintas que coinciden. */}
          <Link
            href="/productos/ordenes"
            className="flex items-center gap-3 rounded-[10px] border px-3 py-3 transition-colors active:bg-accent"
          >
            <span className="text-xl leading-7 text-money-due tabular-nums">
              {datos.pedidosPorAtender}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">Pedidos por atender</span>
              {/* EL DINERO QUE ESPERA, y es el motivo de la tarjeta. Encargo
                  del dueño el 2026-10-27: *«mostrar el dinero pendiente por
                  atender es un cue visual para incentivar a que atienda los
                  pedidos»*. Un «3» no dice si vale la pena dejar lo que estás
                  haciendo; un «$240» sí.

                  EN SU MONEDA MÁS GRANDE Y NO SUMADO: en este producto no hay
                  tasa de euro a dólar, así que un total único sería inventado.
                  El porqué entero está en `pendingOrdersMoney`. */}
              {datos.dineroPorAtender ? (
                <Monto
                  valor={datos.dineroPorAtender.amount}
                  libro={datos.dineroPorAtender.currency as Libro}
                  oculto={oculto}
                  className="text-xs text-muted-foreground"
                />
              ) : null}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </div>
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
              <Link href="/dashboard?nuevo=abono">Registrar abono</Link>
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
