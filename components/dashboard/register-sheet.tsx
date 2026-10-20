"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, Percent, User } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// LAS TRES COSAS QUE EL TENDERO PUEDE REGISTRAR — frame `1389:11227`, encargo
// del dueño del 2026-10-18.
//
// ===========================================================================
// POR QUÉ UNA HOJA Y NO UN BOTÓN QUE LLEVE DIRECTO
//
// Hasta hoy «Agregar» hacía una sola cosa, y la cosa fue cambiando: primero
// abría el diálogo de registrar movimiento, y desde el 2026-10-18 abría el
// asistente de venta. Las dos veces el botón decidía por el tendero cuál de
// sus tres tareas era la importante.
//
// El paso 8 es justo lo que rompe esa suposición: Sevenz deja de ser solo un
// libro de fiados, así que ya no hay una acción por defecto evidente. Un
// tendero que abre la app para anotar un abono y otro que viene de vender son
// el mismo número de tenderos.
//
// ===========================================================================
// LAS FLECHAS SON LAS QUE YA SIGNIFICAN ESO EN ESTA APP
//
// `ArrowUpRight` para lo que el cliente se lleva y `ArrowDownLeft` para lo que
// entra: es exactamente el par que `TipoButtons` usa en el diálogo de
// movimientos (`movement-currency-field.tsx`), y son los mismos glifos que el
// frame pide —`call_made` y `call_received` de Material—. Reutilizarlos no es
// ahorro de trabajo: un tendero que ya aprendió qué flecha es un abono no
// tiene que volver a aprenderlo aquí.
//
// Y NO LLEVAN COLOR, a diferencia de `TipoButtons`. Ahí el verde y el rojo
// distinguen dos opciones de la misma pregunta; aquí las tres filas son tres
// destinos distintos y pintar dos de rojo y verde sugeriría que son dos caras
// de la misma cosa y «Nuevo cliente» otra categoría.
type Opcion = {
  href: string;
  etiqueta: string;
  Icono: typeof User;
  // CÓMO SE NAVEGA, y no es un detalle: un `?nuevo=` es un MARCADOR sobre la
  // misma página y va con `replace`, que es lo que el botón flotante hacía
  // desde hace meses. Con `push` quedaría en el historial, y volver atrás
  // después de cerrar el diálogo lo abriría solo — la mitad del fallo que
  // `ClientSearchDialog` documenta haber arreglado.
  //
  // `/ventas/nueva` es una ruta de verdad y va con `push`: con `replace`
  // borraría la entrada de Inicio, y la flecha del paso 1/4 llama a
  // `router.back()` — sacaría al tendero de la app.
  marcador: boolean;
};

const OPCIONES: Opcion[] = [
  // LA PANTALLA DE ALTA, frame `1389:8313`. Crea un cliente y NADA MÁS —sin
  // monto, sin plazo, sin cuotas— y termina ofreciendo seguir con una venta.
  //
  // Apuntaba a `/dashboard?nuevo=cliente` durante unas horas del 2026-10-18,
  // que abría el diálogo de siempre en su paso de alta. Ese diálogo sigue
  // existiendo y sigue creando cliente + primer fiado de una vez, que es lo
  // que hace falta cuando el tendero ya tiene la deuda delante; lo que ya no
  // hace es ser la única forma de apuntar a una persona.
  { href: "/clients/nuevo", etiqueta: "Nuevo cliente", Icono: User, marcador: false },
  // EL ASISTENTE DE CUATRO PASOS. Un fiado manual es «una venta sin pago»
  // desde la migración `124`, y por eso las dos palabras van en el mismo
  // botón en vez de en dos.
  { href: "/ventas/nueva", etiqueta: "Venta o fiado", Icono: ArrowUpRight, marcador: false },
  // UN ABONO NECESITA SABER DE QUIÉN, así que pasa por el buscador de
  // clientes y el marcador viaja con él: al elegir a alguien se aterriza en su
  // ficha con el diálogo de abono ya abierto.
  //
  // EL ÍCONO ES UN «%» Y NO UNA FLECHA. Decisión del dueño el 2026-10-19, con
  // su mockup al lado. La flecha hacia abajo era la misma familia que la de
  // «Venta o fiado» justo encima —una entra, otra sale—, y dos flechas
  // opuestas en una lista de tres se distinguen mirándolas, no de un vistazo.
  // El porcentaje no se parece a nada más de la hoja.
  { href: "/dashboard?nuevo=abono", etiqueta: "Abono", Icono: Percent, marcador: true },
];

export function RegisterSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  // CONTROLADA DESDE FUERA, sin disparador propio: la abren dos botones que no
  // se parecen en nada —el flotante de la barra en teléfono y el del
  // encabezado en escritorio— y cada uno tiene su propia maquetación, sus
  // guardias y su marcador de tour. Un `SheetTrigger` aquí dentro obligaría a
  // reproducir todo eso dos veces.
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `dvh` y no `vh`: en un teléfono con la barra del navegador a la vista,
          `vh` mide el viewport grande, el que habría si estuviera escondida.
          Es la misma trampa que el diálogo de movimientos ya documenta. */}
      <SheetContent side="bottom" className="max-h-[90dvh] rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-lg font-normal">Selecciona una opción</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 pb-6 pt-2">
          {OPCIONES.map(({ href, etiqueta, Icono, marcador }) => (
            <button
              key={href}
              type="button"
              // SE CIERRA ANTES DE NAVEGAR. Dejarla abierta durante la
              // transición deja la hoja encima de la pantalla nueva mientras
              // carga, y en el caso de «Nuevo cliente» y «Abono» —que navegan
              // a esta misma página con otro marcador— se quedaría abierta
              // ENCIMA del diálogo que acaba de abrir.
              onClick={() => {
                onOpenChange(false);
                if (marcador) router.replace(href);
                else router.push(href);
              }}
              className="flex h-14 w-full items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-left outline-none transition-colors active:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icono className="size-6 shrink-0" aria-hidden="true" />
              <span className="text-base font-semibold">{etiqueta}</span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
