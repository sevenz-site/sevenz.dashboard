"use client";

// ═══════════════════════════════════════════════════════════════════════
// LEER DEL ALMACENAMIENTO DEL NAVEGADOR SIN QUE LA PANTALLA SE QUEDE VIEJA
// ═══════════════════════════════════════════════════════════════════════
//
// `useSyncExternalStore` pide tres cosas: cómo SUSCRIBIRSE, cómo leer en el
// navegador y cómo leer en el servidor. La primera es la que se olvida, y
// olvidarla no rompe nada: compila, pasa el lint, y la pantalla enseña el
// valor correcto la primera vez. Lo que deja de pasar es que se ACTUALICE.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ NO SE NOTA HASTA QUE CUESTA DINERO
//
// `localStorage` y `sessionStorage` NO avisan a la pestaña que escribe. El
// evento `storage` del navegador se dispara solo en las OTRAS pestañas --está
// pensado para sincronizar ventanas, no para esto--. Así que si nadie avisa a
// mano, un componente que lea de ahí se queda con lo que leyó al montarse.
//
// Y `router.refresh()` NO lo arregla, que es la trampa: refrescar vuelve a
// pedirle la pantalla al SERVIDOR, y el servidor no ve el almacenamiento del
// navegador. La pantalla se repinta entera con el mismo dato viejo.
//
// LO QUE COSTÓ, dos veces, las dos con dinero delante:
//
//   2026-10-25  «Agregar» en la hoja de editar una línea no cambiaba nada en
//               la pantalla de detrás. Se "arregló" refrescando, que es
//               justo lo que no puede funcionar.
//   2026-10-26  El dueño puso 4 unidades, la tarjeta siguió diciendo 1, y la
//               venta se escribió con 4. *«Resultado: no se agregan»*. La
//               tarjeta que miente es la última que se mira antes de cobrar.
//
// ───────────────────────────────────────────────────────────────────────
// LA REGLA, Y ES DE DOS PIEZAS
//
// 1. TODO MÓDULO QUE ESCRIBA EN EL ALMACENAMIENTO EXPORTA SU PROPIA
//    SUSCRIPCIÓN y avisa desde su única función de escritura. Los tres que
//    hay lo hacen: `lib/cart/store.ts` (el carrito del cliente),
//    `lib/orders/borrador-de-registro.ts` (registrar un pedido) y este
//    fichero como puerta del caso contrario.
//
// 2. QUIEN NO SE SUSCRIBE LO DICE CON ESTE NOMBRE. `leerUnaVezAlEntrar` no
//    es un atajo: es una declaración de que ese valor se lee al montar y no
//    vuelve a cambiar mientras la pantalla viva. Escrito así, `grep` lo
//    encuentra y cada uso se puede revisar; escrito como un `() => () => {}`
//    suelto, es indistinguible de habérselo dejado.
//
// `npm run qa:suscripciones` falla si alguien vuelve a escribir el no-op a
// mano. No lleva lista de excepciones a propósito --una lista desactualizada
// falla en silencio, que es lo que este guardia existe para evitar--: la
// excepción se declara importando esta función, y su nombre dice cuál es.
//
// ───────────────────────────────────────────────────────────────────────
// CUÁNDO SÍ VALE, Y SOLO ENTONCES
//
// ✅ El valor INICIAL de un campo de formulario, cacheado en un `useRef`: a
//    partir de ahí el campo es el dueño del dato y esta pantalla es la única
//    que escribe. Así lo usan `abono-monto.tsx` y `abono-reparto.tsx`.
// ✅ Algo que no cambia nunca: qué sistema operativo es el teléfono.
// ✅ Algo escrito en OTRA página, antes de que este componente existiera.
//
// ❌ NUNCA para una cifra que se dibuja en pantalla y que otra parte de la
//    misma pantalla puede cambiar. Eso se suscribe, sin excepción.
export function leerUnaVezAlEntrar(): () => void {
  return () => {};
}
