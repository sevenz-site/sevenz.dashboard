"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatDate, formatDateLong, formatDateTime, zonaDelNegocio } from "@/lib/format";

// ===========================================================================
// THE BUSINESS'S TIME ZONE, FOR EVERY DATE ON SCREEN -- PL-1
//
// The owner's decision of 2026-10-30: dates are drawn in the zone of the
// business (Caracas for VE, Bogotá for CO), not in UTC and not in the zone of
// whoever happens to render them. See `formatDate` in lib/format.ts for what
// went wrong before.
//
// WHY A CLIENT COMPONENT, EVEN INSIDE SERVER PAGES: a server component cannot
// read a context, and threading the country through every prop down to a
// card would be a second way to get it wrong. `<Fecha>` renders on the server
// with the provider's zone and hydrates with the same one, so the HTML and
// the page finally agree.
//
// THE DEFAULT IS CARACAS, for a tree with no provider. Sevenz is Venezuela
// first, and the two zones differ by one hour; every screen that shows dates
// sits under a provider anyway -- the app layout and the three /s/[token]
// pages.
const ZonaDelNegocio = createContext<string>(zonaDelNegocio("VE"));

export function ZonaDelNegocioProvider({
  country,
  children,
}: {
  country: string | null | undefined;
  children: ReactNode;
}) {
  return <ZonaDelNegocio.Provider value={zonaDelNegocio(country)}>{children}</ZonaDelNegocio.Provider>;
}

export function useZonaDelNegocio(): string {
  return useContext(ZonaDelNegocio);
}

export function Fecha({ iso, formato = "corta" }: { iso: string; formato?: "corta" | "larga" | "hora" }) {
  const zona = useZonaDelNegocio();
  if (formato === "larga") return <>{formatDateLong(iso, zona)}</>;
  if (formato === "hora") return <>{formatDateTime(iso, zona)}</>;
  return <>{formatDate(iso, zona)}</>;
}
