import Image from "next/image";
import type { PriceCurrency } from "@/lib/products/price";

// COP WAS MISSING UNTIL 2026-10-16, AND THAT WAS A COLOMBIAN-ONLY DEFECT.
//
// This map had USD, EUR, VES and USDT, and the prop type listed those four.
// Every call site therefore CAST its way in -- `currency as "USD" | "EUR" |
// "USDT"` -- which silenced TypeScript about the one currency that was not
// there. For a Colombian shop `FLAG_SRC["COP"]` resolved to `undefined`, so
// `next/image` rendered `<img>` with no `src` and no `alt`. Three console
// errors, one of them React's own warning that an empty `src` makes the
// browser DOWNLOAD THE WHOLE PAGE AGAIN -- on a phone, on a public catalogue,
// in the country where this was never tested.
//
// Found by walking CT-74: the first time the public catalogue was ever opened
// against a Colombian business, on 2026-10-16. The data side had been green
// the whole time, because a missing image is not something a SQL check can
// see.
//
// THE PROP IS NOW `PriceCurrency`, which is the real fix: with the five
// currencies in the type, a missing flag becomes a compile error instead of a
// cast at the call site.
const FLAG_SRC: Record<PriceCurrency, string> = {
  USD: "/flag-usd.svg",
  EUR: "/flag-eur.svg",
  // Added for the rate calculator, which labels the bolívar side of a
  // conversion the same way it labels the foreign one.
  VES: "/flag-ves.svg",
  // No es una bandera: el USDT no tiene país. Es la marca de Tether, que es
  // lo que un tendero reconoce en Binance. Por eso su `alt` tampoco dice
  // "bandera de".
  USDT: "/flag-usdt.svg",
  COP: "/flag-cop.svg",
};

const FLAG_ALT: Record<PriceCurrency, string> = {
  USD: "Bandera de Estados Unidos",
  EUR: "Bandera de la Unión Europea",
  VES: "Bandera de Venezuela",
  USDT: "USDT",
  COP: "Bandera de Colombia",
};

export function CurrencyFlagIcon({
  currency,
  className,
}: {
  currency: PriceCurrency;
  className?: string;
}) {
  const src = FLAG_SRC[currency];

  // NOTHING RATHER THAN A BROKEN IMAGE. The type above already makes a
  // missing flag a compile error, so this only catches a value that reached
  // here at runtime without passing through it -- a string from the database,
  // say. Rendering nothing loses an icon; rendering `<img src={undefined}>`
  // costs a full page re-download and an unlabelled image in a screen reader.
  if (!src) return null;

  return (
    <Image
      src={src}
      alt={FLAG_ALT[currency]}
      width={16}
      height={16}
      className={className ?? "shrink-0"}
    />
  );
}
