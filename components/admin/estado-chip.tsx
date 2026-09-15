import { Badge } from "@/components/ui/badge";
import { CUENTA_BADGE_CLASS } from "@/lib/types";
import type { Cuenta } from "@/lib/admin/subscriptions";

// El chip de estado de una cuenta.
//
// USA Badge, no un <span> con clases a mano. La primera versión de esta
// pantalla se dibujó su propio chip, y por eso no compartía ni el radio, ni la
// altura, ni el tamaño de letra con los de la cartera — dos cosas que hacen lo
// mismo y se ven distinto.
//
// Y los colores salen de CUENTA_BADGE_CLASS, en lib/types.ts, junto a los de
// los clientes: es la misma paleta. Escritos aquí, el día que alguien ajuste
// el ámbar de "plazo vencido" esta pantalla se quedaría con el viejo.
//
// variant="outline" en todos porque las clases traen su propio fondo y borde;
// lo que aporta la variante es la forma, no el color.
function claseDe(cuenta: Cuenta): string {
  const vencida = cuenta.estado === "demo" && (cuenta.dias_restantes ?? 0) < 0;
  if (vencida) return CUENTA_BADGE_CLASS.vencida;
  if (cuenta.estado === "bloqueada") return CUENTA_BADGE_CLASS.bloqueada;
  if (cuenta.estado === "cancelada") return CUENTA_BADGE_CLASS.cancelada;
  if (cuenta.estado === "demo") return CUENTA_BADGE_CLASS.demo;
  return cuenta.plan_code === "pro"
    ? CUENTA_BADGE_CLASS.activa_pro
    : CUENTA_BADGE_CLASS.activa_free;
}

function nombreDe(cuenta: Cuenta): string {
  const vencida = cuenta.estado === "demo" && (cuenta.dias_restantes ?? 0) < 0;
  const estado = vencida
    ? "Demo vencida"
    : cuenta.estado === "demo"
      ? "Demo"
      : cuenta.estado === "activa"
        ? "Activa"
        : cuenta.estado === "bloqueada"
          ? "Bloqueada"
          : "Cancelada";
  return `${estado} · ${cuenta.plan_code === "pro" ? "Pro" : "Free"}`;
}

export function EstadoChip({ cuenta }: { cuenta: Cuenta }) {
  return (
    <Badge variant="outline" className={claseDe(cuenta)}>
      {nombreDe(cuenta)}
    </Badge>
  );
}
