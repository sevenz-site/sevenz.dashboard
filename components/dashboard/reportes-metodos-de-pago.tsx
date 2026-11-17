import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { methodLabel, SIN_METODO } from "@/lib/payments/methods";

// «¿Cuáles son los métodos de pago que generan mayor ingreso?», owner's request of 2026-11-17.
//
// ONE RANKING PER BOOK, never one across them: dollars and euros are two books and are not added
// up anywhere in this app. Each row is a method, its amount and a bar as wide as its share of the
// book's top method. The figures come from `porMetodo` in `lib/reports/facturacion.ts`, which is
// the cards' «Ventas» and «Abonos» split by method, so a book's rows add up to those two cards.
//
// WHAT IS NOT A BAR, SAID IN WORDS: payments recorded before the field existed have no method and
// go last as «Sin registrar»; a method below zero (more went back by it in a return than came in
// by it in the period: returns come off the method they were refunded by) is shown as an amount
// with no bar and a line naming it.
//
// HAND-BUILT, like `Barras` next to it in Facturación: no chart library for six rows.

type Libro = "USD" | "EUR" | "COP";

export function MetodosDePago({
  libros,
  porMetodo,
  oculto,
}: {
  libros: Libro[];
  porMetodo: Partial<Record<Libro, Record<string, number>>>;
  oculto: boolean;
}) {
  const conDatos = libros.filter((l) =>
    Object.values(porMetodo[l] ?? {}).some((v) => Math.abs(v) >= 0.005),
  );
  if (conDatos.length === 0) {
    return (
      <p className="rounded-[10px] border px-3 py-4 text-sm text-muted-foreground">
        Todavía no hay cobros en este periodo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {conDatos.map((libro) => {
        const filas = Object.entries(porMetodo[libro] ?? {})
          .filter(([, v]) => Math.abs(v) >= 0.005)
          .map(([clave, valor]) => ({
            clave,
            etiqueta: clave ? (methodLabel(clave, libro) ?? clave) : SIN_METODO,
            valor,
          }))
          // Highest first; «Sin registrar» always last, whatever its size: it is not a method,
          // and ranking it first would read as the answer to the question.
          .sort((a, b) => (a.clave === "" ? 1 : b.clave === "" ? -1 : b.valor - a.valor));
        const maximo = Math.max(...filas.map((f) => f.valor), 0);
        const negativos = filas.filter((f) => f.valor < 0).map((f) => `«${f.etiqueta}»`);

        return (
          <div key={libro} className="flex flex-col gap-2 rounded-[10px] border p-3">
            {conDatos.length > 1 ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CurrencyFlagIcon currency={libro as PriceCurrency} className="size-4" />
                {libro === "USD" ? "Dólares" : libro === "EUR" ? "Euros" : "Pesos"}
              </span>
            ) : null}
            <ul className="flex flex-col gap-2.5">
              {filas.map((f) => (
                <li key={f.clave || "sin"} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={f.clave ? "text-sm" : "text-sm text-muted-foreground"}>
                      {f.etiqueta}
                    </span>
                    <span
                      className={
                        f.valor < 0
                          ? "text-sm tabular-nums text-destructive"
                          : "text-sm font-medium tabular-nums"
                      }
                    >
                      {oculto ? "•••••" : formatPriceAmount(f.valor, libro as PriceCurrency)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className={f.clave ? "h-full rounded-full bg-money-in" : "h-full rounded-full bg-muted-foreground/40"}
                      style={{ width: maximo > 0 && f.valor > 0 ? `${(f.valor / maximo) * 100}%` : "0%" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {negativos.length > 0 ? (
              <p className="text-xs leading-4 text-muted-foreground">
                {negativos.join(" y ")} {negativos.length > 1 ? "quedan" : "queda"} en negativo
                porque en este periodo devolviste por {negativos.length > 1 ? "ellos" : "ahí"} más de
                lo que cobraste.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
