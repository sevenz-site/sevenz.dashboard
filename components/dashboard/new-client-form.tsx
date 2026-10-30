"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { StepProgress } from "@/components/dashboard/step-progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { CuotasSelect } from "@/components/dashboard/cuotas-select";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { registrarCliente, validarCliente } from "@/app/(app)/clients/nuevo/actions";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD, textoPermisoDeclarado } from "@/lib/whatsapp-opt-in";
import { usePermisoDelNumero } from "@/hooks/use-permiso-del-numero";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";
import { AvisoNumeroYaAcepta } from "@/components/dashboard/aviso-numero-ya-acepta";
import type { LedgerCurrency, OwnerCountry } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

// LA PANTALLA DE CLIENTE NUEVO — frame `1389:8313`, 2026-10-18, y desde el
// 2026-10-30 DOS PASOS: «1/2 Información del cliente» (`1868:15815`) y «2/2
// Especifica deuda» (`1868:16119`).
//
// ===========================================================================
// POR QUÉ HAY UN SEGUNDO PASO — encargo del dueño el 2026-10-30
//
// El caso borde que lo motiva, en sus palabras: el dueño registra un cliente
// nuevo *«con fiado pendiente desde su libreta a sevenz de manera manual»*,
// sin haber vendido nada dentro de la app. Hasta hoy la única forma de que un
// cliente naciera debiendo era inventarse una venta.
//
// LO QUE PASA EN CADA BOTÓN DEL PASO 2, y lo decidió él (preguntado ese día):
//
//   · «Registrar y finalizar» guarda el cliente y su deuda antigua —que puede
//     ser cero, y entonces no se escribe ningún movimiento— y lleva a su ficha.
//   · «Continuar con venta» guarda lo mismo AL PULSAR, y abre el asistente de
//     venta para ese cliente. La venta es otra transacción: si el tendero la
//     abandona, la deuda antigua ya está apuntada, porque es un hecho aparte.
//     «Por cobrar» suma las dos sin que nada lo tenga que hacer a propósito:
//     son dos fiados del mismo libro.
//
// LA DEUDA ANTIGUA ES UN FIADO, sin bolívares (solo dólares o euros) y con su
// plazo, sus cuotas, su foto y su descripción. El porqué está en
// `leerDeudaAntigua`, en `app/(app)/clients/nuevo/actions.ts`.
//
// ===========================================================================
// UN SOLO `<form>` PARA LOS DOS PASOS
//
// El paso 1 se ESCONDE en el 2, no se desmonta: el tipo de documento lo manda
// un `select` que vive dentro de `DocumentIdInput` y el teléfono lo compone
// `WhatsappInput` en un campo oculto, y los dos viajan solos con el `FormData`
// solo si siguen en el DOM. Desmontarlos obligaría a copiar su lógica aquí, y
// la copia es lo que se queda atrás el día que la original cambie.
//
// SE ESCONDE CON LA CLASE Y NO CON EL ATRIBUTO `hidden`: un `flex` en la misma
// etiqueta le gana al atributo y la sección se seguiría viendo (DESIGN-SYSTEM,
// «flex/hidden»).
export function NewClientForm({
  ownerCountry,
  ownerId,
}: {
  ownerCountry: OwnerCountry | null;
  ownerId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [paso, setPaso] = useState<1 | 2>(1);
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
  // DOS SALIDAS, y las dos hacen falta porque el choque significa dos cosas:
  //
  //   · Es la misma persona y no me acordaba -> mirar su cuenta y usarla.
  //   · Es una segunda cuenta a propósito --«Pepito» y «Pepito negocio», el
  //     negocio informal sin registro propio-- -> crearla.
  //
  // Pedido por el dueño el 2026-10-18 igual que en el paso 4 del asistente de
  // venta. Desde el 2026-10-30 la pregunta se hace al pulsar «Continuar» del
  // paso 1, que es donde está la cédula, y la confirmación viaja hasta el final.
  const [duplicado, setDuplicado] = useState<{ id: string; name: string } | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  // ── LA DEUDA ANTIGUA, PASO 2 ─────────────────────────────────────
  const [monto, setMonto] = useState("");
  const { ref: refMonto, onChange: alTeclearMonto } = useGroupedAmount(monto, setMonto, 2);
  // DÓLARES POR DEFECTO, como el frame. Un negocio colombiano no lleva
  // selector: tiene un solo libro.
  const [moneda, setMoneda] = useState<LedgerCurrency>("USD");
  const [plazo, setPlazo] = useState("sin_especificar");
  const [cuotas, setCuotas] = useState("sin_especificar");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const plazoDias =
    plazo && plazo !== "sin_especificar" && Number.isFinite(Number(plazo)) ? Number(plazo) : null;

  function datosDelFormulario() {
    const datos = new FormData(formRef.current ?? undefined);
    if (confirmado) datos.set("confirm_duplicate", "true");
    return datos;
  }

  // PASO 1 → 2: se comprueba sin crear nada (`validarCliente`). Un error aquí
  // —el nombre, la cédula, una cédula repetida— se ve donde está el campo, no
  // una pantalla después.
  function continuar() {
    setError(null);
    const datos = datosDelFormulario();
    // EL SEGUNDO TOQUE CON LA CÉDULA REPETIDA EN PANTALLA ES LA CONFIRMACIÓN de
    // la cuenta separada, igual que antes lo era el segundo «Registrar».
    if (duplicado) datos.set("confirm_duplicate", "true");
    startTransition(async () => {
      const r = await validarCliente(datos);
      if (!r.ok) {
        setError(r.error);
        setDuplicado(r.duplicado ?? null);
        return;
      }
      if (duplicado) setConfirmado(true);
      setDuplicado(null);
      setPaso(2);
    });
  }

  // LOS DOS BOTONES DEL PASO 2 GUARDAN LO MISMO Y TERMINAN EN SITIOS DISTINTOS.
  // El destino se decide aquí y no en el servidor: la acción crea un cliente
  // (y su deuda), y a dónde va el tendero después es cosa de la pantalla.
  function guardar(destino: "ficha" | "venta") {
    setError(null);
    const datos = datosDelFormulario();
    startTransition(async () => {
      const r = await registrarCliente(datos);
      if (!r.ok) {
        setError(r.error);
        // ENTRE LOS DOS PASOS PUDO ENTRAR OTRO CLIENTE CON ESA CÉDULA: el alta
        // lo vuelve a comprobar. Si pasa, se vuelve al paso 1, que es donde
        // está la pregunta y los dos botones para contestarla.
        if (r.duplicado) {
          setDuplicado(r.duplicado);
          setConfirmado(false);
          setPaso(1);
        }
        return;
      }
      router.push(destino === "venta" ? `/ventas/nueva?cliente=${r.clientId}` : `/clients/${r.clientId}`);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* LA FLECHA DEL PASO 2 VUELVE AL 1, con lo escrito intacto. La del paso
          1 es un enlace y no `router.back()`: a esta pantalla se llega desde la
          hoja de «Registrar», que puede haberse abierto en cualquier sitio. */}
      {paso === 1 ? (
        <ScreenBackRow href="/dashboard" soloEnTelefono={false} />
      ) : (
        <ScreenBackRow
          onClick={() => {
            setError(null);
            setPaso(1);
          }}
          label="Volver al paso anterior"
          soloEnTelefono={false}
        />
      )}

      <div className="py-2">
        <ScreenTitle>{paso === 1 ? "Nuevo cliente" : "Información de deuda"}</ScreenTitle>
      </div>
      <StepProgress
        step={paso}
        total={2}
        label={paso === 1 ? "Información del cliente" : "Especifica deuda"}
      />

      {/* SIN `px-4` PROPIO: `AppMain` ya pone los 16px laterales y esto los
          doblaba a 32. Ver el mismo comentario en `nueva-venta.tsx`. */}
      <form ref={formRef} className="flex flex-1 flex-col gap-4 py-6" onSubmit={(e) => e.preventDefault()}>
        {/* Viaja siempre: la casilla se enseña siempre en esta pantalla, así
            que el cliente nace con `whatsapp_consent_asked_at` puesto y el alta
            de movimiento ya no vuelve a preguntar. */}
        <input type="hidden" name={CONSENT_SHOWN_FIELD} value="1" />
        {acepta ? <input type="hidden" name={CONSENT_FIELD} value="1" /> : null}

        {/* ═══════════════ PASO 1: EL CLIENTE ═══════════════ */}
        <div className={paso === 1 ? "flex flex-col gap-4" : "hidden"}>
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
              onChange={(v) => {
                setDocumentId(v);
                // OTRA CÉDULA, OTRA PREGUNTA: la confirmación de cuenta
                // separada era para la que estaba escrita, no para esta.
                setDuplicado(null);
                setConfirmado(false);
              }}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
            {/* OPCIONAL DESDE EL 2026-09-21, y la razón es de datos: al exigirlo,
                quien no lo sabía lo inventaba — en dev llegó a haber NUEVE
                clientes compartiendo un número.

                EL PREFIJO ARRANCA EN EL PAÍS DEL NEGOCIO: sin esto el selector
                se quedaba en +57 y un tendero venezolano guardaba a todos sus
                clientes con un prefijo que no es el suyo (2026-10-18). */}
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
              guarda: esa cadena es la evidencia ante Meta. */}
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
        </div>

        {/* ═══════════════ PASO 2: LA DEUDA ANTIGUA ═══════════════ */}
        <div className={paso === 2 ? "flex flex-col gap-4" : "hidden"}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="deuda_monto">Deuda antigua</Label>
            <div className="flex gap-1">
              {/* SE AGRUPA MIENTRAS SE TECLEA, como todos los campos de dinero
                  (`useGroupedAmount`). Vacío o cero = sin deuda antigua: el
                  dueño lo dijo, *«puede ser 0»*, y entonces no se escribe
                  ningún fiado. */}
              <Input
                id="deuda_monto"
                name="deuda_monto"
                ref={refMonto}
                inputMode="decimal"
                value={monto}
                onChange={alTeclearMonto}
                placeholder="00"
                className="min-w-0 flex-1"
                autoComplete="off"
              />
              {ownerCountry === "VE" ? (
                <>
                  <Select value={moneda} onValueChange={(v) => setMoneda(v as LedgerCurrency)}>
                    <SelectTrigger className="w-auto shrink-0 gap-2" aria-label="Moneda de la deuda">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["USD", "EUR"] as const).map((c) => (
                        <SelectItem key={c} value={c}>
                          <CurrencyFlagIcon currency={c} />
                          {c === "USD" ? "Dólares" : "Euros"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="deuda_moneda" value={moneda} />
                </>
              ) : null}
            </div>
          </div>

          {/* LAS MISMAS OPCIONES QUE UN FIADO, por instrucción del dueño, y los
              mismos componentes: un plazo y unas cuotas que se eligieran aquí de
              otra forma acabarían guardando otra cosa. Los dos empiezan en
              «Sin especificar», como el frame. */}
          <PlazoPagoSelect
            value={plazo}
            // LAS CUOTAS NO SE BORRAN AL QUITAR EL PLAZO. Se borraban hasta el
            // 2026-10-30; desde que Cuotas ofrece todas sus opciones también sin
            // plazo, el aviso de `CuotasSelect` dice que falta el plazo, y tirar
            // en silencio lo que el tendero eligió sería peor que avisarle.
            //
            // Y EL ERROR DEL GUARDADO SE BORRA AL TOCAR UNO DE LOS DOS: el
            // servidor rechaza cuotas sin plazo con «elige primero el plazo», y
            // esa frase seguía debajo del formulario con el plazo ya elegido.
            // Medido en dev el 2026-10-30.
            onValueChange={(v) => {
              setPlazo(v);
              setError(null);
            }}
          />
          <CuotasSelect
            value={cuotas}
            onValueChange={(v) => {
              setCuotas(v);
              setError(null);
            }}
            plazoDias={plazoDias}
            sinEspecificar
          />

          <div className="flex flex-col gap-1">
            <Label>Foto (opcional)</Label>
            <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
            {photoPath ? <input type="hidden" name="deuda_photo_path" value={photoPath} /> : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="deuda_descripcion">Descripción (opcional)</Label>
            <Textarea
              id="deuda_descripcion"
              name="deuda_descripcion"
              placeholder="Descripción"
              maxLength={500}
              className="min-h-[120px]"
            />
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>

      {/* LOS BOTONES, FUERA DEL `<form>` Y PEGADOS ABAJO, como el frame. Son
          `type="button"` a propósito: con un submit, pulsar Intro en cualquier
          campo guardaría a medio escribir. */}
      <StickyActions>
        {paso === 1 ? (
          <>
            {/* UN SOLO BOTÓN EN EL PASO 1 — frame `1868:15815`. Con la cédula
                repetida dice que lo que sigue es una cuenta separada, que es la
                única forma de seguir desde aquí; la otra salida es mirar la
                cuenta que ya existe. */}
            <Button type="button" className="h-10 w-full" disabled={enviando} onClick={continuar}>
              {enviando ? "Comprobando…" : duplicado ? "Continuar con cuenta separada" : "Continuar"}
            </Button>
            {duplicado ? (
              <Button type="button" variant="outline" className="h-10 w-full" asChild>
                <Link href={`/clients/${duplicado.id}`}>Ver cuenta de {duplicado.name}</Link>
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button
              type="button"
              className="h-10 w-full"
              disabled={enviando}
              onClick={() => guardar("ficha")}
            >
              {enviando ? "Guardando…" : "Registrar y finalizar"}
            </Button>
            {/* «CONTINUAR CON VENTA» YA NO SE ESCONDE CON UNA CÉDULA REPETIDA.
                Se escondía (decisión del 2026-10-18) porque crearía la cuenta
                separada y arrancaría una venta sobre ella sin que nadie hubiera
                contestado «¿es él o es otro?». Desde el 2026-10-30 esa pregunta
                se contesta en el paso 1: aquí solo se llega habiendo elegido. */}
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              disabled={enviando}
              onClick={() => guardar("venta")}
            >
              Continuar con venta
            </Button>
          </>
        )}
      </StickyActions>
    </div>
  );
}
