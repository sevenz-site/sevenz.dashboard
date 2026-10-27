"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { APARTADOS, type Apartado } from "@/lib/reports/apartados";

// LOS TRES APARTADOS DE REPORTES — frame `1502:10283`, nodo `1502:10300`.
//
// Encargo del dueño el 2026-10-27: *«tendrá tres tabs en versión dark como la
// sección superior de reportes: Clientes, Inventario y Proveedores»*, y al
// pasar los frames corrigió el primero: **Facturación**.
//
// ───────────────────────────────────────────────────────────────────────
// EL APARTADO VIVE EN LA URL, no en un `useState`
//
// Es la misma decisión que `?periodo=` y `?cliente=` ya habían tomado en esta
// pantalla, y por las mismas razones: el tendero puede volver atrás con el
// botón del navegador, recargar sin perder dónde estaba, y --la que de verdad
// importa-- el servidor sabe qué apartado pintar, así que no se cargan los
// datos de los tres para enseñar uno.
//
// `scroll={false}`: cambiar de pestaña no es navegar a otro sitio. Sin esto
// la página salta arriba y el gesto se siente como una recarga.
//
// LOS OTROS PARÁMETROS SE CONSERVAN. Un cambio de pestaña que se comiera el
// `?periodo=30d` devolvería al tendero a 7 días sin decírselo, y la cifra de
// al lado cambiaría sola.

export function ReportesTabs({ activo }: { activo: Apartado }) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    // `role="tablist"` y no una lista de enlaces a secas: para un lector de
    // pantalla esto es un selector de vistas, no un menú de navegación.
    <div
      role="tablist"
      aria-label="Apartados del informe"
      className="flex w-full items-center gap-0 rounded-[10px] bg-white/10 p-1"
    >
      {APARTADOS.map((a) => {
        const siguiente = new URLSearchParams(params.toString());
        siguiente.set("tab", a.clave);
        const seleccionado = a.clave === activo;
        return (
          <Link
            key={a.clave}
            href={`${pathname}?${siguiente.toString()}`}
            scroll={false}
            role="tab"
            aria-selected={seleccionado}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-center text-base transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              seleccionado
                ? "bg-white text-brand-primary"
                : "text-brand-muted hover:text-white",
            )}
          >
            {a.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}
