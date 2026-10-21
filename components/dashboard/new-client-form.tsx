"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { registrarCliente } from "@/app/(app)/clients/nuevo/actions";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD, textoPermisoDeclarado } from "@/lib/whatsapp-opt-in";
import { usePermisoDelNumero } from "@/hooks/use-permiso-del-numero";
import { AvisoNumeroYaAcepta } from "@/components/dashboard/aviso-numero-ya-acepta";
import type { OwnerCountry } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

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
  // EL NÚMERO QUE YA TIENE PERMISO. Ver `usePermisoDelNumero`: si ese teléfono
  // ya aceptó —aunque sea en otra ficha, porque el permiso es del número— la
  // casilla se esconde y en su sitio va el aviso. Dejarla a la vista hacía que
  // el tendero creyera que no activaba nada mientras su cliente sí recibía.
  const [whatsapp, setWhatsapp] = useState("");
  const permiso = usePermisoDelNumero(whatsapp);
  const [error, setError] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();
  // ── LA CÉDULA QUE YA ES DE ALGUIEN ───────────────────────────────
  //
  // Esta pantalla se quedaba en la frase roja y ahí terminaba: el tendero no
  // podía ni mirar de quién era esa cédula ni crear la segunda cuenta a
  // propósito. El paso 4 del asistente de venta sí lo permitía desde el
  // 2026-10-18, y el dueño pidió el mismo comportamiento aquí: «recuerda que
  // esto lo ajustamos en la pantalla de registrar cliente pero en el último
  // paso del registro del fiado. Debe ser exactamente el mismo».
  //
  // DOS SALIDAS, y las dos hacen falta porque el choque significa dos cosas:
  //
  //   · Es la misma persona y no me acordaba -> mirar su cuenta y usarla.
  //   · Es una segunda cuenta a propósito --«Pepito» y «Pepito negocio», el
  //     negocio informal sin registro propio-- -> crearla.
  //
  // El servidor ya sabía hacer las dos: para en la primera y acepta
  // `confirm_duplicate` en la segunda. Lo que faltaba era la pantalla.
  const [duplicado, setDuplicado] = useState<{ id: string; name: string } | null>(null);

  // LOS DOS BOTONES GUARDAN LO MISMO Y TERMINAN EN SITIOS DISTINTOS. El
  // destino se decide aquí y no en el servidor: la acción crea un cliente, y a
  // dónde va el tendero después es cosa de la pantalla.
  function guardar(destino: "ficha" | "venta") {
    const form = formRef.current;
    if (!form) return;
    setError(null);
    const datos = new FormData(form);
    // EL SEGUNDO INTENTO LLEVA LA CONFIRMACIÓN. Si el tendero insiste --ahora
    // el botón dice «Crear cuenta separada»-- se manda `confirm_duplicate` y
    // se crea la segunda ficha.
    if (duplicado) datos.set("confirm_duplicate", "true");
    startTransition(async () => {
      const r = await registrarCliente(datos);
      if (!r.ok) {
        setError(r.error);
        setDuplicado(r.duplicado ?? null);
        return;
      }
      setDuplicado(null);
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
        <ScreenTitle>Nuevo cliente</ScreenTitle>
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
            onValueChange={setWhatsapp}
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
        {permiso?.granted ? (
          <AvisoNumeroYaAcepta clientName={permiso.clientName} />
        ) : (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-accent p-2.5">
            <Checkbox
              checked={acepta}
              onCheckedChange={(v) => setAcepta(v === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-4">{textoPermisoDeclarado(nombre)}</span>
          </label>
        )}

        {/* EL ERROR, SOLO. El enlace subrayado que llevaba al lado duró un
            día: el dueño lo pidió como botón el 2026-10-18, y abajo está.

            POR QUÉ UN BOTÓN Y NO UN ENLACE, en esta pantalla y no en el paso
            4: aquí ese control NAVEGA —se sale de la pantalla— y los controles
            que se salen viven en la barra de abajo, con los otros. En el
            asistente abre una hoja y se queda donde está, así que allí el
            enlace pegado al error sigue teniendo sentido. */}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>

      {/* LOS BOTONES, FUERA DEL `<form>` Y PEGADOS ABAJO, como el frame. Son
          `type="button"` a propósito: con dos submits en un formulario, pulsar
          Intro en cualquier campo dispara el primero —aquí «Registrar y
          finalizar»— y el tendero se encontraría guardado a medio escribir. */}
      {/* LA BARRA PEGADA ABAJO desde el 2026-10-18: con el formulario entero
          encima, estos dos botones solo aparecían al final del scroll. Ver
          `StickyActions`, que trae también el aire de abajo. */}
      <StickyActions>
        {/* «REGISTRAR A CUENTA SEPARADA» cuando la cédula choca, y es la ÚNICA
            acción que queda: aquí no hay transacción que llevar a la cuenta
            existente — esta pantalla solo crea clientes. Por eso el mockup
            tiene dos botones y esta pantalla uno; decisión del dueño el
            2026-10-18, preguntada antes de construir.

            Y por eso se queda RELLENO en vez de pasar a outlined como en el
            asistente: allí es la opción menos probable de dos, aquí es la
            única. */}
        <Button type="button" className="h-10 w-full" disabled={enviando} onClick={() => guardar("ficha")}>
          {enviando
            ? "Guardando…"
            : duplicado
              ? "Registrar a cuenta separada"
              : "Registrar y finalizar"}
        </Button>

        {/* «VER CLIENTE», DEBAJO DEL RELLENO y no encima. Lo pidió así el
            dueño, y es al revés que en el asistente — allí el orden es
            outlined arriba, relleno abajo.

            No es incoherencia: allí los dos botones REGISTRAN la venta y la
            pregunta es en qué cuenta, así que el seguro va primero. Aquí el
            relleno es la única forma de seguir y este solo sirve para mirar
            antes de decidir. */}
        {duplicado ? (
          <Button type="button" variant="outline" className="h-10 w-full" asChild>
            <Link href={`/clients/${duplicado.id}`}>Ver cuenta de {duplicado.name}</Link>
          </Button>
        ) : null}
        {/* «CONTINUAR CON VENTA» SE ESCONDE CON EL CHOQUE, a petición del
            dueño. Con una cédula repetida en pantalla hay una pregunta sin
            contestar —¿es él o es otro?»— y ese botón se la salta: crearía
            la cuenta separada y arrancaría una venta sobre ella de una vez,
            que es la decisión menos reversible de las dos. */}
        {duplicado ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            disabled={enviando}
            onClick={() => guardar("venta")}
          >
            Continuar con venta
          </Button>
        )}
      </StickyActions>

    </div>
  );
}
