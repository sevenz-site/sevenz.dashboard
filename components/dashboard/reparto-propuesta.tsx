"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { formatDate, formatPlazoDias } from "@/lib/format";
import { formatPriceAmount } from "@/lib/products/price";
import { cn } from "@/lib/utils";

export type FiadoAbierto = {
  movementId: string;
  chargeAt: string;
  currency: string | null;
  amount: number;
  pending: number;
  plazoDias: number | null;
  cuotas: number | null;
  description: string | null;
};

// ===========================================================================
// REPARTIR UN ABONO ENTRE VARIOS FIADOS — propuesta para revisar (`CT-128`)
// ===========================================================================
//
// Las tres reglas son decisiones del dueño del 2026-10-21:
//
//   1. El reparto por defecto empieza por el fiado MÁS CRÍTICO.
//   2. El tendero puede aceptarlo o repartirlo distinto.
//   3. El abono no puede exceder lo que ese cliente debe.
//
// ===========================================================================
// EL REPARTO ES POR LIBRO, Y ESO NO ESTABA EN LA PREGUNTA
//
// La regla 3 dice «el saldo total de lo que ese cliente debe», y un cliente
// con deuda en dos monedas NO TIENE un total único: 4.000 euros y 50 dólares
// no se suman, y el primer cliente de dev con varios fiados abiertos está
// justamente así. Sumarlos para calcular un tope daría un número que no
// existe, y repartir entre libros distintos significaría que un billete de
// euros paga una deuda en dólares a una tasa que nadie acordó.
//
// Así que la pantalla elige libro primero y el tope es el de ESE libro. Es la
// misma frontera que el resto de la app ya respeta —`movements.currency` es
// un libro por moneda desde la migración `025`— y la única lectura de la
// regla 3 que da un número verdadero.
//
// ===========================================================================
// QUÉ SIGNIFICA «MÁS CRÍTICO», Y POR QUÉ NO ES «MÁS ANTIGUO»
//
// El mismo criterio que el chip del cliente desde la migración `134`: cada
// fiado contra SU propio vencimiento, el más vencido primero; entre vencidos,
// los que tienen plazo antes que los que no; y un fiado sin plazo cuenta como
// vencido el día que se tomó.
//
// EN LA VERSIÓN DEFINITIVA ESTE CÁLCULO NO VA AQUÍ. Vive en
// `get_worst_unpaid_charge`, y escribirlo dos veces es exactamente cómo el
// puntaje de crédito acabó discrepando del libro (`CT-124`). Aquí está en
// TypeScript porque es una propuesta y el servidor todavía no devuelve el
// orden; cuando se construya, la función de la base ordena y la pantalla solo
// dibuja.
function vencimientoEfectivo(f: FiadoAbierto): number {
  const tomado = new Date(f.chargeAt).getTime();
  if (f.plazoDias == null) return tomado;
  const n = Math.max(f.cuotas ?? 1, 1);
  const cubiertas =
    f.amount > 0 ? Math.min(Math.floor((f.amount - f.pending) / (f.amount / n)), n - 1) : 0;
  return tomado + ((f.plazoDias * (cubiertas + 1)) / n) * 86400000;
}

// EL RELOJ ENTRA, NO SE CONSULTA. Un solo instante decide quién está vencido
// y cuántos días lleva, y viene sellado del servidor: `Date.now()` en el
// cuerpo de un render es impuro --lo dice el linter de React 19-- y, peor, dos
// lecturas distintas pueden ordenar los fiados de una forma y rotularlos de
// otra, que es precisamente la contradicción que nadie detectaría mirando.
function porGravedad(ahora: number) {
  return (a: FiadoAbierto, b: FiadoAbierto): number => {
  const va = vencimientoEfectivo(a);
  const vb = vencimientoEfectivo(b);
  const venA = va < ahora;
  const venB = vb < ahora;
  if (venA !== venB) return venA ? -1 : 1;
  // Entre vencidos, el que TIENE plazo manda: «Plazo vencido» dice que había
  // una fecha y se pasó —algo que ir a cobrar— y «Sin plazo» que nunca se
  // puso. Decisión del dueño del 2026-10-21, la misma de la `134`.
  if (venA && (a.plazoDias == null) !== (b.plazoDias == null)) return a.plazoDias == null ? 1 : -1;
  return va - vb;
  };
}

const libroDe = (c: string | null) => c ?? "COP";

// EL IMPORTE SE ESCRIBE EN SU PROPIA MONEDA, y hace falta decirlo porque
// `formatCurrency` de `lib/format` está fijado a pesos: en la primera versión
// de esta pantalla los 4.000 euros de Juan negocio salieron como «$ 4.000,00».
// `formatPriceAmount` es el que el resto de la app ya usa para esto.
const dinero = (n: number, libro: string) =>
  formatPriceAmount(n, (libro === "COP" ? "COP" : libro) as Parameters<typeof formatPriceAmount>[1]);

export function RepartoPropuesta({
  clientName,
  fiados,
  ahora,
}: {
  clientName: string;
  fiados: FiadoAbierto[];
  ahora: number;
}) {
  const libros = useMemo(
    () => [...new Set(fiados.map((f) => libroDe(f.currency)))].sort(),
    [fiados],
  );
  const [libro, setLibro] = useState(libros[0] ?? "USD");
  const [monto, setMonto] = useState("");
  // LO QUE EL TENDERO HA TOCADO A MANO. Lo que no está aquí lo decide el
  // reparto automático, así que ajustar una línea no congela las demás: el
  // resto se recalcula con lo que queda. Es lo que hace que «cambiar una
  // cifra» no obligue a teclear todas.
  const [aMano, setAMano] = useState<Record<string, number>>({});
  // LO QUE GUARDARÍA, EN LA PROPIA PANTALLA Y NO EN UN `alert`. Un diálogo del
  // sistema sale con el tipo de letra del teléfono, no se puede releer al lado
  // del reparto que lo produjo, y en la revisión del 2026-10-21 ni siquiera se
  // pudo comprobar desde fuera. Una caja debajo del reparto se lee junto a los
  // números que la generaron, que es justo lo que hay que revisar aquí.
  //
  // SE GUARDA CON LA HUELLA DEL REPARTO QUE LA PRODUJO, y abajo solo se dibuja
  // si esa huella sigue siendo la de ahora. Un `useEffect` que la borrara al
  // cambiar el monto sería un `setState` dentro de un efecto --lo que el
  // linter de React 19 rechaza, y con razón: encadena renders--. Comparando,
  // no hay nada que borrar ni nada que se pueda olvidar borrar: una caja de un
  // reparto viejo deja de existir sola.
  const [loQueGuardaria, setLoQueGuardaria] = useState<{
    huella: string;
    lineas: string[];
  } | null>(null);

  const delLibro = useMemo(
    () => fiados.filter((f) => libroDe(f.currency) === libro).sort(porGravedad(ahora)),
    [fiados, libro, ahora],
  );
  const deudaDelLibro = delLibro.reduce((s, f) => s + f.pending, 0);

  const montoNum = Number(monto.replace(",", ".")) || 0;
  // REGLA 3: el tope es la deuda de ESTE libro. Ver la cabecera.
  const excede = montoNum > deudaDelLibro + 0.004;

  const reparto = useMemo(() => {
    const r: Record<string, number> = {};
    let queda = Math.min(montoNum, deudaDelLibro);
    // Primero lo que el tendero fijó: su decisión manda sobre el automático.
    for (const f of delLibro) {
      const puesto = aMano[f.movementId];
      if (puesto == null) continue;
      const v = Math.max(0, Math.min(puesto, f.pending));
      r[f.movementId] = v;
      queda -= v;
    }
    // Y el resto baja por gravedad hasta agotarse.
    for (const f of delLibro) {
      if (r[f.movementId] != null) continue;
      if (queda <= 0.004) {
        r[f.movementId] = 0;
        continue;
      }
      const v = Math.min(f.pending, queda);
      r[f.movementId] = Math.round(v * 100) / 100;
      queda -= v;
    }
    return r;
  }, [delLibro, montoNum, deudaDelLibro, aMano]);

  // LA HUELLA ES EL REPARTO MISMO, no el monto: ajustar una línea a mano deja
  // el monto igual y cambia a dónde va el dinero, que es justo lo que la caja
  // enumera.
  const huella = `${libro}|${JSON.stringify(reparto)}`;

  const repartido = Object.values(reparto).reduce((s, v) => s + v, 0);
  const sinAsignar = Math.round((Math.min(montoNum, deudaDelLibro) - repartido) * 100) / 100;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <ScreenBackRow href="/dashboard" soloEnTelefono={false} />

      <div className="flex flex-col gap-1 py-2">
        <ScreenTitle>Repartir abono</ScreenTitle>
        <p className="text-sm text-muted-foreground">
          {clientName} · {delLibro.length} {delLibro.length === 1 ? "fiado" : "fiados"} en{" "}
          {libro === "COP" ? "pesos" : libro === "EUR" ? "euros" : "dólares"}
        </p>
      </div>

      {/* PROPUESTA: esta cinta no va en la versión definitiva. Está para que
          nadie confunda esta pantalla con el flujo real mientras se revisa. */}
      <p className="rounded-lg border border-dashed bg-muted/40 p-2.5 text-xs leading-4 text-muted-foreground">
        <span className="font-medium text-foreground">Propuesta para revisar.</span> Los fiados son
        reales; el botón de abajo no guarda nada todavía.
      </p>

      <div className="flex flex-col gap-4 py-4">
        {/* EL LIBRO PRIMERO, y solo cuando hay más de uno. Con un solo libro
            un selector de una opción es una pregunta sin respuesta posible. */}
        {libros.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label>¿En qué moneda te pagó?</Label>
            <div className="flex gap-2">
              {libros.map((l) => (
                <Button
                  key={l}
                  type="button"
                  variant={l === libro ? "default" : "outline"}
                  className="h-10 flex-1"
                  onClick={() => {
                    setLibro(l);
                    setAMano({});
                  }}
                >
                  {l === "COP" ? "Pesos" : l === "EUR" ? "Euros" : "Dólares"}
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
          <Label htmlFor="monto">¿Cuánto te pagó?</Label>
          <Input
            id="monto"
            inputMode="decimal"
            placeholder="00"
            value={monto}
            onChange={(e) => {
              setMonto(e.target.value.replace(/[^0-9.,]/g, ""));
              setAMano({});
            }}
            className="h-12 text-lg"
            aria-invalid={excede}
          />
          <p className={cn("text-xs leading-4", excede ? "text-destructive" : "text-muted-foreground")}>
            {excede
              ? `No puede ser más de ${dinero(deudaDelLibro, libro)}, que es todo lo que te debe en esta moneda.`
              : `Te debe ${dinero(deudaDelLibro, libro)} en esta moneda.`}
          </p>
        </div>

        {montoNum > 0 && !excede ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label>Se reparte así</Label>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground underline underline-offset-2"
                onClick={() => setAMano({})}
              >
                Volver al reparto sugerido
              </button>
            </div>

            {delLibro.map((f) => {
              const asignado = reparto[f.movementId] ?? 0;
              const vence = vencimientoEfectivo(f);
              const diasTarde = Math.floor((ahora - vence) / 86400000);
              const vencido = diasTarde > 0;
              return (
                <div
                  key={f.movementId}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3",
                    asignado > 0 ? "bg-accent" : "bg-background",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium">
                        {f.description?.trim() || "Fiado"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(f.chargeAt)} · {formatPlazoDias(f.plazoDias)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "w-fit",
                          vencido
                            ? f.plazoDias == null
                              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400"
                              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400"
                            : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400",
                        )}
                      >
                        {f.plazoDias == null
                          ? "Sin plazo"
                          : vencido
                            ? `Plazo vencido · ${diasTarde} ${diasTarde === 1 ? "día" : "días"}`
                            : "Dentro del plazo"}
                      </Badge>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      debe {dinero(f.pending, libro)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      value={String(asignado === 0 ? "" : asignado)}
                      placeholder="0"
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."));
                        setAMano((p) => ({ ...p, [f.movementId]: Number.isFinite(v) ? v : 0 }));
                      }}
                      className="h-10"
                      aria-label={`Cuánto va a este fiado`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0"
                      onClick={() =>
                        setAMano((p) => ({ ...p, [f.movementId]: f.pending }))
                      }
                    >
                      Todo
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* LO QUE SOBRA SE DICE, NO SE ESCONDE. Si el tendero ajusta a
                mano y deja dinero sin asignar, el botón no puede guardar un
                abono que no cuadra con lo que el cliente entregó. */}
            {Math.abs(sinAsignar) > 0.004 ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-4 text-destructive">
                {sinAsignar > 0
                  ? `Te quedan ${dinero(sinAsignar, libro)} sin asignar.`
                  : `Has repartido ${dinero(-sinAsignar, libro)} de más.`}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ESTO ES LO ÚNICO QUE OCURRE AL PULSAR, y se dice con esas palabras:
            la pantalla es una propuesta y guardar de verdad es el trabajo que
            viene después, con su migración para agrupar los pagos. Sin la
            frase, una caja que enumera abonos se lee como un recibo. */}
        {loQueGuardaria && loQueGuardaria.huella === huella ? (
          <div className="rounded-lg border bg-accent p-3 text-xs leading-5">
            <p className="font-medium text-foreground">
              No se ha guardado nada. Esto es lo que guardaría:
            </p>
            <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
              {loQueGuardaria.lineas.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-muted-foreground">
              {loQueGuardaria.lineas.length === 1
                ? "Un abono."
                : `${loQueGuardaria.lineas.length} abonos, agrupados como un solo pago.`}
            </p>
          </div>
        ) : null}
      </div>

      <StickyActions>
        <Button
          type="button"
          className="h-10 w-full"
          disabled={montoNum <= 0 || excede || Math.abs(sinAsignar) > 0.004}
          onClick={() => {
            setLoQueGuardaria({
              huella,
              lineas: delLibro
                .filter((f) => (reparto[f.movementId] ?? 0) > 0)
                .map(
                  (f) =>
                    `${dinero(reparto[f.movementId], libro)} → ${f.description?.trim() || "Fiado"} (${formatDate(f.chargeAt)})`,
                ),
            });
          }}
        >
          {/* SIN CIFRA CUANDO LA CIFRA ES LA QUE SOBRA. Un botón apagado que
              dice «Registrar abono de $500,00» repite el número que la pantalla
              acaba de rechazar dos líneas más arriba, y deja al tendero leyendo
              dos mensajes que se contradicen. */}
          {excede || montoNum <= 0
            ? "Registrar abono"
            : `Registrar abono de ${dinero(montoNum, libro)}`}
        </Button>
      </StickyActions>
    </div>
  );
}
