"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { EmptyState } from "@/components/dashboard/empty-state";
import { foldForSearch } from "@/lib/search/fold";

// EL BUSCADOR DEL CATÁLOGO QUE VE EL CLIENTE.
//
// Pedido por el dueño el 2026-10-17: *«agregar search "Buscar producto" en
// todas las vistas del catálogo donde se listan los productos, tanto perfil
// del dueño como cliente»*. El del dueño ya existía desde el 2026-10-16; esta
// pantalla era la que faltaba.
//
// `SearchField` Y NO UN CAMPO NUEVO, y esa decisión ya la tomó él: *«el
// componente que usas en "Clientes" es el que debería ir en todas las
// pantallas mencionadas»*. Trae el aspa de limpiar, que es la mitad de cómo
// este campo dice si está filtrando — en su variante oscura el texto escrito
// y el marcador de posición son el mismo color a propósito, así que lo único
// que distingue un campo lleno de uno vacío es ese icono.
//
// ===========================================================================
// POR QUÉ ESTE COMPONENTE RECIBE TARJETAS YA PINTADAS
//
// Lo normal sería pasarle los productos y que pintara él. No se hace, y la
// razón es el riesgo, no la elegancia: la tarjeta del catálogo público son
// ~110 líneas con seis decisiones del dueño comentadas encima —la palabra
// «equivale», la etiqueta de inventario sin cifra, los tres estados de
// `stock`, el color que no sale de un token de tema— y moverlas a un
// componente de cliente para añadir una caja de texto es tocar todo eso sin
// necesidad.
//
// Así que el servidor sigue pintando cada `<li>` con sus comentarios donde
// están, y aquí solo llegan `{ id, name, card }`. Pasar elementos ya
// construidos de un componente de servidor a uno de cliente es lo que los
// React Server Components hacen por diseño: viajan en la carga RSC como
// cualquier otro hijo.
//
// LO QUE ESTO CUESTA, dicho entero: las tarjetas de TODOS los productos
// viajan al navegador aunque el filtro enseñe una. Con los catálogos de hoy
// —seis productos el mayor de dev— no es nada. Si algún día un negocio
// publica cientos, esto se nota antes que ninguna otra cosa de esta pantalla,
// y entonces el arreglo es filtrar en el servidor con el texto en la URL.
export function CatalogSearchGrid({
  items,
}: {
  items: { id: string; name: string; card: ReactNode }[];
}) {
  const [query, setQuery] = useState("");

  // `foldForSearch`, EXACTLY what the owner's catalogue does in
  // `catalog-filters.tsx`: «azucar» finding a product on the shopkeeper's
  // screen but not on the customer's is a bug nobody would trace to two search
  // functions. Both moved to accent-insensitive together on 2026-10-31.
  const visibles = useMemo(() => {
    const q = foldForSearch(query.trim());
    if (!q) return items;
    return items.filter((i) => foldForSearch(i.name).includes(q));
  }, [items, query]);

  return (
    <div className="flex flex-col gap-4">
      <SearchField value={query} onChange={setQuery} placeholder="Buscar producto" />

      {visibles.length === 0 ? (
        // DICE QUÉ SE BUSCÓ, no solo que no hay nada. En un teléfono es fácil
        // dejarse una letra de más y no verla dentro del campo.
        <EmptyState
          title={`No encontramos nada con «${query.trim()}»`}
          subtitle="Prueba con otra palabra."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibles.map((i) => i.card)}
        </ul>
      )}
    </div>
  );
}
