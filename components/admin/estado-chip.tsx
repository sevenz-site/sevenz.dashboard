import type { Cuenta } from "@/lib/admin/subscriptions";

// El color dice el estado de un vistazo, sin leer.
//
// EL MAPA, y por qué es este:
//
//   verde   está pagando, o es un regalo deliberado. Todo en orden.
//   rojo    hace falta que hagas algo: la demo venció y sigue trabajando, o
//           la cuenta está bloqueada.
//   neutro  demo en curso. No es una alarma — es lo normal durante la prueba.
//   apagado cancelada. Ya no es tuyo el problema.
//
// SOLO DOS COLORES Y EL NEUTRO, a propósito. La paleta tiene `money-in` y
// `destructive`, los dos medidos contra WCAG. No hay un ámbar, y no me lo
// invento: ayer se arregló un color que llevaba meses fallando el contraste
// justamente por haberse elegido a ojo. Si hace falta un tercer nivel —"esta
// demo vence en tres días"— se añade el token midiéndolo, no antes.
//
// La urgencia de "por vencer" ya la lleva su propia sección, que es una señal
// más fuerte que un matiz de color.
export function EstadoChip({ cuenta }: { cuenta: Cuenta }) {
  const vencida = cuenta.estado === "demo" && (cuenta.dias_restantes ?? 0) < 0;

  const color = vencida || cuenta.estado === "bloqueada"
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : cuenta.estado === "activa"
      ? "border-money-in/30 bg-money-in/10 text-money-in"
      : cuenta.estado === "cancelada"
        ? "border-border bg-muted text-muted-foreground"
        : "border-border bg-background text-foreground";

  const nombre = vencida
    ? "Demo vencida"
    : cuenta.estado === "demo"
      ? "Demo"
      : cuenta.estado === "activa"
        ? "Activa"
        : cuenta.estado === "bloqueada"
          ? "Bloqueada"
          : "Cancelada";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {nombre}
      <span className="opacity-60">·</span>
      <span className="font-normal">{cuenta.plan_code === "pro" ? "Pro" : "Free"}</span>
    </span>
  );
}
