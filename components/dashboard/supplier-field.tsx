"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sugerenciasDeProveedor } from "@/lib/products/supplier";

// «PROVEEDOR (OPCIONAL)» DEL FORMULARIO DE PRODUCTO. Frame 1192:4185.
//
// Texto libre con sugerencias de lo que este negocio ya escribio alguna vez,
// «similar al buscador de clientes en agregar movimientos pero solo por nombre
// de proveedor» — decision del dueno, 2026-10-14.
//
// ===========================================================================
// LA LISTA VA EN LINEA, NO EN UN POPOVER
//
// Y no es una preferencia estetica. Este campo vive dentro del dialogo de
// producto, y `DESIGN-SYSTEM.md` ya documenta la trampa con su propia seccion:
// un popup en portal dentro de un Dialog de Radix NO RECIBE TOQUES. Un
// Popover aqui se veria perfecto en el escritorio y seria inerte en el
// telefono, que es donde el tendero lo va a usar.
//
// El costo de ir en linea es que la lista empuja el contenido de debajo. Se
// acepta: el formulario ya se desplaza, y empujar es visible mientras que un
// control muerto no lo es.
//
// ===========================================================================
// POR QUE NO HAY NINGUNA CONSULTA AQUI
//
// Las sugerencias llegan por `suggestions`, derivadas de los productos que
// `/productos` YA cargo —todos los del dueno, sin paginar— asi que escribir en
// este campo no habla con la red. Eso importa en un telefono con mala senal:
// un autocompletado que depende de una peticion por pulsacion se siente roto
// justo cuando la conexion es mala, que es cuando el tendero esta en la calle.

export function SupplierField({
  value,
  onChange,
  suggestions,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  // Los proveedores que este negocio ya uso. Pueden venir repetidos y con
  // distinta caja; de eso se encarga este componente.
  suggestions: string[];
  disabled?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  // LA REGLA VIVE EN `lib/products/supplier.ts`, no aqui. Es la unica parte de
  // este campo que puede equivocarse en silencio --deduplicar y buscar
  // ignorando la caja-- y dentro de un componente no la prueba nadie. Alli es
  // una funcion pura y `qa:proveedor` la vigila.
  const coincidencias = useMemo(
    () => sugerenciasDeProveedor(suggestions, value),
    [suggestions, value],
  );

  const visible = abierto && coincidencias.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="producto_proveedor">Proveedor (opcional)</Label>
      <Input
        id="producto_proveedor"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        // `onBlur` con un respiro: sin el, el blur cierra la lista ANTES de que
        // el toque llegue a la sugerencia y elegir una se vuelve imposible. El
        // `onMouseDown` de abajo tambien lo evita, pero los dos juntos cubren
        // teclado y puntero sin depender de cual gana la carrera.
        onBlur={() => window.setTimeout(() => setAbierto(false), 120)}
        placeholder="¿Dónde compraste el producto?"
        autoComplete="off"
        disabled={disabled}
        aria-expanded={visible}
        aria-controls={visible ? "producto_proveedor_sugerencias" : undefined}
      />

      {visible ? (
        <ul
          id="producto_proveedor_sugerencias"
          className="flex flex-col overflow-hidden rounded-md border bg-popover"
        >
          {coincidencias.map((s) => (
            <li key={s}>
              <button
                type="button"
                // `onMouseDown` y no `onClick`: el click llega despues del blur
                // del input, y para entonces la lista ya se habria cerrado.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s);
                  setAbierto(false);
                }}
                className="flex h-10 w-full items-center px-3 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Para acordarte de dónde reponerlo. Si ya lo compraste ahí antes, te lo sugerimos.
      </p>
    </div>
  );
}
