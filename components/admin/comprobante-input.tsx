"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fileToResizedBlob } from "@/lib/image";

// El comprobante de una acción de /admin: la captura del Zelle, el PDF de la
// transferencia, las capturas de WhatsApp que respaldan un bloqueo.
//
// NO SUBE NADA AQUÍ. A diferencia del adjunto del tendero, que sube a Storage
// desde el navegador con su propia sesión, este archivo viaja dentro del envío
// del formulario y lo sube la acción de servidor. No es una preferencia: el
// bucket `comprobantes` no tiene políticas, así que ninguna sesión normal
// puede escribir en él — y la del superadmin, para la base, es una sesión
// normal. Quién es superadmin lo dice una variable de entorno.
//
// LAS IMÁGENES SE REDUCEN ANTES DE SALIR. Una acción de servidor de Next
// acepta 1 MB por defecto; una foto de teléfono son ocho. Reducirla la deja en
// unos 200 KB y de paso no hace esperar a nadie con una subida de 8 MB. El PDF
// pasa tal cual —no hay nada que reducir— y por eso el tope sigue existiendo.
const TIPOS = "image/jpeg,image/png,image/webp,application/pdf";
const TOPE_PDF = 5 * 1024 * 1024;

export type Comprobante = { blob: Blob; nombre: string } | null;

// Lo mete en el envío del formulario. Va aparte del componente porque quien
// arma el FormData es el <form>, no el campo: `action={(fd) => formAction(
// adjuntaComprobante(fd, comprobante))}`.
export function adjuntaComprobante(fd: FormData, comprobante: Comprobante): FormData {
  if (comprobante) fd.set("comprobante", comprobante.blob, comprobante.nombre);
  return fd;
}

// El archivo elegido, y se olvida solo cuando la accion sale bien. Sin esto,
// reabrir el dialogo para el siguiente negocio enseña el nombre del recibo del
// anterior — y el que lo lea se creera que ya esta adjunto.
//
// Ajuste en el render y no en un efecto: es el patron que ya usa
// DialogoDeAccion en este mismo archivo para cerrarse al terminar.
export function useComprobante(state: { ok: boolean }) {
  const [comprobante, setComprobante] = useState<Comprobante>(null);
  const [visto, setVisto] = useState(state);
  if (state !== visto) {
    setVisto(state);
    if (state.ok) setComprobante(null);
  }
  return [comprobante, setComprobante] as const;
}

export function ComprobanteInput({
  value,
  onChange,
  ayuda,
}: {
  value: Comprobante;
  onChange: (valor: Comprobante) => void;
  // Qué tiene sentido adjuntar en ESTA acción. No es lo mismo el recibo de un
  // pago que las capturas que respaldan un bloqueo.
  ayuda: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [nombre, setNombre] = useState<string | null>(null);

  async function alElegir(file: File | undefined) {
    if (!file) return;
    setPreparando(true);
    try {
      if (file.type === "application/pdf") {
        if (file.size > TOPE_PDF) {
          toast.error("Ese PDF pasa de 5 MB.");
          return;
        }
        onChange({ blob: file, nombre: file.name });
      } else {
        const blob = await fileToResizedBlob(file);
        // El nombre lleva .jpg porque eso es lo que sale del reductor. Guardar
        // "recibo.png" para un contenido JPEG es una mentira que se descubre
        // el día que alguien se descargue el archivo.
        const base = file.name.replace(/\.[^.]+$/, "");
        onChange({ blob, nombre: `${base}.jpg` });
      }
      setNombre(file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos preparar el archivo.");
    } finally {
      setPreparando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Comprobante (opcional)</Label>

      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <span className="flex items-center gap-2 truncate text-muted-foreground">
            {value.blob.type === "application/pdf" ? (
              <FileText className="size-4 shrink-0" />
            ) : (
              <Paperclip className="size-4 shrink-0" />
            )}
            <span className="truncate">{nombre ?? "Archivo adjunto"}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={() => {
              onChange(null);
              setNombre(null);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="justify-start font-normal text-muted-foreground"
          disabled={preparando}
          onClick={() => inputRef.current?.click()}
        >
          {preparando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
          {preparando ? "Preparando…" : "Adjuntar imagen o PDF"}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={TIPOS}
        className="hidden"
        onChange={(e) => void alElegir(e.target.files?.[0])}
      />

      <p className="text-xs text-muted-foreground">{ayuda}</p>
    </div>
  );
}
