"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  ClientCardBody,
  CLIENT_CARD_INNER,
  clientCardShell,
} from "@/components/dashboard/client-card";
import { MovementHistoryList } from "@/components/dashboard/movement-history-list";
import { CreditScoreRadialChart } from "@/components/dashboard/credit-score-radial-chart";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { Badge } from "@/components/ui/badge";
import { cuentaDelCliente, type CuentaDelCliente } from "@/app/(app)/ventas/actions";
import { estadoDeCliente, type LibroJuzgado } from "@/lib/estado-del-plazo";
import {
  clientStatusLabel,
  CLIENT_STATUS_BADGE_CLASS,
  CREDIT_SCORE_TIER_BADGE_CLASS,
  type ClientSummary,
  type LedgerCurrency,
} from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { cn } from "@/lib/utils";

// «VER CUENTA DE …» — la hoja que se abre cuando la cédula tecleada en el paso
// 4 ya pertenece a alguien.
//
// ===========================================================================
// SIRVE PARA UNA SOLA DECISIÓN
//
// ¿Es la misma persona que ya tengo apuntada, o de verdad hace falta una
// cuenta aparte? Por eso enseña su ficha Y su historial: el nombre solo no
// basta —dos hermanos comparten apellido y a veces hasta el apodo— y lo que de
// verdad distingue es qué le fiaron y cuándo.
//
// Y por eso es una HOJA y no una navegación: irse a la ficha del cliente
// perdería la venta entera, que vive en memoria.
export function ClientAccountSheet({
  open,
  onOpenChange,
  clientId,
  clientName,
  ledger,
  onUsarEstaCuenta,
  guardando = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  ledger: LedgerDisplay | null;
  // EL ATAJO DESDE DENTRO DE LA HOJA, pedido por el dueño el 2026-10-18:
  // «al seleccionar Ver cuenta de <nombre> dentro del sheet debe haber botón
  // Registrar a cuenta existente».
  //
  // POR QUÉ AQUÍ Y NO SOLO EN LA PANTALLA DE ATRÁS: la hoja es donde el
  // tendero RESUELVE la duda —mira el historial y reconoce a la persona— y
  // obligarle a cerrarla para pulsar un botón que ya tiene delante es pedirle
  // que sostenga la conclusión mientras navega.
  //
  // `undefined` donde no hay nada que registrar: el alta de cliente ya no monta
  // esta hoja, pero si algún día la monta, sin venta en curso este botón no
  // tendría qué guardar.
  onUsarEstaCuenta?: () => void;
  guardando?: boolean;
}) {
  const [cuenta, setCuenta] = useState<CuentaDelCliente | null>(null);

  // SE PIDE AL ABRIR Y NO ANTES. Teclear una cédula que choca es un caso raro;
  // traer el historial de alguien por si acaso sería una consulta en el camino
  // caliente de todas las ventas que no chocan.
  useEffect(() => {
    let vivo = true;
    void cuentaDelCliente(clientId).then((c) => {
      if (vivo) setCuenta(c);
    });
    return () => {
      vivo = false;
    };
  }, [clientId]);

  const fila = cuenta?.fila ?? null;
  // `CT-137`, un libro a la vez, igual que las cuatro listas. Esta hoja se
  // abre en medio de una venta para contestar una sola pregunta —«¿le fío a
  // este?»—, así que el chip que enseña no puede ser más suave que el de la
  // ficha del mismo cliente.
  const { status, currency, overdueCount } = fila
    ? estadoDeCliente({
        fila,
        saldos: { cop: fila.balance, usd: fila.balance_usd, eur: fila.balance_eur },
        // Igual que antes de `CT-137`: aquí nunca hubo tasa a mano con la que
        // convertir, así que la degradación juzga por el libro colombiano.
        saldoCombinado: fila.balance,
        dosLibros: ledger !== null,
      })
    : { status: "sin_deuda" as const, currency: null, overdueCount: null };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-base font-medium">Cuenta de {clientName}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {fila ? (
            <>
              {/* LA MISMA TARJETA QUE LA LISTA DE CLIENTES, por lo mismo que en
                  el paso 4: el tendero ya sabe leerla. */}
              <div className={clientCardShell(status)}>
                <div className={cn(CLIENT_CARD_INNER, "flex items-start gap-1.5 px-4 py-2")}>
                  <ClientCardBody
                    name={fila.name}
                    documentId={fila.document_id}
                    documentType={fila.document_type}
                    status={status}
                    overdueCount={overdueCount}
                    monedaDelEstado={currency}
                    isFlagged={fila.is_flagged}
                    balance={fila.balance}
                    balanceUsd={fila.balance_usd}
                    balanceEur={fila.balance_eur}
                    ledger={ledger}
                    conFlecha={false}
                  />
                </div>
              </div>

              {/* SIN FOTOS DE COMPROBANTE, a propósito: sus URLs se firman una
                  por una contra Storage, y esto es una mirada de diez segundos
                  para decidir si es la misma persona. Quien necesite ver un
                  comprobante abre la ficha del cliente, que es donde está. */}
              {onUsarEstaCuenta ? (
                <Button
                  type="button"
                  className="h-10 w-full"
                  disabled={guardando}
                  onClick={onUsarEstaCuenta}
                >
                  {guardando ? "Guardando…" : "Registrar a cuenta existente"}
                </Button>
              ) : null}

              {/* ── POR COBRAR, UN LIBRO POR TARJETA ─────────────────
                  Encargo del dueño el 2026-10-25: *«cuando se abre el detalle
                  del cliente en todas las pantallas del flujo de registrar
                  pedido se debe mostrar en el sheet cuánto debe en total por
                  moneda y el puntaje de crédito, solo se está viendo el
                  historial»*.

                  LA TARJETA DE ARRIBA NO BASTABA, y por eso esto no es
                  duplicar: `ClientCardBody` enseña UN libro —el que manda el
                  chip— porque esa tarjeta nació para una lista donde cada
                  fila tiene una línea. Un cliente que debe en dólares Y en
                  euros salía con una sola cifra, y la otra no estaba en
                  ninguna parte de la hoja.

                  MISMA FORMA QUE LA FICHA DEL CLIENTE —rótulo, bandera,
                  cifra en absoluto y el chip de ESE libro debajo— porque es
                  la misma clienta a dos toques de distancia. */}
              <SaldosPorLibro
                fila={fila}
                ledger={ledger}
                estadosDeLibro={cuenta?.estadosDeLibro ?? {}}
              />

              {/* EL PUNTAJE, que es la otra mitad del encargo. Va DEBAJO de
                  los saldos y ENCIMA del historial: el tendero baja por la
                  hoja contestando «¿cuánto me debe?» y luego «¿me fío de
                  él?», y el historial es el detalle que sostiene las dos.

                  SIN EL DESGLOSE DE LA FICHA. Esta hoja se abre en mitad de
                  un registro para decidir en diez segundos; las cuatro líneas
                  de «cómo se calcula» son para quien va a discutirlo, y eso
                  se hace en la ficha. */}
              {cuenta?.puntaje ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Puntaje de crédito</h3>
                  <div className="flex flex-col items-center gap-2 rounded-lg border p-3">
                    <CreditScoreRadialChart
                      score={cuenta.puntaje.score}
                      tier={cuenta.puntaje.tier}
                    />
                    <Badge
                      variant="outline"
                      className={CREDIT_SCORE_TIER_BADGE_CLASS[cuenta.puntaje.tier]}
                    >
                      {cuenta.puntaje.tier}
                    </Badge>
                  </div>
                </div>
              ) : null}

              <MovementHistoryList
                movements={cuenta?.movimientos ?? []}
                ventasDeContado={cuenta?.ventasDeContado ?? []}
                pendientePorFiado={cuenta?.pendientePorFiado ?? {}}
                diasSinPagar={fila?.days_since_payment ?? 0}
                ledger={ledger}
                titulo={<span className="text-sm font-medium">Últimas transacciones</span>}
                // SIN NAVEGAR, por instrucción del dueño el 2026-10-21. Esta
                // hoja sale en mitad de una venta que vive EN MEMORIA: tocar
                // una fila se iba a `/transacciones/<id>` y tiraba el carrito,
                // el cliente a medio escribir y el pago. Aquí se mira para
                // decidir, no para irse.
                navegable={false}
              />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {cuenta ? "No pudimos leer esta cuenta." : "Cargando…"}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ===========================================================================
// «POR COBRAR», UNA TARJETA POR LIBRO
// ===========================================================================
//
// La misma forma que `app/(app)/clients/[id]` —rótulo con bandera a la
// izquierda, cifra a la derecha, chip del libro debajo— porque es la misma
// clienta vista desde otra pantalla. Es una copia pequeña y a propósito: la
// de la ficha es una función local de un componente de servidor y esta hoja
// es de navegador, así que no se puede importar. Lo que NO puede divergir es
// lo que deciden las dos —`estadoPorLibro` y `ExchangeRateBalanceDisplay`—, y
// eso sí está compartido.
//
// LA CIFRA VA EN ABSOLUTO Y EL SIGNO LO DICE EL CHIP. Regla del dueño del
// 2026-10-23: «Por cobrar −$178,00» no se lee como «te sobran 178», se lee
// como una avería.
function SaldosPorLibro({
  fila,
  ledger,
  estadosDeLibro,
}: {
  fila: ClientSummary;
  ledger: LedgerDisplay | null;
  estadosDeLibro: Record<string, LibroJuzgado>;
}) {
  // DOS LIBROS O UNO, decidido por la MISMA señal que la ficha: que haya tasa
  // es que el negocio es venezolano. Un negocio colombiano lleva un solo
  // libro y su moneda es `null`.
  const libros: { clave: string; label: string; moneda: LedgerCurrency | null; saldo: number }[] =
    ledger
      ? [
          { clave: "USD", label: "Por cobrar Dólares", moneda: "USD", saldo: fila.balance_usd ?? 0 },
          { clave: "EUR", label: "Por cobrar Euros", moneda: "EUR", saldo: fila.balance_eur ?? 0 },
        ]
      : [{ clave: "COP", label: "Por cobrar", moneda: null, saldo: fila.balance ?? 0 }];

  return (
    <div className="flex flex-col gap-2">
      {libros.map((libro) => {
        const juicio = estadosDeLibro[libro.clave];
        return (
          <div key={libro.clave} className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                {libro.moneda ? <CurrencyFlagIcon currency={libro.moneda} /> : null}
                <span className="truncate">{libro.label}</span>
              </p>
              <ExchangeRateBalanceDisplay
                balance={Math.abs(libro.saldo)}
                currency={libro.moneda}
                ledger={libro.moneda ? ledger : null}
                size="sm"
                align="end"
              />
            </div>
            {juicio ? (
              <div className="flex justify-end pt-1">
                <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[juicio.status]}>
                  {clientStatusLabel(juicio.status, juicio.vencidos, true)}
                </Badge>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
