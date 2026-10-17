// WHEN EACH CUOTA FALLS DUE, AND FOR HOW MUCH.
//
// ONE FORMULA, THREE PLACES. The deadline of cuota `k` out of `n` is
//
//     created_at + plazo_dias * (k / n) days
//
// and that exact expression is what migration `118` uses to decide whether a
// client reads "Plazo vencido", what migration `120` uses to decide the day a
// client's WhatsApp reminder goes out, and what this function uses to print
// the dates on screen. They have to be the same expression, not three that
// agree today: a screen promising the 19th while the badge turns red on the
// 18th is the product arguing with itself about money.
//
// NO ROUNDING OF THE DAY COUNT, on purpose. 7 days in 2 cuotas is 3,5 days,
// so the first one falls due half a day in. Rounding that to 4 days here --
// which was the first thing written, and wrong -- would have moved the printed
// date a whole day away from the moment the ledger actually judges.
//
// WHAT THIS DOES NOT KNOW IS WHAT IS PAID. It describes the agreement, not its
// state: the amounts are the split, not what is outstanding. Marking a cuota
// as covered needs the FIFO queue that lives in `client_summary_all`, and a
// "Vencida" printed on a cuota the client actually paid would be worse than no
// label at all. See `CT-89` in PENDIENTES.md.

export type Cuota = {
  /** 1-based, as the owner counts them. */
  numero: number;
  fecha: Date;
  monto: number;
};

export function calcularCuotas({
  createdAt,
  plazoDias,
  cuotas,
  amount,
}: {
  createdAt: string;
  plazoDias: number;
  cuotas: number;
  amount: number;
}): Cuota[] {
  const inicio = new Date(createdAt).getTime();

  // THE LAST ONE ABSORBS THE REMAINDER. 100 in 3 cuotas is 33,33 + 33,33 +
  // 33,34, not three times 33,33 -- which would add up to 99,99 and leave the
  // owner looking for a cent that was never missing.
  const base = Math.round((amount / cuotas) * 100) / 100;

  return Array.from({ length: cuotas }, (_, i) => {
    const numero = i + 1;
    const dias = (plazoDias * numero) / cuotas;
    return {
      numero,
      fecha: new Date(inicio + dias * 86_400_000),
      monto:
        numero === cuotas
          ? Math.round((amount - base * (cuotas - 1)) * 100) / 100
          : base,
    };
  });
}
