"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// DÓNDE SE GUARDA EL CAMINO DE VUELTA AL SALDO.
//
// Exportado porque lo escribe la franja de `/s/[token]` y lo lee este
// componente, y dos literales iguales en dos archivos son la forma exacta de
// que un día dejen de serlo.
export const CLAVE_VOLVER_AL_SALDO = "sevenz:volver-al-saldo";

// EL TOKEN DEL SALDO, SI LO HAY. Sacado a un hook el 2026-10-17 porque ya son
// DOS sitios los que preguntan lo mismo: esta flecha y el botón «Ver saldo
// pendiente» del comprobante. Dos lecturas del mismo almacén con dos claves
// escritas a mano es como una de las dos deja de encontrar nada.
export function useTokenDelSaldo(): string | null {
  // El valor se lee del almacén en cada render del cliente y es `null` en el
  // servidor, así que no hay desajuste de hidratación ni un segundo render en
  // cascada. La suscripción no hace nada a propósito: esto se escribe una
  // sola vez, en otra página, antes de que estos componentes existan.
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem(CLAVE_VOLVER_AL_SALDO);
      } catch {
        // Modo privado, almacén bloqueado, o un navegador que dice que no.
        return null;
      }
    },
    () => null,
  );
}

// LA FLECHA PARA VOLVER AL SALDO, y solo para quien vino de ahí.
//
// Pedida por el dueño el 2026-10-17, el mismo día que el catálogo empezó a
// abrirse desde `/s/[token]`. Antes de eso nadie llegaba a esta pantalla
// desde otra de Sevenz: se entraba por un enlace de un mensaje, y por eso la
// única flecha que existía era la de la vista previa del tendero.
//
// ===========================================================================
// POR QUÉ `sessionStorage` Y NO LA URL, Y POR QUÉ TAMPOCO `history.back()`
//
// Las dos alternativas se intentaron antes que ésta, y las dos fallan:
//
// 1. `?desde=<token del cliente>` daría el destino exacto, y está DESCARTADO
//    por dinero. Ese token abre el SALDO de esa persona: cuánto debe y su
//    historial entero. El catálogo es justo la pantalla que un cliente SÍ
//    querría reenviar —«mira lo que vende este»—, así que quien la reenviara
//    estaría regalando su propia deuda sin saberlo. Es el mismo razonamiento
//    que ya está escrito en `/s/[token]` para la cédula y para los datos de
//    pago del tendero.
//
// 2. `?desde=saldo` MÁS `router.back()` fue la primera versión, y el dueño
//    encontró su fallo el mismo día usándola: después de
//    `/s/` → catálogo → producto → carrito → «Regresar al catálogo» la flecha
//    desaparecía, porque ninguno de los siete enlaces internos del catálogo
//    propagaba el marcador. Y aunque lo propagaran, `back()` habría llevado
//    AL CARRITO, no al saldo. Una flecha que vuelve a un sitio que no es el
//    de antes es peor que ninguna flecha.
//
// Así que el token se guarda en `sessionStorage` cuando el cliente sale de su
// saldo, y de ahí sale el `href`. No viaja en ninguna URL, es por pestaña, se
// muere con ella, y sobrevive al paseo entero por el catálogo sin que ningún
// enlace tenga que acordarse de nada.
//
// LO QUE ESTO LE PIDE AL NAVEGADOR, dicho por delante porque `CLAUDE.md` lo
// exige: si el almacén está bloqueado, no hay flecha. Es degradación limpia,
// no pantalla rota. Y no añade una dependencia nueva — **el carrito de este
// mismo catálogo ya vive en `localStorage`** (`useCarrito`), así que un
// navegador que no deje guardar nada ya no podía usar esta pantalla.
export function BackToBalance() {
  const token = useTokenDelSaldo();

  if (!token) return null;

  return (
    <Link
      href={`/s/${token}`}
      aria-label="Volver a tu saldo"
      className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <ArrowLeft className="size-5" aria-hidden="true" />
    </Link>
  );
}
