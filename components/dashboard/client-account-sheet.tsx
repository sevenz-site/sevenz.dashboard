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
import { cuentaDelCliente, type CuentaDelCliente } from "@/app/(app)/ventas/actions";
import { getClientStatus } from "@/lib/types";
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
  const status = fila
    ? getClientStatus(
        fila.balance,
        fila.days_since_payment,
        fila.oldest_unpaid_charge_at,
        fila.oldest_unpaid_charge_plazo_dias,
        fila.oldest_unpaid_charge_due_at,
      )
    : "sin_deuda";

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
                    status={status}
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

              <MovementHistoryList
                movements={cuenta?.movimientos ?? []}
                ventasDeContado={cuenta?.ventasDeContado ?? []}
                estadosDeFiado={cuenta?.estadosDeFiado ?? {}}
                pendientePorFiado={cuenta?.pendientePorFiado ?? {}}
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
