"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { WhatsappConsentField } from "@/components/dashboard/whatsapp-consent-field";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { registrarAbonoRepartido } from "@/app/(app)/abonos/actions";
import { repartir, deudaDelLibro, type FiadoParaRepartir } from "@/lib/abonos/reparto";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";

// PASO 1/2 DEL ABONO REPARTIDO — frame `1526:11182`.
//
// El tendero escribe cuánto le pagaron y la pantalla enseña cómo cae ese
// dinero entre los fiados abiertos, antes de guardar nada. Sustituye al paso
// 1/3, que obligaba a elegir UN fiado y repetir la operación por cada uno.
//
// ===========================================================================
// EL REPARTO SE CALCULA DOS VECES A PROPÓSITO
//
// Aquí, para enseñarlo; y en el servidor, para guardarlo. Es la MISMA función
// —`repartir()`— con las mismas entradas, así que no pueden discrepar. Lo que
// NO se hace es mandar las líneas ya repartidas desde el navegador: entonces
// cualquiera podría guardar un reparto que no sigue la gravedad o que le mete
// a un fiado más de lo que debe, y esta pantalla no tendría forma de notarlo.
//
// ===========================================================================
// LA MISMA TARJETA QUE EL PASO 1/3, Y ESO ES UNA DECISIÓN
//
// El frame dibuja DOS tarjetas distintas: la que ya tiene importe asignado
// lleva fecha y chevron, y la que no lleva un botón «Pagar» y ni fecha ni
// chevron. Aquí las dos son `TarjetaDeFiado`, la misma de `/abonos/nuevo` y
// del detalle de un abono, y lo único que cambia es lo que va DEBAJO.
//
// Dos razones, y la segunda es del dueño:
//
//   · Tres copias de la misma tarjeta en tres archivos es exactamente cómo
//     dejan de ser la misma —lo tiene escrito `tarjeta-de-fiado.tsx`—.
//   · El frame NO dibuja «Debe $X», que la tarjeta de producción sí tiene.
//     Preguntado el 2026-10-22, el dueño respondió *«Sí mantén la tarjeta»*.
//     Y es la cifra que decide el reparto: repartir sin ver cuánto falta en
//     cada fiado es repartir a ciegas.
export function AbonoReparto({
  clienteId,
  clienteNombre,
  clienteTieneWhatsapp,
  yaAceptaAvisos,
  fiados,
  libros,
  rates,
  paisVE,
}: {
  clienteId: string;
  clienteNombre: string;
  clienteTieneWhatsapp: boolean;
  yaAceptaAvisos: boolean;
  fiados: FiadoAbierto[];
  // Los libros en los que este cliente debe algo. Casi siempre uno.
  libros: (LedgerCurrency | null)[];
  rates: BolivarRates | null;
  // Solo un negocio venezolano puede teclear en bolívares.
  paisVE: boolean;
}) {
  const router = useRouter();
  const [guardando, empezar] = useTransition();

  const [libro, setLibro] = useState<LedgerCurrency | null>(libros[0] ?? null);
  const [monto, setMonto] = useState("");
  const [enBolivares, setEnBolivares] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UN INSTANTE PARA TODA LA PANTALLA. El orden del reparto y los rótulos que
  // se pintan al lado tienen que salir del mismo, o la lista puede ordenarse
  // de una forma y rotularse de otra sin que nada falle.
  const [ahora] = useState(() => new Date());

  const delLibro = useMemo(
    () => fiados.filter((f) => (f.currency ?? null) === libro),
    [fiados, libro],
  );

  const paraRepartir: FiadoParaRepartir[] = useMemo(
    () =>
      delLibro.map((f) => ({
        movementId: f.movementId,
        createdAt: f.fecha,
        plazoDias: f.plazoDias,
        cuotas: f.cuotas,
        amount: f.amount,
        pendiente: f.pending,
      })),
    [delLibro],
  );

  const deuda = deudaDelLibro(paraRepartir);
  const montoNum = Number(monto.replace(",", ".")) || 0;

  // LO QUE SE TECLEA PUEDE SER BOLÍVARES Y EL LIBRO SER DÓLARES, así que el
  // reparto se hace SIEMPRE sobre la cifra del libro. Sin tasa no se puede
  // convertir y la pantalla lo dice en vez de inventar una.
  const enElLibro = useMemo(() => {
    if (!enBolivares) return montoNum;
    if (!libro || !rates) return 0;
    // `amount` es `number | null`: null cuando falta la tasa. Cae a 0, que
    // deja el botón apagado — mejor que convertir con una tasa inventada.
    return priceIn(libro, { amount: montoNum, currency: "VES" }, rates).amount ?? 0;
  }, [enBolivares, montoNum, libro, rates]);

  const excede = enElLibro - deuda > 0.005;

  const reparto = useMemo(
    () => repartir({ monto: excede ? 0 : enElLibro, fiados: paraRepartir, ahora }),
    [excede, enElLibro, paraRepartir, ahora],
  );

  const asignado = new Map(reparto.lineas.map((l) => [l.movementId, l.asignado]));
  // En el orden del reparto, no en el de la consulta: es el que explica por
  // qué al primero le tocó todo.
  const enOrden = reparto.lineas
    .map((l) => delLibro.find((f) => f.movementId === l.movementId))
    .filter((f): f is FiadoAbierto => f != null);

  const equivalencia = (n: number, moneda: PriceCurrency | null) => {
    if (!rates || !moneda || n <= 0) return null;
    return priceIn("VES", { amount: n, currency: moneda }, rates)?.amount ?? null;
  };

  const bsDelTotal = enBolivares ? montoNum : equivalencia(enElLibro, libro);

  const guardar = () => {
    setError(null);
    empezar(async () => {
      const r = await registrarAbonoRepartido({
        clienteId,
        libro,
        montoTecleado: montoNum,
        monedaTecleada: enBolivares ? "VES" : ((libro ?? "COP") as PriceCurrency),
        permisoMostrado: clienteTieneWhatsapp && !yaAceptaAvisos,
        avisarPorWhatsapp: consent,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/clients/${clienteId}`);
    });
  };

  const puedeGuardar = enElLibro > 0.005 && !excede && reparto.repartido > 0.005 && !guardando;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      {/* `soloEnTelefono={false}`: `/abonos` está en la lista de
          `app-header.tsx` que suprime la cabecera a TODAS las anchuras, así
          que sin esto, a partir de `sm` la pantalla se queda sin forma de
          volver. */}
      <ScreenBackRow href={`/clients/${clienteId}`} label={clienteNombre} soloEnTelefono={false} />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Registrar abono</ScreenTitle>
        <p className="text-sm text-muted-foreground">1/2 fiados</p>
        {/* `aria-hidden` porque la línea de arriba ya lo dice con palabras. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* SIN FIADOS NO HAY NADA QUE REPARTIR, y la salida es registrar la
          venta. Decisión del dueño del 2026-10-19, heredada del paso 1/3: el
          tendero que llegó aquí quería anotar que alguien le pagó; si no hay
          deuda, lo que de verdad pasó es que todavía no ha anotado lo que se
          llevó. */}
      {fiados.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[10px] border px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {clienteNombre} no tiene fiados abiertos, así que no hay nada a lo que abonar.
          </p>
          <Button asChild className="h-10 w-full">
            <Link href={`/ventas/nueva?cliente=${clienteId}`}>Registrar venta</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* EL LIBRO, SOLO CUANDO HAY MÁS DE UNO. Con un solo libro un
              selector de una opción es una pregunta sin respuesta posible — y
              es el caso de casi todos los clientes. */}
          {libros.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label>¿En qué moneda te pagó?</Label>
              <div className="flex gap-2">
                {libros.map((l) => (
                  <Button
                    key={l ?? "COP"}
                    type="button"
                    variant={l === libro ? "default" : "outline"}
                    className="h-10 flex-1"
                    onClick={() => {
                      setLibro(l);
                      setEnBolivares(false);
                    }}
                  >
                    {l === "EUR" ? "Euros" : l === "USD" ? "Dólares" : "Pesos"}
                  </Button>
                ))}
              </div>
              <p className="text-xs leading-4 text-muted-foreground">
                Un abono se reparte dentro de una sola moneda: pagar una deuda en dólares con euros
                exigiría una tasa que nadie acordó.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monto">¿Cuánto abona?</Label>
            <div className="flex items-start gap-2">
              <Input
                id="monto"
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))}
                placeholder="00"
                className="h-10 flex-1 text-lg"
              />
              {/* LOS BOLÍVARES SOLO SI EL NEGOCIO ES VENEZOLANO. Un negocio
                  colombiano no tiene tasa con la que convertirlos. */}
              {paisVE && libro ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2"
                  onClick={() => setEnBolivares((v) => !v)}
                >
                  <CurrencyFlagIcon
                    currency={enBolivares ? "VES" : libro}
                    className="size-4 shrink-0"
                  />
                  <span className="text-xs">
                    {enBolivares ? "Bolívares" : libro === "EUR" ? "Euros" : "Dólares"}
                  </span>
                </Button>
              ) : null}
            </div>

            {/* LA EQUIVALENCIA, Y SOLO CUANDO SE PUEDE CALCULAR. Sin tasa no
                se dibuja: inventar una conversión es peor que no darla. */}
            {bsDelTotal != null && montoNum > 0 ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                {enBolivares
                  ? `${formatPriceAmount(enElLibro, (libro ?? "COP") as PriceCurrency)} hoy`
                  : `${formatBs(bsDelTotal)} hoy`}
              </p>
            ) : null}

            {excede ? (
              <p className="text-sm leading-5 text-destructive">
                Te debe {formatPriceAmount(deuda, (libro ?? "COP") as PriceCurrency)} en esta
                moneda. Escribe esa cantidad o menos.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Te debe {formatPriceAmount(deuda, (libro ?? "COP") as PriceCurrency)} en esta
                moneda.
              </p>
            )}
          </div>

          {enElLibro > 0.005 && !excede ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-medium">Así se reparte el pago</h2>

              <ul className="flex flex-col gap-3">
                {enOrden.map((f) => {
                  const toca = asignado.get(f.movementId) ?? 0;
                  const bs = equivalencia(toca, f.currency);
                  return (
                    <li key={f.movementId} className="rounded-[10px] border">
                      {/* La tarjeta sin su propio borde: ya lo pone el `li`,
                          que es quien agrupa el fiado con lo que se le abona.
                          Dos bordes anidados se leen como dos tarjetas. */}
                      <div className="[&>*]:rounded-b-none [&>*]:border-0">
                        <TarjetaDeFiado fiado={f} rates={rates} mostrarPendiente />
                      </div>
                      <div className="flex items-start justify-between gap-3 border-t px-4 py-2">
                        <span className="text-sm text-muted-foreground">
                          {toca > 0.005 ? "Abona" : "No le toca nada"}
                        </span>
                        {toca > 0.005 ? (
                          <div className="flex flex-col items-end">
                            <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                              {f.currency ? (
                                <CurrencyFlagIcon
                                  currency={f.currency}
                                  className="size-3.5 shrink-0"
                                />
                              ) : null}
                              {formatPriceAmount(toca, (f.currency ?? "COP") as PriceCurrency)}
                            </span>
                            {bs != null ? (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {formatBs(bs)} hoy
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="text-sm leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {fiados.length > 0 ? (
        <StickyActions>
          {/* LA CASILLA DEL PERMISO VA AQUÍ, no en la pantalla del monto.
              Decisión del dueño del 2026-10-22, y la razón es que aquí es
              donde de verdad sale el mensaje: pedir permiso para mandar en una
              pantalla que no manda nada es confuso, y preguntarlo una vez por
              fiado lo es más. */}
          {clienteTieneWhatsapp ? (
            <WhatsappConsentField
              clientName={clienteNombre}
              hasWhatsapp={clienteTieneWhatsapp}
              yaTienePermiso={yaAceptaAvisos}
              checked={consent}
              onCheckedChange={setConsent}
              disabled={guardando}
            />
          ) : null}

          <Button type="button" className="h-10 w-full" disabled={!puedeGuardar} onClick={guardar}>
            {guardando
              ? "Guardando…"
              : enElLibro > 0.005 && !excede
                ? `Pagar y finalizar ${formatPriceAmount(reparto.repartido, (libro ?? "COP") as PriceCurrency)}`
                : "Pagar y finalizar"}
          </Button>
        </StickyActions>
      ) : null}
    </div>
  );
}
