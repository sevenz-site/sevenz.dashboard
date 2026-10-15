import { formatPriceAmount } from "@/lib/products/price";
import { formatCantidad } from "@/lib/products/cantidad";
import { precioUnitario, subtotales, type LineaCarrito, type ProductoDelCarrito } from "@/lib/cart/cart";

// EL TEXTO DEL PERMISO Y EL MENSAJE DEL PEDIDO, LOS DOS AQUI.
//
// ===========================================================================
// LA FRASE DEL PERMISO ES LA EVIDENCIA, ASI QUE SE ESCRIBE UNA VEZ
//
// Lo que se guarda en `client_whatsapp_consents.consent_text` tiene que ser
// LITERALMENTE lo que el cliente tenia en pantalla. Es la misma regla que ya
// siguen `TEXTO_AVISOS_WHATSAPP` (el dueno) y el modal de `/s/[token]` (el
// cliente): esa cadena es la prueba ante Meta, y dos textos distintos la
// convierten en una reconstruccion.
//
// Por eso la pinta y la guarda la MISMA constante. Escrita dos veces, el dia
// que alguien retoque la de la pantalla, la base empieza a guardar una frase
// que nadie leyo nunca.
//
// LA REDACCION ES LA DEL FRAME `1326:5755` (2026-10-15), literal. Cambio
// cualquier palabra de aqui y la frase guardada deja de coincidir con la que
// el cliente leyo — que es justo lo que la invalida como evidencia.
//
// Y LA CASILLA NACE DESMARCADA, aunque el frame la dibuje marcada. Decision
// del dueno el 2026-10-15 al verlo planteado: Meta exige consentimiento
// AFIRMATIVO, y una casilla premarcada no es una eleccion sino algo que paso
// mientras el cliente miraba otra cosa. Ademas es el unico freno real entre un
// enlace que circula y permisos dados en nombre de terceros.
export const TEXTO_PERMISO_ORDEN =
  "Quiero recibir avisos del estado de mi compra y saldo vía WhatsApp.";

// ===========================================================================
// EL RESUMEN QUE VIAJA POR WHATSAPP
//
// La anotacion del frame pide «productos seleccionados con su respectivo
// precio unitario, precio, total, moneda por producto».
//
// SE ARMA EN EL CLIENTE Y NO EN EL SERVIDOR, a proposito: el mensaje lo manda
// el telefono del cliente desde su propio WhatsApp, asi que el servidor no
// tiene nada que anadir. Y lo que de verdad importa —la orden— ya se guardo
// antes de llegar aqui.
//
// LOS IMPORTES SE RECALCULAN con los mismos productos que la pantalla acaba de
// ensenar, no se vuelven a pedir: si el tendero cambia un precio entre que el
// cliente mira y pulsa, el mensaje dice lo que el cliente vio. La orden
// guardada puede diferir —el servidor la recalculo— y el tendero tiene las
// dos, que es la unica forma de que la diferencia se note.
export function mensajeDeLaOrden(
  businessName: string,
  nombreDelCliente: string,
  lineas: LineaCarrito[],
  productos: Map<string, ProductoDelCarrito>,
): string {
  const partes: string[] = [
    `Hola ${businessName}, soy ${nombreDelCliente.trim()} y te hago este pedido:`,
    "",
  ];

  for (const l of lineas) {
    const p = productos.get(l.productId);
    if (p == null) continue;
    const precio = precioUnitario(p, l);
    if (precio == null) continue;

    const unidad = formatPriceAmount(precio.amount, precio.currency);
    const total = formatPriceAmount(precio.amount * l.quantity, precio.currency);
    partes.push(`• ${formatCantidad(l.quantity)} x ${p.name} — ${unidad} c/u = ${total}`);
    if (l.comment) partes.push(`   (${l.comment})`);
  }

  const totales = subtotales(lineas, productos);
  if (totales.length > 0) {
    partes.push("");
    for (const t of totales) {
      // Con una sola moneda se dice «Total»; con varias se nombra cada una,
      // porque «Total: 21,60 €» y «Total: 5,00 $» seguidos se leen como dos
      // versiones de lo mismo en vez de como dos pagos distintos.
      const etiqueta = totales.length > 1 ? `Total en ${t.currency}` : "Total";
      partes.push(`${etiqueta}: ${formatPriceAmount(t.amount, t.currency)}`);
    }
  }

  return partes.join("\n");
}
