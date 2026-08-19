"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fileToResizedDataUrlForOcr } from "@/lib/image";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { ImportContext, type ImportJob } from "@/components/import/import-context";
import type { ImportUsage } from "@/lib/import-usage";
import { recordImportNotification } from "@/app/(app)/actions";

export function ImportProvider({
  initialUsage,
  children,
}: {
  initialUsage: ImportUsage;
  children: ReactNode;
}) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [usage, setUsage] = useState<ImportUsage>(initialUsage);

  const updateJob = useCallback((id: string, patch: Partial<ImportJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const startImport = useCallback(
    (files: File[]) => {
      let selected = files.slice(0, MAX_IMPORT_PHOTOS);
      if (selected.length === 0) return;

      if (usage.plan === "free" && usage.remaining !== null) {
        if (usage.remaining <= 0) {
          toast.error(`Alcanzaste el límite de ${usage.limit} fotos este mes en el plan Free.`);
          return;
        }
        if (selected.length > usage.remaining) {
          const skipped = selected.length - usage.remaining;
          selected = selected.slice(0, usage.remaining);
          toast.warning(
            `Solo se procesarán ${selected.length} foto${selected.length === 1 ? "" : "s"} — te ` +
              `quedan ${usage.remaining} este mes. Se omitieron ${skipped}.`,
          );
        }
      }

      const newJobs: ImportJob[] = selected.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
        movements: [],
        error: null,
      }));
      setJobs((prev) => [...prev, ...newJobs]);

      // Deliberately not awaited by the caller: this keeps running to
      // completion regardless of navigation, since ImportProvider is
      // mounted once at the (app) layout and doesn't unmount between pages.
      void (async () => {
        for (let i = 0; i < selected.length; i++) {
          const file = selected[i];
          const job = newJobs[i];
          updateJob(job.id, { status: "processing" });
          try {
            const dataUrl = await fileToResizedDataUrlForOcr(file);
            const response = await fetch("/api/extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image: dataUrl }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? "No pudimos leer la foto.");
            const movements = data.movements ?? [];
            updateJob(job.id, { status: "done", movements });
            void recordImportNotification({
              fileName: job.fileName,
              status: "done",
              movementsCount: movements.length,
            });
            // Only 'done' photos count against the free plan's monthly quota
            // — mirrors the recordImportNotification write above.
            setUsage((prev) =>
              prev.plan === "free"
                ? {
                    ...prev,
                    used: prev.used + 1,
                    remaining: prev.limit !== null ? Math.max(0, prev.limit - (prev.used + 1)) : null,
                  }
                : prev,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "Error al procesar la foto.";
            updateJob(job.id, { status: "error", error: message });
            void recordImportNotification({
              fileName: job.fileName,
              status: "error",
              errorMessage: message,
            });
          }
        }
        toast.success("Libreta procesada — revisa los movimientos en Importar cartera.");
      })();
    },
    [updateJob, usage],
  );

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearJobs = useCallback(() => {
    setJobs([]);
  }, []);

  const isProcessing = jobs.some((j) => j.status === "queued" || j.status === "processing");

  return (
    <ImportContext.Provider value={{ jobs, isProcessing, usage, startImport, removeJob, clearJobs }}>
      {children}
    </ImportContext.Provider>
  );
}
