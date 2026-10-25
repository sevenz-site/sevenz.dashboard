"use client";

import { useBorrador } from "@/components/dashboard/order-registration-summary";

// «2/4 Confirmar pedido», «3/4 Pago» — Y «3/3» EN LA SEGUNDA PASADA.
//
// La nota que la flecha del sitemap lleva escrita encima, entre la pantalla
// del cliente y el pedido: *«Inicia mismo flujo de registro, pero el flujo
// pasa a ser de 4/4 pasos a 3/3 porque la pantalla de "Registrar cliente" ya
// no se muestra porque registró el cliente en el primer pedido»*.
//
// ===========================================================================
// POR QUÉ ES UN COMPONENTE DE CLIENTE PARA DOS NÚMEROS
//
// Porque el total depende del BORRADOR, que vive en el navegador: con el
// cliente ya puesto son tres pasos y sin él cuatro. Una página de servidor no
// puede saberlo, y mandarlo como prop obligaría a cada pantalla a leer el
// borrador por su cuenta -- que es cómo dos contadores acaban diciendo cosas
// distintas en la misma pasada.
//
// EL SERVIDOR PINTA «de 4», que es lo que ve quien llega por primera vez. Si
// resulta que había cliente, el número baja a 3 en el primer render del
// cliente. Un parpadeo en un contador es inherente a un dato que solo existe
// en el navegador, y la alternativa --no pintar nada hasta saberlo-- deja el
// hueco en blanco justo donde el tendero mira para saber cuánto le falta.
export function OrderStepCounter({
  pedidoId,
  paso,
  nombre,
}: {
  pedidoId: string;
  paso: number;
  nombre: string;
}) {
  const borrador = useBorrador(pedidoId);
  const total = borrador?.cliente ? 3 : 4;
  return (
    <p className="-mt-2 text-sm text-muted-foreground">
      {paso}/{total} {nombre}
    </p>
  );
}
