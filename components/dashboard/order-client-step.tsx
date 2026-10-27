"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandHelping, UserRoundSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { OrderStepCounter } from "@/components/dashboard/order-step-counter";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import {
  borrarBorrador,
  fijarCliente,
  leerBorrador,
} from "@/lib/orders/borrador-de-registro";
import { registrarTodoElPedido } from "@/lib/orders/registrar-todo";
import { OrderClientSheetButton } from "@/components/dashboard/order-client-sheet-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  quedaFiado,
  type LineaDelPedido,
} from "@/components/dashboard/order-registration-summary";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDocumentId } from "@/lib/format";
import { MALA_PAGA_BADGE_CLASS, type OwnerCountry } from "@/lib/types";
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
  sinPasoDePedido,
  monedaDeOrigen,
  ledger,
  // TODAS las líneas del pedido con precio, para saber si este registro deja
  // algo debiendo. Es lo único que decide si sale el aviso de «mala paga»:
  // ver `quedaFiado`. Las descatalogadas las filtra la página, porque no se
  // cobran.
  lineas,
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
  // `true` cuando el pedido tiene una sola moneda y el paso «1/4 Pedido» no
  // existe en este flujo: entonces esta pantalla es el `3/3`.
  sinPasoDePedido: boolean;
  // La moneda cuyo pago acaba de confirmarse, para que la flecha vuelva ahí.
  monedaDeOrigen: string | null;
  // La tasa vigente, que la hoja de la cuenta del cliente necesita.
  ledger: LedgerDisplay | null;
  lineas: LineaDelPedido[];
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
  // ── ¿ES UN PASO DEL FLUJO O UNA CORRECCIÓN? ────────────────────────
  //
  // Con el cliente YA en el borrador, a esta pantalla solo se llega por el
  // lápiz de la tarjeta del 1/3 --encargo del dueño el 2026-10-26-- y eso no
  // es el paso 4 de nada: es un desvío para corregir un dato, igual que
  // «Registrar a cuenta separada», que tampoco lleva contador (su frame
  // `1542:11888` no lo dibuja).
  //
  // DECIDIDO UNA VEZ AL ENTRAR, con el mismo inicializador perezoso que los
  // campos: un instante después de guardar, el borrador tendrá cliente
  // SIEMPRE, así que leerlo en cada render convertiría el 4/4 en un desvío a
  // mitad de la primera pasada.
  const [esCorreccion] = useState(() => delBorrador() != null);
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

  // ── ¿HAY QUE AVISAR DE QUE ESTE CLIENTE ES MALA PAGA? ─────────────
  //
  // TRES CONDICIONES Y LAS TRES HACEN FALTA:
  //
  //   · HAY FICHA EMPAREJADA Y SE VA A USAR. Un cliente nuevo no tiene marca,
  //     y «Registrar a cuenta separada» abre otra ficha a propósito --el
  //     tendero acaba de decir «este no es ese Pedro»--, así que la deuda no
  //     va a la persona marcada y avisar sería hablar de otra.
  //   · ESTÁ MARCADA. `is_flagged`, que `findOrderClient` no leía hasta hoy.
  //   · Y QUEDA ALGO DEBIENDO. Es la condición del diálogo original
  //     (`isFlagged && type === "charge"`): una venta pagada entera no presta
  //     nada. Ver `quedaFiado`.
  //
  // UN PEDIDO DE VARIAS MONEDAS AVISA UNA SOLA VEZ, al final: con monedas
  // pendientes esta pantalla no escribe nada --solo guarda el cliente-- así
  // que el aviso sale donde de verdad se decide.
  const fichaMarcada = ficha != null && !cuentaSeparada && ficha.is_flagged;
  const debeAvisar = fichaMarcada && quedaFiado(lineas, borradorActual);
  const [avisando, setAvisando] = useState(false);
  const nombreParaElPermiso =
    (conFormulario ? nombre : ficha!.name).trim() || "tu cliente";

  // `yaConfirmado` -- viene del diálogo de «mala paga». Sin él, confirmar
  // volvería a abrir el mismo diálogo para siempre.
  async function finalizar(yaConfirmado = false) {
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

    // ── EL AVISO VA AQUÍ Y NO EN EL `onClick` ───────────────────────
    //
    // Después de validar y DESPUÉS de la rama de arriba, que no escribe nada.
    // Puesto en el botón saldría también cuando esta pantalla solo guarda el
    // cliente para seguir con la siguiente moneda, y entonces el tendero
    // confirmaría un fiado dos veces para una sola venta.
    //
    // `fijarCliente` YA CORRIÓ y da igual: es un borrador en el navegador, no
    // una fila. Si el tendero cancela, lo guardado es lo que ya había puesto.
    if (debeAvisar && !yaConfirmado) {
      setAvisando(true);
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
    borrarBorrador(pedidoId);
    router.push(`/ventas/${r.primeraVentaId}`);
  }

  return (
    // `flex-1` NO SOBRA: `StickyActions` baja con `mt-auto`, y `mt-auto` solo
    // empuja si el contenedor tiene alto que repartir. Sin esto la barra se
    // queda pegada al contenido, con media pantalla vacía debajo — el fallo
    // que el dueño reportó el 2026-10-25 en el paso 2/4.
    <div className="flex flex-1 flex-col gap-4">
      {/* ── ATRÁS ES EL PASO ANTERIOR, QUE ES EL PAGO ─────────────────
          «Registrar a cuenta separada» vuelve a la pantalla emparejada, no
          fuera del flujo: es un paso que el tendero dio, y retroceder
          significa deshacer esa elección, no perder el registro entero.

          DESDE EL RESTO VUELVE AL `Pago` DE SU MONEDA, que es de donde se
          llega. Apuntaba al `1/4`, y con una sola moneda esa pantalla ya no
          existe --redirige aquí al lado--, así que la flecha habría saltado
          el paso del pago o, peor, rebotado. Un contador «3/3» promete que
          atrás está el `2/3`.

          EL `null` es un enlace viejo sin `?moneda=`: entonces se vuelve a
          donde empieza el flujo, que con una moneda es el detalle. */}
      <ScreenBackRow
        href={
          cuentaSeparada
            ? `/productos/ordenes/${pedidoId}/registrar/cliente${monedaDeOrigen ? `?moneda=${monedaDeOrigen}` : ""}`
            : monedaDeOrigen
              ? `/productos/ordenes/${pedidoId}/registrar/pago?moneda=${monedaDeOrigen}`
              : sinPasoDePedido
                ? `/productos/ordenes/${pedidoId}`
                : `/productos/ordenes/${pedidoId}/registrar`
        }
        label="Volver"
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
        {/* EL CONTADOR LO PINTA `OrderStepCounter` DESDE EL 2026-10-25, y
            no un «4/4» escrito a mano como hasta entonces. Dejó de ser cierto
            ese día: con una sola moneda el flujo no tiene paso «Pedido» y
            esta pantalla es el `3/3`. Un número fijo sobre una pantalla cuyo
            número cambia es exactamente la clase de cifra creíble y falsa que
            `CLAUDE.md` persigue — y aquí además contradecía al contador de la
            pantalla anterior. */}
        {!cuentaSeparada && !esCorreccion ? (
          <OrderStepCounter
            pedidoId={pedidoId}
            paso="cliente"
            sinPasoDePedido={sinPasoDePedido}
          />
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
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* ── EL CHIP «MALA PAGA», DENTRO DEL RECUADRO VERDE ──────
                  Encargo del dueño el 2026-10-26, al leer el informe del
                  diálogo que había pedido esa mañana: la tarjeta «sigue
                  diciendo solo "ya existe"».

                  Y ESA ERA LA MITAD QUE FALTABA, no un adorno. El diálogo
                  avisa en el ÚLTIMO toque, cuando el tendero ya decidió; esto
                  avisa mientras lo está decidiendo. Sin el chip, la única
                  pantalla que habla de esa persona antes de fiarle la
                  presenta en VERDE con un «ya existe» --que es un aval--, y
                  el aviso llega cuando ya ha dicho que sí.

                  ARRIBA Y A LA DERECHA, no pegado a la frase: a 375px el
                  rótulo ocupa dos líneas, y un chip dentro del texto se iría
                  al final de la segunda, que es donde no se mira. */}
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">
                  El cliente ya existe en tu cuenta de Sevenz.
                </p>
                {fichaMarcada ? (
                  <Badge
                    variant="outline"
                    className={`${MALA_PAGA_BADGE_CLASS} shrink-0`}
                  >
                    Mala paga
                  </Badge>
                ) : null}
              </div>
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

      {/* ── PEGADO ABAJO, A 40px DEL FILO ─────────────────────────────
          Encargo del dueño el 2026-10-26: *«Botón "Registrar" debe estar
          pegado abajo a 40px del fondo de la pantalla»*. Es `StickyActions`,
          el mismo componente que el paso 2/4, y NO sus clases copiadas: la
          regla de `CLAUDE.md` nació justamente de una pantalla que las copió
          a mano y se quedó sin lo único que el original añade --esconderse
          con el teclado arriba, que en una pantalla de SEIS campos como esta
          es la mitad del asunto--.

          Los 40px los pone la barra; `app-main.tsx` deja de sumar los suyos
          en esta ruta, o serían 80. */}
      <StickyActions>
        {/* EL RÓTULO, TRES CASOS Y NO DOS desde el 2026-10-26:

            · CORRIGIENDO (se llegó por el lápiz de la tarjeta del cliente):
              «Guardar». Suyo, preguntado: *«Sí, cámbialo a "Guardar"»*.
              «Registrar» ahí prometía apuntar algo nuevo cuando lo único que
              se hace es cambiar una letra de lo ya tecleado.
            · CON MONEDAS PENDIENTES: «Registrar» a secas, como dibuja el
              frame del caso de dos monedas.
            · SIN NINGUNA PENDIENTE: «Registrar y finalizar», que es lo que
              la flecha del sitemap escribe con todas las letras --*«CTA es
              "Registrar y finalizar" porque no hay más pedidos que
              registrar»*--. */}
        {/* ROJO CUANDO VA A FIARLE A UNA MALA PAGA, como el diálogo
            original ponía su propio «Guardar fiado»: el color es la mitad del
            aviso que llega ANTES de tocar. */}
        <Button
          className="h-10 w-full"
          variant={debeAvisar ? "destructive" : undefined}
          onClick={() => finalizar()}
          disabled={enviando}
        >
          {enviando
            ? esCorreccion
              ? "Guardando…"
              : "Registrando…"
            : esCorreccion
              ? "Guardar"
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
              // ARRASTRA LA MONEDA. Sin ella, volver desde la cuenta
              // separada pierde de dónde venía el tendero y la flecha
              // retrocede más de un paso.
              href={`/productos/ordenes/${pedidoId}/registrar/cliente?nuevo=1${monedaDeOrigen ? `&moneda=${monedaDeOrigen}` : ""}`}
            >
              Registrar a cuenta separada
            </Link>
          </Button>
        ) : null}
      </StickyActions>

      {/* ═══════════════════════════════════════════════════════════════
          «ESTÁ MARCADO COMO MALA PAGA. ¿FIARLE DE TODAS FORMAS?»
          ═══════════════════════════════════════════════════════════════

          Encargo del dueño el 2026-10-26: *«debería mostrar modal de
          confirmación como el flujo anterior que menciona que esa persona está
          marcada como mala paga y preguntarle si desea fiarle de todas maneras
          o no»*.

          ES EL DIÁLOGO QUE EXISTÍA, palabra por palabra. Vivía en
          `add-movement-dialog.tsx` y se fue con él el 2026-10-24, cuando el
          dueño mandó borrar ese flujo --*«ese flujo ya no debe existir»*--.
          Nadie se dio cuenta de que con el formulario se iba también el único
          aviso de mala paga que la app ha tenido: desde ese día, NINGUNA
          pantalla de Sevenz lo menciona antes de fiar. Así que esto no es
          copiar un patrón de otro sitio; es devolver uno que se perdió.

          «Revisa el motivo en su historial» NO ES RELLENO: marcar a alguien
          exige escribir un motivo, y ese motivo está en su ficha. El diálogo
          manda ahí porque la decisión --fiarle o no-- se toma con el motivo
          delante, no con la etiqueta.

          AQUÍ NO HAY UN ENLACE A ESA FICHA a propósito: salir de esta pantalla
          en el último paso pierde el hilo del registro, que es justo lo que el
          dueño reportó el 2026-10-25 con «Ver ‹nombre›». Para mirarlo sin
          salir está la hoja de arriba, en la tarjeta del cliente. */}
      <AlertDialog open={avisando} onOpenChange={setAvisando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {ficha?.name} está marcado como Mala paga
            </AlertDialogTitle>
            <AlertDialogDescription>
              Revisa el motivo en su historial. ¿Fiarle de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={enviando}
              onClick={(e) => {
                // El diálogo no se cierra solo: Radix lo cerraría al tocar la
                // acción y el «Registrando…» del botón de detrás no se vería.
                e.preventDefault();
                setAvisando(false);
                void finalizar(true);
              }}
            >
              Fiar de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
