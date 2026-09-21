"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2, RotateCw, TriangleAlert, Sparkles, Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from "@/components/ui/attachment";
import { useImportJobs, type ImportJobStatus } from "@/components/import/import-context";
import { reconcileMovements } from "@/lib/reconcile";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { type ExtractedMovement, type LedgerCurrency } from "@/lib/types";
import { confirmImport, type ImportRow } from "@/app/(app)/import/actions";
import { ImportReviewTable } from "@/components/import/import-review-table";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { useTrampaDeAtras } from "@/hooks/use-trampa-de-atras";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";

// Lo que dice el diálogo al intentar salir con una libreta a medias. No
// menciona "guardar" porque aquí guardar es importar veintitantos movimientos,
// y eso tiene su propia confirmación: el diálogo de salida solo ofrece
// quedarse o irse.
const TEXTO_SALIR_DE_LA_REVISION = {
  titulo: "¿Salir sin importar la libreta?",
  cuerpo:
    "Tienes movimientos leídos que todavía no se han guardado. Si sales ahora se pierden, junto con las correcciones que hayas hecho.",
};
import { ConfirmarImportacion } from "@/components/import/confirmar-importacion";
import { PasosImportar } from "@/components/dashboard/pasos-importar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RANURA_ACCION_CABECERA } from "@/components/import/ranura-cabecera";

import type { ReconcileClient } from "@/lib/reconcile";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import type { OwnerCountry } from "@/lib/types";

type ExistingClient = ReconcileClient;

const ATTACHMENT_STATE: Record<ImportJobStatus, "uploading" | "processing" | "done" | "error"> = {
  queued: "uploading",
  processing: "processing",
  done: "done",
  error: "error",
};

const STATUS_LABEL: Record<ImportJobStatus, string> = {
  queued: "En cola...",
  processing: "Leyendo con IA...",
  done: "Listo",
  error: "Error",
};

export function ImportFlow({
  existingClients,
  ownerCountry,
  rateContext,
}: {
  existingClients: ExistingClient[];
  // Solo para la línea de bolívares del resumen de confirmación. Null en un
  // negocio colombiano, y también en uno venezolano sin tasa todavía: entonces
  // el resumen no pinta esa línea, nunca se inventa una tasa.
  rateContext: MovementRateContext | null;
  // Nunca null: la página no monta este componente si no pudo leer el país,
  // porque sin él no se sabe si las filas llevan moneda. Tipado así a
  // propósito, para que el valor por defecto silencioso no pueda volver.
  ownerCountry: string;
}) {
  const router = useRouter();
  // Only a VE owner has a currency to choose. A CO owner's ledger has no
  // currency dimension at all — null means COP — so showing them a selector
  // would invent a decision they don't have.
  const showCurrency = ownerCountry === "VE";
  // Narrowed once here: the page hands this down as a plain string.
  const country: OwnerCountry = ownerCountry === "VE" ? "VE" : "CO";
  const { jobs, isProcessing, usage, startImport, removeJob, clearJobs } = useImportJobs();
  const [confirming, setConfirming] = useState(false);
  // Cuenta pausada: se para ANTES de la foto. Escanearla gasta cuota de
  // Gemini y veinte minutos de revision para nada.
  const guardia = useGuardiaDeCuentaPausada();
  const [reviewMovements, setReviewMovements] = useState<ExtractedMovement[] | null>(null);
  const { setDirty, guard } = useUnsavedChangesGuard();
  const { setRevisando } = useRevisionEnCurso();
  // El botón atrás del teléfono y el gesto de deslizar: la salida más probable
  // en un móvil, y la única que no pasa por ningún onClick nuestro.
  const consumirCentinela = useTrampaDeAtras(reviewMovements !== null, guard);

  // Entrar y salir de la revisión, en un solo sitio. Los tres estados van
  // juntos siempre —hay filas, hay que avisar al salir, la barra se esconde—
  // y separarlos es cómo uno se queda desincronizado: una barra escondida sin
  // nada que revisar, o un aviso de "sin guardar" cuando ya se guardó.
  function abrirRevision(movimientos: ExtractedMovement[]) {
    setReviewMovements(movimientos);
    setRevisando(true);
    setDirty(true, undefined, consumirCentinela, TEXTO_SALIR_DE_LA_REVISION);
  }

  function cerrarRevision() {
    setReviewMovements(null);
    setRevisando(false);
    setDirty(false);
  }

  // "Every row is the same person" — for an owner who photographs one client's
  // pages rather than a page of many clients.
  //
  // It has to rewrite the NAME as well as the document, not just the document.
  // confirmImport groups new clients by name and refuses a cédula that is
  // already taken, so one document across two spellings of one person ("Ana
  // Torres" on one page, "A. Torres" on the next) would create the first
  // client and then fail on the second — halfway through, with movements
  // already saved. One client means one name and one document.
  const [sameClient, setSameClient] = useState(false);
  const [sharedName, setSharedName] = useState("");
  const [sharedDocument, setSharedDocument] = useState("");
  // A page usually holds one client but can mix, so the shared value is a
  // default rather than a rule: any row can opt out and keep its own client.
  // Keyed by uid, not position — deleting a row would otherwise hand its
  // opt-out to whichever row moved up into its place.
  const [unlinked, setUnlinked] = useState<Set<string>>(new Set());

  const quotaExhausted = usage.plan === "free" && usage.remaining === 0;

  const doneJobs = jobs.filter((j) => j.status === "done");
  const errorJobs = jobs.filter((j) => j.status === "error");
  const hasJobs = jobs.length > 0;

  // Applied on top of what was read, never written back into it, so unticking
  // the box restores the original names and documents instead of losing them.
  const effectiveMovements = useMemo(() => {
    if (!reviewMovements) return null;
    if (!sameClient) return reviewMovements;
    return reviewMovements.map((m) =>
      // An opted-out row keeps exactly what was read, because the override is
      // applied here and never written back into reviewMovements. Re-linking it
      // restores the shared value; unticking the box restores every original.
      m.uid && unlinked.has(m.uid)
        ? m
        : { ...m, client_name: sharedName, document_id: sharedDocument.trim() || null },
    );
  }, [reviewMovements, sameClient, sharedName, sharedDocument, unlinked]);

  const reviewRows = useMemo(
    () => (effectiveMovements ? reconcileMovements(effectiveMovements, existingClients) : []),
    [effectiveMovements, existingClients],
  );

  // A client without a cédula/documento on file must get one before the
  // import can be confirmed — same requirement as the manual "Registrar
  // cliente nuevo" form, just applied per row here.
  const missingDocumentId = reviewRows.some((r) => r.needs_document_id && !r.document_id?.trim());
  // A blank shared name would create a nameless client, so it blocks the same
  // way a missing cédula does — but only while at least one row still uses it.
  // Opting every row out leaves the field unused, and blocking on an unused
  // field is the kind of dead end that has no explanation on screen.
  const someRowLinked = reviewRows.some((r) => !unlinked.has(r.rowId));
  const missingSharedName = sameClient && someRowLinked && !sharedName.trim();
  // Antes las filas nacían en USD. Era el valor por defecto más común y estaba
  // a la vista, pero nada obligaba a mirarlo: una libreta llevada en euros,
  // confirmada de corrido, entraba entera en el libro de dólares — y un
  // movimiento en el libro que no es no da error, se ve bien y cuadra consigo
  // mismo hasta que el cliente reclama.
  //
  // Ahora nacen sin moneda y esto bloquea la confirmación. Un clic en "Todo en
  // USD/EUR" lo resuelve para la tanda entera, que es el camino normal; el
  // selector por fila sigue ahí para la libreta que mezcla.
  const missingCurrency = showCurrency && reviewRows.some((r) => !r.currency);

  // Cuál de las dos monedas marca el radio. Sale de las filas y no de un
  // estado aparte: las filas son la verdad y se pueden cambiar de una en una.
  // Si todas coinciden, esa; si la libreta mezcla —o si todavía no se ha
  // elegido, que es todas en null—, ninguna.
  const monedasEnUso = new Set(reviewRows.map((r) => r.currency));
  const monedaDeLaLibreta = monedasEnUso.size === 1 ? [...monedasEnUso][0] : null;

  // Una sola definición de "no se puede guardar todavía", porque ahora hay DOS
  // botones que la preguntan —el del pie y el de la cabecera— y que discrepen
  // sería un botón que guarda una tanda que el otro considera incompleta.
  const noSePuedeConfirmar =
    confirming ||
    reviewRows.length === 0 ||
    missingDocumentId ||
    missingSharedName ||
    missingCurrency;

  // Si estamos en el navegador. `useSyncExternalStore` y no un efecto: el
  // portal necesita un nodo que solo existe tras montar, y poner ese
  // `setState` en un `useEffect` es justo lo que rechaza
  // `react-hooks/set-state-in-effect`. Mismo recurso que `useIsMobile()`.
  const montado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const ranuraCabecera = montado ? document.getElementById(RANURA_ACCION_CABECERA) : null;

  function handleFilesSelected(fileList: FileList | null) {
    if (guardia()) return;
    if (!fileList) return;
    startImport(Array.from(fileList));
  }

  function handleViewResults() {
    // La moneda no sale de la extracción porque la foto no la dice. Tampoco se
    // siembra ya con un valor por defecto: la elige el dueño antes de guardar.
    abrirRevision(
      doneJobs.flatMap((j) => j.movements).map((m) => ({
        ...m,
        uid: crypto.randomUUID(),
        // null en los dos casos, con dos significados: en un negocio CO es la
        // respuesta definitiva — su libro no tiene moneda —, y en uno VE es un
        // dato que todavía falta y que missingCurrency exige antes de guardar.
        currency: null,
      })),
    );
    setUnlinked(new Set());
  }

  // A libreta is usually kept in one currency even though it can mix, so
  // setting all rows at once is the common path and the per-row select is the
  // exception — not the other way round.
  function applyCurrencyToAll(currency: LedgerCurrency) {
    setReviewMovements((prev) => (prev ? prev.map((m) => ({ ...m, currency })) : prev));
  }

  function updateMovement(index: number, patch: Partial<ExtractedMovement>) {
    setReviewMovements((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  // Seeded with the name Gemini read most often, so the common case is one
  // tick and no typing. It stays editable, and the datalist of existing
  // clients is still available through the table's own matching.
  function toggleSameClient(next: boolean) {
    setSameClient(next);
    if (next && !sharedName && reviewMovements && reviewMovements.length > 0) {
      const counts = new Map<string, number>();
      for (const m of reviewMovements) {
        const n = m.client_name.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) setSharedName(best[0]);
      const withDoc = reviewMovements.find((m) => m.document_id?.trim());
      if (withDoc?.document_id) setSharedDocument(withDoc.document_id);
    }
  }

  function toggleLinked(rowId: string) {
    setUnlinked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function removeMovement(index: number) {
    setReviewMovements((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleConfirm() {
    if (guardia()) return;
    if (reviewRows.length === 0) return;
    setConfirming(true);
    try {
      const rows: ImportRow[] = reviewRows.map((r) => ({
        client_id: r.matched_client_id,
        client_name: r.client_name,
        type: r.type,
        amount: r.amount,
        description: r.description,
        document_id: r.document_id,
        currency: r.currency,
      }));
      const result = await confirmImport(rows);
      if (result.error) {
        // La cuenta pausada se para antes de guardar nada, asi que aqui el
        // "ya se guardaron N" seria mentira. Lo dice el dialogo y ya.
        if (!avisarCuentaPausada(result.error)) {
          toast.error(result.error, { description: `${result.imported} movimientos ya se guardaron.` });
        }
      } else {
        toast.success(`${result.imported} movimientos importados.`);
        // Antes de navegar: si el aviso siguiera armado, el router.push de
        // abajo abriría "¿salir sin importar?" justo después de importar.
        cerrarRevision();
        clearJobs();
        router.push("/dashboard");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (reviewMovements) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {/* El mismo botón, arriba. Con veinticinco filas revisadas, el único
            que guardaba quedaba a una pantalla y media de scroll del sitio
            donde el dueño acababa de corregir la última. Ver
            ranura-cabecera.tsx para por qué viaja por portal. */}
        {ranuraCabecera
          ? createPortal(
              <ConfirmarImportacion
                cuantas={reviewRows.length}
                filas={reviewRows}
                rateContext={rateContext}
                deshabilitado={noSePuedeConfirmar}
                guardando={confirming}
                onConfirm={handleConfirm}
                size="sm"
              />,
              ranuraCabecera,
            )
          : null}
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="same-client"
              checked={sameClient}
              onCheckedChange={(v) => toggleSameClient(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="same-client" className="cursor-pointer">
              Todas las filas son del mismo cliente
            </Label>
          </div>

          {sameClient ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="shared-name" className="text-xs">
                  Cliente
                </Label>
                <Input
                  id="shared-name"
                  list="known-clients"
                  value={sharedName}
                  placeholder="Nombre del cliente"
                  className={sharedName.trim() ? undefined : "border-destructive"}
                  onChange={(e) => setSharedName(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="shared-document" className="text-xs">
                  Cédula/documento
                </Label>
                <DocumentIdInput
                  id="shared-document"
                  country={country}
                  value={sharedDocument}
                  onChange={setSharedDocument}
                />
              </div>
            </div>
          ) : null}
        </div>

        {showCurrency ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className="text-sm font-medium">¿En qué moneda está esta libreta?</span>
            {/* Radio y no dos botones sueltos, con la misma píldora que
                "Cargo / Abono" del alta de movimiento (TipoButtons). Dos
                botones `outline` no dejaban NINGUNA marca de cuál se había
                pulsado: el dueño elegía USD, la pantalla no cambiaba de
                aspecto, y la única prueba de que había funcionado estaba
                veinticinco filas más abajo, en la columna de la moneda.

                El valor no se guarda aparte: se deduce de las filas, que son
                la verdad. Si todas coinciden, esa es la elegida; si la libreta
                mezcla —se permite, cambiando filas sueltas— no se marca
                ninguna, porque marcar una sería mentir sobre las otras. */}
            <RadioGroup
              value={monedaDeLaLibreta ?? ""}
              onValueChange={(v) => applyCurrencyToAll(v as LedgerCurrency)}
              className="flex flex-row flex-wrap gap-2"
            >
              {(["USD", "EUR"] as const).map((moneda) => (
                <label
                  key={moneda}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm"
                >
                  <RadioGroupItem value={moneda} />
                  <span className="whitespace-nowrap">Todo en {moneda}</span>
                </label>
              ))}
            </RadioGroup>
            <p className="w-full text-xs text-muted-foreground">
              Hay que elegir una para poder importar. Puedes cambiar filas sueltas después, si la
              libreta mezcla.
            </p>
          </div>
        ) : null}
        <ImportReviewTable
              country={country}
          rows={reviewRows}
          onUpdate={updateMovement}
          onRemove={removeMovement}
          existingClients={existingClients}
          showCurrency={showCurrency}
          sharedClientActive={sameClient}
          isLinked={(rowId) => !unlinked.has(rowId)}
          onToggleLinked={toggleLinked}
        />
        {missingSharedName ? (
          <p className="text-sm text-destructive">
            Escribe el nombre del cliente antes de continuar.
          </p>
        ) : missingDocumentId ? (
          <p className="text-sm text-destructive">
            {sameClient
              ? "Falta la cédula/documento del cliente — complétala antes de continuar."
              : "Falta la cédula/documento de uno o más clientes nuevos — complétala antes de continuar."}
          </p>
        ) : missingCurrency ? (
          <p className="text-sm text-destructive">
            Elige la moneda de la libreta antes de continuar.
          </p>
        ) : null}
        <div className="flex items-center justify-between">
          {/* "Volver" no sale de la app, pero sí tira la revisión: las fotos
              se conservan y las correcciones hechas a mano no. Duele lo mismo
              que salir, así que pregunta lo mismo. */}
          <Button
            variant="outline"
            onClick={() => guard(() => cerrarRevision())}
            disabled={confirming}
          >
            Volver
          </Button>
          <ConfirmarImportacion
            cuantas={reviewRows.length}
            filas={reviewRows}
            rateContext={rateContext}
            deshabilitado={noSePuedeConfirmar}
            guardando={confirming}
            onConfirm={handleConfirm}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Los tres pasos viven aquí y no en la página porque solo valen para
          este momento: explican cómo se importa, y una vez la libreta está
          leída y el dueño está corrigiendo montos, describen algo que ya
          hizo. En un teléfono son cuatro renglones de los que se come antes
          de llegar a la primera fila. */}
      <PasosImportar className="-mt-2" />

      {/* La bandeja de fotos va AQUÍ, pegada a las instrucciones, y no al
          final de la pantalla. Mientras la IA lee la libreta es lo único que
          se mueve: dejarla debajo de la cuota y del recuadro de subir obligaba
          a bajar media pantalla para ver si seguía procesando, y en un
          teléfono quedaba tapada por la barra inferior. Lo que está pasando
          ahora va antes que lo que ya se hizo. */}
      {hasJobs ? (
        <div className="flex flex-col gap-3">
          <AttachmentGroup className="flex-wrap py-0">
            {jobs.map((job) => (
              <Attachment key={job.id} state={ATTACHMENT_STATE[job.status]} orientation="vertical">
                <AttachmentMedia variant="image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={job.previewUrl} alt={job.fileName} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{job.fileName}</AttachmentTitle>
                  <AttachmentDescription>
                    {job.status === "error" ? job.error : STATUS_LABEL[job.status]}
                    {job.status === "done" ? ` · ${job.movements.length} movimientos` : ""}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Quitar ${job.fileName}`}
                    onClick={() => removeJob(job.id)}
                    disabled={job.status === "processing"}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>

          {errorJobs.length > 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {errorJobs.length} foto{errorJobs.length > 1 ? "s" : ""} no se pudo procesar. Puedes
              quitarla{errorJobs.length > 1 ? "s" : ""} o intentar de nuevo con otra.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button onClick={handleViewResults} disabled={doneJobs.length === 0 || isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Procesando...
                </>
              ) : (
                `Ver resultados (${doneJobs.reduce((sum, j) => sum + j.movements.length, 0)} movimientos)`
              )}
            </Button>
            {!isProcessing ? (
              <Button variant="ghost" onClick={clearJobs}>
                <RotateCw className="size-4" />
                Empezar de nuevo
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}


      {usage.plan === "free" && usage.limit !== null ? (
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Fotos usadas este mes (plan Free)</span>
              <span className={usage.used >= 3 ? "font-medium text-destructive" : "font-medium text-emerald-600 dark:text-emerald-400"}>
                {usage.used}/{usage.limit}
              </span>
            </div>
            <Progress
              value={Math.min(100, (usage.used / usage.limit) * 100)}
              indicatorClassName={usage.used >= 3 ? "bg-destructive" : "bg-emerald-500"}
            />
            <p className="text-xs text-muted-foreground">
              Se reinicia el 1 de cada mes. Solo cuentan las fotos procesadas con éxito.
            </p>
          </CardContent>
        </Card>
      ) : usage.plan === "pro" ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-primary" />
          Plan Pro · fotos ilimitadas
        </p>
      ) : null}

      {quotaExhausted ? (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <TriangleAlert className="size-6 text-destructive" />
            <p className="text-sm font-medium">Alcanzaste el límite de {usage.limit} fotos este mes</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Con el plan Free puedes importar hasta {usage.limit} fotos por mes. Escríbenos para
              actualizar a Pro y seguir importando sin límites.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {/* Two inputs, not one with a toggle, because the difference is
                the `capture` attribute and it cannot be changed per click
                without re-rendering the input and losing the tap.

                The old single input carried capture="environment", which sends
                a phone straight to the rear camera and removes the photo
                library from the picker altogether — so an owner who had
                already photographed the libreta, or received it on WhatsApp,
                had no way to reach that image. The label said "elegir o tomar"
                while only "tomar" was possible. */}
            <label
              htmlFor="photos"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Upload className="size-6" />
              {`Toca para elegir fotos de la libreta (hasta ${MAX_IMPORT_PHOTOS})`}
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Phones only: a desktop browser ignores `capture` and would open
                the same ordinary file dialog as the button above, which reads
                as broken. Hidden with CSS rather than by detecting the device,
                so the server and the client render the same markup. */}
            <Button asChild variant="outline" className="sm:hidden">
              <label htmlFor="photos-camera" className="cursor-pointer">
                <Camera className="size-4" />
                Tomar foto
              </label>
            </Button>
            {/* No `multiple`: a camera capture returns exactly one image, so
                asking for several here would promise something the OS does not
                deliver. Several photos still work — one capture at a time, or
                the picker above. */}
            <input
              id="photos-camera"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
            {isProcessing ? (
              <p className="text-sm text-muted-foreground">
                Se está leyendo la libreta con IA — puedes seguir usando el resto de la app mientras
                tanto, el progreso sigue aquí.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
