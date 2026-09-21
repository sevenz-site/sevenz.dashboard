"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useImportJobs } from "@/components/import/import-context";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { useTour } from "@/components/dashboard/tour-context";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { PasosImportar } from "@/components/dashboard/pasos-importar";

// "Importar", al lado del título de Cartera.
//
// LO QUE ES Y LO QUE NO ES. Es un lanzador: elige las fotos, las pone a
// procesar y manda a /import, donde ya vive la revisión. NO es una segunda
// copia del flujo. La revisión son 25 líneas editables con moneda, cliente y
// conciliación: montarla dentro de una hoja de teléfono la haría inservible, y
// montarla dos veces daría dos caminos distintos al mismo `confirmImport`, que
// es exactamente como se separan.
//
// Puede hacerlo porque ImportProvider vive en el layout de (app), no en la
// página: el trabajo arranca aquí y sigue vivo al navegar. Por eso el dueño
// llega a /import con las fotos ya leyéndose en vez de esperando a empezar.

export function ImportarCartera() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Primer paso del recorrido de bienvenida. Un solo marcador aunque abajo se
  // escriba dos veces: solo una de las dos ramas está montada a la vez, y
  // `document.querySelector` se quedaría con la primera que encontrara si
  // coexistieran.
  const tour = useTour();

  return isMobile ? (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          data-tour="import-button"
          onClick={() => {
            if (tour.step === 0) tour.advance();
          }}
        >
          Importar
          <Upload className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Importar cartera</SheetTitle>
          {/* asChild: SheetDescription monta un <p>, y un <ol> dentro de un
              <p> es HTML inválido — el navegador cierra el párrafo por su
              cuenta y React se queja en hidratación. Así el <ol> ES la
              descripción, y el diálogo conserva su aria-describedby. */}
          <SheetDescription asChild>
            <PasosImportar />
          </SheetDescription>
        </SheetHeader>
        <Controles onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          data-tour="import-button"
          onClick={() => {
            if (tour.step === 0) tour.advance();
          }}
        >
          Importar
          <Upload className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Importar cartera</h3>
          <PasosImportar />
        </div>
        <Controles onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function Controles({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { usage, startImport } = useImportJobs();
  // La cuenta pausada se comprueba ANTES de la foto, igual que en /import:
  // escanearla gasta cuota de Gemini para nada si el dueño no puede escribir.
  const guardia = useGuardiaDeCuentaPausada();

  const quotaExhausted = usage.plan === "free" && usage.remaining === 0;

  function onFiles(fileList: FileList | null) {
    if (guardia()) return;
    if (!fileList || fileList.length === 0) return;
    startImport(Array.from(fileList));
    onDone();
    // A la pantalla de revisión, que es donde el dueño tiene que estar cuando
    // la lectura termine.
    router.push("/import");
  }

  if (quotaExhausted) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/50 py-6 text-center">
        <TriangleAlert className="size-5 text-destructive" />
        <p className="text-sm font-medium">Alcanzaste el límite de {usage.limit} fotos este mes</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Escríbenos para pasar a Pro y seguir importando sin límites.
        </p>
      </div>
    );
  }

  return (
    // `overflow-y-auto` y `[&>*]:shrink-0`, las dos cosas y por motivos
    // distintos. Sin el scroll, en una pantalla baja —un teléfono apaisado, o
    // uno pequeño con el teclado del sistema encima— el contenido medía 368px
    // dentro de una caja de 269 y "Tomar foto" caía 54px por debajo del borde,
    // sin manera de alcanzarlo. Sin el `shrink-0`, la alternativa es igual de
    // mala: flex encoge los hijos para que quepan y la zona de soltar la foto
    // se aplasta hasta dejar de parecer un sitio donde tocar.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 [&>*]:shrink-0 sm:px-0 sm:pb-0">
      {/* Dos inputs y no uno con interruptor, por lo mismo que en /import: la
          diferencia es el atributo `capture` y no se puede cambiar por clic sin
          volver a montar el input, lo que se come el toque. */}
      <label
        htmlFor="importar-cartera-fotos"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground hover:bg-accent/50"
      >
        <Upload className="size-6" />
        {`Toca para elegir fotos (hasta ${MAX_IMPORT_PHOTOS})`}
      </label>
      <input
        id="importar-cartera-fotos"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Solo en teléfono: un navegador de escritorio ignora `capture` y
          abriría el mismo diálogo de archivos que el control de arriba, lo que
          se lee como un fallo. */}
      <Button asChild variant="outline" className="sm:hidden">
        <label htmlFor="importar-cartera-camara" className="cursor-pointer">
          <Camera className="size-4" />
          Tomar foto
        </label>
      </Button>
      <input
        id="importar-cartera-camara"
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {usage.plan === "free" && usage.limit !== null ? (
        <p className="text-xs text-muted-foreground">
          Plan Free · {usage.used}/{usage.limit} fotos usadas este mes.
        </p>
      ) : usage.plan === "pro" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          Plan Pro · fotos ilimitadas
        </p>
      ) : null}
    </div>
  );
}
