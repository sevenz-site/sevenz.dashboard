"use client";

import { useEffect } from "react";
import { borrarBorrador } from "@/lib/orders/borrador-de-registro";

// SALIRSE DEL FLUJO TIRA LO EDITADO.
//
// ═══════════════════════════════════════════════════════════════════════
// EL ENCARGO
//
// Del dueño, el 2026-10-26: *«Si edito la cantidad de un producto en "Editar
// pedido" y me salgo del flujo y luego vuelvo a entrar la cantidad editada se
// mantiene. Pero está mal, toda la edición del pedido debería reiniciarse si
// me salgo del flujo, incluyendo la cantidad»*.
//
// Hasta hoy el borrador solo se borraba al escribir la venta, o solo cuando
// caducaba a las dos horas. Así que salirse a mitad y volver mañana por la
// mañana enseñaba las cantidades de ayer como si fueran las del cliente —y
// `CantidadDeLinea` las etiqueta «(el cliente pidió 1)», que es la única
// pista de que algo se tocó—. Un pedido que vuelve a abrirse tiene que
// volver a ser lo que el cliente pidió.
//
// ═══════════════════════════════════════════════════════════════════════
// SE BORRA EN EL DETALLE, Y ESO ES LO QUE DEFINE «SALIRSE»
//
// Esta pantalla es la puerta: al flujo se entra por su «Registrar pedido» y
// se sale por la flecha de atrás de cualquiera de sus pasos, que apunta aquí
// o al 1/4 --y el 1/4 vuelve aquí--. Así que «estar en el detalle» es
// exactamente «no estar registrando», y es el único sitio donde hace falta
// una sola línea.
//
// LO QUE NO VALE, y se pensó antes: borrarlo al DESMONTAR las pantallas del
// flujo. El flujo navega entre sus propios pasos todo el rato --el 2/4
// desmonta para montar el 3/4-- así que habría que distinguir «me voy al
// siguiente paso» de «me voy fuera», y esa distinción vive en el destino, no
// en el origen. Mirarlo desde aquí no necesita distinguir nada.
//
// ───────────────────────────────────────────────────────────────────────
// NO HAY NADA QUE PERDER, Y POR ESO SE PUEDE BORRAR SIN PREGUNTAR
//
// El borrador no es un registro: es lo tecleado EN VUELO. Mientras existe, la
// base no tiene nada --ni cliente, ni venta, ni movimiento--, así que
// tirarlo no deshace dinero de nadie. Lo que cuesta es volver a teclear un
// monto, y eso es justo lo que el dueño pide a cambio de que un pedido
// reabierto diga la verdad.
//
// UN PEDIDO DE DOS MONEDAS A MEDIO REGISTRAR TAMBIÉN SE TIRA, y conviene
// decirlo: si registró los dólares y se fue sin los euros, al volver tendrá
// que teclear los dos otra vez. Hoy eso es correcto porque tampoco se escribe
// nada hasta la última moneda; el día que la primera venta se escriba antes
// --está abierto-- esta regla hay que volver a mirarla.
// EL ID, DESDE EL 2026-10-26, y es la otra mitad de `PR-G3`. Sin él esto
// borraba el borrador de CUALQUIER pedido, así que abrir el de Luis tiraba lo
// que estaba a medias en el de Pedro -- y eso pasaba incluso con una llave por
// pedido, porque el que borraba era este componente. Lo que el dueño pidió es
// que salirse del flujo reinicie ESE pedido, y eso es lo que hace ahora.
export function OrderDraftReset({ pedidoId }: { pedidoId: string }) {
  useEffect(() => {
    // NO ES `setState` EN UN EFECTO: escribe en un almacén de fuera de React,
    // que es para lo que los efectos existen. El lint que prohíbe lo primero
    // --y que ya tiene en rojo a `feedback-banner.tsx`-- no aplica aquí.
    borrarBorrador(pedidoId);
  }, [pedidoId]);

  return null;
}
