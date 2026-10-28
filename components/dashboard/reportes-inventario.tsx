"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, PackageMinus, PackageX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
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

function TituloDeBloque({ texto, subtitulo }: { texto: string; subtitulo?: string }) {
  return (
    <div className="flex flex-col gap-1 pt-3 pb-2.5">
      <h2 className="text-base font-medium">{texto}</h2>
      {subtitulo ? <p className="text-xs leading-4 text-muted-foreground">{subtitulo}</p> : null}
    </div>
  );
}

function Tarjeta({
  rotulo,
  cuenta,
  pie,
  dinero,
  Icono,
  colorIcono,
  ancha = false,
}: {
  rotulo: string;
  cuenta: number;
  pie: string;
  dinero: { currency: string; amount: number } | null;
  Icono: typeof Package;
  colorIcono: string;
  ancha?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-[10px] border px-3 py-3",
        ancha ? "w-full" : "min-w-0 flex-1",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">{rotulo}</span>
        <Icono className={cn("size-5 shrink-0", colorIcono)} aria-hidden />
      </div>
      <span className="text-2xl tabular-nums">{cuenta}</span>
      <span className="text-xs text-muted-foreground">{pie}</span>
      {dinero ? (
        <span className="pt-1 text-xs tabular-nums text-muted-foreground">
          {formatPriceAmount(dinero.amount, dinero.currency as PriceCurrency)} en mercancía
        </span>
      ) : null}
    </div>
  );
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

function AjusteDelUmbral({ umbral }: { umbral: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(umbral));
  const [guardando, startTransition] = useTransition();
  const cambiado = valor.trim() !== String(umbral);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2.5">
      <label htmlFor="umbral-stock" className="text-xs text-muted-foreground">
        Avísame cuando queden
      </label>
      <Input
        id="umbral-stock"
        type="number"
        inputMode="numeric"
        min={0}
        max={10000}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        // `h-9 w-20` Y NO UN CAMPO DE ANCHO COMPLETO: es un número de dos
        // cifras dentro de una frase, y un campo largo lo convierte en un
        // formulario.
        //
        // Y 16px DE TIPOGRAFÍA COMO MÍNIMO --`text-base`--: Safari en iPhone
        // hace zoom al enfocar cualquier campo por debajo de eso, y entonces
        // la pantalla se queda ampliada. Está en `CLAUDE.md`.
        className="h-9 w-20 text-base tabular-nums"
      />
      <span className="text-xs text-muted-foreground">o menos.</span>
      {cambiado ? (
        <Button
          type="button"
          size="sm"
          className="h-9"
          disabled={guardando}
          onClick={() =>
            startTransition(async () => {
              const r = await guardarUmbralDeStock(Number(valor));
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              // `router.refresh()` Y NO SOLO EL `revalidatePath` DE LA ACCION.
              // Medido el 2026-10-27: al bajar el umbral de 5 a 2, la base
              // guardaba el 2 y las tres tarjetas seguian diciendo 2/6/0
              // cuando ya eran 3/5/0. Un ajuste que dice «Listo» y no mueve
              // ninguna cifra se lee como que no hace nada -- y el tendero
              // deja de tocarlo.
              //
              // `revalidatePath` invalida la cache del servidor; lo que vuelve
              // a pedir el arbol es esto. Es el patron que `order-more-menu`
              // ya usa.
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
}: {
  datos: Inventario;
  periodoTexto: string;
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
          <Tarjeta
            rotulo="Productos disponibles"
            cuenta={datos.disponibles}
            pie="Listas para vender"
            dinero={datos.capital}
            Icono={Package}
            colorIcono="text-brand-sales"
          />
          <Tarjeta
            rotulo="Por agotarse"
            cuenta={datos.porAgotarse}
            pie="Revisar demanda"
            dinero={datos.capitalPorAgotarse}
            Icono={PackageMinus}
            colorIcono="text-brand-report"
          />
        </div>
        <Tarjeta
          rotulo="Referencias agotadas"
          cuenta={datos.agotadas}
          pie="Revisar demanda"
          dinero={null}
          Icono={PackageX}
          colorIcono="text-destructive"
          ancha
        />

        {/* ── LOS QUE NO ENTRAN EN NINGUNA DE LAS TRES ────────────────
            Es la línea que impide que tres cifras correctas compongan una
            respuesta falsa. Medido en dev: solo la mitad de los productos
            tiene cantidad escrita, así que un tendero podría leer
            «Disponibles: 11» como su catálogo entero teniendo 21. */}
        {datos.sinContar > 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            {datos.sinContar === 1
              ? "1 producto más no tiene cantidad anotada, así que no entra en estas cuentas."
              : `${datos.sinContar} productos más no tienen cantidad anotada, así que no entran en estas cuentas.`}{" "}
            Escríbela en su ficha y empezarán a contarse.
          </p>
        ) : null}
        {/* Y LO MISMO CON EL COSTO, porque es lo que sostiene el chip de
            dinero: sin costo escrito, la mercancía de ese producto no suma
            al capital y la cifra sale más baja de lo que es. */}
        {/* Y CUANDO HAY MERCANCIA EN VARIAS MONEDAS SE DICE. El chip enseña
            la moneda con más dinero dentro, porque sumar monedas está
            prohibido en esta app; sin esta línea, esa cifra se lee como todo
            el inventario. Medido en dev: tres monedas, y la tarjeta solo
            podía enseñar una. */}
        {datos.monedasConMercancia > 1 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            Tienes mercancía en {datos.monedasConMercancia} monedas. Arriba se muestra la de mayor
            valor; no se suman entre sí.
          </p>
        ) : null}
        {datos.sinCosto > 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">
            {datos.sinCosto === 1
              ? "1 de los que tienen existencias no tiene costo anotado, así que no cuenta en la mercancía."
              : `${datos.sinCosto} de los que tienen existencias no tienen costo anotado, así que no cuentan en la mercancía.`}
          </p>
        ) : null}

        <AjusteDelUmbral umbral={datos.umbral} />
      </div>

      {/* ══ MARGEN POR PRODUCTO ═══════════════════════════════════════ */}
      <span id="margen" className="scroll-mt-28" aria-hidden />
      <TituloDeBloque
        texto="Margen por producto"
        subtitulo="El margen que escribiste en la ficha de cada producto, de mayor a menor."
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
      {datos.lineasSueltas > 0 ? (
        <p className="pt-2 text-xs leading-4 text-muted-foreground">
          {datos.lineasSueltas === 1
            ? "1 línea vendida se escribió a mano, sin producto del catálogo, así que no aparece aquí."
            : `${datos.lineasSueltas} líneas vendidas se escribieron a mano, sin producto del catálogo, así que no aparecen aquí.`}
        </p>
      ) : null}
    </div>
  );
}
