// The one sentence of a required «Método de pago» left empty (owner's request of 2026-11-26), and
// the scroll that takes the shopkeeper to it: the field can be far above the button he tapped.
export const FALTA_METODO = "Selecciona el método de pago.";

export function mostrarCampoDeMetodo(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
}
