"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// LA FLECHA PARA VOLVER AL SALDO, y solo para quien vino de ahí.
//
// Pedida por el dueño el 2026-10-17, el mismo día que el catálogo empezó a
// abrirse desde `/s/[token]`. Antes de eso nadie llegaba a esta pantalla
// desde otra de Sevenz: se entraba por un enlace de un mensaje, y por eso la
// única flecha que existía era la de la vista previa del tendero.
//
// ===========================================================================
// POR QUÉ EL MARCADOR NO LLEVA EL TOKEN DEL CLIENTE
//
// Lo obvio era `?desde=<token del cliente>`, que daría un `href` exacto. Se
// descartó, y la razón es de dinero, no de estilo.
//
// El token de `/s/` abre el SALDO de esa persona: cuánto debe y su historial
// entero. Metiéndolo en la URL del catálogo, la barra de direcciones de una
// pantalla de escaparate pasa a contenerlo — y el catálogo es justo la
// pantalla que un cliente SÍ querría reenviar («mira lo que vende este»).
// Quien lo reenviara estaría regalando su propia deuda sin saberlo.
//
// Es el mismo razonamiento que ya está escrito en `/s/[token]` para la cédula
// y para los datos de pago del tendero: un enlace compartido viaja por grupos
// y reenvíos, así que su público real es más ancho que la persona a la que se
// le mandó.
//
// Así que el marcador es una palabra sin información —`?desde=saldo`— y la
// vuelta la hace el historial del navegador, que ya sabe de dónde se viene y
// no se lo cuenta a nadie.
//
// LO QUE ESTO CUESTA, dicho entero: si el cliente navega más adentro y vuelve
// aquí, el marcador sigue en la URL pero `back()` lo lleva a la pantalla
// anterior, que ya no es su saldo. La flecha hace siempre algo razonable
// —vuelve— pero no siempre al saldo. La alternativa exacta era el token en la
// URL, y no compensa.
export function BackToBalance() {
  const router = useRouter();

  // NO SE PINTA SI EL HISTORIAL ESTÁ VACÍO. Alguien puede pegar esta URL con
  // el marcador en una pestaña nueva, y entonces `back()` no tendría a dónde
  // ir: una flecha que no hace nada es peor que ninguna flecha.
  //
  // LO QUE ESTA GUARDA NO ATRAPA, medido el 2026-10-17 en vez de supuesto:
  // una pestaña que se abre en blanco y DESPUÉS navega aquí da
  // `history.length === 2`, no 1 — así que la flecha sale y `back()` lleva a
  // la pestaña en blanco. El caso corriente, pegar la URL en una pestaña
  // recién abierta, sí da 1 y sí queda cubierto.
  //
  // Se deja así a sabiendas. Lo preciso sería que la franja dejara una marca
  // en `sessionStorage` al navegar, pero `CLAUDE.md` avisa de que iOS Safari
  // borra y bloquea ese almacén, y entonces la flecha FALTARÍA justo en los
  // teléfonos de la mayoría de los clientes. Entre «a veces vuelve a un sitio
  // raro» y «a veces no existe para quien la necesita», lo primero cuesta
  // menos.
  //
  // `useSyncExternalStore` Y NO UN EFECTO CON `setState`. Lo primero que se
  // escribió fue el efecto, y `react-hooks/set-state-in-effect` lo rechazó
  // con razón: esto no es sincronizar nada, es LEER un valor del navegador
  // que no existe en el servidor. Para eso está este hook — devuelve `false`
  // en el servidor y en el primer render del cliente, así que no hay
  // desajuste de hidratación, y lee el valor de verdad sin provocar un
  // segundo render en cascada.
  //
  // El primer argumento es la suscripción, y no hace nada a propósito: el
  // historial no emite eventos y este valor solo se mira al entrar.
  const hayVuelta = useSyncExternalStore(
    () => () => {},
    () => window.history.length > 1,
    () => false,
  );

  if (!hayVuelta) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Volver a tu saldo"
      className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <ArrowLeft className="size-5" aria-hidden="true" />
    </button>
  );
}
