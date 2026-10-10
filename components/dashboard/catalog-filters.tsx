"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/dashboard/client-filters";
import { priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import { listPrice, type ProductRow } from "@/lib/products/catalog";

// EL BUSCADOR Y LOS CHIPS DEL CATALOGO.
//
// Viven en un contexto por la misma razon que los de Clientes: desde el spec
// del 2026-10-04 el campo y los chips se pintan DENTRO de `ScreenHeader`, que
// la pagina monta como hermano de la lista. Dos hermanos no comparten estado
// sin algo por encima.
//
// Las listas de opciones son propias y no las de Clientes: ahi un "Estado" es
// al día / con deuda / mala paga, y aqui es publicado / sin publicar. El
// unico trozo compartido es `FilterChip`, la cáscara, porque lleva dentro una
// decision de contraste medida que una segunda copia dejaria de respetar.

const SORT_OPTIONS = [
  { value: "nombre", label: "Nombre (A-Z)" },
  { value: "precio-desc", label: "Precio: de mayor a menor" },
  { value: "precio-asc", label: "Precio: de menor a mayor" },
] as const;

const STATUS_OPTIONS = [
  { value: "todos", label: "Todos" },
  { value: "publicados", label: "Publicados" },
  { value: "sin-publicar", label: "Sin publicar" },
] as const;

type SortBy = (typeof SORT_OPTIONS)[number]["value"];
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

type CatalogFilterState = {
  query: string;
  setQuery: (v: string) => void;
  sortBy: SortBy;
  setSortBy: (v: SortBy) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  minAmount: string;
  setMinAmount: (v: string) => void;
  maxAmount: string;
  setMaxAmount: (v: string) => void;
  // Ya filtrada y ordenada. La lista la consume tal cual.
  visible: ProductRow[];
  total: number;
};

const CatalogFilterContext = createContext<CatalogFilterState | null>(null);

function useCatalogFilters(): CatalogFilterState {
  const value = useContext(CatalogFilterContext);
  if (!value) throw new Error("CatalogFilterProvider falta por encima de este componente.");
  return value;
}

export function CatalogFilterProvider({
  rows,
  rates,
  compareCurrency,
  children,
}: {
  rows: ProductRow[];
  // null para un negocio colombiano.
  rates: BolivarRates | null;
  // La moneda en la que se comparan precios de monedas distintas. Ver abajo.
  compareCurrency: PriceCurrency;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("nombre");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // DOS PRECIOS EN MONEDAS DISTINTAS NO SE COMPARAN CRUDOS, y la tabla lo
  // permite: `base_currency` es por producto, asi que un negocio venezolano
  // puede tener uno en dolares y otro en bolivares. Ordenarlos por el numero a
  // secas pondria «Bs. 500» por encima de «$40», que es al reves.
  //
  // Asi que antes de comparar se lleva todo a una sola moneda con las mismas
  // tasas que usa la ficha. Sin tasas —Colombia— no hace falta: alli no hay
  // mas moneda que el peso.
  const comparable = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of rows) {
      const { amount } = listPrice(p);
      if (!rates || p.base_currency === compareCurrency) {
        out.set(p.id, amount);
        continue;
      }
      const converted = priceIn(
        compareCurrency,
        { amount, currency: p.base_currency },
        rates,
      ).amount;
      // Sin tasa para esa moneda el producto no se puede situar. Se le deja su
      // numero crudo en vez de sacarlo de la lista: desaparecer de su propio
      // catalogo es peor que quedar mal ordenado.
      out.set(p.id, converted ?? amount);
    }
    return out;
  }, [rows, rates, compareCurrency]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minAmount.trim() === "" ? null : Number(minAmount.replace(",", "."));
    const max = maxAmount.trim() === "" ? null : Number(maxAmount.replace(",", "."));

    const filtered = rows.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (status === "publicados" && !p.published) return false;
      if (status === "sin-publicar" && p.published) return false;
      const value = comparable.get(p.id) ?? 0;
      if (min != null && Number.isFinite(min) && value < min) return false;
      if (max != null && Number.isFinite(max) && value > max) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === "nombre") {
      // `localeCompare` en es, que es lo que pone la ñ en su sitio y no
      // despues de la z.
      sorted.sort((a, b) => a.name.localeCompare(b.name, "es"));
    } else {
      const dir = sortBy === "precio-desc" ? -1 : 1;
      sorted.sort(
        (a, b) => dir * ((comparable.get(a.id) ?? 0) - (comparable.get(b.id) ?? 0)),
      );
    }
    return sorted;
  }, [rows, query, status, minAmount, maxAmount, sortBy, comparable]);

  const value: CatalogFilterState = {
    query,
    setQuery,
    sortBy,
    setSortBy,
    status,
    setStatus,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    visible,
    total: rows.length,
  };

  return <CatalogFilterContext.Provider value={value}>{children}</CatalogFilterContext.Provider>;
}

export function CatalogSearchField() {
  const { setQuery, query } = useCatalogFilters();
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand-muted"
        aria-hidden="true"
      />
      {/* Mismas clases que el campo de Clientes sobre la cabecera oscura:
          `--brand-field-border` a 2px, que es el contraste medido (5,78:1).
          El #525252 del spec daba 1,91:1 y desaparecia. */}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar producto"
        aria-label="Buscar producto"
        className="h-[46px] rounded-[10px] border-2 border-brand-field-border bg-transparent pl-9 text-white placeholder:text-brand-muted focus-visible:border-white"
      />
    </div>
  );
}

export function CatalogFilterChips() {
  const f = useCatalogFilters();

  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sortBy)?.label;
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === f.status)?.label;

  // El chip dice POR QUE esta filtrando, no solo que lo esta. «1.000–5.000»
  // contesta la pregunta que tiene el dueño; un borde de otro color no.
  const amountActive = Boolean(f.minAmount || f.maxAmount);
  const amountLabel = !amountActive
    ? "Monto"
    : f.minAmount && f.maxAmount
      ? `${f.minAmount}–${f.maxAmount}`
      : f.minAmount
        ? `Desde ${f.minAmount}`
        : `Hasta ${f.maxAmount}`;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <FilterChip
        tone="dark"
        label={f.sortBy === "nombre" ? "Ordenar por" : (sortLabel ?? "Ordenar por")}
        active={f.sortBy !== "nombre"}
      >
        {(close) => (
          <div className="flex flex-col gap-1">
            {SORT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={f.sortBy === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  f.setSortBy(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>

      <FilterChip
        tone="dark"
        label={f.status === "todos" ? "Estado" : (statusLabel ?? "Estado")}
        active={f.status !== "todos"}
      >
        {(close) => (
          <div className="flex flex-col gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={f.status === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  f.setStatus(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>

      {/* Nodo y no funcion: "Monto" tiene dos campos, y cerrar al primer
          teclazo dejaria el segundo inalcanzable. Es el mismo motivo por el
          que `FilterChip` admite las dos formas. */}
      <FilterChip tone="dark" label={amountLabel} active={amountActive}>
        <div className="flex flex-col gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Monto desde"
            value={f.minAmount}
            onChange={(e) => f.setMinAmount(e.target.value)}
            aria-label="Monto desde"
          />
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Monto hasta"
            value={f.maxAmount}
            onChange={(e) => f.setMaxAmount(e.target.value)}
            aria-label="Monto hasta"
          />
          {amountActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                f.setMinAmount("");
                f.setMaxAmount("");
              }}
            >
              Quitar el filtro
            </Button>
          ) : null}
        </div>
      </FilterChip>
    </div>
  );
}

export { useCatalogFilters };
