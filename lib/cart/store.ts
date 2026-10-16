"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  agregarLinea,
  cambiarCantidad,
  quitarLinea,
  type LineaCarrito,
} from "@/lib/cart/cart";

// DONDE VIVE EL CARRITO MIENTRAS EL CLIENTE COMPRA.
//
// ===========================================================================
// `useSyncExternalStore` Y NO UN `useEffect`, Y NO ES PREFERENCIA DE ESTILO
//
// El patron obvio seria `useState([])` mas un `useEffect` que lea
// `localStorage` al montar. Dos razones para no hacerlo, y la segunda es dura:
//
//   1. Ese patron pinta el carrito vacio y lo corrige un instante despues.
//      En un telefono se ve el parpadeo.
//   2. `react-hooks/set-state-in-effect` lo RECHAZA, y con razon: llamar a
//      setState dentro de un efecto encadena renders. Es la misma regla que
//      hoy tiene en rojo a `components/public/feedback-banner.tsx`.
//
// `useSyncExternalStore` esta hecho exactamente para esto: lee de una fuente
// que no es React —aqui `localStorage`— con una instantanea distinta para el
// servidor. Sin efecto, sin parpadeo y sin pelearse con el lint.
//
// ===========================================================================
// LA CLAVE LLEVA EL TOKEN DENTRO
//
// Todas las bodegas comparten dominio, y `localStorage` es por dominio. Sin el
// token en la clave, abrir el catalogo de dos negocios dejaria UN carrito
// mezclado con productos de los dos — y el segundo rechazaria la mitad de las
// lineas al pedir, porque la funcion valida que cada producto sea del dueno
// del enlace.
//
// ===========================================================================
// SI EL NAVEGADOR DICE QUE NO, EL CARRITO ESTA VACIO
//
// Modo privado, cookies bloqueadas, almacenamiento lleno: cada lectura y cada
// escritura van en `try`. Un carrito que no se puede guardar es un carrito
// vacio, no una pagina rota. Y eso es aceptable porque el carrito ANTES de
// enviarse no importa: lo que importa es la orden, y esa la guarda el
// servidor. Ver la cabecera de `lib/cart/cart.ts`.

const PREFIJO = "sevenz:carrito:";

function claveDe(token: string): string {
  return `${PREFIJO}${token}`;
}

// LA INSTANTANEA TIENE QUE SER ESTABLE o React vuelve a renderizar sin parar:
// `getSnapshot` se llama en cada render y si devuelve un array nuevo cada vez,
// React cree que el estado cambio siempre. Se cachea por la CADENA cruda, que
// es lo unico que de verdad dice si algo cambio.
let cache: { clave: string; crudo: string; valor: LineaCarrito[] } | null = null;
const VACIO: LineaCarrito[] = [];

function leer(token: string): LineaCarrito[] {
  const clave = claveDe(token);
  let crudo: string | null = null;
  try {
    crudo = window.localStorage.getItem(clave);
  } catch {
    return VACIO;
  }
  if (crudo == null) return VACIO;
  if (cache && cache.clave === clave && cache.crudo === crudo) return cache.valor;

  let valor: LineaCarrito[] = VACIO;
  try {
    const parseado = JSON.parse(crudo);
    // SE VALIDA LO QUE SE LEE. `localStorage` lo puede editar cualquiera desde
    // la consola, y una linea sin `productId` reventaria la pantalla del
    // carrito. Tambien pasa solo: una version anterior del formato.
    if (Array.isArray(parseado)) {
      valor = parseado.filter(
        (l) =>
          l != null &&
          typeof l.productId === "string" &&
          typeof l.quantity === "number" &&
          l.quantity > 0 &&
          typeof l.currency === "string",
      );
    }
  } catch {
    valor = VACIO;
  }
  cache = { clave, crudo, valor };
  return valor;
}

function escribir(token: string, lineas: LineaCarrito[]): void {
  try {
    if (lineas.length === 0) window.localStorage.removeItem(claveDe(token));
    else window.localStorage.setItem(claveDe(token), JSON.stringify(lineas));
  } catch {
    // Sin sitio o sin permiso. El carrito se queda como estaba en pantalla y
    // se pierde al recargar, que es mejor que una pagina que no responde.
  }
  avisar();
}

// Un solo canal para todos los que miran el carrito: la pildora flotante, la
// pantalla del carrito y el boton del detalle. `storage` cubre ademas otra
// pestana del mismo navegador.
const oyentes = new Set<() => void>();
function avisar() {
  for (const o of oyentes) o();
}

function suscribir(cb: () => void): () => void {
  oyentes.add(cb);
  const deOtraPestana = () => {
    cache = null;
    cb();
  };
  window.addEventListener("storage", deOtraPestana);
  return () => {
    oyentes.delete(cb);
    window.removeEventListener("storage", deOtraPestana);
  };
}

export function useCarrito(token: string) {
  const lineas = useSyncExternalStore(
    suscribir,
    () => leer(token),
    // EN EL SERVIDOR EL CARRITO ESTA VACIO, y tiene que estarlo: el HTML que
    // se manda es igual para todos, y pintar ahi un carrito que solo existe en
    // un telefono haria que el primer render del cliente no coincidiera.
    () => VACIO,
  );

  const agregar = useCallback(
    (linea: LineaCarrito) => escribir(token, agregarLinea(leer(token), linea)),
    [token],
  );
  const cambiar = useCallback(
    (productId: string, quantity: number) =>
      escribir(token, cambiarCantidad(leer(token), productId, quantity)),
    [token],
  );
  const quitar = useCallback(
    (productId: string) => escribir(token, quitarLinea(leer(token), productId)),
    [token],
  );
  const vaciar = useCallback(() => escribir(token, []), [token]);

  return { lineas, agregar, cambiar, quitar, vaciar };
}
