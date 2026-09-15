// El texto que se manda cuando el dueño comparte un movimiento.
//
// POR QUÉ VIVE APARTE. Es presentación, sí, pero presentación que sale de la
// app y aterriza en el WhatsApp de un cliente. Una cifra mal compuesta aquí no
// es un fallo de pantalla: es un papel escrito que alguien va a citar en una
// discusión sobre lo que debe. Eso merece una prueba, y una prueba necesita una
// función a la que llamar.
//
// RECIBE TEXTO YA FORMATEADO, no números. Formatear es cosa de
// lib/exchange-rate/format.ts y de nadie más; si esta función recibiera cifras
// y las formateara a su manera, el mensaje compartido diría "1.08" donde la
// pantalla dice "$1,08" y sería la misma app hablando de dos formas del mismo
// dinero. Aquí solo se decide QUÉ líneas salen y en qué orden.
export type MovimientoCompartible = {
  tipo: "charge" | "payment";
  fecha: string;
  monto: string;
  // La otra cara de la moneda, cuando la hubo. Null en un negocio colombiano y
  // en los movimientos anteriores a que existiera la tasa.
  equivalente: string | null;
  tasa: string | null;
  plazo: string | null;
  detalle: string | null;
  saldoEtiqueta: string;
  saldo: string;
};

// Las líneas vacías se caen solas. Un mensaje con "Detalle: —" dentro es peor
// que uno sin esa línea: obliga a leer un renglón para descubrir que no dice
// nada.
export function textoParaCompartir(m: MovimientoCompartible): string {
  const lineas: string[] = [
    m.tipo === "charge" ? "Cargo (fía)" : "Abono (paga)",
    `Monto: ${m.monto}`,
  ];

  if (m.equivalente) lineas.push(`Equivalente: ${m.equivalente}`);
  if (m.tasa) lineas.push(`Tasa del día: ${m.tasa}`);
  if (m.plazo) lineas.push(`Plazo de pago: ${m.plazo}`);
  if (m.detalle) lineas.push(`Detalle: ${m.detalle}`);

  lineas.push(`Fecha: ${m.fecha}`);
  // El saldo va el último y separado: es lo único del mensaje que no describe
  // ESTE movimiento sino en qué queda la cuenta, y es lo que el cliente va a
  // buscar primero.
  lineas.push("", `${m.saldoEtiqueta}: ${m.saldo}`);

  return lineas.join("\n");
}
