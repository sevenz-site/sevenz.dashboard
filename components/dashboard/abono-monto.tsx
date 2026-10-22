"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { WhatsappConsentField } from "@/components/dashboard/whatsapp-consent-field";
import {
  BsAmountPreview,
  MonedaTecleadaButtons,
  MontoARegistrarRow,
  MontoCard,
  PrevistaCheckbox,
  ResumenMonto,
  montoConvertido,
} from "@/components/dashboard/movement-currency-field";
import { registrarAbonoDirigido } from "@/app/(app)/abonos/actions";
import { fijarEnBorrador } from "@/lib/abonos/borrador";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { topeEnBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency, MonedaTecleada } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";

// PASO 3/3 DEL ABONO DIRIGIDO — frame `1389:9381`.
//
// ===========================================================================
// ESTA PANTALLA NO TIENE CAMPOS PROPIOS DE DINERO, Y ESO ES EL PUNTO
//
// Las pastillas de moneda, la tarjeta del monto, la de «Monto a registrar», la
// casilla de la tasa prevista y el «Resumen» son LOS MISMOS componentes que
// pinta el formulario de «Agregar» — `movement-currency-field.tsx`. Se reusan
// a petición del dueño el 2026-10-19 (*«los componentes de chips para
// seleccionar la moneda a registrar ya existen en el formulario actual de
// Agregar, así como los inputs de Montos y Resumen»*), y la primera versión de
// esta pantalla los había vuelto a escribir a mano.
//
// Reusarlos no es solo ahorro de líneas: `montoConvertido` hace exactamente la
// misma cuenta que `convertirDesdeBolivares` hace en el servidor
// —`Math.round((bs / porUnidad) * 100) / 100`—, así que la cifra que el tendero
// lee y la que se guarda no pueden separarse. Dos conversiones escritas aparte
// se separan el día que una se corrija.
//
// LO ÚNICO QUE ESTA PANTALLA AÑADE es que aquí el libro de destino NO se elige:
// el abono va a UN fiado y ese fiado ya tiene su moneda. Por eso las pastillas
// llevan dos opciones y no tres, y `MontoARegistrarRow` va sin desplegable.
export function AbonoMonto({
  ownerId,
  fiadoId,
  clienteId,
  clienteNombre,
  clienteTieneWhatsapp,
  libro,
  pendiente,
  rateContext,
  yaAceptaAvisos,
  pasoUnico = false,
  enReparto = false,
}: {
  ownerId: string;
  fiadoId: string;
  clienteId: string;
  clienteNombre: string;
  clienteTieneWhatsapp: boolean;
  // La moneda del fiado. `null` es un negocio colombiano: un solo libro, sin
  // monedas que elegir ni equivalencias que enseñar.
  libro: LedgerCurrency | null;
  pendiente: number;
  rateContext: MovementRateContext | null;
  yaAceptaAvisos: boolean;
  // SE LLEGÓ DESDE LA FICHA DEL FIADO, no desde el paso 2/2. Ver el porqué en
  // la página que lo decide; aquí solo cambia el rótulo y la flecha.
  pasoUnico?: boolean;
  // SE LLEGÓ DESDE UN REPARTO. Entonces esta pantalla NO guarda: fija lo que
  // le toca a este fiado y vuelve a «1/2 fiados». Ver `fijarYVolver`.
  enReparto?: boolean;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const llevaDivisas = libro !== null;
  const moneda = (libro ?? "COP") as PriceCurrency;

  // SE PUEDE ESCRIBIR EN BOLÍVARES solo si hay con qué convertir. Sin tasa, la
  // única moneda posible es la del libro: ofrecer bolívares y rechazarlos al
  // guardar sería peor que no ofrecerlos.
  const puedeBolivares = llevaDivisas && rateContext != null;

  const [monedaTecleada, setMonedaTecleada] = useState<MonedaTecleada>(libro ?? "USD");
  const [monto, setMonto] = useState("");
  const [usarPrevista, setUsarPrevista] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [avisar, setAvisar] = useState(false);

  const escrito = Number(monto) || 0;

  // La misma tasa que el servidor va a sellar, no una copia: el objeto viene
  // del servidor y la casilla solo elige cuál de las dos usar.
  const tasaActiva =
    usarPrevista && rateContext?.prevista
      ? { usd: rateContext.prevista.usd, eur: rateContext.prevista.eur }
      : rateContext?.effectiveRate;

  // LO QUE VA A QUEDAR GUARDADO, en la moneda del fiado. Se calcula aquí solo
  // para ENSEÑARLO; la cifra que se guarda la vuelve a calcular el servidor con
  // la tasa que él mismo sella. Dos cálculos para dos propósitos distintos: uno
  // informa, el otro decide, y el que decide nunca viaja en la petición.
  const enElLibro =
    monedaTecleada === "VES" && libro && rateContext
      ? (montoConvertido(monto, libro, rateContext, usarPrevista) ?? 0)
      : escrito;

  // EL TOPE, EN LA MONEDA EN QUE SE ESTÁ ESCRIBIENDO. Comparar bolívares
  // tecleados contra una deuda en dólares es un fallo que ya estuvo en
  // producción —ver `topeEnBolivares`—, y aquí reaparecería igual: con un fiado
  // de $55, «Bs. 100» son doce céntimos y se rechazarían por ser 100 > 55.
  const topeTecleado: number | null =
    monedaTecleada !== "VES" ? pendiente : libro ? topeEnBolivares(pendiente, libro, tasaActiva) : null;

  const topeLegible =
    monedaTecleada === "VES" ? formatBs(topeTecleado ?? 0) : formatPriceAmount(pendiente, moneda);

  const deMas = enElLibro - pendiente > 0.005;
  const listo = enElLibro > 0 && !deMas;

  // ===========================================================================
  // DENTRO DE UN REPARTO, ESTA PANTALLA NO GUARDA
  //
  // Decisión del dueño del 2026-10-22: al pulsar aquí *«regresa a 1/2 fiados
  // para seleccionar otro abono a pagar»*. Lo que el tendero fija es cuánto le
  // toca a ESTE fiado; lo que escribe en la base es «Pagar y finalizar», una
  // sola vez y con todas las líneas juntas.
  //
  // Es la mitad de `CT-128` sin la cual el reparto no sería una transacción:
  // guardando aquí, tres fiados serían tres pagos y TRES WhatsApp al cliente
  // por un solo billete.
  //
  // El monto se queda en el borrador del navegador, no en la base: mientras el
  // tendero va y viene no hay NADA escrito, así que abandonar a mitad no deja
  // medio pago en ningún sitio.
  function fijarYVolver() {
    setError(null);
    fijarEnBorrador(clienteId, fiadoId, enElLibro);
    router.push(`/abonos/nuevo?cliente=${clienteId}`);
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      const r = await registrarAbonoDirigido({
        fiadoId,
        monto: escrito,
        monedaTecleada: monedaTecleada as "VES" | PriceCurrency,
        usarPrevista,
        photoPath,
        descripcion,
        // Se mandan los DOS por separado: que la casilla estuviera en pantalla
        // y que la marcara. Mandar solo «aceptó» hace que un «no» no quede
        // anotado, y entonces la casilla vuelve a salir en el siguiente
        // movimiento como si nunca se hubiera preguntado.
        permisoMostrado: !yaAceptaAvisos,
        avisarPorWhatsapp: avisar,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/abonos/${r.movementId}`);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LA FLECHA VUELVE POR DONDE SE VINO.
          Llegando del paso 2/3, al paso 2/3. Llegando del botón «Pagar» de la
          ficha del fiado, a esa ficha -- que es lo que el dueño reportó el
          2026-10-20: *«si el usuario desea regresar al detalle seleccionando
          "Regresar" lo regresa a los dos pasos previos del flujo y eso está
          mal»*.

          `soloEnTelefono={false}` porque `app-header.tsx` esconde la barra de la
          app en todo `/abonos` a TODAS las anchuras: sin esto, desde `sm` la
          pantalla se quedaría sin ninguna salida. */}
      <ScreenBackRow
        href={
          pasoUnico
            ? `/transacciones/${fiadoId}`
            : `/abonos/nuevo/${fiadoId}${enReparto ? "?reparto=1" : ""}`
        }
        label={pasoUnico ? "Volver al detalle" : clienteNombre}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Registrar abono</ScreenTitle>
        {/* «1/1» Y NO «3/3» cuando se entra por la ficha. El contador no es
            decoración: dice cuántas pantallas quedan y cuántas hay detrás, y
            un «3/3» con dos pasos que nunca ocurrieron promete un camino de
            vuelta que no existe. */}
        <p className="text-sm text-muted-foreground">
          {pasoUnico ? "1/1" : enReparto ? "2/2" : "3/3"} Monto a abonar
        </p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* «FIADO SELECCIONADO», ARRIBA DEL TODO. Es el tope y es la razón de
          estar aquí: sin verlo, el tendero escribe una cifra a ciegas y se
          entera del límite cuando la acción se la rechaza. */}
      <div className="flex items-center justify-between gap-4 rounded-[10px] border px-4 py-3">
        <span className="text-xs text-muted-foreground">Fiado seleccionado</span>
        <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
          {llevaDivisas ? <CurrencyFlagIcon currency={libro} className="size-4 shrink-0" /> : null}
          {formatPriceAmount(pendiente, moneda)}
        </span>
      </div>

      {/* DOS OPCIONES, NO TRES: bolívares y la moneda de este fiado. La tercera
          sería abonar un fiado en dólares con euros, que es la conversión entre
          libros que este producto no hace nunca (ver `convert.ts`). */}
      {puedeBolivares ? (
        <MonedaTecleadaButtons
          value={monedaTecleada}
          onValueChange={setMonedaTecleada}
          opciones={[
            { value: "VES", label: "Bolívares" },
            { value: libro, label: libro === "USD" ? "Dólares" : "Euros" },
          ]}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="monto">Monto</Label>
        <MontoCard
          id="monto"
          name="monto"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          moneda={llevaDivisas ? monedaTecleada : null}
          max={topeTecleado ?? undefined}
          invalid={deMas}
          // UN SOLO RENGLÓN debajo de la cifra, no dos: el tope en gris
          // mientras va bien y el error rojo EN SU LUGAR cuando se pasa. Misma
          // decisión que el formulario de «Agregar», donde los dos a la vez
          // hacían que el dueño leyera el mismo aviso repetido.
          ayuda={
            deMas
              ? `Ese fiado solo debe ${formatPriceAmount(pendiente, moneda)}. Escribe esa cantidad o menos.`
              : `Máximo ${topeLegible} — lo que debe este fiado.`
          }
        />

        {/* Tecleando bolívares, la cifra que importa es la convertida: la deuda
            no vive en bolívares. Tecleando la moneda del fiado no hace falta,
            porque lo escrito ya es lo que se guarda. */}
        {monedaTecleada === "VES" && libro && rateContext ? (
          <MontoARegistrarRow
            bolivares={monto}
            destino={libro}
            rateContext={rateContext}
            usarPrevista={usarPrevista}
            type="payment"
          />
        ) : null}

        {rateContext && libro ? (
          <>
            {monedaTecleada === "VES" ? null : (
              <BsAmountPreview
                amount={monto}
                currency={libro}
                rateContext={rateContext}
                usarPrevista={usarPrevista}
              />
            )}
            {/* LA CASILLA DE LA PREVISTA SE GOBIERNA SOLA. El frame la dibuja
                siempre porque su maqueta tiene uno de esos viernes; el
                componente aplica `tocaOfrecerPrevista`, la misma ventana que
                usan las dos calculadoras y el formulario de «Agregar». La
                versión anterior de esta pantalla la pintaba en cuanto hubiera
                una prevista guardada, que es una segunda regla para la misma
                casilla. */}
            <PrevistaCheckbox
              rateContext={rateContext}
              checked={usarPrevista}
              onCheckedChange={setUsarPrevista}
            />
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="descripcion">Descripción (opcional)</Label>
        <Textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="min-h-[120px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Foto (opcional)</Label>
        <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
      </div>

      {/* EL RESUMEN, JUSTO ANTES DEL BOTÓN. Repite la cifra que se va a anotar y
          no se toca. Tecleando la moneda del fiado repite lo escrito, que parece
          redundante y no lo es: con el monto arriba y la foto en medio, en un
          teléfono el número ya no se ve cuando el dedo llega al botón. */}
      <ResumenMonto
        type="payment"
        monto={enElLibro > 0 ? enElLibro : null}
        moneda={libro}
        rateContext={rateContext}
        usarPrevista={usarPrevista}
        bolivaresTecleados={monedaTecleada === "VES" ? monto : null}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* ── `StickyActions`, NO LA MISMA BARRA COPIADA A MANO ──────────────
          Esta barra llevaba las clases de `StickyActions` escritas aquí una
          por una, y por eso NO heredaba lo único que ese componente añade
          sobre un `sticky`: desaparecer con el teclado abierto.

          Lo reportó el dueño el 2026-10-20 con una captura: tecleando el
          monto, «Pagar» y el aviso de WhatsApp se quedaban flotando encima
          del teclado numérico, tapando el campo que estaba rellenando. Es
          EXACTAMENTE el fallo que él mismo reportó el 2026-10-18 con
          «Registrar y finalizar» sobre el campo Documento, y que `StickyActions`
          existe para no repetir — pero esta pantalla no lo montaba.

          Las clases eran idénticas salvo `gap-3` contra el `gap-4` del
          componente y `pt-4` contra `pt-3`. O sea que la copia ya había
          empezado a separarse del original, que es cómo acaban las copias. */}
      <StickyActions>
        {/* EL PERMISO DE WHATSAPP, ENCIMA DEL BOTÓN — donde el frame lo pone.
            Es `WhatsappConsentField`, el mismo de las otras tres puertas, y no
            la frase del frame: lo que la casilla enseña es LITERALMENTE lo que
            se guarda como evidencia (`textoPermisoDeclarado`), y dos cadenas
            distintas —una para enseñar y otra para guardar— convierten la
            prueba ante Meta en una reconstrucción. Ver `lib/whatsapp-opt-in.ts`.

            EL RECIBO QUE SALE DE AQUÍ VIAJA CON `abono_confirmation_v3`,
            confirmada en producción el 2026-10-16. La `v2` fue la que se aprobó
            con el botón de URL estático y tumbó 12 de 12 envíos (`MS-39`); si
            alguien lee esa ficha y cree que el recibo no funciona, es esa. */}
        {/* EN UN REPARTO, LA CASILLA NO VA AQUÍ. Decisión del dueño del
            2026-10-22: sube a «1/2 fiados», junto a «Pagar y finalizar».
            Pedir permiso para mandar en una pantalla que no manda nada es
            confuso, y pedirlo una vez por fiado lo es más — un reparto de
            tres preguntaría tres veces por el mismo cliente. */}
        {enReparto ? null : (
          <WhatsappConsentField
            clientName={clienteNombre}
            hasWhatsapp={clienteTieneWhatsapp}
            yaTienePermiso={yaAceptaAvisos}
            checked={avisar}
            onCheckedChange={setAvisar}
            disabled={guardando}
          />
        )}
        <Button
          type="button"
          className="h-10 w-full"
          disabled={!listo || guardando}
          onClick={enReparto ? fijarYVolver : guardar}
        >
          {guardando
            ? "Guardando…"
            : enElLibro > 0
              ? `Pagar ${formatPriceAmount(enElLibro, moneda)}`
              : "Pagar"}
        </Button>
      </StickyActions>
    </div>
  );
}
