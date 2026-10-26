"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { FilterChip } from "@/components/dashboard/client-filters";
import { OrdersList, type OrderWithItems } from "@/components/dashboard/orders-list";
import { estaDescartado, isUnregistered } from "@/lib/orders/catalog-orders";
import { EmptyState } from "@/components/dashboard/empty-state";

// EL BUSCADOR Y EL CHIP DE ESTADO DE PEDIDOS.
//
// Owner's request, 2026-10-16, with the catalogue's own header as the
// reference. They live in a context for the same reason Catálogo's and
// Clientes' do: the field and the chip are painted INSIDE `ScreenHeader`,
// which the page mounts as a sibling of the list, and two siblings share no
// state without something above them.
//
// ONE CHIP AND NOT THREE. Catálogo carries "Ordenar por", "Estado" and
// "Monto"; here the order is fixed -- unattended first, newest within each
// group -- and that order is the screen's whole point, so a sort control
// would offer to break it. Amount is not a question anyone asks of an order
// either. If a sort ever arrives it goes here, beside this one.

// «DESCARTADOS» ES UNA VISTA APARTE, NO UN ESTADO MÁS DE LA LISTA.
//
// Encargo del dueño el 2026-10-26, cuando el informe de los tres arreglos
// dijo que un pedido descartado se podía devolver desde su propia pantalla
// pero no se podía ENCONTRAR: *«¿Esto sería en la sección de "Pedidos"
// cierto? de ser así agrégalo»*.
//
// LOS OTROS TRES NUNCA ENSEÑAN UN DESCARTADO, incluido «Todos», y eso es a
// propósito: el diálogo de descartar le promete al tendero que el pedido
// «sale de tu lista de pedidos y deja de contar como pendiente». Si
// apareciera en «Todos» --que es la vista que se abre sola-- la promesa sería
// falsa desde el primer segundo. Así que «Todos» significa «todos los que
// siguen en tu lista», y los descartados tienen su puerta, que es esta.
const STATUS_OPTIONS = [
  { value: "todos", label: "Todos" },
  { value: "sin-registrar", label: "Sin registrar" },
  { value: "registrados", label: "Registrado" },
  { value: "descartados", label: "Descartado" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

type OrdersFilterState = {
  query: string;
  setQuery: (v: string) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  // Already filtered. The list consumes it as it is.
  visible: OrderWithItems[];
  // CUÁNTOS SIGUEN EN LA LISTA, sin contar los descartados. Es la cifra que
  // decide si la tarjeta de compartir se dibuja y si «no hay nada» se lee
  // como «no coincide» o como «todavía no te ha llegado nada».
  total: number;
  // Y LOS DESCARTADOS APARTE, porque son dos preguntas distintas. Un negocio
  // cuyo único pedido está descartado tiene `total` 0 y `descartados` 1, y
  // decirle «todavía no te ha llegado ningún pedido» ahí sería mentirle.
  descartados: number;
};

const OrdersFilterContext = createContext<OrdersFilterState | null>(null);

function useOrdersFilters(): OrdersFilterState {
  const value = useContext(OrdersFilterContext);
  if (!value) throw new Error("OrdersFilterProvider falta por encima de este componente.");
  return value;
}

// ACCENT-INSENSITIVE, AND THAT IS A DEPARTURE FROM THE OTHER TWO SEARCHES.
//
// Clientes and Catálogo compare with a plain `toLowerCase().includes()`, so
// "Maria" does not find "María" there. This screen is the one place where the
// two people are different: the CUSTOMER typed the name, on their own phone,
// and the SHOPKEEPER types the search. Nobody can be expected to guess
// whether a stranger wrote the accent, so here the accent is removed from
// both sides before comparing.
function plano(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function OrdersFilterProvider({
  orders,
  children,
}: {
  orders: OrderWithItems[];
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");

  const visible = useMemo(() => {
    const q = plano(query.trim());

    return orders.filter((o) => {
      // EL DESCARTE MANDA ANTES QUE CUALQUIER OTRO ESTADO. Preguntarlo
      // después no bastaría: `isUnregistered` contesta `false` a un
      // descartado --no está pendiente-- así que el chip «Registrado» lo
      // habría colado entre los registrados, que es justo donde no está.
      if (estaDescartado(o) !== (status === "descartados")) return false;
      if (status === "sin-registrar" && !isUnregistered(o)) return false;
      if (status === "registrados" && isUnregistered(o)) return false;
      if (!q) return true;

      // The name is what the owner asked to search by. The document goes in
      // with it because it is the other column on this screen, and a
      // shopkeeper holding a cédula will try it before the name.
      return plano(o.customer_name).includes(q) || plano(o.customer_document).includes(q);
    });
  }, [orders, query, status]);

  const descartados = useMemo(() => orders.filter((o) => estaDescartado(o)).length, [orders]);

  const value: OrdersFilterState = {
    query,
    setQuery,
    status,
    setStatus,
    visible,
    total: orders.length - descartados,
    descartados,
  };

  return <OrdersFilterContext.Provider value={value}>{children}</OrdersFilterContext.Provider>;
}

export function OrdersSearchField() {
  const { query, setQuery } = useOrdersFilters();
  // `SearchField`, el mismo de Clientes. Nació copiando el de Catálogo el
  // 2026-10-16 y se unificó con todos el mismo día.
  return <SearchField tone="dark" value={query} onChange={setQuery} placeholder="Buscar cliente" />;
}

export function OrdersFilterChips() {
  const f = useOrdersFilters();
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === f.status)?.label;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
    </div>
  );
}

// LA TARJETA DE COMPARTIR, SOLO SI YA HAY PEDIDOS — frame `1472:21674`.
//
// Instrucción del dueño el 2026-10-20: *«esa card permanente solo se ve
// cuando hay al menos un pedido en la sección de pedidos»*.
//
// ===========================================================================
// MIRA `total`, NO `visible`, Y NO ES LO MISMO
//
// `visible` son los pedidos que pasan el filtro de arriba. Con «Atendidos»
// marcado y ningún pedido atendido, `visible` es cero y `total` no — y
// esconder la tarjeta ahí sería decirle al tendero que no tiene pedidos
// porque acaba de filtrar. La condición del dueño es sobre lo que hay en la
// sección, no sobre lo que se está mirando.
//
// VIVE AQUÍ Y NO EN LA PÁGINA porque la cuenta está en este contexto, y la
// página es un componente de servidor. Lo que sí viaja desde allí es la
// tarjeta ya montada: necesita el enlace del catálogo y cuántos productos hay
// publicados, que son datos del servidor. Es la misma división que ya tiene
// el estado vacío, explicada en `OrdersList`.
export function OrdersShareCard({ children }: { children: ReactNode }) {
  const { total } = useOrdersFilters();
  if (total === 0) return null;
  return <>{children}</>;
}

export function OrdersResults({ vacio }: { vacio?: ReactNode }) {
  const { visible, total, descartados, status } = useOrdersFilters();

  // ── CUATRO MANERAS DE NO TENER NADA EN PANTALLA, Y CADA UNA ES OTRA COSA
  //
  // Son cuatro ramas y no una porque las cuatro frases dicen verdades
  // distintas, y la de al lado leída en el caso equivocado es una mentira con
  // muy buena presentación. Ya pasó aquí: el estado vacío de `OrdersList`
  // --«todavía no te ha llegado ningún pedido»-- se le enseñó durante meses a
  // negocios que tenían tres, porque un `42501` se descartaba en silencio.

  // 1. LA VISTA DE DESCARTADOS, VACÍA. Su propia frase, porque «ningún pedido
  //    coincide con lo que buscas» mandaría a cambiar una búsqueda que no hay.
  if (status === "descartados" && visible.length === 0) {
    return (
      <EmptyState
        title="No has descartado ningún pedido"
        subtitle="Los pedidos que descartes se guardan aquí y puedes restaurarlos."
      />
    );
  }

  // 2. "NOTHING MATCHES" IS NOT "NOTHING HAS ARRIVED", and `OrdersList`'s own
  //    empty state says the second one. Telling a shopkeeper who filtered by
  //    "Registrado" that no customer has ever ordered would be a lie with a
  //    perfectly good explanation sitting one tap away in the chip.
  if (total > 0 && visible.length === 0) {
    return (
      <EmptyState
        title="Ningún pedido coincide con lo que buscas"
        subtitle="Prueba con otro nombre o quita el filtro."
      />
    );
  }

  // 3. TODOS SUS PEDIDOS ESTÁN DESCARTADOS. Sin esta rama caería en el estado
  //    vacío de abajo, que dice que no le ha llegado nada -- y le ha llegado:
  //    lo descartó él. La frase nombra el chip donde están, que es el único
  //    sitio desde el que se pueden devolver.
  if (total === 0 && descartados > 0 && visible.length === 0) {
    return (
      <EmptyState
        title="Todos tus pedidos están descartados"
        subtitle="Míralos en el filtro «Descartado» para restaurar el que quieras."
      />
    );
  }

  // 4. Y si de verdad no ha llegado nada, el estado vacío de la lista.
  return <OrdersList orders={visible} vacio={vacio} />;
}
