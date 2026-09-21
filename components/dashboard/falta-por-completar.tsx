"use client";

import { TriangleAlert } from "lucide-react";
import { REQUIRED_MESSAGE } from "@/lib/form-validation";

// "Falta completar Monto", pegado al botón de guardar.
//
// El formulario YA marca cada campo en rojo con su mensaje debajo, y al
// intentar guardar lleva el foco al primero que falta. Eso basta en una
// pantalla de escritorio, donde el formulario entero se ve de una vez.
//
// EN UN TELÉFONO NO BASTA, y es el caso que importa. Con el teclado abierto se
// ven unos 300px de formulario: el dueño está abajo, sobre "Guardar fiado", y
// el campo que falta puede estar cuatro campos más arriba, fuera de la
// pantalla. Toca guardar, no pasa nada visible, y no hay forma de saber por
// qué. El error tiene que estar donde está el pulgar.
//
// No sustituye a los mensajes por campo: los repite aquí nombrando el campo,
// que es el dato que al de abajo le falta. Sin el nombre, un "Completa este
// campo" junto al botón no dice cuál.
//
// Solo aparece después de intentar guardar — `errors` únicamente se rellena en
// `validate()`, nunca al teclear. Ver hooks/use-field-errors.ts.

export function FaltaPorCompletar({
  errors,
  etiquetas,
}: {
  errors: Record<string, string>;
  // name del campo -> cómo se llama en pantalla. Se pasa desde fuera y no se
  // deduce del <label>: el texto visible lleva cosas como "(opcional)" o
  // "Monto a registrar", y aquí hace falta el nombre corto.
  etiquetas: Record<string, string>;
}) {
  const fallos = Object.entries(errors).filter(([name]) => etiquetas[name]);
  if (fallos.length === 0) return null;

  // Tres casos, y cada uno se dice distinto. La diferencia es si el mensaje
  // YA nombra el campo:
  //
  //   "Escribe el monto."                -> tal cual. Prefijarlo daba
  //                                         "Monto: Escribe el monto.",
  //                                         que dice monto dos veces.
  //   "Máximo $50,00 — lo que debe hoy." -> con prefijo, porque suelto no se
  //                                         sabe de qué campo habla.
  //   "Completa este campo."             -> agrupados en una sola frase, que
  //                                         es la que de verdad informa
  //                                         cuando faltan dos.
  const sinTildes = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const yaSeNombra = (mensaje: string, etiqueta: string) =>
    sinTildes(mensaje).includes(sinTildes(etiqueta));

  const vacios = fallos
    .filter(([, m]) => m === REQUIRED_MESSAGE)
    .map(([n]) => etiquetas[n]);
  const resto = fallos.filter(([, m]) => m !== REQUIRED_MESSAGE);

  const lista = (xs: string[]) =>
    xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2">
      {vacios.length > 0 ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Falta completar <span className="font-medium">{lista(vacios)}</span>.
          </span>
        </p>
      ) : null}
      {resto.map(([name, mensaje]) => (
        <p key={name} className="flex items-start gap-1.5 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {yaSeNombra(mensaje, etiquetas[name]) ? (
            <span>{mensaje}</span>
          ) : (
            <span>
              <span className="font-medium">{etiquetas[name]}</span>: {mensaje}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}
