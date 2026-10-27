"use client";

import Link from "next/link";
import { SquarePen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { formatDocumentId } from "@/lib/format";
import { MALA_PAGA_BADGE_CLASS } from "@/lib/types";

// QUIÉN QUEDÓ APUNTADO EN LA PRIMERA MONEDA — frames `1708:15043` (la
// pantalla) y `1708:15220` (la tarjeta), leídos con el puente de escritorio el
// 2026-10-26.
//
// ═══════════════════════════════════════════════════════════════════════
// EL ENCARGO, Y POR QUÉ ESTA TARJETA NO ESTABA
//
// Del dueño ese día: *«Pantalla "Nuevo pedido" debe mostrar información del
// cliente que registré en el pedido de la primera moneda y permitir
// editarla»*.
//
// Ayer esta pantalla se quedó SOLO con los bloques de moneda, también por
// encargo suyo. No se contradice: lo que se quitó fue la tarjeta del
// COMPRADOR del pedido --quién escribió el carrito, con su aviso de si ya
// existe en la cuenta-- y lo que entra ahora es otra cosa, la ficha que él
// acaba de decidir. Una es un dato del pedido; la otra, una decisión suya.
//
// ───────────────────────────────────────────────────────────────────────
// SOLO EXISTE A PARTIR DE LA SEGUNDA MONEDA, Y ESO NO ES UNA CONDICIÓN
// INVENTADA
//
// El cliente se pregunta en el paso 4/4, o sea DESPUÉS de cobrar la primera
// moneda. Antes de eso no hay nada que enseñar aquí, y por eso el frame del
// 1/4 sin cliente (`1652:12752`) no dibuja tarjeta ninguna y este sí. Un
// pedido de una sola moneda nunca vuelve a esta pantalla, así que tampoco la
// ve.
//
// Devuelve `null` sin borrador, que es también lo que pinta el SERVIDOR: este
// dato vive en `sessionStorage` y allí no existe. La tarjeta aparece en la
// primera pintura del navegador.
//
// ───────────────────────────────────────────────────────────────────────
// EL LÁPIZ LLEVA AL PASO DEL CLIENTE, no a un diálogo
//
// Palabras suyas: *«al seleccionar el icon button "Editar" lleva a la
// pantalla "Datos del cliente"»*. Esa pantalla es `/registrar/cliente` --hoy
// titulada «Registrar cliente»--, y llega con todo relleno desde el borrador,
// que es de donde esta tarjeta lee. Al guardar vuelve aquí sola, porque su
// propia regla es «si queda alguna moneda, guarda el cliente y vuelve al
// pedido».
//
// NO HAY FLECHA EN EL SITEMAP que lo diga: el icono no tiene conector. Lo que
// hay es su frase, y queda citada arriba para que se sepa de dónde salió.
// ── Y EL CHIP «MALA PAGA», PORQUE AQUÍ EL RECUADRO VERDE NO PASA ─────
//
// El chip que el dueño pidió el 2026-10-26 vive en la tarjeta verde del paso
// del cliente. ESTA PANTALLA NO LA TIENE: en la segunda pasada de un pedido
// de dos monedas el paso del cliente se salta --ya está en el borrador-- así
// que la única tarjeta de cliente que el tendero ve antes de cobrar la
// segunda moneda es ésta.
//
// Sin esto, ese camino --el único que necesita dos cobros, o sea el más
// largo-- no enseñaría la marca en ninguna pantalla, y el aviso llegaría solo
// en el diálogo del último toque. Es la misma puerta que `PR-E6` tuvo que
// cerrar dos veces por el mismo motivo.
//
// SE COMPRUEBA CONTRA EL ID, NO CONTRA LA MARCA A SECAS: el borrador puede
// llevar otro cliente --el tendero lo cambió con el lápiz, o eligió «cuenta
// separada»-- y entonces la ficha emparejada con el pedido no es a quien se
// le va a apuntar nada. Es la misma condición que la puerta del Pago.
export function OrderRegisteredClientCard({
  pedidoId,
  ficha,
}: {
  pedidoId: string;
  // La ficha emparejada con el DOCUMENTO del pedido, cuando hay exactamente
  // una. `null` con varias o con ninguna.
  ficha?: { id: string; marcada: boolean } | null;
}) {
  const borrador = useBorrador(pedidoId);
  const cliente = borrador?.cliente;
  if (!cliente) return null;
  const marcada = ficha != null && ficha.marcada && cliente.fichaId === ficha.id;

  // INICIALES DE PALABRAS QUE EMPIECEN POR LETRA O NÚMERO. El nombre puede
  // venir del formulario que rellenó el CLIENTE, así que trae lo que él
  // tecleara: «Jos (desde el catálogo)» daba «J(» en dev. Misma limpieza que
  // `OrderClientCard`, por el mismo motivo.
  const iniciales =
    cliente.name
      .trim()
      .split(/\s+/)
      .map((palabra) => palabra.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((palabra) => palabra[0]!.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex items-start gap-3 rounded-[10px] border p-4">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl text-muted-foreground"
      >
        {iniciales}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-base font-semibold">{cliente.name}</p>
          {marcada ? (
            <Badge variant="outline" className={`${MALA_PAGA_BADGE_CLASS} shrink-0`}>
              Mala paga
            </Badge>
          ) : null}
          {/* ── EL LÁPIZ, A LA DERECHA DEL NOMBRE ───────────────────────
              Donde lo pone el frame: dentro de la fila del nombre, pegado al
              borde derecho de la columna.

              CON ÁREA DE TOQUE DE VERDAD. El icono mide 24 como en el frame,
              pero el enlace lleva `-m-2 p-2` alrededor: el dibujo no cambia y
              lo tocable pasa de 24 a 40px. Es el mismo truco que la flecha de
              volver de esta misma app, y la razón es que 24px en un pulgar es
              una ruleta.

              Y LLEVA `aria-label`, porque un enlace cuyo único contenido es
              un icono no tiene nombre para un lector de pantalla. */}
          <Link
            href={`/productos/ordenes/${pedidoId}/registrar/cliente`}
            aria-label={`Editar los datos de ${cliente.name}`}
            className="-m-2 shrink-0 rounded-md p-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SquarePen className="size-5" aria-hidden="true" />
          </Link>
        </div>
        {/* LAS TRES LÍNEAS SIEMPRE, AUNQUE VENGAN VACÍAS. Regla del
            `DESIGN-SYSTEM.md`: un dato que falta y desaparece no se distingue
            de uno que nunca se pidió. */}
        <p className="truncate text-sm text-muted-foreground">
          Cédula: {formatDocumentId(cliente.documentId, cliente.documentType) || "—"}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          Teléfono: {cliente.whatsapp || "—"}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          Dirección: {cliente.address || "—"}
        </p>
      </div>
    </div>
  );
}
