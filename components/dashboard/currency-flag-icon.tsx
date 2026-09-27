import Image from "next/image";

const FLAG_SRC = {
  USD: "/flag-usd.svg",
  EUR: "/flag-eur.svg",
  // Added for the rate calculator, which labels the bolívar side of a
  // conversion the same way it labels the foreign one.
  VES: "/flag-ves.svg",
  // No es una bandera: el USDT no tiene país. Es la marca de Tether, que es
  // lo que un tendero reconoce en Binance. Por eso su `alt` tampoco dice
  // "bandera de".
  USDT: "/flag-usdt.svg",
} as const;

const FLAG_ALT = {
  USD: "Bandera de Estados Unidos",
  EUR: "Bandera de la Unión Europea",
  VES: "Bandera de Venezuela",
  USDT: "USDT",
} as const;

export function CurrencyFlagIcon({
  currency,
  className,
}: {
  currency: "USD" | "EUR" | "VES" | "USDT";
  className?: string;
}) {
  return (
    <Image
      src={FLAG_SRC[currency]}
      alt={FLAG_ALT[currency]}
      width={16}
      height={16}
      className={className ?? "shrink-0"}
    />
  );
}
