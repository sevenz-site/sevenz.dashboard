"use client";

import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fileToResizedDataUrlForOcr } from "@/lib/image";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { ImportContext, type ImportJob } from "@/components/import/import-context";
import type { ImportUsage } from "@/lib/import-usage";
import { recordImportNotification } from "@/app/(app)/actions";
import { track } from "@/lib/mixpanel";

// "Failed to fetch" NO es un mensaje para un tendero.
//
// Lo vio el usuario el 2026-09-28 subiendo una libreta desde el teléfono, tres
// veces seguidas: el error crudo de `fetch`, en inglés, en mitad de la pantalla.
// Venía de pasar `error.message` directo a la interfaz, que funciona para los
// errores que escribimos nosotros —ya están en castellano y pensados para él— y
// falla justo para los que no.
//
// `fetch` lanza un `TypeError` cuando la petición NO LLEGA A TENER RESPUESTA:
// se cayó la red, o el servidor cerró la conexión sin contestar. Lo segundo es
// lo que pasa cuando la función tarda más de lo que el plan permite y la
// plataforma la mata a mitad — ver la nota de `REQUEST_TIMEOUT_MS` en
// app/api/extract/route.ts. Desde el teléfono las dos cosas se ven igual, así
// que el mensaje nombra las dos y dice qué hacer.
//
// `data.error` pasa tal cual, y desde el 2026-10-01 eso ya no es una suposición
// sino algo que el servidor garantiza: `/api/extract` devuelve únicamente lo que
// `lib/errores-legibles.ts` sabe decir en castellano, y todo lo demás cae en un
// mensaje genérico legible. Antes era una suposición, y era falsa — el día que
// el servidor se quedó sin salida a internet, aquí llegó "fetch failed" y de
// aquí pasó entera a la pantalla.
function mensajeDeFalloAlLeer(error: unknown): string {
  if (error instanceof TypeError) {
    return "Se cortó la conexión mientras leíamos la foto. Puede ser tu internet, o que la lectura tardara demasiado. Inténtalo otra vez.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "No pudimos leer la foto. Inténtalo otra vez.";
}

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
      const selected = files.slice(0, MAX_IMPORT_PHOTOS);
      if (selected.length === 0) return;

      // Aquí se recortaba la selección al cupo que quedaba del mes. Sin tope
      // desde el 2026-09-28, lo único que sigue limitando es MAX_IMPORT_PHOTOS
      // —cuántas caben en una tanda—, que es otra cosa y sigue arriba.

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
            track("Import Photo Processed", { movements_count: movements.length });
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
            const message = mensajeDeFalloAlLeer(error);
            // El detalle técnico, al log del navegador y no a la pantalla. Es
            // lo que hace falta para diagnosticar y lo que no significa nada
            // para quien está intentando subir su libreta.
            console.error("extract:", error);
            updateJob(job.id, { status: "error", error: message });
            track("Import Photo Failed", { error: message });
            void recordImportNotification({
              fileName: job.fileName,
              status: "error",
              errorMessage: message,
            });
          }
        }
        // No nombra la pantalla. Antes decía "revisa los movimientos en
        // Importar cartera", y con el nombre nuevo quedaría "en Subir libreta"
        // — el título de la pantalla es ahora una ACCIÓN, y un sitio no se
        // llama "Subir libreta". Además el dueño ya está ahí cuando esto salta.
        toast.success("Libreta procesada — revisa los movimientos antes de guardar.");
      })();
    },
    [updateJob],
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
