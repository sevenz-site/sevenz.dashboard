"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2, RotateCw, TriangleAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { ExtractedMovement } from "@/lib/types";
import { confirmImport, type ImportRow } from "@/app/(app)/import/actions";
import { ImportReviewTable } from "@/components/import/import-review-table";

type ExistingClient = { id: string; name: string; balance: number };

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

export function ImportFlow({ existingClients }: { existingClients: ExistingClient[] }) {
  const router = useRouter();
  const { jobs, isProcessing, usage, startImport, removeJob, clearJobs } = useImportJobs();
  const [confirming, setConfirming] = useState(false);
  const [reviewMovements, setReviewMovements] = useState<ExtractedMovement[] | null>(null);

  const quotaExhausted = usage.plan === "free" && usage.remaining === 0;

  const doneJobs = jobs.filter((j) => j.status === "done");
  const errorJobs = jobs.filter((j) => j.status === "error");
  const hasJobs = jobs.length > 0;

  const reviewRows = useMemo(
    () => (reviewMovements ? reconcileMovements(reviewMovements, existingClients) : []),
    [reviewMovements, existingClients],
  );

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return;
    startImport(Array.from(fileList));
  }

  function handleViewResults() {
    setReviewMovements(doneJobs.flatMap((j) => j.movements));
  }

  function updateMovement(index: number, patch: Partial<ExtractedMovement>) {
    setReviewMovements((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
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
        <ImportReviewTable
          rows={reviewRows}
          onUpdate={updateMovement}
          onRemove={removeMovement}
          existingClients={existingClients}
        />
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setReviewMovements(null)} disabled={confirming}>
            Volver
          </Button>
          <Button onClick={handleConfirm} disabled={confirming || reviewRows.length === 0}>
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Guardando...
              </>
            ) : (
              `Confirmar e importar (${reviewRows.length})`
            )}
          </Button>
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
            <label
              htmlFor="photos"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Upload className="size-6" />
              {`Toca para elegir o tomar fotos de la libreta (hasta ${MAX_IMPORT_PHOTOS})`}
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
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
