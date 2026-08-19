"use client";

import { useRef, useState } from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fileToResizedBlob } from "@/lib/image";

export function AttachmentUploader({
  ownerId,
  value,
  onChange,
}: {
  ownerId: string;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
      const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("attachments").upload(path, blob, {
        contentType: "image/jpeg",
      });
      if (error) throw error;
      onChange(path);
      setFileName(file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir la foto.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="flex items-center gap-2 truncate text-muted-foreground">
          <Paperclip className="size-4 shrink-0" />
          <span className="truncate">{fileName ?? "Foto adjunta"}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={() => {
            onChange(null);
            setFileName(null);
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
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
        className="w-full justify-start text-muted-foreground"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Subiendo...
          </>
        ) : (
          <>
            <Paperclip className="size-4" /> Adjuntar foto (recibo, factura, cédula...)
          </>
        )}
      </Button>
    </>
  );
}
