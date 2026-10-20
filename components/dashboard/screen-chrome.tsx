import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// LAS DOS PIEZAS QUE TODA PANTALLA CON TÍTULO REPITE: su flecha de volver y su
// título. Viven juntas aquí porque el problema de las dos es el mismo.
//
// ===========================================================================
// POR QUÉ UN COMPONENTE PARA UN `<h1>` Y UN ICONO
//
// El dueño lo reportó el 2026-10-20 con dos capturas: *«el estilo del texto
// "Notificaciones" es el estilo que deben tener todos los títulos de las
// pantallas donde hay títulos [...] verifica y ajústalo porque los veo
// distintos»*, y *«el ícono back del componente Header debe ser la flecha con
// la raya, no el chevron»*.
//
// Las dos cosas habían derivado por la misma vía: se elegían a mano en cada
// pantalla. Al contarlas había NUEVE títulos en `font-normal` contra cinco en
// `font-semibold tracking-tight`, y DIEZ sitios eligiendo entre `ChevronLeft`
// y `ArrowLeft` sin que nadie hubiera decidido nada.
//
// No es descuido de quien escribe una pantalla: no hay ningún sitio al que
// mirar. Lo mismo que ya había pasado con la fila de la flecha --cuatro copias
// del mismo `sticky top-0 -mx-4` antes de que `ScreenBackRow` existiera-- y
// con `COP` faltando en el mapa de banderas. Una decisión que se repite a mano
// no se mantiene; se reescribe distinta la quinta vez.

// LA FLECHA DE VOLVER. Con raya, no chevron.
//
// Es la misma que ya llevaban las cabeceras OSCURAS --catálogo, la ficha del
// cliente, el carrito-- y la que el dueño señaló como la correcta. Un chevron
// es un «hay más por aquí» (lo lleva cada fila de lista de esta app); una
// flecha con raya es «vuelve». Que la misma pantalla usara una para navegar
// adentro y la otra para salir era lo que hacía que las dos se leyeran igual.
//
// `size-6` iguala a las oscuras. El color lo pone quien la monta:
//
//   · sobre cabecera oscura   `text-white`
//   · sobre fondo claro       `text-primary` --que es `#272727` en claro y se
//                             INVIERTE a casi blanco en oscuro, así que no hay
//                             que escribir ninguna variante--
export function IconoVolver({ className }: { className?: string }) {
  return <ArrowLeft className={cn("size-6", className)} aria-hidden="true" />;
}

// EL TÍTULO DE UNA PANTALLA.
//
// `text-2xl font-semibold tracking-tight`, copiado de «Notificaciones», que es
// el que el dueño señaló como bueno. `tracking-tight` no es decorativo: a 24px
// el espaciado por defecto de Geist separa demasiado y el título se lee como
// dos palabras sueltas en vez de como un rótulo.
//
// NO VALE PARA UN TÍTULO SOBRE CABECERA OSCURA --`ScreenHeader`,
// `PublicHeader`, la ficha del cliente--, que son otra cosa: allí el título va
// centrado, en blanco y compitiendo con los controles de su propia barra.
// Tampoco para los rótulos centrados de las pantallas de «listo», que son un
// mensaje y no el nombre de una pantalla.
export function ScreenTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight", className)}>{children}</h1>;
}
