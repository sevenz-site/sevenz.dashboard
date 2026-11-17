"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A SHEET OF REPORTES THAT A LINK CAN OPEN: `?abrir=<clave>`.
//
// For the assistant's links (owner's request of 2026-11-17, frame 2189:28630): «Ver clientes»
// under «los 9 clientes en estado crítico» has to land on those nine, not on a card he must
// find and tap. The link carries `abrir=criticos`; the sheet whose key it is reads it.
//
// DERIVED FROM THE URL, NOT COPIED INTO STATE: a link to the same page only changes the query,
// and a `useState` seeded from it would keep its first value.
//
// CLOSING IS IMMEDIATE, AND THE PARAMETER LEAVES WITHOUT A ROUND TRIP. The first version took
// `abrir` out with `router.replace`, which asks the server for the whole Reportes page again:
// measured in dev on 2026-11-17, the sheet stayed open ~2.5 s after tapping its X. Now a local
// flag closes it at once, and `history.replaceState` drops the parameter (Next keeps
// `useSearchParams` in step with it), so a reload does not open the sheet again.
export function useHojaDesdeLaUrl(clave: string) {
  const params = useSearchParams();
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);
  const [cerradaAMano, setCerradaAMano] = useState(false);
  const pedida = params.get("abrir") === clave;

  // Once the URL no longer asks, the flag has done its job; a later link that asks again must
  // open the sheet again. Adjusting state while rendering, guarded, is React's own pattern for
  // «reset when a prop changes».
  if (!pedida && cerradaAMano) setCerradaAMano(false);

  const cambiar = (abrir: boolean) => {
    setAbierta(abrir);
    if (!abrir && pedida) {
      setCerradaAMano(true);
      const q = new URLSearchParams(params.toString());
      q.delete("abrir");
      window.history.replaceState(null, "", q.size ? `${ruta}?${q.toString()}` : ruta);
    }
  };

  return [abierta || (pedida && !cerradaAMano), cambiar] as const;
}
