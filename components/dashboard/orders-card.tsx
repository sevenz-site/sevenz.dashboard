import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PedidosIcon, VERDE_PEDIDOS } from "@/components/icons/pedidos";

// EL ATAJO A PEDIDOS DEL CATÁLOGO — frame `1360:6518`, 2026-10-16.
//
// ── VIVIÓ EN DOS SITIOS Y AHORA EN UNO, y conviene saber por qué ──────
//
// Hasta el 2026-10-28 también lo usaba el Inicio, con una prop `place` que
// elegía entre dos maquetaciones. Ese día el dueño rediseñó el Inicio: ahí
// «Pedidos» pasó a ser una de DOS tarjetas lado a lado --con «Ventas» a su
// izquierda, frame `1500:9981`-- con el título dentro y una cifra grande, que
// no se parece en nada a esta fila.
//
// La rama de Inicio se quitó entera en vez de dejarla sin usar: una rama
// muerta con un comentario largo explicando una pantalla que ya no es así es
// peor que no tener nada, porque el siguiente que lea este fichero creerá que
// describe el Inicio de hoy. Lo nuevo vive en `inicio-resumen-cards.tsx`.
//
// EL DEGRADADO SE FUE EL 2026-10-28, por decision del dueno y a la vez en las
// tres tarjetas que lo llevaban. Lo que decia este comentario --por que era un
// atributo de estilo y no una clase-- ya no aplica, pero queda dicho que
// existio: era `--accent` a `--background`, tan tenue que en un telefono al
// sol no se distinguia de un fondo plano.
//
// THE ICON'S GREEN IS `#7EC070`, which is `--brand-whatsapp`. That token's own
// note in `globals.css` says it measures 2,17:1 on white and "works on the
// dark header and nowhere light" -- and both of these cards are light. The
// exception is deliberate and bounded: the icon is decoration next to text
// that carries the whole meaning on its own, so a reader who cannot make the
// green out loses nothing. It is not a precedent for a green that has to be
// READ on a light surface; that still needs its own darker value, the way
// `--money-due` solves it for the orange.

function VerTodo({ unattended }: { unattended: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span className="text-xs leading-4">Ver todo</span>
      {unattended > 0 ? (
        // 16px round, as drawn. `min-w-4` and not `size-4`: the frame shows a
        // single digit, and a fixed circle would clip the second the day a
        // shopkeeper has twelve orders waiting.
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-primary-foreground bg-destructive px-1 text-xs leading-4 text-primary-foreground">
          {unattended}
        </span>
      ) : null}
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function OrdersCard({ unattended }: { unattended: number }) {
  // SIN PEDIDOS, LA TARJETA EXPLICA — frame `1466:20137`, pedido del dueño el
  // 2026-10-19. Con pedidos esperando dice «N sin registrar»; sin ninguno,
  // para qué sirve la pantalla.
  const vacia = unattended === 0;

  return (
    <Link
      href="/productos/ordenes"
      // ── SIN GRADIENTE ──────────────────────────────────────────────
      // Decision del dueno el 2026-10-28, para las tres tarjetas a la vez
      // --«Ventas» y «Pedidos» del Inicio y la de Pedidos del Catalogo--.
      // Era `linear-gradient(82.76deg, var(--accent) 0%, var(--background))`,
      // o sea un degradado tan tenue que en un telefono al sol no se
      // distingue de un fondo plano: pagaba un atributo de estilo en linea
      // --que no se puede sobreescribir con una clase-- por algo que casi
      // nadie ve. El borde es lo que separa la tarjeta del fondo.
      className="flex items-center justify-between gap-3 rounded-[10px] border p-3 drop-shadow-[0px_2px_1px_rgba(0,0,0,0.02)]"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {/* EL MISMO DIBUJO QUE LAS NOTIFICACIONES desde el 2026-10-26. Era
            un `<Image src="/icon-pedidos.svg">`, y un `.svg` servido como
            imagen no se puede pintar: el color vive dentro del fichero. Las
            notificaciones lo necesitan en tres colores --verde, rojo y azul,
            según lo que le pasó al pedido-- así que el trazo se mudó a
            `PedidosIcon` con `currentColor`.

            AQUÍ SIGUE SIENDO EL MISMO VERDE, el que el icono ya tenía. No es
            un color nuevo ni un token: `VERDE_PEDIDOS` vive junto al dibujo
            para que esta tarjeta y el aviso de la campana no se separen. */}
        <PedidosIcon className="size-8 shrink-0" style={{ color: VERDE_PEDIDOS }} />
        <span className="flex min-w-0 flex-col justify-center">
            {/* EL TÍTULO VA DENTRO. Catálogo no lleva encabezado encima de la
                tarjeta, que es lo que el frame dibuja. */}
            <span className="font-medium">Pedidos</span>
            {/* UNA SOLA FRASE PARA LAS DOS PANTALLAS — frame `1466:20137`.
                Antes eran dos redacciones distintas: «Lo que piden desde tu
                catálogo» en Inicio y «Lo que te piden desde tu enlace» en
                Catálogo. Decían lo mismo con palabras distintas, y «tu enlace»
                además obligaba a saber que el catálogo ES un enlace. */}
            <span className="text-xs leading-4 text-muted-foreground">
              {vacia ? "Lo que tus clientes ordenan desde tu catálogo." : `${unattended} sin registrar`}
            </span>
        </span>
      </span>
      <VerTodo unattended={unattended} />
    </Link>
  );
}
