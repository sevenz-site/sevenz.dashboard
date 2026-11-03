"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/dashboard/client-filters";
import { priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import { isPublished, listPrice, type ProductRow } from "@/lib/products/catalog";
import { foldForSearch } from "@/lib/search/fold";
import { CategoryChips } from "@/components/category-chips";
import { CategoryManagerSheet, type CategoriaConConteo } from "@/components/dashboard/category-manager";
import type { Categoria } from "@/lib/products/categories";

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
  // Migration 184: the owner's categories, each with how many of his
  // products it holds, and the chip chosen (`null` = «Todas»).
  categorias: CategoriaConConteo[];
  setCategorias: (next: CategoriaConConteo[]) => void;
  categoryId: string | null;
  setCategoryId: (v: string | null) => void;
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

const SIN_CATEGORIAS: Categoria[] = [];

export function CatalogFilterProvider({
  rows,
  rates,
  compareCurrency,
  categorias: categoriasDelServidor = SIN_CATEGORIAS,
  children,
}: {
  rows: ProductRow[];
  // All of the owner's categories, empty ones too: here he is looking at his
  // own shop, and an empty chip tells him which category has nothing yet.
  categorias?: Categoria[];
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
  const [categoryIdElegida, setCategoryId] = useState<string | null>(null);

  // THE LIST IS KEPT HERE, not only read from the server: the «Editar» sheet
  // creates, renames and deletes, and the chips have to show it at once
  // rather than after the page revalidates. When the server sends a fresh
  // list (the action's `revalidatePath`), it replaces the local one.
  const [categoriasLocales, setCategoriasLocales] = useState<Categoria[]>(categoriasDelServidor);
  const [ultimaDelServidor, setUltimaDelServidor] = useState(categoriasDelServidor);
  if (categoriasDelServidor !== ultimaDelServidor) {
    setUltimaDelServidor(categoriasDelServidor);
    setCategoriasLocales(categoriasDelServidor);
  }

  // Counted over EVERY product of the owner, published or not — his decision
  // of 2026-11-03. Trashed ones never reach `rows`.
  const categorias = useMemo<CategoriaConConteo[]>(() => {
    const conteo = new Map<string, number>();
    for (const p of rows) if (p.category_id) conteo.set(p.category_id, (conteo.get(p.category_id) ?? 0) + 1);
    return categoriasLocales.map((c) => ({ id: c.id, name: c.name, productos: conteo.get(c.id) ?? 0 }));
  }, [rows, categoriasLocales]);

  // A chip whose category was just deleted filters by nothing that exists,
  // and would leave the list empty with no chip lit to explain why. It falls
  // back to «Todas».
  const categoryId =
    categoryIdElegida && categoriasLocales.some((c) => c.id === categoryIdElegida) ? categoryIdElegida : null;

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
    const q = foldForSearch(query.trim());
    const min = minAmount.trim() === "" ? null : Number(minAmount.replace(",", "."));
    const max = maxAmount.trim() === "" ? null : Number(maxAmount.replace(",", "."));

    const filtered = rows.filter((p) => {
      if (q && !foldForSearch(p.name).includes(q)) return false;
      if (categoryId && p.category_id !== categoryId) return false;
      // «Publicado» es estar en ALGUN catalogo, de mayor o de detal. Separar
      // el filtro en dos haria tres estados donde el tendero piensa en uno:
      // «esto se ve o no se ve».
      if (status === "publicados" && !isPublished(p)) return false;
      if (status === "sin-publicar" && isPublished(p)) return false;
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
  }, [rows, query, status, minAmount, maxAmount, sortBy, comparable, categoryId]);

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
    categorias,
    setCategorias: setCategoriasLocales,
    categoryId,
    setCategoryId,
    visible,
    total: rows.length,
  };

  return <CatalogFilterContext.Provider value={value}>{children}</CatalogFilterContext.Provider>;
}

export function CatalogSearchField() {
  const { query, setQuery } = useCatalogFilters();
  // `SearchField`, el mismo de Clientes, Malas pagas y Papelera, desde el
  // 2026-10-16. Antes era una copia de 46px con la lupa a la izquierda y sin
  // aspa: para vaciar la búsqueda había que borrar letra por letra.
  return <SearchField tone="dark" value={query} onChange={setQuery} placeholder="Buscar producto" />;
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

// «CATEGORÍAS», UNDER THE «PEDIDOS» CARD — frame `1958:16272`, owner's
// request of 2026-11-03: *«Las categorías en el catálogo van debajo de la card
// "Pedidos", al seleccionar botón "Editar" muestra en componente sheet todas
// las categorías»*. Until that day the chips were a second row inside the dark
// header, under «Ordenar por».
//
// THE TITLE ROW SHOWS WITH ZERO CATEGORIES, chips or not: «Editar» is the only
// door to creating the first one outside the product flow, and hiding it
// until a category exists would make it unreachable.
//
// «Editar», NOT «Éditar»: the frame's label carries a stray accent, read as a
// typo rather than copy.
export function CatalogCategorySection() {
  const f = useCatalogFilters();
  const [editando, setEditando] = useState(false);

  return (
    // The title row's own 8px on top of the page's 16px gap is the 24px the
    // frame leaves between the card and the title; its 8px below plus the
    // chip row's 4px are the frame's 12px to the chips. Measured 24 and 12.
    <section aria-labelledby="catalogo-categorias" className="flex flex-col">
      <div className="flex items-center justify-between gap-2 py-2">
        <h2 id="catalogo-categorias" className="text-sm leading-5">
          Categorías
        </h2>
        {/* The label is 12px; the padding and the negative margin give the
            thumb a 32px target without moving the text off the frame. */}
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="-my-2 -mr-2 flex items-center gap-0.5 rounded-md p-2 text-xs leading-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Editar
          <Pencil className="size-[15px]" aria-hidden="true" />
        </button>
      </div>
      <CategoryChips categorias={f.categorias} total={f.total} value={f.categoryId} onChange={f.setCategoryId} />

      <CategoryManagerSheet
        open={editando}
        onOpenChange={setEditando}
        categorias={f.categorias}
        onCategoriasChange={f.setCategorias}
      />
    </section>
  );
}

export { useCatalogFilters };
