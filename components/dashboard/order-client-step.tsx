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
import {
  borrarBorrador,
  fijarCliente,
  leerBorrador,
} from "@/lib/orders/borrador-de-registro";
import { registrarTodoElPedido } from "@/lib/orders/registrar-todo";
import { OrderClientSheetButton } from "@/components/dashboard/order-client-sheet-button";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
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
  // TODAS las monedas del pedido, en el orden en que la pantalla anterior las
  // dibujó, y cuáles quedan sin rellenar. Las dos salen del servidor y del
  // borrador respectivamente, y juntas contestan el rombo del sitemap.
  monedas,
  ledger,
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
  monedas: string[];
  // La tasa vigente, que la hoja de la cuenta del cliente necesita.
  ledger: LedgerDisplay | null;
}) {
  const router = useRouter();
  // ── LA SEGUNDA PASADA NO VUELVE A PREGUNTAR LO MISMO ────────────────
  //
  // Con dos monedas el tendero pasa por aquí dos veces, y la nota de la
  // flecha del sitemap dice que la segunda no debería ver esta pantalla:
  // *«el flujo pasa a ser de 4/4 pasos a 3/3 porque la pantalla de Registrar
  // cliente ya no se muestra porque registró el cliente en el primer
  // pedido»*.
  //
  // SALTARLA DEL TODO ESTÁ PENDIENTE y queda dicho en `CT-147`. Lo que SÍ
  // está mal de las dos formas es volver a pedir los datos EN BLANCO: el
  // tendero acaba de escribirlos, los ve vacíos, y la lectura natural es que
  // la app los perdió. Así que se rellenan desde el borrador, que es donde
  // los dejó.
  //
  // `useState(() => …)` Y NO UN VALOR: `sessionStorage` no existe en el
  // servidor, así que leerlo durante el render haría que la primera pintura
  // del cliente no coincidiera con el HTML del servidor y React tirara el
  // árbol -- con los campos dentro. El inicializador perezoso solo corre en
  // el navegador, en el primer render, que es cuando hace falta.
  const delBorrador = () => leerBorrador(pedidoId)?.cliente ?? null;
  const [consiente, setConsiente] = useState(() => delBorrador()?.consienteWhatsapp ?? false);
  const [nombre, setNombre] = useState(() => delBorrador()?.name || delPedido.name);
  const [documento, setDocumento] = useState(
    () => delBorrador()?.documentId || delPedido.documentId,
  );
  const [tipo, setTipo] = useState(() => delBorrador()?.documentType ?? delPedido.documentType);
  const [direccion, setDireccion] = useState(() => delBorrador()?.address || delPedido.address);
  const [whatsapp, setWhatsapp] = useState(() => delBorrador()?.whatsapp || delPedido.whatsapp);
  const [error, setError] = useState<string | null>(null);

  // THE FORM IS SHOWN WHENEVER THERE IS NO FICHA TO CONFIRM, or when the
  // shopkeeper has asked for a separate account.
  const conFormulario = ficha == null || cuentaSeparada;
  const [enviando, setEnviando] = useState(false);
  // ¿Queda algún bloque sin rellenar? Se lee del borrador, que es quien lo
  // sabe, y decide tanto el rótulo del botón como lo que hace.
  const borradorActual = leerBorrador(pedidoId);
  const quedanMonedas = monedas.some((m) => borradorActual?.monedas[m] == null);
  const nombreParaElPermiso =
    (conFormulario ? nombre : ficha!.name).trim() || "tu cliente";

  async function finalizar() {
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
    // ── Y AQUÍ SE DECIDE SI SE GUARDA O SE SIGUE RECOGIENDO ──────────
    //
    // Es el rombo del sitemap, «¿Hay más de una moneda en el pedido?», y la
    // flecha lo dice con todas las letras: *«CTA es "Registrar y finalizar"
    // porque no hay más pedidos que registrar»*. Así que el rótulo y lo que
    // hace el botón son la misma pregunta: ¿queda algún bloque sin rellenar?
    //
    // SI QUEDA, esta pantalla solo guarda el cliente y devuelve al pedido;
    // la siguiente pasada se salta este paso porque la ficha ya está en el
    // borrador -- la nota de la flecha, *«el flujo pasa a ser de 4/4 pasos a
    // 3/3»*.
    if (quedanMonedas) {
      // AL 1/4 Y NO AL DETALLE: desde que son dos pantallas (2026-10-25) los
      // bloques de moneda viven en `/registrar`. Volver al detalle dejaría al
      // tendero mirando los totales sin el botón de la moneda que le falta.
      router.push(`/productos/ordenes/${pedidoId}/registrar`);
      router.refresh();
      return;
    }

    setEnviando(true);
    const borrador = leerBorrador(pedidoId);
    if (!borrador) {
      setEnviando(false);
      setError(
        "Se perdió lo que llevabas registrado. Vuelve al pedido y empieza de nuevo.",
      );
      return;
    }
    const r = await registrarTodoElPedido(pedidoId, borrador, monedas);
    if (!r.ok) {
      setEnviando(false);
      setError(r.error);
      // LA PANTALLA SE REFRESCA AUNQUE HAYA FALLADO, si algo llegó a
      // guardarse: el pedido de detrás ya no es el mismo y dejarlo viejo es
      // cómo el tendero registra dos veces lo que ya está escrito.
      if (r.monedasHechas.length > 0) router.refresh();
      return;
    }
    // EL BORRADOR SE BORRA SOLO DESPUÉS DE QUE LA VENTA ATERRICE. Borrarlo
    // antes dejaría, ante un fallo de escritura, un pedido que sigue
    // diciendo «Registrar» y nada de lo que el tendero había tecleado.
    borrarBorrador();
    router.push(`/ventas/${r.primeraVentaId}`);
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
            : `/productos/ordenes/${pedidoId}/registrar`
        }
        label={cuentaSeparada ? "Volver" : "Volver al pedido"}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        {/* «Registrar cliente», QUE ES LO QUE ESCRIBE EL FRAME del flujo
            nuevo (`1653:12971`, `1654:15657`), con o sin ficha emparejada.
            Antes eran dos títulos distintos --«Registrar pedido» y «Datos del
            cliente»-- heredados del flujo por producto; el frame nuevo usa
            uno solo. */}
        <ScreenTitle>
          {cuentaSeparada ? "Nuevo cliente" : "Registrar cliente"}
        </ScreenTitle>
        {/* NO COUNTER ON «Nuevo cliente» — its frame (`1542:11888`) draws
            none. It is a detour off the matched screen, not a step of the
            flow, and numbering it would make the flow look longer than it is. */}
        {!cuentaSeparada ? (
          <>
            {/* «4/4», SIEMPRE, y no depende de si hay ficha: en el flujo
                nuevo esta pantalla es el cuarto paso de cuatro, y cuando el
                cliente ya está en el borrador no se muestra --la nota de la
                flecha, *«el flujo pasa a ser de 4/4 pasos a 3/3»*--. Los
                «1/1» y «2/2» de antes eran del flujo por producto. */}
            <p className="text-sm text-muted-foreground">
              4/4 Información del cliente
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

          {/* ── TAMBIÉN AQUÍ ABRE UNA HOJA ──────────────────────────────
              Reportado por el dueño el 2026-10-25: este era el ÚLTIMO «Ver
              ‹nombre›» que seguía navegando, y además rompía el camino de
              vuelta —*«al seleccionar "<" en el perfil del cliente me regresa
              al home»*—, así que el tendero perdía el registro a medias en
              el paso 4 de 4.

              NO BASTABA CON ARREGLAR LA FLECHA: volver a esta pantalla desde
              la ficha es una navegación nueva, y el borrador sobrevive pero
              el hilo no. La hoja no sale de aquí, que es lo que él pidió. */}
          <OrderClientSheetButton
            clientId={ficha.id}
            clientName={ficha.name}
            ledger={ledger}
          />
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
        {/* EL RÓTULO LO DICE LA FLECHA DEL SITEMAP, literalmente: *«CTA es
            "Registrar y finalizar" porque no hay más pedidos que
            registrar»*. Con monedas pendientes es «Registrar» a secas, que es
            lo que el frame del caso de dos monedas dibuja. */}
        <Button className="h-10 w-full" onClick={finalizar} disabled={enviando}>
          {enviando
            ? "Registrando…"
            : quedanMonedas
              ? "Registrar"
              : "Registrar y finalizar"}
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
