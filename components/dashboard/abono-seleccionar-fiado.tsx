"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/dashboard/client-filters";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { formatDate } from "@/lib/format";
import type { BolivarRates } from "@/lib/products/price";


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
export type { FiadoAbierto };

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
                  <TarjetaDeFiado fiado={f} rates={rates} href={`/abonos/nuevo/${f.movementId}`} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
