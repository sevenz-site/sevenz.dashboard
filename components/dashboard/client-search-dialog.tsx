"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
// ── UNA HOJA Y NO UN DIÁLOGO ─────────────────────────────────────────────
//
// Encargo del dueño el 2026-10-22: *«El popup para buscar cliente debe ser un
// sheet»*, con el frame `1535:10874` al lado.
//
// NO ES SOLO LA ANIMACIÓN. Un diálogo se centra en la pantalla, así que al
// subir el teclado el navegador tiene que decidir dónde ponerlo y acaba
// empujando el título fuera por arriba. Una hoja nace pegada abajo: el teclado
// la recorta por el sitio por el que ya crecía, que es el mismo motivo por el
// que el resto de este flujo ya usa hojas.
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  useGuardiaAlAbrir,
  useGuardiaDeCuentaPausada,
} from "@/components/dashboard/cuenta-pausada";
import {
  ClientResultList,
  CLIENT_RESULT_LIMIT,
} from "@/components/dashboard/client-result-list";

type ClientOption = {
  id: string;
  name: string;
  document_id: string | null;
  // Su letra, para que el resultado diga «V-32.256.369» como el resto.
  document_type: string | null;
};

// ═══════════════════════════════════════════════════════════════════════
// EL BUSCADOR DE CLIENTE DEL ABONO, Y YA NO MÁS QUE ESO
//
// Hasta el 2026-10-24 este archivo tenía DOS pasos: este buscador y un
// formulario de alta —cliente nuevo + su primer movimiento— que escribía con
// `createClientWithMovement`. Ese segundo paso era la mitad del diálogo viejo
// que el dueño mandó borrar ese día; el alta vive en `/clients/nuevo` desde el
// 2026-10-18 y la hoja de «Registrar» lleva allí.
//
// LO QUE SE QUEDA, Y POR QUÉ ESTE ARCHIVO NO SE REESCRIBIÓ DE CERO: la
// carcasa de abrir y cerrar que viene abajo tiene tres fallos reales
// resueltos dentro —el marcador que no se limpiaba, el `replace` que
// cancelaba el `push`, y el campo de teléfono que sobrevivía a un cierre— y
// cada uno está explicado donde ocurre. Reescribirla «limpia» es volver a
// pisarlos.
//
// CÓMO SE ABRE: nadie la dispara con un botón. La abre `?nuevo=abono`, el
// marcador que pone la opción «Abono» de la hoja de «Registrar».
export function ClientSearchDialog({
  clients,
  autoOpen,
}: {
  clients: ClientOption[];
  // True cuando la navegación trae el marcador pidiendo esta hoja.
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Bumped every time the dialog fully closes, and used as the body's `key`
  // below. Remounting is what actually guarantees a clean form next open —
  // this component's own state (nameValue, plazoPago, ...) already got reset
  // field-by-field before, but a WhatsappInput's own internal phone number
  // lived below that reset and was never touched, so it kept surviving a
  // close. A key-remount resets everything in one place, including whatever
  // a future field adds, instead of one more line to remember to update.
  const [instanceKey, setInstanceKey] = useState(0);
  // Read synchronously from the Dialog's onOpenChange handler below, so a
  // ref rather than state — nothing here needs to re-render when it changes.
  const dirtyRef = useRef(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  // Opens on each false -> true transition of autoOpen, not on a one-shot
  // latch. A latch only ever fires once, so the first tap of the bar's
  // "Agregar" worked and every tap afterwards did nothing. Re-arming it on
  // close doesn't work either: the marker is still in the address at that
  // moment, so the guard immediately fires again and the dialog reopens the
  // instant it is dismissed. Tracking the transition is what makes repeat taps
  // work without looping — the effect below returns autoOpen to false once the
  // dialog is closed, which arms the next one.
  // Seeded false, never from autoOpen. Tapping "Agregar" from another screen
  // mounts this component fresh with autoOpen ALREADY true; seeding from the
  // prop would record that as the starting value, so there was no transition
  // to react to and the dialog never opened. Starting false makes a fresh
  // mount carrying the marker a transition in its own right.
  // Normalised once: the prop is optional, so undefined and false have to mean
  // the same thing to the comparison below.
  const wantsOpen = autoOpen === true;
  const abrirBloqueado = useGuardiaAlAbrir(wantsOpen);
  const guardia = useGuardiaDeCuentaPausada();
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (wantsOpen !== prevAutoOpen) {
    setPrevAutoOpen(wantsOpen);
    if (wantsOpen && !abrirBloqueado) setOpen(true);
  }

  // Clears the marker only once the dialog is CLOSED, through the router rather
  // than history.replaceState. replaceState moves the address bar behind Next's
  // back: the router still believed it was on ?nuevo=1, so tapping the bar again
  // was a navigation to the page it thought it was already on — the spinner ran
  // and nothing opened. Leaving the marker instead makes a refresh spring the
  // dialog open on its own, which is the other half of what was reported.
  //
  // Skipped entirely when the dialog is closing *because* we are navigating to
  // a client. Picking a client from the search results ran onDone() (open ->
  // false) and then router.push("/clients/<id>"), which armed this effect while
  // `pathname` was still "/dashboard" — so the replace landed after the push
  // and put the owner straight back on Cartera. The dialog closed and nothing
  // else happened, and only from the bar's "Agregar", since that is the only
  // entry point that sets ?nuevo=1 and therefore the only one where wantsOpen
  // is true. There is nothing to clean up in that case anyway: navigating to
  // another route leaves the marker behind on its own.
  const navigatingAwayRef = useRef(false);
  useEffect(() => {
    if (navigatingAwayRef.current) return;
    if (wantsOpen && !open) router.replace(pathname, { scroll: false });
  }, [wantsOpen, open, router, pathname]);

  // Stable identity: the body passes this to an effect (see handledState
  // below), and a fresh function every render would re-run that effect on
  // every render — each run bumping instanceKey, which re-renders, which
  // makes another new function. Both setters are stable, so [] is correct.
  // `navigating` tells the marker-clearing effect above to stand down: the
  // body is closing this dialog on its way to a client page, and the replace
  // would land after that push and cancel it.
  const closeAndReset = useCallback((navigating = false) => {
    navigatingAwayRef.current = navigating;
    setOpen(false);
    setInstanceKey((k) => k + 1);
  }, []);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (next) {
            if (guardia()) return;
            setOpen(true);
            return;
          }
          // Covers every way Radix can ask to close — the X button, Escape,
          // and a click outside — with one check instead of guarding each
          // affordance separately.
          if (dirtyRef.current) {
            setConfirmDiscardOpen(true);
            return;
          }
          closeAndReset();
        }}
      >
        {/* SIN DISPARADOR PROPIO. Lo tuvo hasta el 2026-10-24 —un botón
            «Agregar movimiento»— y era el último sitio desde donde se abría
            el diálogo viejo. Hoy esta hoja la abre un marcador en la
            dirección, `?nuevo=abono`, que pone la hoja de «Registrar». */}
        {/* svh y no vh. `vh` mide el viewport GRANDE —el que habría si la barra
          del navegador estuviera escondida— así que en un teléfono con la barra
          a la vista el 90% de esa medida es más alto que la pantalla, y el
          diálogo se centra sobre un alto que no existe: el título queda por
          encima del borde y no hay forma de subir hasta él. `svh` mide el
          viewport PEQUEÑO, el que de verdad se ve. Es el mismo problema del
          100vh que CLAUDE.md ya nombra para iPhone. */}
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-xl">
          <ClientSearchDialogBody key={instanceKey} clients={clients} onDone={closeAndReset} />
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Todavía no guardaste este cliente ni su movimiento — si sales ahora se pierde lo que
              ya escribiste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscardOpen(false);
                closeAndReset();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Everything below is remounted (via the `key` above) on every fresh open,
// which is what makes "close without saving, reopen" start from a blank
// slate — including WhatsappInput's own phone number, which lives entirely
// inside that child and was never reachable from a field-by-field reset up
// in the parent.
function ClientSearchDialogBody({
  clients,
  onDone,
}: {
  clients: ClientOption[];
  // Cierra la hoja. `true` le dice al efecto del marcador que se esté quieto:
  // estamos cerrando PARA navegar, y su `replace` aterrizaría después del
  // `push` y lo cancelaría. Ese fallo está contado entero arriba.
  onDone: (navigating?: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // SIN ESCRIBIR NADA SE ENSEÑA LA LISTA — frame `1525:10827`, que la dibuja
  // llena antes de teclear. Al abono se llega sabiendo que ALGUIEN pagó, así
  // que la lista es la pregunta; en el camino de alta el campo vacío era la
  // invitación a escribir, y ese camino ya no pasa por aquí.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, CLIENT_RESULT_LIMIT);
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || c.document_id?.toLowerCase().includes(q))
      .slice(0, CLIENT_RESULT_LIMIT);
  }, [clients, query]);

  function selectExisting(id: string) {
    onDone(true);
    // EL ABONO ENTRA EN SU PROPIO FLUJO. `/abonos/nuevo?cliente=<id>` es su
    // paso 1/3 —elegir qué fiado paga— y es el mismo sitio al que lleva
    // «Agregar abono» de la ficha del cliente desde el 2026-10-19.
    //
    // Hasta el 2026-10-20 esto iba a `/clients/<id>?movimiento=abono`, que
    // abría el diálogo «Agregar transacción». Ese diálogo se borró el
    // 2026-10-24 por orden del dueño, y con él la última rama que quedaba
    // aquí para mandar a alguien a la ficha con un marcador.
    router.push(`/abonos/nuevo?cliente=${id}`);
  }

  return (
    <>
      {/* LA CABECERA DEL ABONO ES MÁS CORTA, Y SALE DEL FRAME `1471:21576`:
          solo el título, la ✕ y el campo. Ni la línea del negocio ni
          «+ Nuevo cliente». Confirmado con el dueño el 2026-10-20.

          Y «+ Nuevo cliente» no es solo que el frame no lo dibuje: un cliente
          recién creado no tiene ningún fiado que pagar, así que ese botón
          llevaba a un callejón sin salida en este camino. Hoy el alta vive en
          `/clients/nuevo`, a la que lleva la hoja de «Registrar». */}
      <SheetHeader>
        <SheetTitle>Buscar cliente</SheetTitle>
        <SheetDescription>Selecciona un cliente</SheetDescription>
      </SheetHeader>
      {/* ── LOS 16px DE LOS LADOS, QUE AQUÍ FALTABAN ───────────────────────
          `SheetHeader` trae su propio `p-4`; `SheetContent` NO trae ninguno.
          Así que el título iba indentado y el buscador con la lista pegados a
          los dos bordes — reportado por el dueño el 2026-10-23 con la captura
          y los dos lados señalados en rojo.

          VA AQUÍ Y NO EN `SheetContent`: ese componente lo usan todas las
          hojas de la app, varias de las cuales ponen su propio relleno
          dentro. Cambiarlo allí sumaría dos rellenos en todas ellas. */}
      <div className="flex flex-col gap-3 px-4 pb-6">
        <Input
          autoFocus
          placeholder="Nombre o cédula del cliente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {results.length > 0 ? (
          <ClientResultList
            results={results.map((c) => ({
              id: c.id,
              name: c.name,
              documentId: c.document_id,
              documentType: c.document_type ?? null,
            }))}
            onSelect={selectExisting}
          />
        ) : query.trim() ? (
          <p className="text-sm text-muted-foreground">Sin resultados para &quot;{query}&quot;.</p>
        ) : null}
      </div>
    </>
  );
}
