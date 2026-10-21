"use client";

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// EL PAGINADO DE UNA LISTA: «Anterior · Página N de M · Siguiente».
//
// Encargo del dueño el 2026-10-20: *«Catálogo y pedidos agregar misma regla
// de paginado que clientes»*. La forma de decirlo importa — la misma REGLA,
// no una parecida— y por eso esto es un componente en vez de dos copias más.
//
// ===========================================================================
// YA HABÍA CUATRO COPIAS
//
// Clientes, el historial del tendero, el historial del cliente y la papelera
// llevaban estas treinta líneas escritas a mano, idénticas. Añadir Catálogo y
// Pedidos las habría dejado en seis, y seis copias no se portan distinto
// hasta el día que alguien toca una.
//
// Es la cuarta deriva de la misma clase esta semana --el título de pantalla,
// la flecha de volver y el estado vacío fueron las otras tres-- y por la
// misma vía: no había dónde mirar.
//
// ===========================================================================
// 15 POR PÁGINA, QUE ES LO QUE USA CLIENTES
//
// Se exporta para que las listas no lo escriban cada una: el día que el
// número cambie, cambia en los seis sitios o en ninguno.
export const PAGE_SIZE = 15;

// NO SE DIBUJA CON UNA SOLA PÁGINA. Un paginador con los dos botones
// apagados y un «Página 1 de 1» no informa de nada y ocupa el sitio donde
// termina la lista.
export function ListPagination({
  page,
  pageCount,
  onPage,
}: {
  // La página ACOTADA, no la cruda del estado. Quien llama ya tiene que
  // calcularla para cortar la lista, y pasarla hecha evita que las dos
  // cuentas se separen.
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            text="Anterior"
            onClick={(e) => {
              e.preventDefault();
              if (page > 1) onPage(page - 1);
            }}
            className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
          />
        </PaginationItem>
        <PaginationItem>
          <span className="px-2 text-sm text-muted-foreground">
            Página {page} de {pageCount}
          </span>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href="#"
            text="Siguiente"
            onClick={(e) => {
              e.preventDefault();
              if (page < pageCount) onPage(page + 1);
            }}
            className={page >= pageCount ? "pointer-events-none opacity-50" : undefined}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
