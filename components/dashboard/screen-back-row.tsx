"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

// LA FILA DE LA FLECHA, pegada arriba y de borde a borde.
//
// Es la cabecera de Notificaciones, Mi negocio, Subir libreta y la ficha de un
// pedido. Desde el 2026-10-18 lo es también de todo el flujo de registrar, a
// petición del dueño: «los headers son diferentes a los del frame, deben ser
// el mismo componente ya aplicado en la pantalla Notificaciones».
//
// ===========================================================================
// ERA LA MISMA FILA ESCRITA A MANO EN CUATRO SITIOS
//
// Las cuatro pantallas de arriba llevaban copiado, carácter a carácter, el
// mismo `sticky top-0 z-20 -mx-4 -mt-4 … border-b … px-4 py-3`. No era un
// descuido de nadie: `app-header.tsx` incluso lo documentaba —«any new screen
// that copies the "-mx-4 -mt-4 … sm:hidden" back-arrow row belongs in this
// list too»— y aun así la quinta copia iba a entrar con el flujo de la venta.
//
// Cuatro copias no se portan distinto hasta el día que alguien toca una. Esa
// es la razón de que esto sea un componente y no una quinta copia.
//
// ===========================================================================
// LOS MÁRGENES NEGATIVOS SON LA PIEZA QUE NO SE PUEDE TOCAR
//
// `AppMain` envuelve toda pantalla en un `p-4`. Para que esta barra llegue a
// los bordes —como una cabecera de verdad y no como una tarjeta más— tiene que
// cancelar ese padding con `-mx-4 -mt-4`, y devolverlo con su propio `px-4`
// para que la flecha quede alineada con el contenido de debajo.
//
// Si algún día `AppMain` deja de poner `p-4`, esto se sale de la pantalla.
export function ScreenBackRow({
  href,
  label,
  onClick,
  // POR DEFECTO SOLO EN EL TELÉFONO, porque en las cuatro pantallas originales
  // esta barra SUSTITUYE a la cabecera de la app, que vuelve a partir de `sm`.
  // Dos cabeceras a la vez es exactamente el fallo que `app-header.tsx` cuenta
  // tres veces: papelera, catálogo y la propia venta.
  //
  // El flujo de registrar la pasa a `false`: allí `app-header.tsx` esconde su
  // barra a TODAS las anchuras —es un flujo de pantalla completa—, así que sin
  // esto la pantalla se quedaría sin ninguna salida en un escritorio.
  soloEnTelefono = true,
  children,
}: {
  href?: string;
  label?: string;
  onClick?: () => void;
  soloEnTelefono?: boolean;
  // El control, cuando no es ni un enlace ni un botón corriente. Lo usan «Mi
  // negocio» y «Subir libreta» con `CarteraBackButton`, que pregunta antes de
  // salir si hay cambios sin guardar.
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 -mt-4 flex items-center border-b bg-background px-4 py-3",
        soloEnTelefono && "sm:hidden",
      )}
    >
      {children ??
        (onClick ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2"
            aria-label={label ?? "Volver"}
            onClick={onClick}
          >
            <IconoVolver className="text-primary" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" asChild className="-ml-2">
            <Link href={href ?? "/dashboard"} aria-label={label ?? "Volver"}>
              <IconoVolver className="text-primary" />
            </Link>
          </Button>
        ))}
    </div>
  );
}
