import { redirect } from "next/navigation";
import { getCurrentUser, getOwnerShellRow, getRequestClient } from "@/lib/supabase/current-user";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NewClientForm } from "@/components/dashboard/new-client-form";
import type { OwnerCountry } from "@/lib/types";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";

export const metadata = { title: "Nuevo cliente — Sevenz" };

// `/clients/nuevo` Y NO `/clientes/nuevo`, aunque las rutas de este producto
// se escriban en castellano por ser cosa que el usuario lee: ya existe
// `/clients` y `/clients/[id]`, y dos grafías del mismo sustantivo en la misma
// app son peores que una ruta en inglés. Renombrar las que ya están en
// producción cuesta más que la inconsistencia (decisión del 2026-09-17).
//
// UN SEGMENTO FIJO GANA AL DINÁMICO en Next, así que esto no lo intercepta
// `[id]` y nadie acaba buscando un cliente llamado «nuevo».
//
// Y DE AQUÍ SALE GRATIS ALGO QUE EL FRAME PIDE: `MobileNav` se esconde entera
// en todo lo que empieza por `/clients/`, así que esta pantalla no lleva barra
// abajo — que es exactamente como está dibujada. Es un efecto secundario, no
// un descuido: si algún día esa condición cambia, esta pantalla gana una barra
// que su maquetación no reserva.
export default async function NuevoClientePage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await getRequestClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // EL PAÍS DEL NEGOCIO decide qué letras ofrece el selector de documento:
  // V/E/J en Venezuela, CC/CE/NIT en Colombia (migración 125). Si no se sabe,
  // `DocumentIdInput` no pinta selector — elegir a ciegas guardaría una «V» en
  // la cédula de un colombiano.
  const { data: owner } = await getOwnerShellRow(supabase, user.id);

  // THE RATE IS BACK, for the bolívar equivalent under «Deuda antigua» (owner's request of
  // 2026-11-17). It left on 2026-10-18 with the duplicate-account sheet. Same context the
  // abono's amount screen builds; `null` in a Colombian business, which has no bolívares.
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rateContext: MovementRateContext | null =
    resultado.kind === "ve"
      ? {
          rateMode: resultado.context.rateMode,
          effectiveRate: resultado.context.effectiveRate,
          officialRateUsd: resultado.context.officialRate.usd,
          prevista: resultado.context.prevista,
          rateDate: resultado.context.rateDate,
        }
      : null;

  // `ownerId` para la foto de la deuda antigua: se sube a la carpeta del dueño
  // en `attachments`, que es la única ruta que el servidor acepta.
  return (
    <NewClientForm
      ownerCountry={(owner?.country as OwnerCountry | null) ?? null}
      ownerId={user.id}
      rateContext={rateContext}
    />
  );
}
