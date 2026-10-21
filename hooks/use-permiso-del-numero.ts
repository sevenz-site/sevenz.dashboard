"use client";

import { useEffect, useRef, useState } from "react";
import { permisoDelNumero } from "@/app/(app)/clients/nuevo/actions";

export type PermisoDelNumero = {
  granted: boolean;
  clientName: string | null;
};

// ¿SEVENZ YA PUEDE ESCRIBIRLE A ESTE NÚMERO MIENTRAS SE TECLEA?
//
// Un hook y no tres copias del mismo `useEffect`: lo usan los tres formularios
// de alta —`/clients/nuevo`, el buscador de cliente y el paso 4/4 del
// asistente— y lo que tienen que compartir no es la consulta sino el RITMO con
// el que se hace. Tres debounces escritos aparte son tres números que alguien
// cambia en uno y olvida en los otros, y el síntoma sería que una pantalla
// avisa y la de al lado no.
//
// ===========================================================================
// POR QUÉ EXISTE, EN UNA FRASE
//
// El permiso de WhatsApp es del NÚMERO y no de la ficha (decisión del dueño
// del 2026-10-10). Un tendero que deja la casilla sin marcar cree que no ha
// activado nada, y si ese teléfono aceptó alguna vez, su cliente recibe el
// mensaje igual. Lo reportó un dueño desde producción el 2026-10-21.
//
// ===========================================================================
// DEVUELVE `null` MIENTRAS NO SE SABE, Y ESO NO ES LO MISMO QUE «NO ACEPTA»
//
// Tres estados y tres frases distintas en la pantalla:
//
//   null   → todavía no se sabe. No se pinta NI la casilla ni el aviso.
//   granted: false → se pregunta, con la casilla de siempre.
//   granted: true  → se avisa, y la casilla no se enseña.
//
// Enseñar la casilla medio segundo a alguien que ya aceptó es ofrecerle
// deshacer algo por error, que es el mismo razonamiento que el asistente de
// venta ya tenía escrito para su propia tarjeta.
export function usePermisoDelNumero(whatsapp: string): PermisoDelNumero | null {
  const [permiso, setPermiso] = useState<PermisoDelNumero | null>(null);
  // LA ÚLTIMA PETICIÓN GANA, y sin esto el orden de llegada decide. Tecleando
  // deprisa salen varias en vuelo y la del número incompleto puede contestar
  // DESPUÉS que la del completo, dejando en pantalla la respuesta de un número
  // que ya no es el que hay en el campo.
  const ultima = useRef(0);

  useEffect(() => {
    const digitos = whatsapp.replace(/\D/g, "");
    if (digitos.length < 10) {
      setPermiso(null);
      return;
    }

    // 400ms: el tendero teclea un teléfono de corrido, así que esperar a que
    // pare evita una consulta por dígito sin que la frase llegue tarde.
    const id = ultima.current + 1;
    ultima.current = id;
    const t = setTimeout(() => {
      void permisoDelNumero(whatsapp).then((r) => {
        if (ultima.current === id) setPermiso(r);
      });
    }, 400);

    return () => clearTimeout(t);
  }, [whatsapp]);

  return permiso;
}
