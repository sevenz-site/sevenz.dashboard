"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2, RotateCw, TriangleAlert, Sparkles, Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

import type { ReconcileClient } from "@/lib/reconcile";

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
}: {
  existingClients: ExistingClient[];
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
  const { jobs, isProcessing, usage, startImport, removeJob, clearJobs } = useImportJobs();
  const [confirming, setConfirming] = useState(false);
  const [reviewMovements, setReviewMovements] = useState<ExtractedMovement[] | null>(null);

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

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    startImport(Array.from(fileList));
  }

  function handleViewResults() {
    // La moneda no sale de la extracción porque la foto no la dice. Tampoco se
    // siembra ya con un valor por defecto: la elige el dueño antes de guardar.
    setReviewMovements(
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
        toast.error(result.error, { description: `${result.imported} movimientos ya se guardaron.` });
      } else {
        toast.success(`${result.imported} movimientos importados.`);
        setReviewMovements(null);
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
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="same-client"
              checked={sameClient}
              onCheckedChange={(v) => toggleSameClient(v === true)}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="same-client" className="cursor-pointer">
                Todas las filas son del mismo cliente
              </Label>
              <p className="text-xs text-muted-foreground">
                Para cuando fotografías varias páginas de una sola persona. Se aplica el mismo
                nombre y la misma cédula a todo el lote, aunque la IA haya leído el nombre distinto
                en cada página.
              </p>
            </div>
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
                <Input
                  id="shared-document"
                  value={sharedDocument}
                  placeholder="Requerida para un cliente nuevo"
                  onChange={(e) => setSharedDocument(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          {sameClient ? (
            <p className="text-xs text-muted-foreground">
              Si la página mezcla clientes, desmarca la casilla de esa fila en la tabla y recupera
              su nombre y cédula propios.
            </p>
          ) : null}
        </div>

        {showCurrency ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="text-sm font-medium">¿En qué moneda está esta libreta?</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => applyCurrencyToAll("USD")}>
                Todo en USD
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyCurrencyToAll("EUR")}>
                Todo en EUR
              </Button>
            </div>
            <p className="w-full text-xs text-muted-foreground">
              Hay que elegir una para poder importar. Puedes cambiar filas sueltas después, si la
              libreta mezcla.
            </p>
          </div>
        ) : null}
        <ImportReviewTable
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
          <Button variant="outline" onClick={() => setReviewMovements(null)} disabled={confirming}>
            Volver
          </Button>
          {/* La confirmación va en un diálogo y no directa en el botón porque
              esta es la única escritura de la app que mete decenas de filas de
              golpe: lo que se cuela aquí no se revisa fila a fila después. Es
              una pregunta distinta de las de arriba — esas son datos que
              faltan, esta es "¿lo miraste?". */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={
                  confirming ||
                  reviewRows.length === 0 ||
                  missingDocumentId ||
                  missingSharedName ||
                  missingCurrency
                }
              >
                {confirming ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Guardando...
                  </>
                ) : (
                  `Confirmar e importar (${reviewRows.length})`
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  ¿Importar {reviewRows.length} {reviewRows.length === 1 ? "movimiento" : "movimientos"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Asegúrate de haber verificado los datos importados del cliente, así como montos y
                  moneda.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Volver a revisar</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirm}>Confirmar importación</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
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
    </div>
  );
}
