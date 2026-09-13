"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { track } from "@/lib/mixpanel";
import {
  capturarEventoDeInstalacion,
  descartar,
  esIphone,
  estadoDelAviso,
  estadoEnElServidor,
  instalar,
  suscribirse,
  suscribirseANada,
} from "@/lib/install-prompt";

// Se monta en el layout, no en la pantalla que muestra el aviso: Chrome dispara
// su evento una sola vez y temprano, y si nadie lo guarda en ese momento se
// pierde la instalación de un toque.
export function InstallAppCapture() {
  useEffect(() => {
    capturarEventoDeInstalacion();
  }, []);
  return null;
}

// Los pasos, para cuando no hay botón que lo haga solo. En iPhone es el único
// camino: Apple no deja que una web ofrezca instalarse, así que por mucho que
// mejoremos esto, siempre serán tres toques que alguien tiene que enseñar.
export function InstallAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Sin efecto: el sistema operativo no cambia a mitad de sesión, y leerlo con
  // useSyncExternalStore mantiene servidor y cliente de acuerdo durante la
  // hidratación sin escribir estado desde un efecto.
  const iphone = useSyncExternalStore(suscribirseANada, esIphone, () => false);

  const pasos = iphone
    ? [
        <>
          Toca el botón de compartir <Share className="inline size-4 align-text-bottom" aria-hidden="true" />
          , abajo en la barra de Safari.
        </>,
        <>Baja en la lista y elige &ldquo;Añadir a pantalla de inicio&rdquo;.</>,
        <>Toca &ldquo;Añadir&rdquo;, arriba a la derecha.</>,
      ]
    : [
        <>Abre el menú de Chrome: los tres puntos, arriba a la derecha.</>,
        <>Elige &ldquo;Instalar aplicación&rdquo; o &ldquo;Agregar a pantalla de inicio&rdquo;.</>,
        <>Confirma.</>,
      ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instala Sevenz en tu teléfono</DialogTitle>
          <DialogDescription>
            Queda con su ícono en tu pantalla de inicio y abre sin la barra del navegador. Es la
            misma Sevenz de siempre, con tus mismos datos.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-3 text-sm">
          {pasos.map((paso, i) => (
            <li key={i} className="flex gap-3">
              {/* El número sale del peso y del fondo, no de un color de acento:
                  este producto no tiene paleta de marca a propósito. */}
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium tabular-nums">
                {i + 1}
              </span>
              <span className="pt-0.5">{paso}</span>
            </li>
          ))}
        </ol>

        <p className="text-xs text-muted-foreground">
          No ocupa casi espacio y no reemplaza nada: puedes seguir entrando desde el navegador
          cuando quieras.
        </p>
      </DialogContent>
    </Dialog>
  );
}

// La tira que invita a instalar, arriba de Cartera.
//
// Solo en teléfono, solo si no está instalada ya, y solo si toca ofrecerlo —
// dos descartes y no vuelve. Se decidió así porque el aviso compite con lo que
// el tendero vino a hacer: una app que se abre todos los días no puede pedir lo
// mismo todos los días.
export function InstallAppBanner() {
  const isMobile = useIsMobile();
  // Todo lo que decide si esto se ve vive en el navegador —si ya está
  // instalada, lo que se guardó al descartar, si Chrome nos dejó el botón—, y
  // el servidor no ve nada de eso. useSyncExternalStore lo resuelve sin
  // escribir estado desde un efecto: en el servidor y durante la hidratación
  // vale "oculto", así que la tira no existe y no hay nada que discrepar.
  const estado = useSyncExternalStore(suscribirse, estadoDelAviso, estadoEnElServidor);
  const [pasos, setPasos] = useState(false);

  if (!isMobile || estado === "oculto") return null;

  async function handleInstalar() {
    track("Install Prompt Accepted", { method: "prompt" });
    // Si acepta, `appinstalled` recalcula el estado y la tira se va sola. Si
    // cancela, se queda: no la ha rechazado, solo no ahora.
    await instalar();
  }

  function handleCerrar() {
    // descartar() avisa a los suscriptores, así que el estado pasa a "oculto"
    // por el mismo camino que todo lo demás.
    descartar();
    track("Install Prompt Dismissed");
  }

  return (
    <>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Instala Sevenz en tu teléfono</p>
            <p className="text-xs text-muted-foreground">
              Ábrela desde tu pantalla de inicio, como cualquier otra app.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {estado === "un-toque" ? (
              <Button size="sm" onClick={() => void handleInstalar()}>
                Instalar
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setPasos(true);
                  track("Install Prompt Accepted", { method: "steps" });
                }}
              >
                Ver cómo
              </Button>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          onClick={handleCerrar}
          aria-label="Cerrar el aviso de instalación"
        >
          <X className="size-4" />
        </Button>
      </div>
      <InstallAppDialog open={pasos} onOpenChange={setPasos} />
    </>
  );
}
