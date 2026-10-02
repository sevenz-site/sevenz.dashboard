"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useImportJobs } from "@/components/import/import-context";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { useTour } from "@/components/dashboard/tour-context";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { cn } from "@/lib/utils";
import { PasosImportar } from "@/components/dashboard/pasos-importar";
import { AvisoDeBorrador } from "@/components/import/aviso-de-borrador";
import { cargarRevision, olvidarRevision } from "@/lib/revision-guardada";

// "Subir libreta", al lado del título de Por cobrar en Inicio.
//
// El archivo y el componente siguen llamándose `importar-cartera`. La función
// se renombró de cara al dueño el 2026-09-28; el nombre interno no, porque
// CLAUDE.md dice que los nombres existentes no se renombran y convertir un
// cambio de textos en un refactor de imports es cómo se cuelan los errores.
// Está anotado como pendiente aparte, y cuando se haga irá en inglés.
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

export function ImportarCartera({
  variant = "outline",
}: {
  // "outline" en Inicio, donde subir la libreta es una de las dos acciones de la
  // sección y compite con "Agregar movimiento".
  //
  // "responsive" en las cabeceras de Clientes, Malas pagas y Papelera: sin
  // recuadro en teléfono, donde es una salida secundaria y un recuadro pesaría
  // más que el título de al lado; CON recuadro de `sm:` en adelante, que es la
  // versión web y ahí sí lo lleva en todas partes.
  variant?: "outline" | "responsive";
} = {}) {
  // El recuadro se pone con clases y no cambiando `variant` según
  // `useIsMobile()`, aunque este componente ya use ese hook para elegir entre
  // hoja y popover. El hook resuelve DESPUÉS de hidratar: el botón se pintaría
  // sin recuadro y se lo pondría un instante más tarde, a la vista. Con CSS ya
  // está resuelto en el primer fotograma. Es la regla de DESIGN-SYSTEM.md.
  //
  // `border-transparent` ya viene en la base del botón, así que añadir el color
  // del borde no mueve nada de sitio: no hay salto de layout al cruzar 640px.
  const claseBoton = cn(
    "shrink-0",
    variant === "responsive" &&
      "sm:border-border sm:bg-background sm:dark:border-input sm:dark:bg-input/30",
  );
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
          variant={variant === "responsive" ? "ghost" : "outline"}
          size="sm"
          className={claseBoton}
          data-tour="import-button"
          onClick={() => {
            if (tour.step === 0) tour.advance();
          }}
        >
          Subir libreta
          <Upload className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Subir libreta</SheetTitle>
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
          variant={variant === "responsive" ? "ghost" : "outline"}
          size="sm"
          className={claseBoton}
          data-tour="import-button"
          onClick={() => {
            if (tour.step === 0) tour.advance();
          }}
        >
          Subir libreta
          <Upload className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Subir libreta</h3>
          <PasosImportar />
        </div>
        <Controles onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function Controles({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { startImport } = useImportJobs();
  // EL AVISO DE LA REVISIÓN A MEDIAS TAMBIÉN AQUÍ. Vivía solo en `/import`, así
  // que desde Inicio se podía arrancar una libreta nueva sin ninguna señal de
  // que había otra sin terminar — y la nueva pisa el borrador de la vieja.
  // Reportado el 2026-10-02.
  //
  // Se lee una vez al montar, igual que en `/import`: una hoja que se abre y se
  // cierra vuelve a montar esto, así que no hace falta refrescarlo en vivo.
  const borrador = useMemo(() => cargarRevision(), []);
  const [descartado, setDescartado] = useState(false);
  // La cuenta pausada se comprueba ANTES de la foto, igual que en /import:
  // escanearla gasta cuota de Gemini para nada si el dueño no puede escribir.
  const guardia = useGuardiaDeCuentaPausada();


  function onFiles(fileList: FileList | null) {
    if (guardia()) return;
    if (!fileList || fileList.length === 0) return;
    startImport(Array.from(fileList));
    onDone();
    // A la pantalla de revisión, que es donde el dueño tiene que estar cuando
    // la lectura termine.
    router.push("/import");
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
      {/* Arriba del todo: subir una foto nueva es justo lo que pisa el borrador,
          así que el aviso tiene que leerse ANTES de llegar a la zona de soltar. */}
      {borrador && !descartado ? (
        <AvisoDeBorrador
          borrador={borrador}
          // Lleva a la revisión, donde el mismo aviso ofrece retomarla con todo
          // su contexto delante: cuántos clientes salieron y qué falta.
          onSeguir={() => {
            onDone();
            router.push("/import");
          }}
          onDescartar={() => {
            olvidarRevision();
            setDescartado(true);
          }}
        />
      ) : null}

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

      {/* Ya no hay tope en ningún plan, así que no se nombra el plan: decirle
          "Plan Free" a quien tiene las mismas fotos que cualquiera solo invita a
          preguntarse qué se está perdiendo. */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        Fotos ilimitadas
      </p>
    </div>
  );
}
