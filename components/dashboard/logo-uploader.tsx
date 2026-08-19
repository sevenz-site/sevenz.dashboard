"use client";

import { useRef, useState } from "react";
import { Building2, Loader2, Trash2 } from "lucide-react";
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
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fileToResizedBlob } from "@/lib/image";
import { updateLogo, deleteLogo } from "@/app/(app)/profile/actions";

export function LogoUploader({
  ownerId,
  initialPreviewUrl,
  value,
  onChange,
}: {
  ownerId: string;
  initialPreviewUrl: string | null;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
      const path = `${ownerId}/logo-${Date.now()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("logos").upload(path, blob, {
        contentType: "image/jpeg",
      });
      if (error) throw error;

      const saved = await updateLogo(path);
      if (saved.error) throw new Error(saved.error);

      onChange(path);
      setPreviewUrl(URL.createObjectURL(blob));
      toast.success("Logo actualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir el logo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await deleteLogo();
      if (result.error) throw new Error(result.error);
      onChange(null);
      setPreviewUrl(null);
      toast.success("Logo eliminado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos borrar el logo.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Logo del negocio" className="h-full w-full object-cover" />
        ) : (
          <Building2 className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || deleting}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Subiendo...
            </>
          ) : previewUrl ? (
            "Cambiar logo"
          ) : (
            "Subir logo"
          )}
        </Button>

        {previewUrl ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={uploading || deleting}
                title="Eliminar logo"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar el logo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tu negocio quedará con el ícono de Sevenz por defecto en la pantalla de tus
                  clientes hasta que subas uno nuevo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        <input type="hidden" name="logo_path" value={value ?? ""} />
      </div>
    </div>
  );
}
