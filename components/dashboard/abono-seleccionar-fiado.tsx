"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/dashboard/client-filters";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

export type FiadoAbierto = {
  movementId: string;
  saleId: string | null;
  fecha: string;
  currency: PriceCurrency | null;
  // Lo que el fiado fue cuando nació.
  amount: number;
  // Y lo que TODAVÍA debe. Las dos, porque no son la misma pregunta: la tarjeta
  // enseña el importe original a la derecha —como lo hace la fila del
  // historial— y «Debe $X» con lo que falta, que es por lo que se elige.
  pending: number;
  plazoDias: number | null;
  cuotas: number | null;
  productos: string[];
  descripcion: string | null;
};

// PASO 1/3 DEL ABONO DIRIGIDO — frame `1457:16193`.
//
// Decisión del dueño el 2026-10-19: el abono siempre se dirige, así que
// registrar un pago empieza aquí, eligiendo a cuál de sus fiados va.
//
// ===========================================================================
// TODO LO QUE SE VE AQUÍ YA EXISTÍA, Y ESO ES DELIBERADO
//
// El buscador, la píldora del filtro (`FilterChip`) y la forma de la tarjeta
// —«Fiado · descripción» a la izquierda, el importe en `text-destructive` con
// su «+» a la derecha— son los del historial. El dueño pidió explícitamente
// reusar componentes, y además es lo que hace que esta pantalla se lea como
// parte de la app y no como una isla.
//
// LO ÚNICO NUEVO DE VERDAD ES «Debe $X»: lo que ese fiado concreto todavía
// debe. No existía en ninguna parte hasta la migración `126`, porque la cola
// solo devolvía su cabeza — la única pregunta que se le hacía era «¿está este
// cliente en mora?», no «¿cuánto queda de este fiado?».
export function AbonoSeleccionarFiado({
  clienteId,
  clienteNombre,
  fiados,
  rates,
}: {
  clienteId: string;
  clienteNombre: string;
  fiados: FiadoAbierto[];
  rates: BolivarRates | null;
}) {
  const [query, setQuery] = useState("");
  // «Fecha» es el único filtro del frame, y ordena. Arranca en `viejo` porque
  // el fiado que el tendero más probablemente quiere saldar es el que lleva
  // más tiempo abierto — que es también el orden en que la cola los cubre
  // cuando el abono NO se dirige.
  const [orden, setOrden] = useState<"viejo" | "nuevo">("viejo");

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    // SE BUSCA POR PRODUCTO Y POR MONTO, y el monto SIN MONEDA — pedido del
    // dueño el 2026-10-19: «solo valor numérico».
    //
    // POR QUÉ TRES FORMAS DEL NÚMERO Y NO UNA. El tendero escribe la cifra como
    // la lee, y la lee de dos maneras según el campo: «5.84» en el precio y
    // «5,84» en los bolívares. Y a menudo escribe solo el principio — «32»
    // buscando los 32,40. Así que se compara contra el número con punto, con
    // coma, y contra sus dígitos pelados.
    //
    // LOS DÍGITOS PELADOS SE COMPARAN SOLO CONTRA LOS MONTOS, nunca contra el
    // texto entero: la fecha también son dígitos, y «19 de oct de 2026» pegado
    // al resto haría que buscar «20» devolviera media lista.
    const soloDigitos = (x: string) => x.replace(/\D/g, "");
    const qDigitos = soloDigitos(q);

    const coincide = (f: FiadoAbierto) => {
      const texto = [...f.productos, f.descripcion ?? "", formatDate(f.fecha)]
        .join(" ")
        .toLowerCase();
      if (texto.includes(q)) return true;

      // LOS DOS IMPORTES, el original y lo que queda: la tarjeta enseña los dos
      // y el tendero puede estar buscando por cualquiera de ellos.
      const montos = [f.amount, f.pending].map((n) => n.toFixed(2));
      if (montos.some((m) => m.includes(q) || m.replace(".", ",").includes(q))) return true;

      return qDigitos.length > 0 && montos.some((m) => soloDigitos(m).includes(qDigitos));
    };

    const filtrados = q ? fiados.filter(coincide) : fiados;
    return [...filtrados].sort((a, b) => {
      const d = new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
      return orden === "viejo" ? d : -d;
    });
  }, [fiados, query, orden]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* `soloEnTelefono={false}` PORQUE AQUI NO HAY OTRA CABECERA A NINGUNA
          ANCHURA: `/abonos` esta en la lista de `app-header.tsx` que la
          suprime, igual que `/ventas`. Con el valor por defecto, a partir de
          `sm` esta fila desaparece y la pantalla se queda sin forma de volver. */}
      <ScreenBackRow
        href={`/clients/${clienteId}`}
        label={clienteNombre}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-normal">Registrar abono</h1>
        <p className="text-sm text-muted-foreground">1/3 Seleccionar fiado / crédito</p>
        {/* `aria-hidden` porque la línea de arriba ya lo dice con palabras,
            igual que en el asistente de venta. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* SIN FIADOS NO HAY NADA QUE ELEGIR, y la salida es registrar la venta.
          Decisión del dueño el 2026-10-19: *«si no hay fiados se muestra empty
          state en esa pantalla de fiados + botón "Registrar venta"»*.

          POR QUÉ ESA SALIDA Y NO «volver»: el tendero que llegó aquí quería
          anotar que alguien le pagó. Si no hay deuda, lo que de verdad pasó es
          que todavía no ha anotado lo que se llevó — así que el botón le lleva
          a eso y no le deja en un callejón. */}
      {fiados.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[10px] border px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {clienteNombre} no tiene fiados abiertos, así que no hay nada a lo que abonar.
          </p>
          <Button asChild className="h-10 w-full">
            <Link href={`/ventas/nueva?cliente=${clienteId}`}>Registrar venta</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar fiado"
              aria-label="Buscar fiado"
              className="h-10 pl-9"
            />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Historial</h2>
            <FilterChip label="Fecha" active={orden !== "viejo"}>
              {(close) => (
                <div className="flex flex-col gap-1">
                  {(
                    [
                      ["viejo", "Más antiguo primero"],
                      ["nuevo", "Más reciente primero"],
                    ] as const
                  ).map(([valor, texto]) => (
                    <Button
                      key={valor}
                      variant={orden === valor ? "secondary" : "ghost"}
                      size="sm"
                      className="justify-start"
                      onClick={() => {
                        setOrden(valor);
                        close();
                      }}
                    >
                      {texto}
                    </Button>
                  ))}
                </div>
              )}
            </FilterChip>
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-[10px] border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              Ningún fiado coincide con «{query.trim()}».
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibles.map((f) => (
                <li key={f.movementId}>
                  <TarjetaDeFiado fiado={f} rates={rates} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TarjetaDeFiado({ fiado, rates }: { fiado: FiadoAbierto; rates: BolivarRates | null }) {
  // EL MISMO RÓTULO QUE LA FILA DEL HISTORIAL: «Fiado · lo que se llevó». Si la
  // venta trae productos van ellos; si no, lo que el tendero escribió; y si no
  // hay ninguno de los dos se queda en «Fiado» a secas, que sigue siendo
  // cierto. Los fiados de la libreta importada caen casi siempre en el segundo.
  const detalle = fiado.productos.length > 0 ? fiado.productos.join(", ") : (fiado.descripcion ?? "");
  const titulo = detalle ? `Fiado · ${detalle}` : "Fiado";

  // «Bs. … hoy» CONVIERTE A LA TASA DE HOY, y eso es distinto de lo que hace la
  // fila del historial a propósito: allí se enseñan los bolívares que el
  // tendero TECLEÓ, porque tecleó 900 y leer 899,09 no se explica. Aquí la
  // pregunta es otra —«¿cuánto me llevo hoy si me paga esto?»— y el frame lo
  // dice con esa palabra. Sin tasa, la línea no se dibuja: inventar una
  // conversión es peor que no darla.
  const enBs =
    rates && fiado.currency
      ? priceIn("VES", { amount: fiado.amount, currency: fiado.currency }, rates)?.amount
      : null;

  return (
    <Link
      href={`/abonos/nuevo/${fiado.movementId}`}
      className="flex items-center justify-between gap-3 rounded-[10px] border px-4 py-2 transition-colors active:bg-muted/60"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{titulo}</span>
        <span className="text-xs text-muted-foreground">{formatDate(fiado.fecha)}</span>
        {/* LO QUE DE VERDAD DECIDE CUÁL SE ELIGE. Va aquí abajo, en el tamaño
            pequeño del frame, pero es la cifra nueva: lo que queda de ESTE
            fiado, no lo que fue. */}
        <span className="text-xs text-muted-foreground tabular-nums">
          Debe {formatPriceAmount(fiado.pending, fiado.currency ?? "COP")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end">
          <span className="text-xs font-medium tabular-nums text-destructive">
            +{formatPriceAmount(fiado.amount, fiado.currency ?? "COP")}
          </span>
          {enBs != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</span>
          ) : null}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </Link>
  );
}
