"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textoDeDeshacer } from "@/lib/historial-de-revision";

// El deshacer de la revisión, en los dos sitios donde sale: a la derecha del
// título "Subir libreta" y junto a "Eliminar" en el detalle del cliente.
//
// SE QUEDA A LA VISTA Y APAGADO cuando no hay nada que deshacer, en vez de
// desaparecer. Un botón que aparece y desaparece mueve lo que tiene al lado —
// aquí, el botón de eliminar un cliente— y eso es un toque en el sitio
// equivocado sobre una acción que borra. Visto como regla en DESIGN-SYSTEM.md
// con el buscador de Cartera.
export function BotonDeshacer({
  pasos,
  onDeshacer,
  className,
}: {
  pasos: number;
  onDeshacer: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className ?? "size-10 shrink-0 rounded-full"}
      disabled={pasos === 0}
      aria-label={textoDeDeshacer(pasos)}
      title={textoDeDeshacer(pasos)}
      onClick={onDeshacer}
    >
      <Undo2 className="size-4" />
    </Button>
  );
}
