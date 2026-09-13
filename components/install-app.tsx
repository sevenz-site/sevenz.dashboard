"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Share, X } from "lucide-react";
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
  esSamsungInternet,
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
  const samsung = useSyncExternalStore(suscribirseANada, esSamsungInternet, () => false);
  const [sinChrome, setSinChrome] = useState(false);

  // Abrir Chrome desde otro navegador se pide con un enlace `intent://`, que es
  // como Android deja que una página llame a una app concreta.
  //
  // Lo incómodo es que no avisa si falla: si Chrome no está instalado, no pasa
  // nada y el tendero se queda mirando un botón muerto. Así que se mide al
  // revés — si Chrome se abre, ESTA página pasa a segundo plano; si al segundo
  // y medio seguimos visibles, es que no se abrió nada.
  //
  // Un falso positivo aquí no se ve: si Chrome SÍ abrió, el dueño ya no está
  // mirando esta pantalla cuando aparece el mensaje.
  function abrirEnChrome() {
    const destino = `${window.location.host}${window.location.pathname}`;
    let cambio = false;
    const alOcultarse = () => {
      cambio = true;
    };
    document.addEventListener("visibilitychange", alOcultarse, { once: true });
    window.location.href = `intent://${destino}#Intent;scheme=https;package=com.android.chrome;end`;
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", alOcultarse);
      if (!cambio && document.visibilityState === "visible") setSinChrome(true);
    }, 1500);
  }

  // Sin rama para Samsung: ahí no se dan pasos, se da un botón que abre Chrome.
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
          <DialogTitle>
            {samsung ? "Instálala desde Chrome" : "Instala Sevenz en tu teléfono"}
          </DialogTitle>
          <DialogDescription>
            {samsung
              ? "Este navegador no logra instalarla en las versiones nuevas de Android: muestra una alerta de seguridad que no tiene que ver con Sevenz. Desde Chrome funciona."
              : "Queda con su ícono en tu pantalla de inicio y abre sin la barra del navegador. Es la misma Sevenz de siempre, con tus mismos datos."}
          </DialogDescription>
        </DialogHeader>

        {samsung ? (
          <div className="flex flex-col gap-3">
            {sinChrome ? (
              /* Sin Chrome no se manda a nadie a la tienda a descargar un
                 navegador entero solo para poner un icono. Lo que importa
                 decirle es que no está bloqueado: Sevenz funciona completa
                 desde cualquier navegador, y lo único que se pierde es el
                 acceso directo. */
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium">No encontramos Chrome en este teléfono</p>
                <p className="mt-0.5 text-muted-foreground">
                  Puedes seguir usando Sevenz desde aquí sin ningún problema. Lo único que no
                  podrás es dejar el ícono en tu pantalla de inicio.
                </p>
              </div>
            ) : (
              <>
                <Button onClick={abrirEnChrome}>Abrir en Chrome</Button>
                <p className="text-sm text-muted-foreground">
                  Vas a tener que entrar a tu cuenta otra vez: cada navegador guarda su propia
                  sesión. Tus datos no se mueven de sitio.
                </p>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Si prefieres, también funciona con Brave, Edge u Opera. El único que no logra
              instalarla es este.
            </p>
          </div>
        ) : (
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
        )}

        <p className="text-xs text-muted-foreground">
          {samsung
            ? "Si te apareció un aviso de Google diciendo que la app no es segura, fue este navegador al empaquetarla, no Sevenz. Desde Chrome no aparece."
            : "No ocupa casi espacio y no reemplaza nada: puedes seguir entrando desde el navegador cuando quieras."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

// La tira que invita a instalar, arriba de Cartera.
//
// Solo en teléfono, y se queda hasta que la app esté instalada. La ✕ la calla
// en esta visita; en la siguiente vuelve.
//
// Nació con dos descartes y se acabó, y se cambió a petición. El argumento que
// ganó: este aviso existe porque nadie sabía que Sevenz se podía instalar, y
// uno que se rinde a la segunda no arregla eso. Insistir tiene un precio, pero
// aquí hay una salida real y a un toque — instalarla lo apaga para siempre,
// que es exactamente lo que queremos que pase.
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
      {/* Tarjeta oscura fija en los dos temas, no derivada de los tokens.
          Es deliberado: esto no es una superficie más de la pantalla, es lo
          único que la interrumpe, y en modo oscuro una tarjeta "invertida" se
          volvería blanca y gritaría más de lo que toca.

          El #272727 no es un color elegido al azar: es el fondo del propio
          icon.svg. Por eso el icono se apoya sin recorte ni marco — su cuadrado
          se funde con la tarjeta y solo queda la S.

          Medido: naranja sobre este fondo da 5.0:1 y el gris 5.7:1, los dos por
          encima del 4.5:1 que pide AA. El blanco del título, 14.9:1. */}
      <div className="relative flex items-center gap-4 rounded-2xl bg-[#272727] p-4 pr-12">
        <Image
          src="/icon.svg"
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg leading-tight font-semibold text-white">
            Instala Sevenz en tu teléfono
          </p>
          <p className="text-sm leading-snug text-[#a3a3a3]">
            Ábrela desde tu pantalla de inicio, como cualquier otra app.
          </p>
          {/* El naranja de la marca, el mismo del icono. El design system dice
              no inventar un color de acento y esto no lo inventa: lo toma del
              único sitio donde Sevenz ya tenía uno.

              Alto de 36px con margen negativo: se ve como un enlace pegado al
              texto, pero el área que se toca es la de un botón. En un teléfono
              la diferencia entre las dos cosas es fallar el toque o no. */}
          <Button
            variant="link"
            className="-mx-2 mt-1 h-9 self-start px-2 text-lg font-medium text-[#f66b02] hover:text-[#f66b02]/80"
            onClick={() => {
              if (estado === "un-toque") {
                void handleInstalar();
                return;
              }
              setPasos(true);
              track("Install Prompt Accepted", { method: "steps" });
            }}
          >
            {estado === "un-toque" ? "Instalar" : "Ver cómo"}
          </Button>
        </div>
        <button
          type="button"
          onClick={handleCerrar}
          aria-label="Cerrar el aviso de instalación"
          className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-md text-white/70 transition-colors hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/40 focus-visible:outline-none"
        >
          <X className="size-5" />
        </button>
      </div>
      <InstallAppDialog open={pasos} onOpenChange={setPasos} />
    </>
  );
}
