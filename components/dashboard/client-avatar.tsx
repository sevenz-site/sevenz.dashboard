"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { fileToResizedBlob } from "@/lib/image";
import { getPublicClientProfilePictureUrl } from "@/lib/supabase/storage";
import { setClientProfilePicture } from "@/app/(app)/clients/[id]/actions";

// Las iniciales que se ven mientras no hay foto. Dos como mucho: "María
// Delgado" da MD, "Juanito" da J. Se parte por espacios y se descartan los
// trozos vacíos, porque un nombre tecleado con dos espacios seguidos daría una
// inicial en blanco.
function initials(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return partes
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

// La foto del cliente, y el sitio donde se cambia.
//
// El campo y el bucket existen desde la 032, pero quien subía la foto era el
// propio cliente desde el enlace público, y la 041 cerró esa página: un enlace
// compartido viaja por chats reenviados, así que su audiencia real es mucho
// más ancha que la persona a la que se mandó. Desde entonces el campo existía y
// nada lo llenaba. Ahora la sube el dueño, que es quien tiene al cliente
// delante y una sesión con la que comprobar de quién es.
//
// La subida va del navegador directo al bucket, igual que la foto de un
// movimiento: fileToResizedBlob la vuelve a dibujar en un canvas antes de
// enviarla, lo que de paso la achica, la convierte a JPEG y le quita los datos
// de ubicación que traen las fotos de un teléfono.
export function ClientAvatar({
  clientId,
  clientName,
  ownerId,
  picturePath,
  editable = true,
}: {
  clientId: string;
  clientName: string;
  ownerId: string;
  picturePath: string | null;
  // Un cliente en la papelera no acepta cambios; ofrecer un botón que siempre
  // falla es peor que no ofrecerlo.
  editable?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setSubiendo(true);
    try {
      const blob = await fileToResizedBlob(file);
      // Nombre nuevo en cada subida en vez de reescribir el mismo: el bucket es
      // público y los navegadores cachean con ganas, así que reusar la ruta
      // dejaría al dueño mirando la foto vieja sin entender por qué.
      const path = `${ownerId}/${clientId}-${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("client-profile-pictures")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;

      const guardado = await setClientProfilePicture(clientId, path);
      if (guardado.error) throw new Error(guardado.error);

      toast.success("Foto actualizada");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir la foto.");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const foto = picturePath ? getPublicClientProfilePictureUrl(picturePath) : null;

  const avatar = (
    <Avatar className="size-28">
      {foto ? <AvatarImage src={foto} alt={clientName} /> : null}
      <AvatarFallback className="text-3xl font-semibold text-muted-foreground">
        {initials(clientName)}
      </AvatarFallback>
    </Avatar>
  );

  if (!editable) return avatar;

  return (
    <div className="relative">
      {/* Un botón de verdad y no un div con onClick: se llega con el teclado,
          se lee en voz alta y dice qué hace, que es más de lo que se ve — el
          círculo por sí solo no parece pulsable. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        className="group relative rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={foto ? `Cambiar la foto de ${clientName}` : `Agregar una foto de ${clientName}`}
      >
        {avatar}
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {subiendo ? (
            <Loader2 className="size-6 animate-spin text-white" />
          ) : (
            <Camera className="size-6 text-white" />
          )}
        </span>
        {/* En un teléfono no hay hover, así que la cámara vive siempre visible
            en la esquina: sin ella el círculo no se anuncia como pulsable y la
            función queda escondida para quien más la va a usar. */}
        <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted sm:hidden">
          {subiendo ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
