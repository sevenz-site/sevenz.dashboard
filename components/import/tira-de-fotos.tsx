"use client";

import Image from "next/image";
import { useState } from "react";
import { Expand } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Las fotos que se leyeron en esta tanda, para poder mirarlas durante la
// revisión.
//
// POR QUÉ HACE FALTA. La pantalla dice "Suma da $30,00 | tu cuenta en libreta
// da $99,00" y el dueño no tiene forma de comprobar quién tiene razón sin
// salirse de Sevenz, abrir la galería del teléfono y buscar la foto que acaba
// de hacer. Con la tira aquí, la comprobación es un toque y vuelve.
//
// Es lo mismo que pasaba con el saldo previo de `CT-19`: el dato que resuelve
// la duda existía y estaba en otro sitio.
//
// LA MINIATURA NO BASTA, y por eso se abre. Una libreta a 64px es un borrón
// gris; lo que hay que leer es un número escrito a mano. La miniatura sirve
// para ELEGIR cuál abrir cuando hay seis.
export function TiraDeFotos({
  fotos,
}: {
  fotos: { id: string; previewUrl: string; fileName: string }[];
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  if (fotos.length === 0) return null;

  const foto = fotos.find((f) => f.id === abierta);

  return (
    <>
      {/* Scroll horizontal y no una rejilla: con seis fotos una rejilla empuja
          la primera tarjeta de cliente fuera de la pantalla, y lo que el dueño
          vino a hacer es revisar clientes, no mirar fotos. La tira ocupa una
          fila y se desliza. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {fotos.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setAbierta(f.id)}
            aria-label={`Ver la foto ${f.fileName} en grande`}
            className="relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted"
          >
            {/* `unoptimized`: es un blob: del navegador, creado con
                URL.createObjectURL. El optimizador de Next no puede procesar lo
                que no puede descargar, y sin esto la miniatura sale rota. */}
            <Image
              src={f.previewUrl}
              alt={f.fileName}
              fill
              unoptimized
              className="object-cover"
            />
            <span className="absolute right-1 bottom-1 rounded bg-background/80 p-0.5">
              <Expand className="size-3" />
            </span>
          </button>
        ))}
      </div>

      <Dialog open={foto !== undefined} onOpenChange={(v) => !v && setAbierta(null)}>
        <DialogContent className="max-w-[min(92vw,720px)]">
          <DialogHeader>
            <DialogTitle className="truncate text-base">{foto?.fileName}</DialogTitle>
          </DialogHeader>
          {foto ? (
            // `max-h-[70dvh]` y `object-contain`: una página de libreta es más
            // alta que ancha, y sin tope se sale de la pantalla en un teléfono
            // — justo donde se va a mirar.
            <div className="relative max-h-[70dvh] w-full overflow-auto">
              <Image
                src={foto.previewUrl}
                alt={foto.fileName}
                width={1280}
                height={1707}
                unoptimized
                className="h-auto w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
