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
// THE LOGO IS SAVED WITH "GUARDAR CAMBIOS", LIKE EVERY OTHER FIELD.
//
// Until 2026-11-02 uploading and deleting each wrote `owners.logo_path` on the
// spot (the old `updateLogo` / `deleteLogo` actions). The owner found the
// consequence: delete the logo, confirm, leave "Mi negocio" without saving —
// and the logo was gone anyway. Uploading was worse in its own way: the
// file input's change event marked the form dirty, so leaving asked
// «¿Salir sin guardar?», and "Salir sin guardar" left with the new logo
// already in place.
//
// Now both only change the hidden `logo_path` field and the preview, and
// `updateBusinessSettings` applies it — removing the replaced file from
// Storage once the save has gone through.
//
// What cannot wait for "Guardar": the upload to Storage itself, since the
// path has to exist before it can be saved. A file uploaded and then
// abandoned ("Salir sin guardar") stays in the owner's folder unused. Known
// and accepted: a few KB, in a folder only he can write to. A pending upload
// replaced by another one, or deleted before saving, IS removed here.
export function LogoUploader({
  ownerId,
  savedPath,
  initialPreviewUrl,
  value,
  onChange,
}: {
  ownerId: string;
  // What the database holds right now. Anything else in `value` is an upload
  // that has not been saved yet.
  savedPath: string | null;
  initialPreviewUrl: string | null;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);

  // An upload nobody saved, about to be replaced or dropped: nothing will
  // ever point at it. Best effort — failing to remove it costs a few KB.
  function discardPendingUpload() {
    if (value && value !== savedPath) {
      void createClient().storage.from("logos").remove([value]);
    }
  }

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

      discardPendingUpload();
      onChange(path);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir el logo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDelete() {
    discardPendingUpload();
    onChange(null);
    setPreviewUrl(null);
  }

  // Laid out as frame `1927:24166` draws it (2026-11-02): an 80px square, then
  // "Cambiar logo" filling the row, then a red 42×40 delete button. Before
  // that, delete was a grey ghost icon the owner did not read as a button.
  return (
    <div className="flex w-full items-center gap-2">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border bg-muted">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Logo del negocio" className="h-full w-full object-cover" />
        ) : (
          <Building2 className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
          className="h-10 min-w-0 flex-1 text-base font-semibold"
          disabled={uploading}
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

        {/* Only with a logo: with none there is nothing to delete, and a red
            button beside "Subir logo" would read as "cancel the upload". */}
        {previewUrl ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                className="h-10 w-[42px] shrink-0 bg-destructive/20 px-0 hover:bg-destructive/30"
                disabled={uploading}
                aria-label="Eliminar logo"
              >
                <Trash2 className="size-5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar el logo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se quitará al guardar los cambios. Tu negocio quedará con el ícono de Sevenz
                  por defecto en la pantalla de tus clientes hasta que subas uno nuevo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  Eliminar
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
