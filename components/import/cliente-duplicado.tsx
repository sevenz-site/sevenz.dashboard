"use client";

import { UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { CandidatoDuplicado } from "@/lib/reconcile";

// "Ya tienes un Juanito en tu cartera. ¿Es el mismo?"
//
// ─────────────────────────────────────────────────────────────────────────
// LA FICHA CT-22, QUE ES UN FALLO DE DATOS Y NO UNA MEJORA DE PANTALLA
//
// Hasta ahora el importador emparejaba ÚNICAMENTE por nombre normalizado
// (`reconcile.ts`) y mandaba ese id a `confirmImport` como `client_id` sin que
// el dueño confirmara nada ni tuviera forma de decir "es otra persona".
//
// En Venezuela y Colombia "María González" se repite. El resultado era que las
// deudas de dos personas distintas se juntaban en una sola ficha, sin aviso y
// sin vuelta atrás: los movimientos quedan mezclados y no hay pantalla que los
// separe después.
//
// Lo que lo empeoraba: la comprobación de cédula duplicada de `confirmImport`
// vive en la rama de CREAR cliente nuevo, así que cuando el nombre coincidía no
// llegaba a ejecutarse — el documento, que es justo el dato que decide
// identidad, era el único que no se consultaba.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ NO HAY UNA OPCIÓN POR DEFECTO
//
// Ni "es el mismo" ni "es otra persona" pueden venir marcadas. Las dos se
// equivocan en silencio y en direcciones opuestas: una funde dos personas, la
// otra parte el historial de una. Un valor por defecto convierte la pregunta en
// un trámite que se pasa de largo, que es exactamente como llegamos aquí.
//
// Por eso esto BLOQUEA la confirmación mientras quede alguno sin decidir. Es la
// misma regla que la cédula que falta.
//
// ─────────────────────────────────────────────────────────────────────────
// LO QUE SE ENSEÑA, Y LO QUE FALTA
//
// El documento y el saldo, que son los dos datos con los que un tendero
// reconoce a alguien. El diseño pedía además "último movimiento hace N meses";
// no está porque `client_summary` no lo trae hoy y añadirlo es tocar la
// consulta de `/import`. Queda anotado, no olvidado.
export type DecisionDuplicado = "mismo" | "otra";

export function ClienteDuplicado({
  nombreEnLaLibreta,
  candidato,
  decision,
  onDecidir,
}: {
  nombreEnLaLibreta: string;
  candidato: CandidatoDuplicado;
  decision: DecisionDuplicado | undefined;
  onDecidir: (d: DecisionDuplicado) => void;
}) {
  // Un negocio VE lleva dos libros y los dos importan para reconocer a alguien;
  // uno CO lleva uno solo. Se enseña lo que tenga saldo, y si no debe nada se
  // dice, que también es un dato: "el Juanito que ya tienes está a cero".
  const saldos: string[] = [];
  if (candidato.balance_usd) saldos.push(formatDisplayCurrency(candidato.balance_usd, "USD"));
  if (candidato.balance_eur) saldos.push(formatDisplayCurrency(candidato.balance_eur, "EUR"));
  if (candidato.balance) saldos.push(formatCurrency(candidato.balance));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <UserRoundSearch className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            Ya tienes un &ldquo;{candidato.name}&rdquo; en tus clientes
          </p>
          <p className="text-sm text-muted-foreground">
            {candidato.document_id ? `Documento: ${candidato.document_id}. ` : "Sin documento registrado. "}
            {saldos.length > 0 ? `Debe ${saldos.join(" y ")}.` : "No debe nada ahora mismo."}
          </p>
          <p className="text-sm text-muted-foreground">
            En la libreta aparece como &ldquo;{nombreEnLaLibreta}&rdquo;. ¿Es la misma persona?
          </p>
        </div>
      </div>

      {/* Sin opción marcada por defecto: ver la nota de arriba. */}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={decision === "mismo" ? "default" : "outline"}
          onClick={() => onDecidir("mismo")}
        >
          Es el mismo
        </Button>
        <Button
          type="button"
          size="sm"
          variant={decision === "otra" ? "default" : "outline"}
          onClick={() => onDecidir("otra")}
        >
          Es otra persona
        </Button>
      </div>

      {decision === "otra" ? (
        <p className="text-sm text-muted-foreground">
          Se registrará como un cliente nuevo. Necesita un documento distinto al de
          &ldquo;{candidato.name}&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
