import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { CheckCircle2, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { LedgerCurrency } from "@/lib/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AbonoCompartir } from "@/components/dashboard/abono-compartir";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDocumentId, formatReceiptDateTime } from "@/lib/format";
import { telefonoLegible } from "@/lib/phone";
import { formatPriceAmount, priceIn, type PriceCurrency } from "@/lib/products/price";

export const metadata = { title: "Abono registrado — Sevenz" };

// LA PANTALLA DE ÉXITO DEL ABONO — frame `1434:15590`.
//
// ===========================================================================
// UNA SOLA TARJETA, LA DE LA MONEDA EN QUE SE ABONÓ
//
// El frame dibuja dos —«Resumen de transacción en Dólares» y «…en Euros»— y eso
// se leyó mal la primera vez. Aclaración del dueño el 2026-10-19: no son dos
// tarjetas a la vez, son **dos ejemplos de lo que esa tarjeta tiene que saber
// pintar**: un abono del 100 % que deja la deuda en cero, y uno parcial que
// deja saldo. Un abono dirigido va a UN fiado, y un fiado tiene UNA moneda.
//
// ===========================================================================
// SE RECONSTRUYE DESDE LA BASE, NO SE PASA POR LA URL
//
// Esta pantalla tiene dirección propia: el tendero puede recargarla o volver a
// ella con el teléfono en la mano para enseñársela al cliente. Un resumen
// armado con lo que la acción devolvió se queda en blanco en cuanto eso pasa —
// es la misma razón escrita en `resumenDeVenta`.
export default async function AbonoRegistradoPage({
  params,
}: {
  params: Promise<{ movementId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: abono } = await supabase
    .from("movements")
    .select(
      "id, client_id, type, amount, currency, created_at, entry_currency, entry_amount, applies_to_movement_id, payment_group_id, clients!inner(id, name, document_id, whatsapp, owner_id)",
    )
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = abono?.clients as unknown as {
    id: string;
    name: string;
    document_id: string | null;
    whatsapp: string | null;
    owner_id: string;
  } | null;
  if (!abono || !cliente || cliente.owner_id !== user.id || abono.type !== "payment") notFound();

  const moneda = (abono.currency ?? "COP") as PriceCurrency;

  // ── SI ESTE ABONO ES PARTE DE UN REPARTO, EL RESUMEN ES DEL BILLETE ──
  //
  // Un pago repartido entre varios fiados son varias filas en `movements`
  // —`applies_to_movement_id` admite un destino por abono— pero UNA cosa que
  // pasó. Enseñar aquí los $1 de la última línea cuando el cliente entregó $20
  // sería darle al tendero un número que él sabe que es falso, y es el mismo
  // razonamiento por el que el recibo de WhatsApp sale una vez y por el total
  // (migración `137`).
  //
  // Se lee la tabla y no `payment_group_summary`: esa función es
  // `security definer` y está concedida solo a `service_role`, para el emisor
  // del recibo. Aquí hay sesión del dueño y RLS encima, que es la vía normal.
  const grupo = (abono as { payment_group_id?: string | null }).payment_group_id ?? null;
  let totalAbonado = Number(abono.amount);
  let lineasDelGrupo = 1;
  // Una entrada por libro tocado. Con un solo libro tiene una sola, y todo lo
  // de abajo se dibuja igual que siempre.
  let abonadoPorMoneda: { currency: LedgerCurrency | null; total: number }[] = [
    { currency: (abono.currency as LedgerCurrency | null) ?? null, total: Number(abono.amount) },
  ];
  let entregadoEnBs =
    abono.entry_currency === "VES" && abono.entry_amount != null
      ? Number(abono.entry_amount)
      : null;

  if (grupo) {
    const { data: lineas } = await supabase
      .from("movements")
      .select("amount, currency, entry_currency, entry_amount")
      .eq("payment_group_id", grupo)
      .is("deleted_at", null);
    if (lineas && lineas.length > 0) {
      lineasDelGrupo = lineas.length;

      // ── UN TOTAL POR LIBRO, Y NO UNA SUMA ──────────────────────────
      //
      // Hasta el 2026-10-23 esto era `lineas.reduce(... + l.amount)`, y era
      // correcto mientras un reparto no podía mezclar monedas. La migración
      // `141` lo permite, y la primera prueba en pantalla enseñó lo que esa
      // suma produce: un billete repartido en 10 EUR y 5 USD salía como
      // «Abonó en Euros €15.00» — una cifra que es falsa en las dos monedas,
      // en la pantalla que el tendero le enseña al cliente con el teléfono en
      // la mano.
      //
      // Se agrupa por moneda y se dibuja una línea por libro. Con un solo
      // libro —todos los repartos anteriores a hoy y la mayoría de los que
      // vendrán— sale exactamente la misma línea de siempre.
      const suma = new Map<string | null, number>();
      for (const l of lineas) {
        const k = (l.currency as string | null) ?? null;
        suma.set(k, (suma.get(k) ?? 0) + Number(l.amount));
      }
      abonadoPorMoneda = [...suma.entries()].map(([currency, total]) => ({
        currency: currency as LedgerCurrency | null,
        total,
      }));
      totalAbonado = abonadoPorMoneda.find((a) => a.currency === (abono.currency ?? null))?.total ??
        Number(abono.amount);
      // LOS BOLÍVARES TAMBIÉN SE SUMAN, por la misma razón: el tendero tecleó
      // UNA cifra y la repartió el servidor. Enseñar la parte de una línea
      // sería enseñarle un trozo de lo que él escribió.
      const bs = lineas
        .filter((l) => l.entry_currency === "VES" && l.entry_amount != null)
        .reduce((s, l) => s + Number(l.entry_amount), 0);
      entregadoEnBs = bs > 0 ? Math.round(bs * 100) / 100 : null;
    }
  }

  // ── LO QUE QUEDA DEBIENDO EN ESTE LIBRO, DESPUÉS DEL ABONO ───────────
  //
  // De la misma función que todo el flujo. Es la suma de lo que siguen debiendo
  // sus fiados abiertos en ESTA moneda — cero cuando el abono lo saldó todo,
  // que es el primero de los dos casos que el frame enseña.
  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  // ── LO QUE QUEDA DEBIENDO, EN CADA LIBRO ─────────────────────────────
  //
  // Filtraba por la moneda del movimiento de entrada, y con un reparto que
  // cruza libros eso MIENTE: se entra por la línea en euros, se filtran los
  // fiados en euros —que el abono saldó— y la pantalla dice «Sin deuda»
  // mientras el cliente sigue debiendo 5 dólares. Visto en dev el 2026-10-23,
  // en la primera prueba de punta a punta.
  //
  // Ahora se agrupa por libro y se dibuja lo que queda en cada uno. «Sin
  // deuda» solo cuando no queda nada en NINGUNO, que es lo que esa frase
  // siempre pretendió decir.
  const pendientePorMoneda = (() => {
    const suma = new Map<string | null, number>();
    for (const c of (abiertos ?? []) as { currency: string | null; pending: number }[]) {
      const k = c.currency ?? null;
      suma.set(k, (suma.get(k) ?? 0) + Number(c.pending));
    }
    return [...suma.entries()]
      .map(([currency, pending]) => ({ currency: currency as LedgerCurrency | null, pending }))
      .filter((x) => x.pending > 0.005);
  })();
  const deudaTotal = pendientePorMoneda
    .filter((c) => c.currency === (abono.currency ?? null))
    .reduce((suma, c) => suma + c.pending, 0);

  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rates = resultado.kind === "ve" ? await getBolivarRates(resultado.context.effectiveRate) : null;

  // ── CUÁNDO PASÓ ──────────────────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-22: esta pantalla no llevaba fecha, ni ella
  // ni la imagen que se comparte desde aquí.
  //
  // SE RESUELVE AQUÍ, EN EL SERVIDOR, Y EN LA ZONA DEL NEGOCIO. Esta página
  // corre en Vercel, que va en UTC: con `formatDate` a secas, un abono de las
  // nueve de la noche en Caracas saldría fechado al día siguiente. Y baja ya
  // formateada al botón de compartir, que corre en el teléfono y usaría LA
  // SUYA.
  //
  // DEL ABONO QUE SE ABRIÓ, aunque sea parte de un reparto: las líneas de un
  // grupo se escriben en la misma transacción, así que comparten instante.
  const cuando = formatReceiptDateTime(
    abono.created_at as string,
    resultado.kind === "ve" ? "VE" : "CO",
  );
  // `deudaEnBs` vivía aquí y se fue con las tarjetas nuevas: ahora cada una
  // convierte LO SUYO, porque cada tarjeta habla de un libro y no de la suma.

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col items-center gap-4 pt-4">
        {/* EL MISMO VERDE QUE LAS OTRAS CONFIRMACIONES, no el negro del texto.
            Lo reportó el dueño el 2026-10-19 con el círculo en rojo sobre el
            ícono: *«debe ser el mismo de las otras pantallas de confirmación,
            este tiene un color distinto»*.

            Las tres que ya existían —`venta-resumen.tsx`, el carrito del
            cliente y la salud de servicios en `/admin`— llevan todas
            `text-emerald-600`, y esta nació en `text-foreground`. Un check
            negro no se lee como «salió bien», se lee como un ícono más de la
            pantalla; el verde es lo único que dice que la operación terminó. */}
        <CheckCircle2 className="size-20 text-emerald-600" aria-hidden="true" />
        {/* «Transacción» Y NO «Abono» desde el 2026-10-22: es lo que dice el
            frame `1524:10289` y lo que ya decía el resumen de una venta, que es
            su pantalla hermana. Un reparto es un abono repartido en varias
            filas, así que «abono registrado» en singular se quedaba corto
            justo donde más se nota. */}
        <h1 className="text-center text-xl leading-7 font-normal">
          ¡Transacción registrada con éxito!
        </h1>
        {/* LA FECHA, DEBAJO DEL TÍTULO Y EN TENUE — misma posición que en el
            PNG que se comparte desde aquí, para que la imagen y la pantalla
            se lean igual. `-mt-2` porque el contenedor ya pone `gap-4` y la
            fecha pertenece al título, no es un bloque aparte. */}
        <p className="-mt-2 text-center text-sm text-muted-foreground">{cuando}</p>
      </div>

      <section className="flex flex-col rounded-[10px] border p-4">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-base font-semibold">Datos del comprador</h2>
          <User className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        {/* LA FILA SE QUEDA AUNQUE EL DATO FALTE, con un guion. Es la regla de
            `DESIGN-SYSTEM.md`: un dato ausente que desaparece no se distingue
            de uno que nunca se pidió. */}
        <Dato etiqueta="Nombre y apellido" valor={cliente.name} />
        <Dato etiqueta="Documento" valor={formatDocumentId(cliente.document_id)} />
        <Dato
          etiqueta="Teléfono"
          valor={cliente.whatsapp ? telefonoLegible(cliente.whatsapp) : "—"}
        />
      </section>

      {/* ══════════════════════════════════════════════════════════════
          UNA TARJETA POR LIBRO — frames `1576:11405` y `1576:11484`

          Encargo del dueño el 2026-10-23 (`CT-135`), con los dos frames: el
          libro al que se abonó lleva su tarjeta completa, y el libro al que
          NO se abonó pero todavía debe lleva una tarjeta aparte, reducida a
          su «Deuda total».

          QUÉ SUSTITUYE, Y POR QUÉ NO ERA SOSTENIBLE: hasta hoy había UNA
          tarjeta y, debajo de «Deuda total», las cifras de los dos libros
          apiladas. Leído de corrido, «Deuda total: €40,95 $7,50» se parece
          demasiado a una suma — y las dos monedas de esta app no se suman
          nunca. El frame lo resuelve separando: cada libro, su tarjeta.

          LA BANDERA ESTÁ EN UN SITIO DISTINTO EN CADA UNA, y es deliberado:
          en la tarjeta con título la lleva la cabecera (24px) y el importe NO
          la repite; en la tarjeta sin título la lleva el importe (16px),
          porque es lo único que dice de qué libro habla. Es la regla de
          `DESIGN-SYSTEM.md` —la bandera va donde identifica— aplicada a dos
          casos distintos. */}
      {abonadoPorMoneda.map((a, i) => {
        const cur = (a.currency ?? "COP") as PriceCurrency;
        const pendienteDeEste =
          pendientePorMoneda.find((p) => (p.currency ?? null) === (a.currency ?? null))?.pending ??
          0;
        const debe = pendienteDeEste > 0.005;
        const enBs =
          rates && debe
            ? priceIn("VES", { amount: pendienteDeEste, currency: cur }, rates)?.amount
            : null;

        return (
          <section
            key={`abonado-${a.currency ?? "cop"}`}
            className="flex flex-col rounded-[10px] border p-4"
          >
            <div className="flex items-center justify-between pt-2 pb-4">
              <h2 className="text-base font-semibold">
                Resumen de transacción en {nombreDeMoneda(cur)}
              </h2>
              <CurrencyFlagIcon currency={cur} className="size-6 shrink-0" aria-hidden="true" />
            </div>

            <div className="flex items-center justify-between py-3">
              <span className="text-xs">Abonó en {nombreDeMoneda(cur)}</span>
              <span className="text-xs tabular-nums">{formatPriceAmount(a.total, cur)}</span>
            </div>

            {/* ── LAS DOS LÍNEAS QUE NO DIBUJA EL FRAME, Y VAN UNA SOLA VEZ ──
                «Entregó» son los bolívares que el tendero TECLEÓ y «Repartido
                entre N fiados» cuenta que ese billete cubrió varios. Las dos
                describen EL BILLETE, que es uno solo aunque haya tocado dos
                libros — así que se escriben en la primera tarjeta y no se
                repiten en la segunda. Repetirlas sería contar dos veces lo
                que el cliente entregó una. */}
            {i === 0 && entregadoEnBs != null ? (
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-muted-foreground">Entregó</span>
                <span className="text-sm tabular-nums">{formatBs(entregadoEnBs)}</span>
              </div>
            ) : null}
            {i === 0 && lineasDelGrupo > 1 ? (
              <p className="pt-1 pb-2 text-xs text-muted-foreground">
                Repartido entre {lineasDelGrupo} fiados.
              </p>
            ) : null}

            <div className="flex items-start justify-between border-t pt-3">
              <span className="text-base font-semibold">Deuda total</span>
              <div className="flex flex-col items-end gap-1">
                {/* CERO NO SE ESCRIBE «$0,00»: se dice que no debe nada, que
                    es lo que el tendero le lee en voz alta al cliente. El
                    frame dibuja `$0,00` en todas sus cifras porque es su
                    estado vacío de maqueta, no una decisión sobre el cero. */}
                {debe ? (
                  <span className="text-base font-semibold tabular-nums">
                    {formatPriceAmount(pendienteDeEste, cur)}
                  </span>
                ) : (
                  <span className="text-base font-semibold">Sin deuda</span>
                )}
                {enBs != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(enBs)} hoy
                  </span>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}

      {/* ── EL LIBRO AL QUE NO SE ABONÓ Y TODAVÍA DEBE — frame `1576:11484` ──
          Sin título y sin más filas: solo su «Deuda total». Aquí el importe SÍ
          lleva bandera, porque sin cabecera es lo único que dice de qué libro
          habla.

          SOLO SE DIBUJA SI DEBE. Un libro saldado no tiene nada que decir en
          esta pantalla, y uno a FAVOR tampoco: la tarjeta se titula «Deuda
          total» y poner ahí un saldo a favor sería llamar deuda a lo
          contrario. `pendientePorMoneda` ya filtra los dos casos. */}
      {pendientePorMoneda
        .filter((p) => !abonadoPorMoneda.some((a) => (a.currency ?? null) === (p.currency ?? null)))
        .map((p) => {
          const cur = (p.currency ?? "COP") as PriceCurrency;
          const enBs = rates
            ? priceIn("VES", { amount: p.pending, currency: cur }, rates)?.amount
            : null;
          return (
            <section
              key={`debe-${p.currency ?? "cop"}`}
              className="flex items-start justify-between rounded-[10px] border p-4"
            >
              <span className="text-base font-semibold">Deuda total</span>
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                  <CurrencyFlagIcon currency={cur} className="size-4 shrink-0" aria-hidden="true" />
                  {formatPriceAmount(p.pending, cur)}
                </span>
                {enBs != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(enBs)} hoy
                  </span>
                ) : null}
              </div>
            </section>
          );
        })}

      {/* ══════════════════════════════════════════════════════════════
          EL FLOTANTE TODAVÍA PISA ESTOS BOTONES, Y QUEDA ABIERTO

          Reportado por el dueño el 2026-10-22. Medido a 375px: el flotante
          ocupa 652-708 y «Ver cuenta de…» ocupa 628-668. Dieciséis píxeles.

          QUÉ SE PROBÓ Y POR QUÉ NO BASTA, para que nadie lo repita:

            · Subir el `pb` de `app-main.tsx` a 5,5rem, como el resumen de una
              venta. HECHO, y mejora el caso desplazado —abajo del todo los
              botones acaban en 636, por encima de los 652 del flotante— pero
              NO el de reposo: un `padding` por debajo no sube contenido que
              ya está colocado.
            · `mt-auto` en el bloque de acciones. No hace nada: con ese `pb`
              la página ya mide 844 contra 812 de pantalla, así que no sobra
              espacio que repartir. Se escribió y se quitó el mismo día.

          POR QUÉ EL RESUMEN DE UNA VENTA NO FALLA: su contenido es MÁS LARGO,
          así que sus botones nacen fuera de la pantalla y para verlos hay que
          desplazarse —y al hacerlo quedan despejados—. Aquí el contenido
          termina justo dentro de la banda del flotante.

          LO QUE QUEDA ES UNA DECISIÓN SUYA, NO MÍA: con un botón fijo en esa
          banda y un contenido que termina dentro de ella, no hay arreglo de
          CSS que conserve los dos. O el flotante no se dibuja aquí —lo cual
          revierte su petición del 2026-10-18— o sube unos píxeles solo en
          estas pantallas. Preguntado el 2026-10-22.

          ────────────────────────────────────────────────────────────────
          «COMPARTIR», ENCIMA DE «VER CUENTA». Pedido del dueño el 2026-10-19,
          y manda la MISMA IMAGEN PNG que el resumen de una venta — fue su
          elección entre eso y mandar texto. El orden es el del resumen de
          venta: compartir primero, porque es lo que el tendero hace nada más
          cobrar, con el cliente todavía delante.

          `rates` puede ser `null` en un negocio colombiano, y entonces la
          imagen simplemente no lleva la línea de bolívares. */}
      <AbonoCompartir
        comprador={{
          nombre: cliente.name,
          documento: formatDocumentId(cliente.document_id),
          telefono: cliente.whatsapp ? telefonoLegible(cliente.whatsapp) : "—",
        }}
        abono={{
          currency: moneda,
          abonado: totalAbonado,
          // Los bolívares TECLEADOS, no una conversión de hoy. Misma razón que
          // la fila «Entregó» de arriba.
          entregadoBs: entregadoEnBs,
          deuda: deudaTotal,
        }}
        rates={rates}
        fecha={cuando}
      />

      {/* EL BOTON VA EN EL FLUJO, NO PEGADO ABAJO, y es a proposito: esta
          pantalla SI lleva barra de navegacion —vive en `/abonos/<id>`, fuera
          de `/abonos/nuevo`, que es lo que `mobile-nav.tsx` suprime— asi que
          una barra pegada encima de ella duplicaria el aire y se quedaria
          flotando a media altura al final del scroll. Es el mismo descuadre que
          `app-main.tsx` tiene medido en pantalla.
          El resumen de la venta hace exactamente esto por la misma razon. */}
      <Button asChild variant="outline" className="h-10 w-full text-base font-semibold">
        <Link href={`/clients/${cliente.id}`}>Ver cuenta de {cliente.name}</Link>
      </Button>
    </div>
  );
}

function nombreDeMoneda(c: string) {
  return c === "USD" ? "Dólares" : c === "EUR" ? "Euros" : c === "VES" ? "Bolívares" : "Pesos";
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span className="truncate text-sm">{valor}</span>
    </div>
  );
}
