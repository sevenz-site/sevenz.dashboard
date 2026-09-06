"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runServiceChecks } from "@/app/admin/actions";
import type { ServiceCheck } from "@/lib/admin/health";

// Runs only when asked. Nothing here polls: the checks cost real calls to the
// services they watch, and there is nobody to page between requests.
export function ServiceHealth() {
  const [checks, setChecks] = useState<ServiceCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        setChecks(await runServiceChecks());
        setRanAt(new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }));
      } catch {
        setError("No se pudieron ejecutar las comprobaciones.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Estado de los servicios</p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Comprobando..." : checks ? "Volver a comprobar" : "Comprobar ahora"}
        </Button>
      </div>

      {checks === null && !error ? (
        <p className="text-sm text-muted-foreground">
          Comprueba en el momento si cada dependencia responde y acepta nuestras credenciales. No se
          ejecuta solo: cada comprobación gasta una llamada real al servicio que vigila.
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {checks ? (
        <>
          <ul className="flex flex-col gap-2">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2.5">
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {c.name}
                    {c.ms !== null ? (
                      <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                        {c.ms} ms
                      </span>
                    ) : null}
                  </p>
                  {/* Wraps rather than truncates: the detail is the part worth
                      reading, and a clipped error message is what made the last
                      outage take a day to understand. */}
                  <p className="text-sm break-words text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {ranAt ? <p className="text-xs text-muted-foreground">Comprobado a las {ranAt}.</p> : null}
        </>
      ) : null}
    </div>
  );
}

// Colour is never the only signal — each state has its own glyph, so the panel
// still reads correctly in greyscale or to a colourblind viewer.
function StatusIcon({ status }: { status: ServiceCheck["status"] }) {
  if (status === "ok") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />;
  }
  return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
}
