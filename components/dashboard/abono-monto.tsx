"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { registrarAbonoDirigido } from "@/app/(app)/abonos/actions";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import {
  formatPriceAmount,
  parseAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// PASO 3/3 DEL ABONO DIRIGIDO — frame `1389:9381`.
export function AbonoMonto({
  ownerId,
  fiadoId,
  clienteId,
  clienteNombre,
  moneda,
  esLibroDelPeso,
  pendiente,
  rates,
  previstaFecha,
  yaAceptaAvisos,
}: {
  ownerId: string;
  fiadoId: string;
  clienteId: string;
  clienteNombre: string;
  moneda: PriceCurrency;
  // Un negocio colombiano lleva un solo libro y no convierte: ni elige moneda
  // ni ve equivalencias.
  esLibroDelPeso: boolean;
  pendiente: number;
  rates: BolivarRates | null;
  previstaFecha: string | null;
  yaAceptaAvisos: boolean;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // SE PUEDE ESCRIBIR EN BOLÍVARES solo si hay con qué convertir. Sin tasa, la
  // única moneda posible es la del libro: ofrecer bolívares y rechazarlos al
  // guardar sería peor que no ofrecerlos.
  const puedeBolivares = rates != null && !esLibroDelPeso;
  const [monedaTecleada, setMonedaTecleada] = useState<"VES" | PriceCurrency>(moneda);
  const [monto, setMonto] = useState("");
  const [usarPrevista, setUsarPrevista] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [avisar, setAvisar] = useState(false);

  const escrito = parseAmount(monto) ?? 0;

  // LO QUE VA A QUEDAR GUARDADO, en la moneda del libro. Se calcula aquí solo
  // para ENSEÑARLO; la cifra que se guarda la vuelve a calcular el servidor con
  // la tasa que él mismo sella. Dos cálculos para dos propósitos distintos: uno
  // informa, el otro decide, y el que decide nunca viaja en la petición.
  const enElLibro =
    monedaTecleada === "VES" && rates
      ? (priceIn(moneda, { amount: escrito, currency: "VES" }, rates)?.amount ?? 0)
      : escrito;

  const enBs =
    rates && monedaTecleada !== "VES"
      ? priceIn("VES", { amount: escrito, currency: moneda }, rates)?.amount
      : null;

  const deMas = enElLibro - pendiente > 0.005;
  const listo = enElLibro > 0 && !deMas;

  function guardar() {
    setError(null);
    startTransition(async () => {
      const r = await registrarAbonoDirigido({
        fiadoId,
        monto: escrito,
        monedaTecleada,
        usarPrevista,
        photoPath,
        descripcion,
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
      <ScreenBackRow
        href={`/abonos/nuevo/${fiadoId}`}
        label={clienteNombre}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-normal">Registrar abono</h1>
        <p className="text-sm text-muted-foreground">3/3 Monto a abonar</p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* LO QUE ESE FIADO DEBE, ARRIBA DEL TODO. Es el tope y es la razón de
          estar aquí: sin verlo, el tendero escribe una cifra a ciegas y se
          entera del límite cuando la acción se la rechaza. */}
      <div className="flex items-center justify-between rounded-[10px] border px-4 py-3">
        <span className="text-xs text-muted-foreground">Este fiado debe</span>
        <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
          {!esLibroDelPeso ? <CurrencyFlagIcon currency={moneda} className="size-3.5 shrink-0" /> : null}
          {formatPriceAmount(pendiente, moneda)}
        </span>
      </div>

      {puedeBolivares ? (
        <div className="flex flex-col gap-2">
          <Label>Moneda a registrar</Label>
          <div className="flex gap-2">
            {([["VES", "Bolívares"], [moneda, nombreDeMoneda(moneda)]] as const).map(([valor, texto]) => (
              <Button
                key={valor}
                type="button"
                variant={monedaTecleada === valor ? "secondary" : "outline"}
                size="sm"
                onClick={() => setMonedaTecleada(valor)}
              >
                {texto}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="monto">Monto</Label>
        <Input
          id="monto"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          inputMode="decimal"
          placeholder="00"
          className="h-10 tabular-nums"
        />
        {/* LA EQUIVALENCIA, EN LA DIRECCIÓN EN QUE SE ESCRIBIÓ. Tecleando
            bolívares interesa saber en cuánto queda el libro; tecleando la
            moneda del libro, cuántos bolívares son. Enseñar las dos a la vez
            llena la pantalla de cifras que nadie pidió. */}
        {monedaTecleada === "VES" && escrito > 0 ? (
          <p className="text-xs text-muted-foreground">
            Queda guardado como {formatPriceAmount(enElLibro, moneda)} a la tasa equivalente.
          </p>
        ) : null}
        {enBs != null && escrito > 0 ? (
          <p className="text-xs text-muted-foreground tabular-nums">= {formatBs(enBs)}</p>
        ) : null}
        {deMas ? (
          <p className="text-sm text-destructive">
            Ese fiado solo debe {formatPriceAmount(pendiente, moneda)}. Escribe esa cantidad o menos.
          </p>
        ) : null}
      </div>

      {/* LA CASILLA DE LA TASA PREVISTA SOLO SI HAY UNA. El frame la dibuja
          siempre porque su maqueta tiene uno de esos lunes; en la app, sin
          prevista guardada no hay nada que aplicar y la casilla mentiría. */}
      {previstaFecha ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={usarPrevista}
            onChange={(e) => setUsarPrevista(e.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span className="text-sm">
            Aplicar tasa BCV prevista para el {formatDate(previstaFecha)}
          </span>
        </label>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="descripcion">Descripción (opcional)</Label>
        <Textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Foto (opcional)</Label>
        <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-4 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        {/* EL INTERRUPTOR DE LOS AVISOS, ENCIMA DEL BOTÓN — es donde el frame lo
            pone. Solo sale si el cliente NO los tiene activados: son las
            palabras del dueño, «en caso que no las tenga activadas».

            EL RECIBO QUE SALE DE AQUÍ VIAJA CON `abono_confirmation_v3`,
            confirmada en producción el 2026-10-16. La `v2` fue la que se aprobó
            con el botón de URL estático y tumbó 12 de 12 envíos (`MS-39`); si
            alguien lee esa ficha y cree que el recibo no funciona, es esa. */}
        {!yaAceptaAvisos ? (
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              Avisar a {clienteNombre} por WhatsApp
            </span>
            <Switch checked={avisar} onCheckedChange={setAvisar} />
          </label>
        ) : null}
        <Button type="button" className="h-10 w-full" disabled={!listo || guardando} onClick={guardar}>
          {guardando
            ? "Guardando…"
            : enElLibro > 0
              ? `Pagar ${formatPriceAmount(enElLibro, moneda)}`
              : "Pagar"}
        </Button>
      </div>
    </div>
  );
}

function nombreDeMoneda(c: string) {
  return c === "USD" ? "Dólares" : c === "EUR" ? "Euros" : c === "VES" ? "Bolívares" : "Pesos";
}
