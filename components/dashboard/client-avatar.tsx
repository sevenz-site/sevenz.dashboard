"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { createClient } from "@/lib/supabase/client";
import { fileToResizedBlob } from "@/lib/image";
import { getPublicClientProfilePictureUrl } from "@/lib/supabase/storage";
import { setClientProfilePicture } from "@/app/(app)/clients/[id]/actions";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";

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

// La foto del cliente, y el panel donde se cambia.
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
  const galeriaRef = useRef<HTMLInputElement>(null);
  const camaraRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setOcupado(true);
    try {
      const blob = await fileToResizedBlob(file);
      // Nombre nuevo en cada subida en vez de reescribir el mismo: el bucket es
      // público y los navegadores cachean con ganas, así que reusar la ruta
      // dejaría al dueño mirando la foto vieja sin entender por qué. La
      // anterior no queda tirada: setClientProfilePicture la borra.
      const path = `${ownerId}/${clientId}-${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("client-profile-pictures")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;

      const guardado = await setClientProfilePicture(clientId, path);
      if (guardado.error) throw new Error(guardado.error);

      toast.success("Foto actualizada");
      setAbierto(false);
      router.refresh();
    } catch (error) {
      const texto = error instanceof Error ? error.message : "No pudimos subir la foto.";
      if (!avisarCuentaPausada(texto)) toast.error(texto);
    } finally {
      setOcupado(false);
      if (galeriaRef.current) galeriaRef.current.value = "";
      if (camaraRef.current) camaraRef.current.value = "";
    }
  }

  async function handleDelete() {
    setOcupado(true);
    try {
      const guardado = await setClientProfilePicture(clientId, null);
      if (guardado.error) throw new Error(guardado.error);
      toast.success("Foto eliminada");
      setAbierto(false);
      router.refresh();
    } catch (error) {
      const texto = error instanceof Error ? error.message : "No pudimos eliminar la foto.";
      if (!avisarCuentaPausada(texto)) toast.error(texto);
    } finally {
      setOcupado(false);
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
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger asChild>
        {/* Un botón de verdad y no un div con onClick: se llega con el teclado,
            se lee en voz alta y dice qué hace, que es más de lo que se ve — el
            círculo por sí solo no parece pulsable. */}
        <button
          type="button"
          disabled={ocupado}
          className="group relative rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          aria-label={foto ? `Cambiar la foto de ${clientName}` : `Agregar una foto de ${clientName}`}
        >
          {avatar}
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {ocupado ? (
              <Loader2 className="size-6 animate-spin text-white" />
            ) : (
              <Camera className="size-6 text-white" />
            )}
          </span>
          {/* En un teléfono no hay hover, así que la cámara vive siempre visible
              en la esquina: sin ella el círculo no se anuncia como pulsable y la
              función queda escondida para quien más la va a usar. */}
          <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted sm:hidden">
            {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          </span>
        </button>
      </SheetTrigger>

      {/* Desde abajo, no desde el lado: es donde llega el pulgar, y este panel
          existe sobre todo para el teléfono. */}
      <SheetContent side="bottom" className="gap-0">
        <SheetHeader>
          <SheetTitle>Foto de {clientName}</SheetTitle>
          <SheetDescription>
            {foto ? "Cambia o elimina la foto del cliente." : "Agrega una foto para reconocerlo de un vistazo."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 p-4">
          {/* Solo en teléfono. En un computador "Tomar foto" y "Subir foto"
              abren exactamente el mismo explorador de archivos, y ofrecer dos
              botones que hacen lo mismo es una decisión falsa. */}
          {isMobile ? (
            <Button
              variant="outline"
              className="h-12 justify-start"
              disabled={ocupado}
              onClick={() => camaraRef.current?.click()}
            >
              <Camera className="size-5" />
              Tomar foto
            </Button>
          ) : null}

          <Button
            variant="outline"
            className="h-12 justify-start"
            disabled={ocupado}
            onClick={() => galeriaRef.current?.click()}
          >
            <ImageIcon className="size-5" />
            Subir foto
          </Button>

          {/* Sin foto no hay nada que eliminar, así que la opción no se dibuja:
              enseñar una acción imposible es peor que no ofrecerla.

              Y sin confirmación, a propósito. Es una foto, no dinero: si se
              borra por error se vuelve a subir en diez segundos. Un "¿seguro?"
              en cada cosa acaba en que nadie los lee, y los que sí importan
              —mover un cliente a la papelera— pierden fuerza. */}
          {foto ? (
            <Button
              variant="outline"
              className="h-12 justify-start text-destructive hover:text-destructive"
              disabled={ocupado}
              onClick={() => void handleDelete()}
            >
              {ocupado ? <Loader2 className="size-5 animate-spin" /> : <Trash2 className="size-5" />}
              Eliminar foto
            </Button>
          ) : null}
        </div>

        {/* Dos inputs y no uno: `capture` le dice al teléfono que abra la cámara
            en vez del carrete, y es un atributo del input, no del clic. Mismo
            patrón que el import de libretas. */}
        <input
          ref={camaraRef}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <input
          ref={galeriaRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </SheetContent>
    </Sheet>
  );
}
