// EL ICONO DE PEDIDOS, DIBUJADO UNA VEZ Y PINTADO DONDE HAGA FALTA.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ DEJA DE SER UN `<Image src="/icon-pedidos.svg">`
//
// Encargo del dueño el 2026-10-26: *«las notificaciones relacionadas a
// pedidos deben tener el mismo ícono de la card "Pedidos" en el home, lo
// único que cambia es el color según el estado del pedido»* — verde al
// recibirlo, rojo al eliminarlo, azul al restaurarlo.
//
// Un `.svg` servido como imagen NO se puede pintar: el color vive dentro del
// fichero. Las salidas eran tres y solo una deja un dibujo:
//
//   · Tres ficheros, uno por color. El día que el icono cambie hay que
//     acordarse de los tres, y el que se olvide no falla: se queda viejo.
//   · Una máscara CSS. Funciona, pero el icono deja de existir como icono —
//     no se puede inspeccionar, no hereda nada y no se ve en el código.
//   · ESTE: el mismo trazo, con `currentColor`, que es como ya está escrito
//     `components/icons/whatsapp.tsx`.
//
// ═══════════════════════════════════════════════════════════════════════
// EL TRAZO ES EL MISMO, COPIADO TAL CUAL
//
// Del propio `public/icon-pedidos.svg`, sin tocar una coma. Lo único que
// cambia es el `fill`: era `#7EC070` fijo y ahora es `currentColor`, así que
// el color lo decide quien lo monta.
//
// LA TARJETA DE INICIO SIGUE VERDE porque lo pide con ese mismo hex. No es un
// color nuevo ni se ha movido a un token: es el que el icono ya tenía, y
// convertirlo en token sería inventarle un significado que el diseño no le ha
// dado.
//
// LA MÁSCARA Y EL RECUADRO DEL ORIGINAL NO SE COPIAN. El `.svg` exportado de
// Figma trae un `<mask>` sobre un rectángulo de 32×32 que recorta justo al
// borde del `viewBox` — o sea, no recorta nada. Arrastrarlo aquí sería copiar
// la herramienta en vez del dibujo.
export function PedidosIcon({
  className,
  style,
}: {
  className?: string;
  // PARA EL VERDE, que no es un token y por tanto no tiene clase de Tailwind.
  // Ver `VERDE_PEDIDOS` al final de este fichero.
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M15 26.0934V16.5754L6.66667 11.7498V21.0371C6.66667 21.1053 6.68378 21.1694 6.718 21.2294C6.75222 21.2892 6.80344 21.3404 6.87167 21.3831L15 26.0934ZM17 26.0934L25.1283 21.3831C25.1966 21.3404 25.2478 21.2892 25.282 21.2294C25.3162 21.1694 25.3333 21.1053 25.3333 21.0371V11.7498L17 16.5754V26.0934ZM14.795 28.2754L5.872 23.1394C5.49244 22.9208 5.19667 22.6286 4.98467 22.2628C4.77267 21.8968 4.66667 21.495 4.66667 21.0574V10.9448C4.66667 10.5072 4.77267 10.1054 4.98467 9.73944C5.19667 9.37366 5.49244 9.08144 5.872 8.86277L14.795 3.72677C15.1743 3.50788 15.576 3.39844 16 3.39844C16.424 3.39844 16.8257 3.50788 17.205 3.72677L26.128 8.86277C26.5076 9.08144 26.8033 9.37366 27.0153 9.73944C27.2273 10.1054 27.3333 10.5072 27.3333 10.9448V21.0574C27.3333 21.495 27.2273 21.8968 27.0153 22.2628C26.8033 22.6286 26.5076 22.9208 26.128 23.1394L17.205 28.2754C16.8257 28.4943 16.424 28.6038 16 28.6038C15.576 28.6038 15.1743 28.4943 14.795 28.2754ZM21.141 11.8678L24.2333 10.0934L16.205 5.44977C16.1368 5.40711 16.0684 5.38577 16 5.38577C15.9316 5.38577 15.8632 5.40711 15.795 5.44977L12.9 7.11644L21.141 11.8678ZM16 14.8524L19.1 13.0574L10.8667 8.29844L7.76667 10.0934L16 14.8524Z"
        fill="currentColor"
      />
    </svg>
  );
}

// EL VERDE DEL ICONO, en un sitio. Lo usan la tarjeta de Inicio y la
// notificación de «te hizo un pedido», que es el mismo hecho visto desde dos
// pantallas: si una se quedara con otro verde, dejarían de parecer lo mismo.
export const VERDE_PEDIDOS = "#7EC070";
