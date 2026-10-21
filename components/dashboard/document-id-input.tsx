"use client";

import { Input } from "@/components/ui/input";
import {
  DOCUMENT_TYPE_LABELS,
  defaultDocumentType,
  documentTypesFor,
  parseDocumentId,
  type DocumentType,
} from "@/lib/document-id";
import type { OwnerCountry } from "@/lib/types";

// The document field: digits only, with the type beside it.
//
// WHAT THIS IS FOR. The field used to take anything, so a shopkeeper in a hurry
// could type "pendiente" or "no tiene" to get past a required field — the owner
// has seen exactly that with WhatsApp numbers. Junk in this column is what
// breaks matching a person to a record later. Digits only closes that door.
//
// ===========================================================================
// LA «V-» ERA UN ADORNO HASTA EL 2026-10-18, Y AHORA ES UN DATO
//
// Hasta ese día esto pintaba un «V-» fijo al lado de la caja, fuera del valor y
// fuera de la base. Era lo correcto mientras la letra fuera siempre la misma:
// el país ya vive en `clients.document_country`, así que la letra no añadía
// nada y había que quitarla otra vez para comparar dos documentos.
//
// El dueño pidió que se pueda ELEGIR entre V, E y J, y eso cambia el fondo del
// asunto: las tres son tres clases de titular distintas —una J es una empresa,
// una E alguien de fuera— y eso sí es un hecho sobre quién debe el dinero.
// Colombia lleva su propio trío (CC/CE/NIT), decisión suya el mismo día.
//
// DÓNDE SE GUARDA, QUE ES LA PARTE QUE PODÍA SALIR MAL EN SILENCIO: en su
// propia columna (`clients.document_type`, migración 125), nunca pegada dentro
// de `document_id`. El índice único de la migración `033` normaliza
// CONSERVANDO las letras, así que «V-12345678» y «12345678» serían dos claves
// distintas: el mismo cliente podría entrar dos veces, cada una con la mitad de
// lo que debe, y nada daría error.
//
// ===========================================================================
// EL TIPO VIAJA EN UN CAMPO OCULTO, Y NO ES PEREZA
//
// Siete pantallas montan este componente —el alta, la edición, dos de la
// revisión de libreta, el diálogo público, y las que vengan—. Un `<select>`
// controlado desde fuera habría obligado a añadir estado y a pasar dos props
// en las siete, y la regla de `CLAUDE.md` que nació el 2026-10-16 dice
// exactamente qué pasa cuando una se queda atrás: el formulario envía, el
// servidor acepta, la fila se guarda **sin el campo**, y nadie se entera hasta
// que semanas después la app contradice lo que el tendero recuerda.
//
// Con un `<select name="document_type">` dentro, toda pantalla que envíe este
// formulario manda el tipo sin tocar una línea. Quien además necesite leerlo en
// React —porque no usa `FormData`— pasa `onTypeChange`.
export function DocumentIdInput({
  id,
  country,
  value,
  onChange,
  type,
  defaultType,
  onTypeChange,
  sinTipo,
  invalid,
  required,
  disabled,
}: {
  id: string;
  country: OwnerCountry | null;
  // The stored value: digits, or a legacy value with letters in it.
  value: string;
  onChange: (next: string) => void;
  // El tipo guardado. `undefined` = no controlado: el `select` se gobierna solo
  // y el valor sale por el campo del formulario, que es lo que necesitan las
  // pantallas que envían con `FormData`.
  type?: DocumentType | null;
  // EL QUE TRAE UNA FICHA QUE YA EXISTE. Sin esto, editar a un cliente
  // guardado como «E» enseñaría «V» —el primero de la lista— y lo guardaría
  // como V al tocar cualquier otro campo. Un hecho real sobre una persona
  // cambiado en silencio por abrir un diálogo, que es justo lo que la rama
  // `legacy` de más arriba existe para no hacer.
  defaultType?: DocumentType | null;
  onTypeChange?: (next: DocumentType) => void;
  // SIN SELECTOR, A PROPÓSITO. Lo pasan las dos pantallas cuyo servidor
  // todavía no guarda el tipo: la revisión de una libreta y el diálogo público
  // de `/s/[token]`, que escribe por un RPC y necesitaría su propia migración.
  //
  // Es lo contrario de olvidarse: un selector cuya elección nadie guarda es el
  // fallo que `CLAUDE.md` describe el 2026-10-16 —el formulario envía, el
  // servidor acepta, la fila se guarda sin el campo y nadie se entera—, y
  // apagarlo deja esas pantallas exactamente como estaban hasta hoy.
  sinTipo?: boolean;
  invalid?: boolean;
  required?: boolean;
  // Se ensena el valor pero no se puede tocar. Lo usa la revision de una
  // libreta con un cliente que YA existe: la migracion 073 solo rellena
  // documentos que esten en null, asi que un campo editable ahi aceptaria el
  // cambio y lo tiraria en silencio.
  disabled?: boolean;
}) {
  const { digits, legacy } = parseDocumentId(value);
  const tipos = documentTypesFor(country);

  // A value with letters in it stays exactly as it is, in a plain box. Putting
  // an "E-12345678" into a digits box would drop the E the next time anyone
  // saved, and that is losing a real fact about a person by accident.
  //
  // Y TAMPOCO LLEVA SELECTOR. Ese valor ya trae su letra dentro; ofrecer un
  // tipo al lado dejaría al tendero eligiendo una segunda letra para un
  // documento que ya tiene la suya, y las dos podrían no coincidir.
  if (legacy) {
    return (
      <>
        <Input
          disabled={disabled}
          id={id}
          name="document_id"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          required={required}
        />
        <p className="text-xs text-muted-foreground">
          Cédula guardada con otro formato. Se queda como está; si la reescribes, admite solo
          números.
        </p>
      </>
    );
  }

  const field = (
    <Input
      disabled={disabled}
      id={id}
      name="document_id"
      value={digits}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      inputMode="numeric"
      autoComplete="off"
      aria-invalid={invalid}
      required={required}
    />
  );

  // PAÍS DESCONOCIDO, NINGÚN SELECTOR, y es deliberado: sin saber el país no se
  // sabe qué juego de letras corresponde, y elegir uno a ciegas guardaría «V»
  // en la cédula de un colombiano. Se enseña la caja sola, que es lo que había
  // hasta hoy y nunca guardó un dato falso.
  if (sinTipo || tipos.length === 0) return field;

  return (
    <div className="flex items-center gap-2">
      {/* `h-9` y no la altura por defecto: iguala al `Input` de al lado, y dos
          controles de alturas distintas en la misma fila es lo que hace que una
          fila se lea como dos cosas sueltas en vez de como un campo.

          `text-base` y NO `text-sm`: por debajo de 16px, Safari en iPhone hace
          zoom al enfocar y deja la pantalla desplazada a la derecha. Está en
          `CLAUDE.md` y vale para un `select` igual que para un `input`. */}
      <select
        name="document_type"
        aria-label="Tipo de documento"
        disabled={disabled}
        {...(type !== undefined
          ? { value: type ?? defaultDocumentType(country) ?? tipos[0] }
          : { defaultValue: defaultType ?? defaultDocumentType(country) ?? tipos[0] })}
        onChange={(e) => onTypeChange?.(e.target.value as DocumentType)}
        className="h-9 shrink-0 rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {tipos.map((t) => (
          // LA LETRA EN LA LISTA, EL NOMBRE COMPLETO EN EL TÍTULO. El frame
          // enseña «V» y no «Venezolano»: un desplegable con tres frases largas
          // se come el ancho que necesita el número, que es lo que de verdad se
          // teclea. El nombre sigue estando para quien dude, al mantener el
          // dedo encima y para un lector de pantalla.
          <option key={t} value={t} title={DOCUMENT_TYPE_LABELS[t]}>
            {t}
          </option>
        ))}
      </select>
      {/* min-w-0 so the box shrinks instead of pushing the selector off a
          phone. */}
      <div className="min-w-0 flex-1">{field}</div>
    </div>
  );
}
