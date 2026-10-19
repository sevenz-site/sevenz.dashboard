"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { registrarCliente } from "@/app/(app)/clients/nuevo/actions";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD, textoPermisoDeclarado } from "@/lib/whatsapp-opt-in";
import type { OwnerCountry } from "@/lib/types";

// LA PANTALLA DE CLIENTE NUEVO — frame `1389:8313`, 2026-10-18.
//
// ===========================================================================
// ES UNA PANTALLA Y NO UN DIÁLOGO, Y ESO CAMBIA UNA COSA DE FONDO
//
// El alta de siempre vive en un diálogo que crea cliente **y su primer
// fiado**, con monto, plazo y cuotas. Este frame no tiene ni un campo de
// dinero: termina en «Registrar y finalizar» y «Continuar con venta». Con la
// venta dentro de Sevenz, apuntar a alguien dejó de implicar que te deba algo.
//
// Las dos puertas conviven a propósito. El diálogo sigue sirviendo para cuando
// el tendero tiene la deuda delante; esta pantalla, para cuando solo quiere
// apuntar a la persona. Lo que no se duplica es la comprobación de duplicados
// —vive en `lib/clients/duplicate-document.ts`— porque dos copias de eso se
// separan y dejan entrar al mismo cliente dos veces.
//
// ===========================================================================
// UN `<form>` DE VERDAD, Y NO ESTADO POR CAMPO
//
// El tipo de documento lo manda un `select` que vive DENTRO de
// `DocumentIdInput`, y el teléfono lo compone `WhatsappInput` en un campo
// oculto. Los dos viajan solos con el `FormData`. Controlarlos desde aquí
// obligaría a replicar su lógica —el prefijo del país, el filtrado a dígitos—
// y la copia es lo que se queda atrás el día que la original cambie.
export function NewClientForm({ ownerCountry }: { ownerCountry: OwnerCountry | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [nombre, setNombre] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  // LOS DOS BOTONES GUARDAN LO MISMO Y TERMINAN EN SITIOS DISTINTOS. El
  // destino se decide aquí y no en el servidor: la acción crea un cliente, y a
  // dónde va el tendero después es cosa de la pantalla.
  function guardar(destino: "ficha" | "venta") {
    const form = formRef.current;
    if (!form) return;
    setError(null);
    const datos = new FormData(form);
    startTransition(async () => {
      const r = await registrarCliente(datos);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(destino === "venta" ? `/ventas/nueva?cliente=${r.clientId}` : `/clients/${r.clientId}`);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* LA MISMA FILA QUE NOTIFICACIONES —ver `ScreenBackRow`— y no una
          flecha suelta. Un enlace y no `router.back()`: a esta pantalla se
          llega desde la hoja de «Registrar», que puede haberse abierto en
          cualquier sitio, y `back()` devolvería a donde fuera que estuviera el
          tendero. */}
      <ScreenBackRow href="/dashboard" soloEnTelefono={false} />

      <div className="py-2">
        <h1 className="text-2xl font-normal">Nuevo cliente</h1>
      </div>

      {/* SIN `px-4` PROPIO: `AppMain` ya pone los 16px laterales y esto los
          doblaba a 32. Ver el mismo comentario en `nueva-venta.tsx`. */}
      <form ref={formRef} className="flex flex-1 flex-col gap-4 py-6">
        {/* Viaja siempre: la casilla se enseña siempre en esta pantalla, así
            que el cliente nace con `whatsapp_consent_asked_at` puesto y el alta
            de movimiento ya no vuelve a preguntar. */}
        <input type="hidden" name={CONSENT_SHOWN_FIELD} value="1" />
        {acepta ? <input type="hidden" name={CONSENT_FIELD} value="1" /> : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Nombre del cliente</Label>
          <Input
            id="name"
            name="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Escribe nombres y apellidos"
            required
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="document_id">Documento</Label>
          <DocumentIdInput
            id="document_id"
            country={ownerCountry}
            value={documentId}
            onChange={setDocumentId}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
          {/* OPCIONAL DESDE EL 2026-09-21, y la razón es de datos: al exigirlo,
              quien no lo sabía lo inventaba — en dev llegó a haber NUEVE
              clientes compartiendo un número. Un hueco es honesto y se pide
              después; un número falso es indistinguible de uno bueno y el día
              que se enciendan los avisos le manda la deuda de alguien a un
              tercero. */}
          {/* EL PREFIJO ARRANCA EN EL PAÍS DEL NEGOCIO, y faltaba: sin esto el
              selector se quedaba en su primera opción —Colombia, +57— y un
              tendero venezolano guardaba a TODOS sus clientes con un prefijo
              que no es el suyo. Lo vio el dueño en una captura el 2026-10-18.

              No es cosmético: el número guardado es el que la puerta de envío
              va a marcar el día que se enciendan los avisos al cliente, así
              que un +57 de más es un mensaje que no llega — o que llega a
              otro.

              `OWNER_COUNTRY_DIAL_CODE` y no una constante aquí: es el mismo
              mapa que usan las otras cuatro pantallas con este campo.

              SIN PAÍS NO SE SUGIERE NADA y el selector se queda como venga.
              Adivinar aquí es exactamente el fallo que se está arreglando. */}
          <WhatsappInput
            id="whatsapp"
            name="whatsapp"
            preferredDialCode={ownerCountry ? OWNER_COUNTRY_DIAL_CODE[ownerCountry] : undefined}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="address">Dirección (opcional)</Label>
          <Input id="address" name="address" placeholder="Escribe dirección" autoComplete="off" />
        </div>

        {/* EL PERMISO DE WHATSAPP (MS-34). La frase se genera con
            `textoPermisoDeclarado`, LA MISMA función con la que el servidor la
            guarda: esa cadena es la evidencia ante Meta, y dos textos distintos
            —uno en pantalla y otro en la base— la convertirían en una
            reconstrucción en vez de una prueba. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-accent p-2.5">
          <Checkbox
            checked={acepta}
            onCheckedChange={(v) => setAcepta(v === true)}
            className="mt-0.5"
          />
          <span className="text-xs leading-4">{textoPermisoDeclarado(nombre)}</span>
        </label>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>

      {/* LOS BOTONES, FUERA DEL `<form>` Y PEGADOS ABAJO, como el frame. Son
          `type="button"` a propósito: con dos submits en un formulario, pulsar
          Intro en cualquier campo dispara el primero —aquí «Registrar y
          finalizar»— y el tendero se encontraría guardado a medio escribir. */}
      {/* `pt-4` y no `py-4`: los 40px de aire que pidio el dueno los pone
          `AppMain`, y un padding propio aqui abajo los convertia en 56. */}
      <div className="flex flex-col gap-4 pt-4">
        <Button type="button" className="h-10 w-full" disabled={enviando} onClick={() => guardar("ficha")}>
          {enviando ? "Guardando…" : "Registrar y finalizar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          disabled={enviando}
          onClick={() => guardar("venta")}
        >
          Continuar con venta
        </Button>
      </div>
    </div>
  );
}
