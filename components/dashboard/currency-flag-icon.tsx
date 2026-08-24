import Image from "next/image";

const FLAG_SRC = {
  USD: "/flag-usd.svg",
  EUR: "/flag-eur.svg",
} as const;

const FLAG_ALT = {
  USD: "Bandera de Estados Unidos",
  EUR: "Bandera de la Unión Europea",
} as const;

export function CurrencyFlagIcon({
  currency,
  className,
}: {
  currency: "USD" | "EUR";
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
