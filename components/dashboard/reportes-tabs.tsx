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
      // `bg-brand-field` (#525252) Y `rounded-[14px]`, que es lo que el frame
      // dibuja en `1502:10300`. Antes era `bg-white/10`, inventado: se parecía
      // y no era el mismo gris, así que el grupo flotaba más claro sobre la
      // cabecera de lo que debía.
      className="flex w-full items-center gap-0 rounded-[14px] bg-brand-field p-1"
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
              // 33px de alto, `rounded-[10px]` y 16px semibold: las medidas del
              // frame, nodo `I1502:10300;1233:5201`.
              "flex h-[33px] flex-1 items-center justify-center rounded-[10px] px-2 text-center text-base font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              seleccionado
                ? // LA PÍLDORA SELECCIONADA ES GRIS CON TEXTO BLANCO, no blanca
                  // con texto oscuro. Lo reportó el dueño el 2026-10-27 con dos
                  // capturas, la del frame y la mía al lado.
                  //
                  // Y LLEVA BORDE Y SOMBRA, que es lo que la separa del grupo:
                  // #737373 sobre #525252 son 1,65:1 --medido por `npm run qa:contraste`,
                  // no citado de memoria--, o sea que el relleno solo
                  // NO distingue la pestaña activa. Quien quite la sombra deja
                  // tres pestañas que parecen iguales.
                  "border border-brand-tab-selected bg-brand-tab-selected text-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]"
                : "text-brand-secondary hover:text-white",
            )}
          >
            {a.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}
