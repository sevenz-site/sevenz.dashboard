"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandHelping, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { fijarCliente } from "@/lib/orders/borrador-de-registro";
import { formatDocumentId } from "@/lib/format";
import type { OwnerCountry } from "@/lib/types";
import type { OrderClient } from "@/lib/orders/order-client-match";

// THE LAST STEP BEFORE THE SUMMARY: who this sale belongs to.
//
// ===========================================================================
// THREE FRAMES, ONE SCREEN, AND THE DIFFERENCE IS WHO THE CUSTOMER IS
//
// `1516:10496` — a ficha matched. «2/2 Información del cliente»: the ficha is
//   shown as read-only, with the green «El cliente ya existe» and a way out
//   («Registrar a cuenta separada») for when it is a different Pedro.
// `1542:11888` — that way out. «Nuevo cliente», the same form as below, with
//   no step counter, reached from the button above.
// `1564:11876` — no ficha matched. «Datos del cliente», «1/1 Datos del
//   cliente», the form prefilled from what the customer typed in the cart,
//   with the amber «No hemos encontrado este cliente».
//
// ===========================================================================
// IT STILL WRITES NOTHING
//
// Not even the new client. Creating a ficha here would leave an orphan person
// in the shopkeeper's list every time somebody backs out of the flow —
// somebody who never bought anything. The whole registration is written once,
// at the end, out of the draft.
export function OrderClientStep({
  pedidoId,
  // The matched ficha, when there was exactly one. `null` covers both «none»
  // and «several»: with several, nothing in the order tells them apart, so
  // the honest screen is the one that asks.
  ficha,
  // What the customer typed in the cart. It is what prefills the form, and it
  // is the only thing known about them when no ficha matched.
  delPedido,
  country,
  // `true` when the shopkeeper chose «Registrar a cuenta separada» on a
  // matched order: same form as the unmatched case, different title, and no
  // step counter — frame `1542:11888`.
  cuentaSeparada,
}: {
  pedidoId: string;
  ficha: OrderClient | null;
  delPedido: {
    name: string;
    documentId: string;
    documentType: string | null;
    whatsapp: string;
    address: string;
  };
  country: OwnerCountry | null;
  cuentaSeparada: boolean;
}) {
  const router = useRouter();
  const [consiente, setConsiente] = useState(false);
  const [nombre, setNombre] = useState(delPedido.name);
  const [documento, setDocumento] = useState(delPedido.documentId);
  const [tipo, setTipo] = useState(delPedido.documentType);
  const [direccion, setDireccion] = useState(delPedido.address);
  const [whatsapp, setWhatsapp] = useState(delPedido.whatsapp);
  const [error, setError] = useState<string | null>(null);

  // THE FORM IS SHOWN WHENEVER THERE IS NO FICHA TO CONFIRM, or when the
  // shopkeeper has asked for a separate account.
  const conFormulario = ficha == null || cuentaSeparada;
  const nombreParaElPermiso =
    (conFormulario ? nombre : ficha!.name).trim() || "tu cliente";

  function finalizar() {
    if (conFormulario) {
      if (nombre.trim() === "") {
        setError("Escribe el nombre del cliente.");
        return;
      }
      if (documento.replace(/\D/g, "") === "") {
        setError("Escribe el documento del cliente.");
        return;
      }
    }
    setError(null);
    fijarCliente(pedidoId, {
      // A SEPARATE ACCOUNT MEANS A NEW FICHA even though one matched: the
      // shopkeeper said this is not that person.
      fichaId: conFormulario ? null : ficha!.id,
      name: conFormulario ? nombre.trim() : ficha!.name,
      documentId: conFormulario ? documento : (ficha!.document_id ?? ""),
      documentType: conFormulario ? tipo : (ficha!.document_type ?? null),
      whatsapp: conFormulario ? whatsapp : (ficha!.whatsapp ?? ""),
      address: conFormulario ? direccion.trim() : (ficha!.address ?? ""),
      consienteWhatsapp: consiente,
    });
    router.push(`/productos/ordenes/${pedidoId}/registrar/resumen`);
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        // «Registrar a cuenta separada» goes back to the matched screen, not
        // out of the flow: it is a step the shopkeeper took and backing out of
        // it means undoing that choice, not losing the whole registration.
        href={
          cuentaSeparada
            ? `/productos/ordenes/${pedidoId}/registrar/cliente`
            : `/productos/ordenes/${pedidoId}`
        }
        label={cuentaSeparada ? "Volver" : "Volver al pedido"}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>
          {cuentaSeparada
            ? "Nuevo cliente"
            : ficha
              ? "Registrar pedido"
              : "Datos del cliente"}
        </ScreenTitle>
        {/* NO COUNTER ON «Nuevo cliente» — its frame (`1542:11888`) draws
            none. It is a detour off the matched screen, not a step of the
            flow, and numbering it would make the flow look longer than it is. */}
        {!cuentaSeparada ? (
          <>
            <p className="text-sm text-muted-foreground">
              {ficha ? "2/2 Información del cliente" : "1/1 Datos del cliente"}
            </p>
            <div
              aria-hidden="true"
              className="h-1 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full w-full rounded-full bg-foreground transition-all" />
            </div>
          </>
        ) : null}
      </div>

      {/* ── THE MATCHED FICHA, READ-ONLY ──────────────────────────────── */}
      {ficha && !cuentaSeparada ? (
        <div className="flex flex-col gap-3 rounded-[10px] border p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground">
              {iniciales(ficha.name)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-base font-semibold">{ficha.name}</p>
              <p className="text-sm text-muted-foreground">
                Documento:{" "}
                {formatDocumentId(
                  ficha.document_id ?? "",
                  ficha.document_type,
                ) || "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Teléfono: {ficha.whatsapp || "—"}
              </p>
              <p className="text-sm text-muted-foreground">
                Dirección: {ficha.address || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-money-in/30 bg-money-in/10 p-2.5 text-xs text-money-in">
            <HandHelping className="mt-px size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-semibold">
                El cliente ya existe en tu cuenta de Sevenz.
              </p>
              <p>
                {ficha.name} con documento{" "}
                {formatDocumentId(
                  ficha.document_id ?? "",
                  ficha.document_type,
                ) || "—"}
              </p>
            </div>
          </div>

          <Button variant="outline" className="h-10 w-full" asChild>
            <Link href={`/clients/${ficha.id}`}>Ver {ficha.name}</Link>
          </Button>
        </div>
      ) : null}

      {/* ── THE FORM, PREFILLED FROM THE ORDER ────────────────────────── */}
      {conFormulario ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pedido-cliente-nombre">Nombre del cliente</Label>
            <Input
              id="pedido-cliente-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Pedro Pérez"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pedido-cliente-documento">Documento</Label>
            <DocumentIdInput
              id="pedido-cliente-documento"
              country={country}
              value={documento}
              onChange={setDocumento}
              type={tipo as never}
              onTypeChange={(t) => setTipo(t)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pedido-cliente-whatsapp">WhatsApp (opcional)</Label>
            <WhatsappInput
              id="pedido-cliente-whatsapp"
              name="pedido-cliente-whatsapp"
              defaultValue={delPedido.whatsapp}
              onValueChange={setWhatsapp}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pedido-cliente-direccion">
              Dirección (opcional)
            </Label>
            <Input
              id="pedido-cliente-direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Escribe dirección"
            />
          </div>
        </div>
      ) : null}

      {/* THE AMBER ALERT, only when nothing matched — frame `1564:11876`. It
          is the same wording the order's own card uses, on purpose: the
          shopkeeper should not have to work out whether it means the same
          thing. */}
      {ficha == null && !cuentaSeparada ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <UserRoundSearch className="mt-px size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">
              No hemos encontrado este cliente en tu cuenta de Sevenz.
            </p>
            <p>
              {delPedido.name} con documento{" "}
              {formatDocumentId(delPedido.documentId, delPedido.documentType) ||
                "—"}
            </p>
          </div>
        </div>
      ) : null}

      {/* THE CONSENT, AND IT IS EVIDENCE, NOT A PREFERENCE. What the frame
          writes is a sentence the shopkeeper is confirming on their customer's
          behalf, so the name goes inside it — «Confirmo que Pedro Pérez
          autoriza recibirlas» is a statement; «Confirmo que el cliente
          autoriza» is a checkbox nobody reads.

          See `MS-4` in the plan for why this matters: Meta requires opt-in
          that can be demonstrated, and a box with no name in it demonstrates
          nothing. */}
      <label className="flex items-start gap-2 rounded-[10px] border p-2.5 text-xs">
        <Checkbox
          checked={consiente}
          onCheckedChange={(v) => setConsiente(v === true)}
          className="mt-px"
        />
        <span>
          Enviar notificaciones de abono y cobro vía WhatsApp. Confirmo que{" "}
          {nombreParaElPermiso} autoriza recibirlas.
        </span>
      </label>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-4 pb-10">
        <Button className="h-10 w-full" onClick={finalizar}>
          Registrar y finalizar
        </Button>
        {/* «REGISTRAR A CUENTA SEPARADA», only on the matched screen. The
            shopkeeper is saying «this is not that Pedro», which the document
            match cannot rule out on its own — two people can share the digits
            of a document with different letters. */}
        {ficha && !cuentaSeparada ? (
          <Button variant="outline" className="h-10 w-full" asChild>
            <Link
              href={`/productos/ordenes/${pedidoId}/registrar/cliente?nuevo=1`}
            >
              Registrar a cuenta separada
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Letters only: «Jos (desde el catálogo)» used to come out as «J(».
function iniciales(nombre: string): string {
  const partes = nombre
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  return (partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "");
}
