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
      "id, client_id, type, amount, currency, created_at, entry_currency, entry_amount, applies_to_movement_id, payment_group_id, transaction_code, clients!inner(id, name, document_id, whatsapp, owner_id)",
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
  // Los bolívares que le tocaron a cada libro. Vacío cuando no se pagó en
  // bolívares. Ver dónde se llena, más abajo.
  let bsPorMoneda = new Map<string | null, number>(
    abono.entry_currency === "VES" && abono.entry_amount != null
      ? [[(abono.currency as string | null) ?? null, Number(abono.entry_amount)]]
      : [],
  );

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
      // LOS BOLÍVARES TAMBIÉN SE SUMAN, por la misma razón: el tendero tecleó
      // UNA cifra y la repartió el servidor. Enseñar la parte de una línea
      // sería enseñarle un trozo de lo que él escribió.
      const bs = lineas
        .filter((l) => l.entry_currency === "VES" && l.entry_amount != null)
        .reduce((s, l) => s + Number(l.entry_amount), 0);
      entregadoEnBs = bs > 0 ? Math.round(bs * 100) / 100 : null;

      // ── Y ADEMÁS, CUÁNTOS DE ESOS BOLÍVARES FUE A CADA LIBRO ────────
      //
      // Es la cifra que faltaba y la que hacía confusa esta pantalla. Hasta
      // hoy el billete entero salía como «Entregó» DENTRO de la tarjeta de
      // dólares, así que un reparto de Bs. 5.000 entre dos libros se leía
      // como si los 5.000 hubieran ido a dólares — y la tarjeta de euros no
      // mencionaba bolívares en absoluto.
      //
      // `entry_amount` ya viene por línea, así que esto no calcula nada: lo
      // agrupa. Y por eso son los bolívares TECLEADOS y no una conversión de
      // hoy — las partes suman exactamente el billete que el tendero escribió.
      const sumaBs = new Map<string | null, number>();
      for (const l of lineas) {
        if (l.entry_currency !== "VES" || l.entry_amount == null) continue;
        const k = (l.currency as string | null) ?? null;
        sumaBs.set(k, (sumaBs.get(k) ?? 0) + Number(l.entry_amount));
      }
      bsPorMoneda = new Map(
        [...sumaBs.entries()].map(([k, v]) => [k, Math.round(v * 100) / 100]),
      );
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

  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rates = resultado.kind === "ve" ? await getBolivarRates(resultado.context.effectiveRate) : null;

  // ═══════════════════════════════════════════════════════════════════════
  // LOS LIBROS DEL ABONO, EN EL ORDEN EN QUE SE LEEN
  //
  // Se arma UNA vez y la usan las tres superficies: las tarjetas de abajo, la
  // imagen que se comparte y su respaldo en texto. Separarlas es cómo el
  // recibo acaba contando una cuenta distinta de la que el tendero tiene
  // delante.
  //
  // EL ORDEN LO PIDIÓ EL DUEÑO el 2026-10-23: *«la moneda que más se le abonó
  // arriba y la menor abajo»*. Hasta hoy era el orden en que salían de la
  // consulta, que en la práctica era dólares y luego euros, siempre.
  //
  // «MÁS ABONADO» SE COMPARA EN BOLÍVARES, y no es un detalle: $1,00 y €4,14
  // no se pueden ordenar por su número, que es comparar dos cosas distintas.
  // Con la tasa del día, $1,00 son Bs. 886 y €4,14 son Bs. 4.114 — el euro va
  // arriba, y por el número suelto habría salido igual por casualidad. Una
  // casualidad que se rompe en cuanto las cifras se acercan.
  //
  // Y SE COMPARA CON LOS BOLÍVARES TECLEADOS cuando los hay, que es el caso
  // que motivó esto: son exactamente lo que el tendero repartió. Sin ellos se
  // convierte a la tasa de hoy, y sin tasa queda el importe a secas — que
  // basta, porque sin bolívares el reparto no cruza libros y solo hay uno.
  const enBolivaresPara = (currency: LedgerCurrency | null, importe: number) => {
    const tecleados = bsPorMoneda.get(currency ?? null);
    if (tecleados != null) return tecleados;
    if (!rates) return importe;
    return (
      priceIn("VES", { amount: importe, currency: (currency ?? "COP") as PriceCurrency }, rates)
        ?.amount ?? importe
    );
  };
  const librosDelAbono = [...abonadoPorMoneda].sort(
    (a, b) => enBolivaresPara(b.currency, b.total) - enBolivaresPara(a.currency, a.total),
  );
  // EL BILLETE, UNA SOLA VEZ Y ARRIBA DEL TODO — frame `1588:11262`. Solo
  // cuando se pagó en bolívares Y el reparto tocó más de un libro: con un
  // libro, «Abonó Bs. X» y la línea de la tarjeta dirían el mismo número dos
  // veces seguidas, y la pantalla de un abono corriente no cambia.
  const billeteEnBs = librosDelAbono.length > 1 ? entregadoEnBs : null;

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
        {/* EL CÓDIGO TAMBIÉN AQUÍ, porque esta pantalla es el gemelo en vivo
            del comprobante que se comparte: si el PNG lo lleva y la pantalla
            no, el tendero que compara los dos cree que falta algo. Centrado
            con la fecha, que es la otra etiqueta de la transacción entera. */}
        {abono.transaction_code ? (
          <p className="-mt-2 text-center text-sm font-medium text-muted-foreground tabular-nums">
            Código de transacción: {abono.transaction_code as string}
          </p>
        ) : null}
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
      {/* ── EL BILLETE, UNA SOLA VEZ — frame `1588:11262` ────────────────
          «Abonó  Bs. 5.000,00» con la bandera de Venezuela. Es lo que el
          cliente puso en la mano, antes de que nada se reparta.

          POR QUÉ ESTO ARREGLA LA CONFUSIÓN, que es lo que el dueño reportó:
          esa cifra estaba DENTRO de la tarjeta de dólares, bajo el rótulo
          «Entregó». Leída ahí, Bs. 5.000 parecían los bolívares que fueron a
          dólares — y la tarjeta de euros no hablaba de bolívares, así que no
          había forma de ver que también le habían tocado. Sacándola arriba
          deja de pertenecer a un libro: es el billete, y debajo cada libro
          dice su parte. */}
      {billeteEnBs != null ? (
        <section className="flex items-center justify-between rounded-[10px] border px-4 py-2">
          <span className="text-sm">Abonó</span>
          <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
            {formatBs(billeteEnBs)}
            <CurrencyFlagIcon currency="VES" className="size-4 shrink-0" aria-hidden="true" />
          </span>
        </section>
      ) : null}

      {/* VA CON EL BILLETE Y NO DENTRO DE UN LIBRO, por lo mismo: cuenta
          cuántos fiados cubrió ESE billete, no cuántos de este libro. No está
          en el frame y se deja a propósito — es la única línea que dice que
          detrás de dos tarjetas hay varios fiados. */}
      {billeteEnBs != null && lineasDelGrupo > 1 ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Repartido entre {lineasDelGrupo} fiados.
        </p>
      ) : null}

      {librosDelAbono.map((a, i) => {
        const cur = (a.currency ?? "COP") as PriceCurrency;
        // Los bolívares de ESTE libro, y solo cuando el billete se repartió
        // entre varios: con uno solo la cifra ya la dice «Entregó».
        const bsDeEste = billeteEnBs != null ? (bsPorMoneda.get(a.currency ?? null) ?? null) : null;
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

            {/* ── LO QUE ENTRÓ EN ESTE LIBRO — frames `1588:11177` y
                `1588:11284` ────────────────────────────────────────────
                Dos formas, y la que sale depende de en qué se pagó:

                · REPARTIENDO UN BILLETE EN BOLÍVARES entre varios libros,
                  manda el bolívar: arriba «Bs. 4.114,00» con su bandera y
                  debajo, en pequeño, «€4.14». Es el orden del frame, y es el
                  orden en que el tendero lo vive — entregó bolívares y quiere
                  saber cuántos fueron a cada cuenta.

                · EN CUALQUIER OTRO CASO sale como siempre, «Abonó en Dólares
                  $1.00». Un abono que no cruza libros no tiene nada que
                  repartir, y meterle una conversión a bolívares sería añadir
                  una cifra donde no había pregunta. */}
            <div className="flex items-start justify-between gap-1 py-3">
              <span className="text-sm">
                {bsDeEste != null ? "Abonó a esta cuenta" : `Abonó en ${nombreDeMoneda(cur)}`}
              </span>
              {bsDeEste != null ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="flex items-center gap-1 text-sm tabular-nums">
                    {formatBs(bsDeEste)}
                    <CurrencyFlagIcon currency="VES" className="size-4 shrink-0" aria-hidden="true" />
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatPriceAmount(a.total, cur)}
                  </span>
                </div>
              ) : (
                <span className="text-sm tabular-nums">{formatPriceAmount(a.total, cur)}</span>
              )}
            </div>

            {/* «Entregó» VIVÍA AQUÍ y se fue arriba, a su propia tarjeta,
                el 2026-10-23: dentro de un libro, el billete entero se lee
                como si fuera de ese libro. Queda la versión de un solo libro,
                donde no hay nada que repartir y la cifra sí es suya. */}
            {i === 0 && billeteEnBs == null && entregadoEnBs != null ? (
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-muted-foreground">Entregó</span>
                <span className="text-sm tabular-nums">{formatBs(entregadoEnBs)}</span>
              </div>
            ) : null}
            {i === 0 && billeteEnBs == null && lineasDelGrupo > 1 ? (
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
          // EL CÓDIGO DE ESTA TRANSACCIÓN. Es el mismo en las tres líneas de
          // un reparto, así que da igual por cuál se haya entrado aquí.
          codigo: (abono.transaction_code as string | null) ?? null,
          // Los bolívares TECLEADOS, no una conversión de hoy. Misma razón que
          // la fila «Entregó» de arriba.
          billeteBs: billeteEnBs,
          // La línea «Entregó» solo existe en el caso de un libro, igual que
          // en la pantalla: con varios, el billete tiene su propia tarjeta.
          entregadoBs: billeteEnBs == null ? entregadoEnBs : null,
          // EL MISMO ARRAY QUE DIBUJA LA PANTALLA, ya ordenado. La imagen no
          // lo vuelve a ordenar: el recibo que se queda en el chat del cliente
          // tiene que contar la cuenta en el mismo orden que el tendero acaba
          // de leerle en voz alta.
          libros: librosDelAbono.map((a) => ({
            currency: (a.currency ?? "COP") as PriceCurrency,
            abonado: a.total,
            abonadoBs: billeteEnBs != null ? (bsPorMoneda.get(a.currency ?? null) ?? null) : null,
            deuda:
              pendientePorMoneda.find((p) => (p.currency ?? null) === (a.currency ?? null))
                ?.pending ?? 0,
          })),
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
