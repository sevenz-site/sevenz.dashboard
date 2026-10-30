"use client";

import { forwardRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Package, PackageMinus, PackageX, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatCantidad } from "@/lib/products/cantidad";
import { ReportesAvisoSheet } from "@/components/dashboard/reportes-aviso-sheet";
import {
  ReportesProductosSheet,
  type FilaDeDinero,
} from "@/components/dashboard/reportes-productos-sheet";
import { cn } from "@/lib/utils";
import { esMonedaConocida, formatDinero } from "@/lib/reports/ganancia";
import { guardarUmbralDeStock } from "@/app/(app)/reportes/actions";
import type { Inventario } from "@/lib/reports/inventario";

// ═══════════════════════════════════════════════════════════════════════
// LA PESTAÑA «INVENTARIO» — frame `1667:19321`
//
// Tres bloques, en el orden del frame: «Métricas del inventario», «Margen por
// producto» y «Más vendidos». De dónde sale cada cifra, y las decisiones que
// el mock no toma, están en `lib/reports/inventario.ts`.
//
// ───────────────────────────────────────────────────────────────────────
// LO QUE EL FRAME DIBUJA Y AQUÍ NO ESTÁ, dicho en vez de inventarlo
//
// **«Ver todo» en las cinco tarjetas y cabeceras.** Sus flechas existen en el
// sitemap y llevan a cinco hojas --«Capital en inventario», «Total vendido»,
// «Referencias agotadas», el detalle del margen y el de más vendidos-- que son
// la segunda entrega, acordada con el dueño el 2026-10-27: *«los bloques
// primero»*.
//
// NO SE DIBUJAN APAGADOS NI MUERTOS. Un control que no hace nada se lee como
// que la app está rota (`CT-58`), y el propio dueño reportó justo eso el mismo
// día cuando dos de cuatro tarjetas no traían su botón.
//
// ───────────────────────────────────────────────────────────────────────
// EL CHIP DE DINERO NO VA EN LAS TRES TARJETAS, Y NO ES UN OLVIDO
//
// El frame dibuja uno debajo de cada una, pero las dos últimas repiten LA
// MISMA cifra (`$ 452.0...`), así que es relleno del mock y no dice qué va
// ahí. Donde se puede defender, va:
//
//   · Disponibles  -> lo que costó la mercancía que está en la estantería.
//     Es lo que su propia hoja llama «Capital en inventario».
//   · Por agotarse -> lo mismo, de lo que está a punto de acabarse.
//   · Agotadas     -> **no hay cifra posible**: si la cantidad es cero,
//     cualquier valor de ese inventario es cero. Enseñar «$0,00» sería un
//     dato falso con pinta de dato.
// ═══════════════════════════════════════════════════════════════════════

// LOS CINCO COLORES DEL FRAME, con los tokens que ya existen. No se crean
// nuevos: estos ya están medidos en `qa:contraste` y un sexto color inventado
// aquí entraría sin medir.
const COLORES = [
  "bg-brand-sales",
  "bg-sky-600",
  "bg-destructive",
  "bg-brand-report",
  "bg-brand-primary",
  "bg-muted-foreground",
];

function TituloDeBloque({
  texto,
  subtitulo,
  accion,
}: {
  texto: string;
  subtitulo?: string;
  /** El «Ver todo» de la derecha. Su flecha existe en el sitemap. */
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 pt-3 pb-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base font-medium">{texto}</h2>
        {subtitulo ? <p className="text-xs leading-4 text-muted-foreground">{subtitulo}</p> : null}
      </div>
      {accion ? <span className="shrink-0 pt-0.5">{accion}</span> : null}
    </div>
  );
}

// ── EL «VER TODO» DE UNA CABECERA DE BLOQUE ──────────────────────────
//
// Mismo gesto y mismo rótulo que el de las tres tarjetas de arriba, y por la
// misma razón que allí: dos palabras distintas para el mismo gesto en una
// pantalla se leen como dos cosas.
//
// REENVIA EL REF Y DERRAMA LAS PROPS -- `SheetTrigger asChild` clona a su
// hijo. El porqué entero está en el comentario de `Tarjeta`, más abajo.
const VerTodo = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  function VerTodo(props, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        className="flex items-center gap-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Ver todo
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    );
  },
);

// REENVIA EL REF Y DERRAMA LAS PROPS, y las dos cosas son obligatorias.
// `SheetTrigger asChild` NO envuelve a su hijo: lo CLONA y le cuelga encima
// sus handlers y su ref. Un componente que no los acepta se pinta perfecto y
// no abre nada -- sin error de consola, sin aviso, solo un botón que no hace
// nada al tocarlo.
//
// PASÓ AQUÍ EL 2026-10-28, con las tres tarjetas ya montadas dentro de su
// hoja: se veía el «Ver todo», se pulsaba, y no ocurría nada. Es la MISMA
// trampa que `order-product-card.tsx` dejó escrita en octubre, palabra por
// palabra, y aun así se volvió a pisar. Por eso esta nota está también aquí:
// la de allá no la lee quien edita este archivo.
const Tarjeta = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    rotulo: string;
    cuenta: number;
    pie: string;
    dinero: { currency: string; amount: number } | null;
    Icono: typeof Package;
    colorIcono: string;
    ancha?: boolean;
  }
>(function Tarjeta(
  { rotulo, cuenta, pie, dinero, Icono, colorIcono, ancha = false, className, ...props },
  ref,
) {
  return (
    // ── UN BOTON, PORQUE AHORA ABRE UNA HOJA ─────────────────────────
    //
    // Encargo del dueno el 2026-10-28. Es `<button>` y no un `<div>` con un
    // `onClick`: lo segundo no lo alcanza el teclado ni lo anuncia un lector
    // de pantalla, y aqui la tarjeta ENTERA es el area de toque -- igual que
    // en `TarjetaDePlazo` de la pestana de al lado, que resolvio esto mismo
    // el 2026-10-27.
    //
    // `text-left` PORQUE UN BOTON CENTRA SU TEXTO por defecto, que es justo
    // lo que no se nota al escribirlo y se ve raro en pantalla.
    <button
      {...props}
      ref={ref}
      type="button"
      className={cn(
        "flex flex-col gap-1 rounded-[10px] border px-3 py-3 text-left transition-colors active:bg-accent",
        ancha ? "w-full" : "min-w-0 flex-1",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">{rotulo}</span>
        <Icono className={cn("size-5 shrink-0", colorIcono)} aria-hidden />
      </div>
      <span className="text-2xl tabular-nums">{cuenta}</span>
      <span className="text-xs text-muted-foreground">{pie}</span>
      {dinero ? (
        // ── CON SU BANDERA ──────────────────────────────────────────
        // Pedido por el dueno el 2026-10-28. No es adorno: esta cifra es la
        // de la moneda con MAS dinero dentro --sumar monedas esta prohibido
        // en esta app-- asi que sin bandera un «$35.070,00» no dice si son
        // dolares o pesos colombianos, que usan el mismo simbolo. Es la misma
        // razon por la que la tarjeta «Ventas» del Inicio la lleva.
        <span className="flex items-start gap-1 pt-1 text-xs text-muted-foreground">
          {/* LA BANDERA SOLO SI LA APP CONOCE ESA MONEDA. El costo puede
              estar en una moneda «Otra», que es texto libre: sin esta guarda
              `next/image` pinta un `<img>` sin `src`. Armado desde que existe
              esta tarjeta; salió a la luz el 2026-10-28 al abrir su hoja, con
              una moneda libre entre las de más dinero. */}
          {esMonedaConocida(dinero.currency) ? (
            <CurrencyFlagIcon currency={dinero.currency} className="mt-0.5 size-4 shrink-0" />
          ) : null}
          {/* ENVUELVE, NO SE RECORTA. Con `truncate` y la bandera delante,
              «$34.665,00 en mercancía» terminaba en «en merc…» a 375px --
              medido en pantalla el 2026-10-28, justo al anadir la bandera--.
              Una cifra de dinero a medias es peor que una cifra en dos
              lineas: la tarjeta tiene alto de sobra y el recorte se come
              precisamente la palabra que dice QUE es esa cifra. */}
          <span className="min-w-0 tabular-nums">{formatDinero(dinero)} en mercancía</span>
        </span>
      ) : null}

      {/* ── «VER TODO» VA SIEMPRE, TAMBIÉN EN CERO ───────────────────
          Es la lección que la pestaña de al lado ya pagó el 2026-10-27: el
          dueño reportó que a dos de cuatro tarjetas les faltaba el botón, y
          la razón por la que va en todas es que **cuatro tarjetas iguales de
          las que unas reaccionan y otras no se leen como que la pantalla
          está a medio cargar**, no como que están vacías. La hoja en cero
          enseña su estado vacío, que confirma la respuesta. */}
      <span className="flex items-center justify-end gap-0.5 pt-1 text-xs">
        Ver todo
        <ChevronRight className="size-3.5" aria-hidden />
      </span>
    </button>
  );
});

/**
 * Las tarjetas de dinero de la hoja de «Productos disponibles».
 *
 * UNA POR MONEDA DE COSTO, que es como el frame las dibuja --€ a la
 * izquierda, $ a la derecha-- y lo que permite no sumarlas. La proyección se
 * busca por la misma moneda; si ese libro no tiene ningún precio de detal
 * escrito, la segunda línea sale «—» en vez de cero.
 *
 * SE CORTA EN DOS porque es lo que cabe a 375px sin que las cifras se partan.
 * Un negocio con mercancía en tres monedas ve las dos mayores -- lo dice la
 * nota «Tienes mercancía en N monedas» que ya vive bajo las tarjetas.
 */
function filasDeCapital(datos: Inventario): FilaDeDinero[] {
  const fila = (
    rotulo: string,
    ds: { currency: string; amount: number }[],
    nota?: string,
  ): FilaDeDinero => ({
    rotulo,
    tarjetas: ds.slice(0, 2).map((d) => ({ rotulo, dinero: d, nota })),
  });
  return [
    // LA DEL CAPITAL YA LA DA LA BANDA GRIS de encima --«Calculado en función
    // del costo de cada producto»-- así que repetirla dentro de la tarjeta
    // sería decir lo mismo dos veces en cuatro centímetros.
    fila("Capital en inventario", datos.capitalPorMoneda),
    fila(
      "Ventas proyectadas",
      datos.ventasProyectadas,
      "Precio de venta × unidades que te quedan.",
    ),
  ];
}

/** «Total vendido» de las hojas de «Por agotarse» y «Referencias agotadas». */
function filasDeVendido(ds: { currency: string; amount: number }[]): FilaDeDinero[] {
  return [{ rotulo: "Total vendido", tarjetas: ds.slice(0, 2).map((d) => ({ rotulo: "Total vendido", dinero: d })) }];
}

function GraficoDeProductos({
  filas,
  sufijo,
  vacio,
}: {
  filas: { id: string; nombre: string; valor: number; detalle: string }[];
  sufijo: string;
  vacio: React.ReactNode;
}) {
  if (!filas.length) return <>{vacio}</>;
  const maximo = Math.max(...filas.map((f) => f.valor));

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border px-4 pt-4 pb-3">
      {/* 80px es el `Chart container` del frame. `items-stretch` y `h-full`
          por la misma razón que el gráfico de Facturación: con `items-end`,
          cada columna coge el alto de su contenido y el `height: N%` de la
          barra se resuelve contra CERO -- barras de 0,0px, medido el
          2026-10-27. */}
      <div className="flex h-20 items-stretch justify-between gap-2">
        {filas.map((f, i) => (
          <div key={f.id} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={cn("w-full rounded-sm", COLORES[i % COLORES.length])}
              // El mínimo de 6% es para que un producto con margen muy bajo
              // siga siendo una barra y no una raya invisible: la leyenda lo
              // nombra, así que una barra ausente se leería como un fallo.
              style={{ height: `${Math.max(Math.round((f.valor / maximo) * 100), 6)}%` }}
              title={`${f.nombre}: ${f.detalle}`}
            />
          </div>
        ))}
      </div>
      {/* LA LEYENDA LLEVA LA CIFRA, y el frame solo pone el nombre. Sin ella
          el gráfico obliga a comparar alturas a ojo para saber cuánto vale
          cada barra, que es justo lo que una leyenda debería ahorrar. */}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {filas.map((f, i) => (
          <li key={f.id} className="flex min-w-0 items-start gap-1.5">
            <span
              className={cn("mt-1 size-2 shrink-0 rounded-[2px]", COLORES[i % COLORES.length])}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[11px] text-muted-foreground">{f.nombre}</span>
              <span className="text-[11px] tabular-nums">
                {f.detalle}
                {sufijo}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// «AVÍSAME CUANDO QUEDEN ‹N› O MENOS»
//
// Era un campo numérico libre hasta el 2026-10-29, cuando el dueño pidió un
// desplegable: *«cambiar input (…) por dropdown con opciones: 1; 2; 3; 4; 5;
// 6; 12; 24; otro. Otro abre input editable»*.
//
// POR QUÉ UNA LISTA Y NO UN CAMPO, dicho por si algún día alguien quiere
// volver: un campo numérico en una frase invita a teclear, y teclear aquí
// abre un teclado en mitad de una pantalla de lectura. Las ocho cifras que
// eligió no son arbitrarias — son la docena y la docena doble, que es como se
// compra en una bodega.
//
// ───────────────────────────────────────────────────────────────────────
// EL CERO NO ESTÁ EN LA LISTA Y SIGUE SIENDO VÁLIDO
//
// Cero significa «no me avises» (ver `guardarUmbralDeStock`), y la base lo
// acepta. No se le dio opción propia porque no lo pidió; se llega por «Otro»,
// y el campo lo dice en su pie para que no haya que adivinarlo.
//
// Y UN VALOR GUARDADO QUE NO ESTÉ EN LA LISTA ABRE «Otro» SOLO. Un negocio
// que tuviera un 7 de antes vería «Otro» con su 7 dentro, no la lista
// reseteada a 5 — que sería la pantalla cambiándole un ajuste por haberla
// abierto.
// ═══════════════════════════════════════════════════════════════════════
const OPCIONES_DEL_UMBRAL = [1, 2, 3, 4, 5, 6, 12, 24];
const OTRO = "otro";

function AjusteDelUmbral({ umbral }: { umbral: number }) {
  const router = useRouter();
  const enLaLista = OPCIONES_DEL_UMBRAL.includes(umbral);
  const [opcion, setOpcion] = useState(enLaLista ? String(umbral) : OTRO);
  const [otro, setOtro] = useState(enLaLista ? "" : String(umbral));
  const [guardando, startTransition] = useTransition();

  // `null` = lo que hay escrito no es un número guardable, así que no se
  // ofrece el botón. Es la misma cuenta que hará el servidor, hecha antes para
  // no mandar un viaje que ya se sabe que vuelve con un error.
  const elegido = (() => {
    if (opcion !== OTRO) return Number(opcion);
    const n = Number(otro.trim());
    if (otro.trim() === "" || !Number.isFinite(n) || !Number.isInteger(n)) return null;
    return n >= 0 && n <= 10000 ? n : null;
  })();
  const cambiado = elegido != null && elegido !== umbral;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="umbral-stock" className="text-xs text-muted-foreground">
          Avísame cuando queden
        </label>
        <Select
          value={opcion}
          onValueChange={(v) => {
            setOpcion(v);
            // AL ABRIR «Otro» SE ARRANCA DEL VALOR VIGENTE y no en blanco: el
            // tendero suele venir a subirlo o bajarlo un poco, y un campo
            // vacío le pide recordar en cuánto lo tenía.
            if (v === OTRO && otro.trim() === "") setOtro(String(umbral));
          }}
        >
          {/* `w-24` Y NO ANCHO COMPLETO, por lo mismo que tenía el campo: es
              un número de dos cifras dentro de una frase, y un control largo
              la convierte en un formulario. */}
          <SelectTrigger id="umbral-stock" size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_DEL_UMBRAL.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
            <SelectItem value={OTRO}>Otro</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">o menos.</span>
      </div>

      {opcion === OTRO ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Otra cantidad para el aviso"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            value={otro}
            onChange={(e) => setOtro(e.target.value)}
            // 16px DE TIPOGRAFÍA COMO MÍNIMO --`text-base`--: Safari en iPhone
            // hace zoom al enfocar cualquier campo por debajo de eso y la
            // pantalla se queda ampliada. Está en `CLAUDE.md`.
            className="h-9 w-24 text-base tabular-nums"
          />
          <span className="text-xs text-muted-foreground">
            Escribe 0 si no quieres que te avisemos.
          </span>
        </div>
      ) : null}

      {cambiado ? (
        <Button
          type="button"
          size="sm"
          className="h-9 w-fit"
          disabled={guardando}
          onClick={() =>
            startTransition(async () => {
              const r = await guardarUmbralDeStock(elegido);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              // `router.refresh()` Y NO SOLO EL `revalidatePath` DE LA ACCIÓN.
              // Medido el 2026-10-27: al bajar el umbral de 5 a 2, la base
              // guardaba el 2 y las tres tarjetas seguían diciendo 2/6/0
              // cuando ya eran 3/5/0. Un ajuste que dice «Listo» y no mueve
              // ninguna cifra se lee como que no hace nada -- y el tendero
              // deja de tocarlo.
              //
              // Y DESDE EL 2026-10-29 REFRESCA ADEMÁS LOS CHIPS de las otras
              // siete pantallas, que ahora se gradúan con este mismo número.
              router.refresh();
              toast.success("Listo, te avisaremos con ese número");
            })
          }
        >
          Guardar
        </Button>
      ) : null}
    </div>
  );
}

export function ReportesInventario({
  datos,
  periodoTexto,
  tasas,
}: {
  datos: Inventario;
  periodoTexto: string;
  /** Bs por dólar y por euro, para la línea pequeña de las hojas. */
  tasas: { usd: number; eur: number } | null;
}) {
  const sinProductos = datos.totalProductos === 0;

  if (sinProductos) {
    return (
      <EmptyState
        title="Todavía no tienes productos"
        subtitle="Crea tu primer producto para que esta sección pueda contarte qué tienes y qué se vende."
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* ══ MÉTRICAS DEL INVENTARIO ═══════════════════════════════════ */}
      <span id="metricas-inventario" className="scroll-mt-28" aria-hidden />
      <TituloDeBloque
        texto="Métricas del inventario"
        // EL SUBTÍTULO DEL FRAME HABLA DE ÓRDENES DE COMPRA --«dependen de
        // haber completado las órdenes de compras»-- y eso no existe en la
        // app. Escribirlo sería prometer una pantalla que no está.
        //
        // Lo que SÍ es verdad desde la migración 163 es esto: la cuenta baja
        // sola con cada venta, y sube cuando el tendero la corrige al reponer.
        // Decirlo es lo que hace que confíe en la cifra o sepa por qué no.
        subtitulo="La cantidad baja sola con cada venta. Cuando repongas mercancía, actualízala en la ficha del producto."
      />
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          {/* ── LA HOJA DE «DISPONIBLES» ES LA ÚNICA CON BANDA Y SEGUNDA
                 LÍNEA — frame `1673:22429` ────────────────────────────
              Su banda dice «Capital en inventario / Calculado en función del
              costo de cada producto», y sus tarjetas llevan además «Ventas
              proyectadas».

              OJO CON UNA COSA, Y SE DICE EN VEZ DE DISIMULARLA: el capital
              es el de TODA la mercancía en estantería --disponibles Y por
              agotarse--, mientras la lista de abajo son solo los
              disponibles. No es un descuido: es la definición que esta
              pantalla ya tenía escrita (*«Disponibles -> lo que costó la
              mercancía que está en la estantería»*) y la que su propio chip
              enseña. Cambiarla aquí haría que el chip de la tarjeta y la
              hoja que abre dijeran cifras distintas, que es peor. */}
          <ReportesProductosSheet
            umbral={datos.umbral}
            titulo="Productos disponibles"
            encabezado={{
              titulo: "Capital en inventario",
              sub: "Calculado en función del costo de cada producto.",
            }}
            filas={filasDeCapital(datos)}
            productos={datos.disponiblesLista}
            conChip
            // AHORA SOLO SALE SI NO HAY NADA EN ESTANTERÍA, porque
            // «disponibles» pasó a ser todo lo que tiene existencias. Antes
            // salía con el almacén lleno si todo estaba por debajo del aviso,
            // que es lo que el dueño reportó el 2026-10-29 como confuso.
            vacio={{
              titulo: "No tienes nada en existencias",
              sub: "Aquí aparecerán tus productos en cuanto les anotes cuántas unidades te quedan.",
            }}
            tasas={tasas}
          >
            <Tarjeta
              rotulo="Productos disponibles"
              cuenta={datos.disponibles}
              pie="Listas para vender"
              dinero={datos.capital}
              Icono={Package}
              colorIcono="text-brand-sales"
            />
          </ReportesProductosSheet>

          <ReportesProductosSheet
            umbral={datos.umbral}
            titulo="Por agotarse"
            filas={filasDeVendido(datos.vendidoPorAgotarse)}
            productos={datos.porAgotarseLista}
            vacio={{
              titulo: "Nada por agotarse",
              sub: "Aquí aparecerán los productos que bajen de tu aviso de existencias.",
            }}
            tasas={tasas}
          >
            <Tarjeta
              rotulo="Por agotarse"
              cuenta={datos.porAgotarse}
              pie="Revisar demanda"
              dinero={datos.capitalPorAgotarse}
              Icono={PackageMinus}
              colorIcono="text-brand-report"
            />
          </ReportesProductosSheet>
        </div>

        <ReportesProductosSheet
          umbral={datos.umbral}
          titulo="Referencias agotadas"
          filas={filasDeVendido(datos.vendidoAgotadas)}
          productos={datos.agotadasLista}
          conChip
          vacio={{
            titulo: "No tienes referencias agotadas",
            sub: "Aquí aparecerán los productos que se queden en cero.",
          }}
          tasas={tasas}
        >
          <Tarjeta
            rotulo="Referencias agotadas"
            cuenta={datos.agotadas}
            pie="Revisar demanda"
            dinero={null}
            Icono={PackageX}
            colorIcono="text-destructive"
            ancha
          />
        </ReportesProductosSheet>

        {/* ── LAS TRES CIFRAS NO SE SUMAN, Y HAY QUE DECIRLO ───────────
            Desde el 2026-10-29 «Por agotarse» es un SUBCONJUNTO de
            «disponibles» --un producto con 3 unidades y un aviso en 5 está
            disponible Y por agotarse--, así que el mismo producto cuenta en
            las dos tarjetas.

            SIN ESTA LÍNEA, 1 y 1 se leen como dos productos. Es el mismo
            problema que la nota de las monedas que va justo debajo: tres
            cifras correctas componiendo una respuesta falsa. */}
        {datos.porAgotarse > 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            «Por agotarse» ya está contado dentro de «Productos disponibles»: son los que
            tienes, pero con {formatCantidad(datos.umbral)} unidades o menos.
          </p>
        ) : null}

        {/* ── LOS QUE NO ENTRAN EN NINGUNA DE LAS TRES ────────────────
            Es la línea que impide que tres cifras correctas compongan una
            respuesta falsa. Medido en dev: solo la mitad de los productos
            tiene cantidad escrita, así que un tendero podría leer
            «Disponibles: 11» como su catálogo entero teniendo 21. */}
        {/* ══ LOS QUE NO ENTRAN EN LAS CUENTAS, EN ALERTA ═════════════
            Frame `1786:15262`, pedido por el dueno el 2026-10-28: *«Labels
            debajo de "Referencias agotadas" agregalos en alerta tipo
            warning»*.

            ERAN TRES PARRAFOS GRISES SEGUIDOS y se veian como letra pequena
            de un contrato: su captura los lleva rodeados enteros. Un aviso
            que explica por que una cifra NO es lo que parece tiene que
            leerse como aviso, no como pie de pagina.

            Y EL TEXTO ES EL DEL FRAME, que dice algo mejor que el mio: el
            mio contaba el mecanismo («no entran en estas cuentas»), el suyo
            dice la CONSECUENCIA --que sin ese dato no se pueden vigilar «Por
            agotarse» ni «Referencias agotadas»--, que es lo que mueve a
            alguien a rellenarlo.

            LA DEL COSTO SE ELIMINA, por instruccion suya del mismo dia. Lo
            que se pierde, dicho en voz alta: el capital en mercancia sale
            mas bajo de lo que es cuando algun producto con existencias no
            tiene costo, y ya nada en pantalla lo advierte. */}
        {datos.sinContar > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <p className="font-semibold">
                  {datos.sinContar === 1
                    ? "1 producto no tiene cantidad en inventario."
                    : `${datos.sinContar} productos no tienen cantidad en inventario.`}
                </p>
                <p>
                  Deben tener ese dato para poder monitorear «Por agotarse» y «Referencias
                  agotadas».
                </p>
              </div>
              {/* EL BOTON DEL FRAME, con su destino: el catalogo es donde se
                  escribe esa cantidad, en la ficha de cada producto. */}
              {/* ABRE LA HOJA CON ESOS PRODUCTOS, no el catálogo entero.
                  Encargo del dueño el 2026-10-28. Mandarlo al catálogo lo
                  obligaba a cotejar de memoria cuáles eran los cuatro. */}
              <ReportesAvisoSheet
                titulo="Sin cantidad en inventario"
                descripcion="Escribe la cantidad en la ficha de cada uno y empezarán a contarse en «Por agotarse» y «Referencias agotadas»."
                productos={datos.sinContarLista}
              >
                <button type="button" className="w-fit text-sm underline-offset-2 hover:underline">
                  Ver productos
                </button>
              </ReportesAvisoSheet>
            </div>
          </div>
        ) : null}

        {/* ══ Y LOS QUE NO TIENEN COSTO, SU PROPIA ALERTA ════════════
            Frame `1786:15280`, leido el 2026-10-28 en cuanto el puente de
            escritorio volvio.

            ESTO DESHACE LO QUE HICE UNAS HORAS ANTES. Yo habia ELIMINADO este
            aviso, porque los puntos 2 y 3 de su lista se contradecian --uno
            pedia sustituirlo por un frame y el otro borrarlo-- y elegi el
            inequivoco. El frame, al poder leerse, zanja cual era: sustituirlo.

            Y SU TEXTO CORRIGE EL MIO EN LO QUE IMPORTA. El mio decia que esos
            productos «no cuentan en la mercancia»; el suyo dice que sin costo
            no se puede vigilar EL MARGEN. Son dos consecuencias distintas y la
            suya es la que de verdad duele: el capital en mercancia es una
            cifra informativa, y el margen es lo que dice si un producto deja
            dinero.

            POR ESO LA CUENTA CAMBIO TAMBIEN: antes eran «los que tienen
            existencias y no tienen costo»; ahora son TODOS los que no tienen
            costo. El margen aplica a un producto tenga o no existencias, asi
            que la cuenta vieja habria dado un numero mas pequeno que la frase
            que lo acompana. */}
        {datos.sinCosto > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <p className="font-semibold">
                  {datos.sinCosto === 1
                    ? "1 producto no tiene especificado su costo."
                    : `${datos.sinCosto} productos no tienen especificado su costo.`}
                </p>
                <p>Deben tener ese dato para poder monitorear el margen.</p>
              </div>
              <ReportesAvisoSheet
                titulo="Sin costo especificado"
                descripcion="Escribe el costo en la ficha de cada uno para poder monitorear su margen."
                productos={datos.sinCostoLista}
              >
                <button type="button" className="w-fit text-sm underline-offset-2 hover:underline">
                  Ver productos
                </button>
              </ReportesAvisoSheet>
            </div>
          </div>
        ) : null}

        {/* ── LO DE LAS MONEDAS SE QUEDA COMO ESTA, Y SE DICE POR QUE ──
            Su cambio pedia el frame `1786:15280` y ese dia la cuenta de
            Figma habia agotado su cupo de lecturas, asi que NO se pudo
            abrir. Escribirlo «con lo que se entiende del enlace» es
            exactamente lo que `CLAUDE.md` prohibe. Queda pendiente. */}
        {datos.monedasConMercancia > 1 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            Tienes mercancía en {datos.monedasConMercancia} monedas. Arriba se muestra la de mayor
            valor; no se suman entre sí.
          </p>
        ) : null}

        <AjusteDelUmbral umbral={datos.umbral} />
      </div>

      {/* ══ MARGEN POR PRODUCTO ═══════════════════════════════════════ */}
      <span id="margen" className="scroll-mt-28" aria-hidden />
      <TituloDeBloque
        texto="Margen por producto"
        // EL SUBTÍTULO NO ES EL DEL FRAME, y se dice. `1746:14845` escribe
        // «Dependen del registro del margen y órdenes de compras
        // completadas», y las órdenes de compra NO EXISTEN en esta app:
        // copiarlo prometería una pantalla que no está. Es la misma razón por
        // la que el subtítulo del bloque de arriba tampoco es el suyo.
        subtitulo="El margen que escribiste en la ficha de cada producto, de mayor a menor."
        accion={
          datos.margenLista.length ? (
            <ReportesProductosSheet
              umbral={datos.umbral}
              titulo="Margen por producto"
              filas={[]}
              productos={datos.margenLista}
              vacio={{
                titulo: "Todavía no has anotado márgenes",
                sub: "Escribe el margen en la ficha de un producto y aquí lo verás.",
              }}
              tasas={tasas}
            >
              <VerTodo />
            </ReportesProductosSheet>
          ) : null
        }
      />
      <GraficoDeProductos
        filas={datos.margen.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          valor: m.margenPct,
          detalle: `${m.margenPct.toLocaleString("es-VE", { maximumFractionDigits: 1 })}%`,
        }))}
        sufijo=""
        vacio={
          <EmptyState
            title="Todavía no has anotado márgenes"
            subtitle="Escribe el margen en la ficha de un producto y aquí verás cuál te deja más."
          />
        }
      />

      {/* ══ MÁS VENDIDOS ══════════════════════════════════════════════ */}
      <span id="mas-vendidos" className="scroll-mt-28" aria-hidden />
      <TituloDeBloque
        texto="Más vendidos"
        subtitulo={`Lo que más salió ${periodoTexto}, en unidades.`}
        accion={
          datos.masVendidosLista.length ? (
            // SU FRAME --`1747:14327`-- NO LLEVA SUBTÍTULO NI TARJETAS DE
            // DINERO: solo el título, el buscador y la lista.
            <ReportesProductosSheet
              umbral={datos.umbral}
              titulo="Más vendidos"
              filas={[]}
              productos={datos.masVendidosLista}
              vacio={{
                titulo: "Todavía no hay ventas en este periodo",
                sub: "Aquí aparecerán los productos que vendas dentro del rango que elijas.",
              }}
              tasas={tasas}
            >
              <VerTodo />
            </ReportesProductosSheet>
          ) : null
        }
      />
      <GraficoDeProductos
        filas={datos.masVendidos.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          valor: v.unidades,
          detalle: `${v.unidades.toLocaleString("es-VE", { maximumFractionDigits: 2 })}${v.unidad ? ` ${v.unidad}` : ""}`,
        }))}
        sufijo=""
        vacio={
          <EmptyState
            title="Todavía no hay ventas en este periodo"
            subtitle={`No se vendió ningún producto del catálogo ${periodoTexto}.`}
          />
        }
      />
      {/* LAS LÍNEAS SUELTAS SE DICEN. Lo que el tendero teclea a mano en una
          venta no apunta a ningún producto, así que «más vendidos» estaría
          describiendo solo una parte de lo que vendió -- y nada en pantalla
          lo delataría. */}
      {/* ── LOS DEL RANKING QUE YA NO ESTÁN EN EL CATÁLOGO ────────────
          Encargo del dueño el 2026-10-28: *«X productos de este ranking ya no
          están en tu catálogo» + Ver productos. Ese disclaimer solo aparecerá
          cuando alguno de esos productos pertenezca al top»*.

          CAMBIA QUÉ SE CUENTA, y por eso esta nota es nueva y no un retoque.
          La de antes hablaba de LÍNEAS sin producto --que la app ya no puede
          crear: `registrarVenta` exige `productId`, comprobado ese mismo
          día-- y esta habla de PRODUCTOS que sí salen en el ranking, con su
          nombre y sus ventas, pero están en la papelera. Hasta hoy se
          dibujaban como «Producto borrado» sin decir por qué.

          Y SOLO SI ALGUNO SE VE: `fueraDelCatalogo` se calcula sobre el tramo
          que el gráfico dibuja, no sobre todas las ventas del rango. Un aviso
          sobre algo que no está en pantalla es ruido. */}
      {datos.fueraDelCatalogo.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 pt-2 text-xs leading-4 text-muted-foreground">
          <span>
            {datos.fueraDelCatalogo.length === 1
              ? "1 producto de este ranking ya no está en tu catálogo"
              : `${datos.fueraDelCatalogo.length} productos de este ranking ya no están en tu catálogo`}
          </span>
          {/* `conFicha={false}`: estos están en la papelera y su ficha
              devuelve 404. El porqué, entero, en `reportes-aviso-sheet.tsx`.

              Y POR ESO EL TEXTO MANDA A NOTIFICACIONES, que es el único sitio
              desde el que hoy se puede devolver un producto al catálogo. Dice
              «busca su aviso» y no «está ahí» a propósito: esa lista trae los
              20 más recientes, así que un borrado viejo ya no aparece. */}
          <ReportesAvisoSheet
            titulo="Ya no están en tu catálogo"
            descripcion="Sus ventas siguen contando en este ranking, pero están en la papelera. Para devolverlos al catálogo, busca su aviso en Notificaciones."
            productos={datos.fueraDelCatalogo}
            conFicha={false}
          >
            <button type="button" className="underline underline-offset-2">
              Ver productos
            </button>
          </ReportesAvisoSheet>
        </p>
      ) : null}
    </div>
  );
}
