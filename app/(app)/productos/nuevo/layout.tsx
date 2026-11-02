import type { ReactNode } from "react";
import { PantallaCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { sesionPausada } from "@/lib/cuenta-pausada-server";

// A blocked account meets the paused-account screen at the door of this flow
// instead of being refused at its last step (plan of 2026-10-31, phase B).
// The database refuses the write anyway (migrations 061 and 170): this only
// spares the owner a flow they cannot finish.
export default async function Layout({ children }: { children: ReactNode }) {
  if (await sesionPausada()) return <PantallaCuentaPausada />;
  return children;
}
