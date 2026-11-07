"use client";

import { useActionState, useId } from "react";
import { FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogoDeAccion } from "@/components/admin/cuenta-acciones";
import { adjuntaComprobante, ComprobanteInput, useComprobante } from "@/components/admin/comprobante-input";
import { accionRegistrarFeedback } from "@/app/admin/cuentas/kam-actions";
import type { AccionState } from "@/app/admin/cuentas/actions";
import { FEEDBACK_KIND } from "@/lib/admin/history";
import type { AccountFeedback } from "@/lib/admin/kam";

const inicial: AccionState = { error: null, ok: false };

function fecha(iso: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

// «FEEDBACK» ON THE ACCOUNT'S PAGE: frames 13 and 14 of `2076:738`, approved on
// 2026-11-07. What the business tells its KAM, as the owner chose that day: a note
// with a type and an optional attachment. It is NOT `client_feedback`, which is what a
// shopkeeper's own customers write on their link (`CA-10`).
//
// There is no edit and no delete, on purpose: this is the trace he asked for.
export function CuentaFeedback({
  ownerId,
  feedback,
  urls,
}: {
  ownerId: string;
  feedback: AccountFeedback[];
  urls: Record<string, string>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <p className="text-sm text-muted-foreground">Lo que el negocio le cuenta al KAM. No se edita ni se borra.</p>
      </div>

      <div>
        <RegistrarFeedback ownerId={ownerId} />
      </div>

      {feedback.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay feedback de esta cuenta.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {feedback.map((f) => (
            <li key={f.id} className="flex flex-col gap-1 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full border px-2 py-0.5 text-xs">{FEEDBACK_KIND[f.kind] ?? f.kind}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fecha(f.at)}</span>
              </div>
              <p className="text-sm break-words whitespace-pre-wrap">{f.body}</p>
              <span className="text-xs text-muted-foreground">{f.actor_email ?? "—"}</span>
              {f.attachment_path && urls[f.attachment_path] ? (
                <a
                  href={urls[f.attachment_path]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 text-xs font-medium underline underline-offset-2"
                >
                  {f.attachment_path.endsWith(".pdf") ? <FileText className="size-3.5" /> : <Paperclip className="size-3.5" />}
                  Ver adjunto
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RegistrarFeedback({ ownerId }: { ownerId: string }) {
  const formId = useId();
  const [state, action, pending] = useActionState(accionRegistrarFeedback, inicial);
  const [comprobante, setComprobante] = useComprobante(state);

  return (
    <DialogoDeAccion
      titulo="Registrar feedback"
      descripcion="Queda con tu correo y la fecha de hoy."
      disparador={
        <Button type="button" size="sm">
          Registrar feedback
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
      confirmar="Guardar"
    >
      <form id={formId} action={(fd) => action(adjuntaComprobante(fd, comprobante))} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-k`}>Tipo</Label>
          <Select name="kind" defaultValue="complaint">
            <SelectTrigger id={`${formId}-k`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FEEDBACK_KIND).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-b`}>Qué dijo</Label>
          <Textarea id={`${formId}-b`} name="body" rows={4} maxLength={2000} required />
        </div>
        <ComprobanteInput
          value={comprobante}
          onChange={setComprobante}
          ayuda="Una captura de la conversación, si la hay."
          etiqueta="Adjunto (opcional)"
        />
      </form>
    </DialogoDeAccion>
  );
}
