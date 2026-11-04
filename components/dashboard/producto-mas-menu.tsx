"use client";

import { useRef, useState } from "react";
import { MoreVertical, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RegistrarDevolucionDialog, type ReturnContext } from "@/components/dashboard/registrar-devolucion-dialog";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { LedgerCurrency } from "@/lib/types";

// THE «⋮» BESIDE A PRODUCT OF A FIADO, owner's request of 2026-11-03: *«un
// botón "More" al lado de cada producto en un fiado y al seleccionarlo mostrará
// la opción "Registrar devolución"»*.
//
// OWNER'S SCREEN ONLY: `detalle-de-transaccion.tsx` draws it when it is handed
// a context, and the client's page never hands one.
//
// `modal={false}`, and the focus handed over by hand: the option opens a dialog
// of its own, and a modal menu keeps its trap alive under it (DESIGN-SYSTEM.md).
export type ReturnMenuContext = ReturnContext & {
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
};

export function ProductoMasMenu({ line, context }: { line: SaleLineRow; context: ReturnMenuContext }) {
  const [open, setOpen] = useState(false);
  const opensDialog = useRef(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-my-1 -mr-1 shrink-0"
            aria-label={`Más opciones de ${line.name}`}
          >
            <MoreVertical className="size-5 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            if (opensDialog.current) e.preventDefault();
            opensDialog.current = false;
          }}
        >
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => {
              opensDialog.current = true;
              setOpen(true);
            }}
          >
            <Undo2 className="size-5" aria-hidden="true" />
            Registrar devolución
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mounted only while open: its quantity and choices start clean every
          time, with no reset to remember. */}
      {open ? (
        <RegistrarDevolucionDialog
          open
          onOpenChange={setOpen}
          line={line}
          context={context}
          currency={context.currency}
          ledger={context.ledger}
        />
      ) : null}
    </>
  );
}
