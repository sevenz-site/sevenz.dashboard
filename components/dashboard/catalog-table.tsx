"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatalogProductDialog } from "@/components/dashboard/catalog-product-dialog";
import { formatPriceAmount, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import { overridesByTier, type ProductRow, type PriceOverrideRow } from "@/lib/products/catalog";

// LA LISTA DEL CATÁLOGO.
//
// Tarjetas en teléfono, tabla desde `md`, que es la regla del DESIGN-SYSTEM
// para cualquier lista de registros. La tarjeta entera es un botón que abre la
// ficha, con su `ChevronRight` para decirlo — sin botones por fila, que
// compiten con el gesto de tocar en cualquier parte justo en la pantalla más
// pequeña.
export function CatalogTable({
  products,
  overrides,
  rates,
  defaultCurrency,
}: {
  products: ProductRow[];
  overrides: PriceOverrideRow[];
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  // El precio que se enseña en la lista: el de detal si lo tiene, y si no el
  // de mayor. La tabla exige uno de los dos, así que siempre hay algo.
  const listPrice = (p: ProductRow) => {
    if (p.price_retail != null) return { amount: p.price_retail, label: "detal" as const };
    return { amount: p.price_wholesale!, label: "mayor" as const };
  };

  if (products.length === 0) {
    return (
      <>
        {/* EL ESTADO VACÍO NO SE DISCULPA NI EMPUJA.
            Los dos tenderos entrevistados el 2026-10-09 no llevan inventario.
            Si esto dijera «carga tus productos», ninguno de los dos pasaría de
            aquí. Dice lo que de verdad va a pasar: se llena solo. */}
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-base font-medium">Todavía no tienes productos</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            No hace falta que los cargues ahora. Se van agregando solos cuando fías o vendes algo
            que no esté en la lista, y después puedes completarles el costo y la unidad.
          </p>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Agregar uno ahora
          </Button>
        </div>
        <CatalogProductDialog
          open={creating}
          onOpenChange={setCreating}
          product={null}
          rates={rates}
          defaultCurrency={defaultCurrency}
          overrides={{ retail: {}, wholesale: {} }}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            className="pl-9"
          />
        </div>
        {/* "Agregar producto" y no "Agregar", encontrado rindiendo la
            pantalla el 2026-10-09. El botón flotante de `MobileNav` dice
            "Agregar" y abre **Registrar movimiento**: dos controles con la
            misma palabra a dos sitios distintos, y el flotante es el grande.
            El DESIGN-SYSTEM ya advierte que dos puertas al mismo cajón en una
            pantalla son una de las dos sin explicación; dos puertas con la
            misma etiqueta a cajones DISTINTOS es peor. */}
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Agregar producto
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          Ningún producto se llama así.
        </p>
      ) : null}

      {/* ── Tarjetas, por debajo de md ─────────────────────────────────── */}
      <ul className="flex flex-col gap-2 md:hidden">
        {filtered.map((p) => {
          const price = listPrice(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background p-4 text-left transition-colors active:bg-accent"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.unit ?? "—"} · al {price.label}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm tabular-nums">
                    {formatPriceAmount(price.amount, p.base_currency)}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* ── Tabla, desde md ────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Producto</th>
              <th className="py-2 font-normal">Unidad</th>
              <th className="py-2 text-right font-normal">Al detal</th>
              <th className="py-2 text-right font-normal">Al mayor</th>
              <th className="py-2 text-right font-normal">Costo</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => setEditing(p)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-accent"
              >
                <td className="py-3 font-medium">{p.name}</td>
                {/* Un valor que falta conserva su fila y enseña «—», para que
                    cada registro tenga la misma forma. */}
                <td className="py-3 text-muted-foreground">{p.unit ?? "—"}</td>
                <td className="py-3 text-right tabular-nums">
                  {p.price_retail == null ? "—" : formatPriceAmount(p.price_retail, p.base_currency)}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {p.price_wholesale == null
                    ? "—"
                    : formatPriceAmount(p.price_wholesale, p.base_currency)}
                </td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">
                  {p.cost == null ? "—" : formatPriceAmount(p.cost, p.base_currency)}
                </td>
                <td className="py-3 text-right">
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CatalogProductDialog
        open={creating}
        onOpenChange={setCreating}
        product={null}
        rates={rates}
        defaultCurrency={defaultCurrency}
        overrides={{ retail: {}, wholesale: {} }}
      />
      {editing ? (
        <CatalogProductDialog
          // La `key` fuerza una instancia nueva por producto. Sin ella, abrir
          // un segundo producto reutilizaría los `useState` del primero y la
          // ficha abriría con el nombre del anterior.
          key={editing.id}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          product={editing}
          rates={rates}
          defaultCurrency={defaultCurrency}
          overrides={overridesByTier(overrides, editing.id)}
        />
      ) : null}
    </div>
  );
}
