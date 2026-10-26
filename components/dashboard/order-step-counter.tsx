"use client";

import { useBorrador } from "@/components/dashboard/order-registration-summary";

// EL CONTADOR DEL FLUJO DE REGISTRAR UN PEDIDO — «2/4 Confirmar pedido»,
// «3/3 Pago», «1/3 Confirmar pedido».
//
// ═══════════════════════════════════════════════════════════════════════
// LOS NÚMEROS NO SON FIJOS, Y ESA ES TODA LA RAZÓN DE QUE ESTO EXISTA
//
// El mismo paso lleva un número distinto según por dónde vaya el pedido, y
// son tres recorridos:
//
//   Varias monedas, primera pasada   1/4 Pedido · 2/4 Confirmar · 3/4 Pago
//                                    · 4/4 Información del cliente
//   Varias monedas, siguientes       1/3 Pedido · 2/3 Confirmar · 3/3 Pago
//   UNA sola moneda                  1/3 Confirmar · 2/3 Pago
//                                    · 3/3 Información del cliente
//
// La segunda sale de la nota escrita encima de la flecha del sitemap:
// *«Inicia mismo flujo de registro, pero el flujo pasa a ser de 4/4 pasos a
// 3/3 porque la pantalla de "Registrar cliente" ya no se muestra porque
// registró el cliente en el primer pedido»*.
//
// La tercera es el encargo del dueño del 2026-10-25 --el `1/4` sobra cuando
// no hay monedas entre las que elegir-- y él eligió renumerar: *«Renumerar a
// 1/3, 2/3, 3/3»*, en vez de dejar el «2/4» que escribe el frame. El porqué
// es que el frame numera el recorrido largo: entrar a un flujo cuya primera
// pantalla dice «2/4», con la barra ya medio llena y sin haber hecho nada,
// se lee como que la app se saltó algo.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ RECIBE EL NOMBRE DEL PASO Y NO SU NÚMERO
//
// Porque el número es justo lo que cambia. Pasándolo como prop, cada pantalla
// tendría que saber en cuál de los tres recorridos está --y son cuatro
// pantallas que se editan por separado--. Pasando QUÉ paso es, la lista de
// pasos se arma aquí, una vez, y los números caen solos.
//
// ───────────────────────────────────────────────────────────────────────
// EL TOTAL DEPENDE DEL BORRADOR, QUE VIVE EN EL NAVEGADOR
//
// Por eso es un componente de cliente para dos números. El servidor pinta el
// recorrido LARGO --el que ve quien llega por primera vez-- y si resulta que
// el cliente ya estaba puesto, el total baja en la primera pintura del
// navegador. Un parpadeo es inherente a un dato que solo existe ahí; la
// alternativa --no pintar nada hasta saberlo-- deja el hueco en blanco justo
// donde el tendero mira para saber cuánto le falta.
export type PasoDelRegistro = "pedido" | "confirmar" | "pago" | "cliente";

const NOMBRES: Record<PasoDelRegistro, string> = {
  pedido: "Pedido",
  confirmar: "Confirmar pedido",
  pago: "Pago",
  cliente: "Información del cliente",
};

export function OrderStepCounter({
  pedidoId,
  paso,
  // `true` cuando el pedido tiene UNA sola moneda cobrable, así que el paso
  // «Pedido» no existe en este flujo. Lo decide el servidor con
  // `unicaMonedaDelPedido`, que es la única función que contesta esa pregunta
  // en todo el repo — ver su comentario para los dos bordes que la afinan.
  sinPasoDePedido,
}: {
  pedidoId: string;
  paso: PasoDelRegistro;
  sinPasoDePedido: boolean;
}) {
  const borrador = useBorrador(pedidoId);

  const pasos: PasoDelRegistro[] = [];
  if (!sinPasoDePedido) pasos.push("pedido");
  pasos.push("confirmar", "pago");
  // CON EL CLIENTE YA EN EL BORRADOR, SU PANTALLA NO SE VUELVE A MOSTRAR...
  // salvo que sea LA QUE SE ESTÁ PINTANDO. Pasa al retroceder con la flecha
  // desde el paso siguiente: sin este `|| paso === "cliente"` el paso actual
  // no estaría en su propia lista, `indexOf` daría -1 y el contador diría
  // «1/3» sobre la pantalla del cliente.
  if (!borrador?.cliente || paso === "cliente") pasos.push("cliente");

  const indice = pasos.indexOf(paso);
  const numero = indice + 1;
  const total = pasos.length;

  return (
    <div className="-mt-2 flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {numero}/{total} {NOMBRES[paso]}
      </p>
      {/* ── LA BARRA DE PROGRESO, QUE ESTÁ EN EL FRAME ─────────────────
          Reportada por el dueño el 2026-10-25: *«colocaste el texto del paso
          a paso de cada pantalla pero quitaste la barra de progreso, revisa
          el frame y te darás cuenta de que la barra está en el diseño»*.
          Tenía razón: el paso 4/4 la lleva desde que se construyó y los pasos
          nuevos nacieron solo con el texto.

          `aria-hidden` A PROPÓSITO: lo que un lector de pantalla necesita ya
          está dicho en letras —«2/4 Confirmar pedido»— y anunciar además una
          barra sería decir dos veces lo mismo. Es lo que ya hacía el 4/4.

          SE LLENA HASTA EL PASO EN CURSO INCLUIDO, así que la última pantalla
          la deja entera. Eso es lo que el dueño eligió al ver las dos
          numeraciones dibujadas. */}
      <div
        aria-hidden="true"
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-all"
          style={{ width: `${Math.round((numero / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}
