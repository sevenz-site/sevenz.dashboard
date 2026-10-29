"use client";

import { forwardRef } from "react";
import { ChevronRight, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ReportesProductosSheet } from "@/components/dashboard/reportes-productos-sheet";
import { formatPercent } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import type { ProveedorEnReporte } from "@/lib/reports/proveedores";

// ═══════════════════════════════════════════════════════════════════════
// LA PESTAÑA «PROVEEDORES» — frame `1749:14583`
//
// Un bloque, «Métricas de proveedores», y una fila por proveedor: avatar con
// las iniciales, nombre, «Productos: N  Margen: X%» y la flecha.
//
// De dónde sale cada cifra y por qué --sobre todo el margen, que el dueño
// eligió el 2026-10-28 entre tres lecturas-- está en
// `lib/reports/proveedores.ts`.
//
// ───────────────────────────────────────────────────────────────────────
// LA FLECHA NO ESTABA DIBUJADA EN EL SITEMAP
//
// Se enumeraron los conectores de la página entera y **ninguno toca este
// frame**, así que el destino no existía: la flecha estaba dibujada sin decir
// a dónde lleva. Lo decidió el dueño el 2026-10-28, preguntado: a una hoja
// con los productos de ese proveedor, el mismo componente que abren las tres
// tarjetas de Inventario.
//
// Y NO SE DIBUJA UNA FLECHA MUERTA. `CT-58` lo tiene escrito: un control que
// no hace nada se lee como que la app está rota.
//
// ───────────────────────────────────────────────────────────────────────
// EL SUBTÍTULO ES EL DEL FRAME, Y DICE ALGO QUE HAY QUE DECIR
//
// *«Dependen del registro del proveedor al momento de crear el producto»*. Es
// literal del frame y además es el aviso que esta pantalla necesita: el
// proveedor es un campo OPCIONAL, así que esta lista describe solo la parte
// del catálogo donde alguien lo escribió. La fila «Sin proveedor» de abajo es
// la otra mitad de ese mismo aviso.
// ═══════════════════════════════════════════════════════════════════════

export function ReportesProveedores({
  filas,
  periodoTexto,
  tasas,
}: {
  filas: ProveedorEnReporte[];
  /** «del 29 sep al 28 oct», tal como lo escribe la cabecera de la pantalla. */
  periodoTexto: string;
  /** Bs por dólar y por euro, para las hojas. `null` en Colombia. */
  tasas: { usd: number; eur: number } | null;
}) {
  if (!filas.length) {
    return (
      <EmptyState
        title="Todavía no tienes productos"
        subtitle="Cuando crees productos y les anotes el proveedor, aquí verás cuántos le compras a cada uno y el margen que te dejan."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">Métricas de proveedores</h2>
        {/* ── LA SEGUNDA FRASE DICE CÓMO SE CALCULA EL MARGEN ─────────
            Encargo del dueño el 2026-10-28, con la captura y el subtítulo
            rodeado en rojo. La primera frase es la del frame y se queda: dice
            de qué depende esta lista. La segunda dice qué significa la única
            cifra que el tendero no puede rehacer de cabeza.

            «DE CADA 100 QUE PAGASTE» Y NO «SOBRE EL COSTO», que es lo mismo
            dicho en contable. Es además la forma en que los dos tenderos lo
            dijeron cuando se definió el margen en `price.ts`: *«al monto que
            me costó le aplico un 30 %»*.

            Y ESCRIBIRLA OBLIGÓ A ARREGLAR LA CUENTA: hasta ese día el margen
            se calculaba sobre la VENTA, así que esta frase habría sido falsa
            --y la pestaña de al lado llevaba meses diciendo otro número para
            los mismos productos--. El detalle está en `margenReal`. */}
        <p className="text-sm text-muted-foreground">
          Dependen del registro del proveedor al momento de crear el producto. El margen dice,
          de cada 100 que pagaste por sus productos, cuánto ganaste al venderlos {periodoTexto}.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {filas.map((f) => (
          <li key={f.clave}>
            <ReportesProductosSheet
              titulo={f.nombre}
              tarjetas={[]}
              productos={f.lista}
              vacio={{
                titulo: "Sin productos",
                sub: "Este proveedor ya no tiene productos en tu catálogo.",
              }}
              tasas={tasas}
            >
              <FilaDeProveedor f={f} />
            </ReportesProductosSheet>
          </li>
        ))}
      </ul>
    </div>
  );
}

// REENVIA EL REF Y DERRAMA LAS PROPS. Obligatorio para `SheetTrigger
// asChild`; el porqué, entero, en `reportes-inventario.tsx`.
const FilaDeProveedor = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { f: ProveedorEnReporte }
>(function FilaDeProveedor({ f, className, ...props }, ref) {
  return (
    // `border-l-4` Y NO LA CAJA DOBLE, por lo mismo que la tarjeta de
    // producto: ver la cabecera de `reportes-productos-sheet.tsx`.
    //
    // LA FILA «SIN PROVEEDOR» LLEVA LA FRANJA APAGADA. No es un proveedor
    // --es el hueco-- y la franja oscura la pondría al mismo nivel que los
    // que sí tienen nombre.
    <button
      {...props}
      ref={ref}
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-[10px] border border-l-4 p-2 text-left transition-colors active:bg-accent",
        f.sinProveedor ? "border-l-border" : "border-l-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium",
          f.sinProveedor ? "text-muted-foreground" : "text-foreground",
        )}
        aria-hidden
      >
        {f.iniciales}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{f.nombre}</span>
        <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span className="tabular-nums">Productos: {f.productos}</span>
          <span className="flex items-center gap-1">
            Margen:{" "}
            {f.margenPct == null ? (
              // «—» Y NO «0%». El dueño eligió el margen REAL de las ventas
              // sabiendo lo que cuesta: un proveedor cuyos productos no se
              // vendieron en el periodo no tiene margen que enseñar, y un
              // 0 % diría que vende sin ganar nada.
              <span className="text-muted-foreground">—</span>
            ) : (
              <span
                className={cn(
                  "flex items-center gap-0.5 font-medium tabular-nums",
                  f.margenPct < 0 ? "text-destructive" : "text-money-in",
                )}
              >
                {formatPercent(f.margenPct)}
                {/* LA FLECHITA DEL FRAME SE GIRA CUANDO EL MARGEN ES
                    NEGATIVO. Vender por debajo del costo pasa, y una flecha
                    hacia arriba en rojo sería la pantalla contradiciéndose
                    a sí misma. */}
                <TrendingUp
                  className={cn("size-3.5", f.margenPct < 0 && "-scale-y-100")}
                  aria-hidden
                />
              </span>
            )}
          </span>
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
});
