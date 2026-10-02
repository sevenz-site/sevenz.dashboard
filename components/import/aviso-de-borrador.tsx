"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RevisionGuardada } from "@/lib/revision-guardada";

// EL AVISO DE QUE HAY UNA REVISIÓN A MEDIAS, en los dos sitios desde los que se
// puede empezar a subir: la pantalla `/import` y la hoja del botón "Subir
// libreta" de Inicio.
//
// Vive aquí porque enseñarlo en uno solo es el fallo que lo motivó: desde Inicio
// se podía arrancar una libreta nueva sin ninguna señal de que había otra sin
// terminar, y la nueva pisa el borrador de la vieja. Reportado el 2026-10-02.
//
// Dos copias del mismo párrafo se separan en cuanto alguien retoca una, y este
// párrafo promete algo concreto —que las correcciones vuelven y las fotos no—,
// así que la que se quedara vieja estaría mintiendo sobre lo que se recupera.
export function AvisoDeBorrador({
  borrador,
  onSeguir,
  onDescartar,
}: {
  borrador: RevisionGuardada;
  onSeguir: () => void;
  onDescartar: () => void;
}) {
  const n = borrador.movimientos.length;
  const movs = `${n} ${n === 1 ? "movimiento" : "movimientos"}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
      <p className="flex items-start gap-1.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        {borrador.revisada ? (
          <span>
            Dejaste una revisión a medias con <strong>{movs}</strong>. Puedes seguir donde la
            dejaste: las correcciones y las decisiones siguen ahí. Las fotos no, así que la tira
            saldrá vacía.
          </span>
        ) : (
          <span>
            Ya leímos tu libreta: <strong>{movs}</strong>. La pantalla se cerró antes de que los
            revisaras, pero no hace falta volver a subir la foto: sigue desde aquí. La tira de fotos
            saldrá vacía, nada más.
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSeguir}>
          {borrador.revisada
            ? "Seguir con esa revisión"
            : `Revisar ${n === 1 ? "ese movimiento" : `esos ${n} movimientos`}`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDescartar}>
          Descartarla
        </Button>
      </div>
    </div>
  );
}
