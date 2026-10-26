import { notFound, redirect } from "next/navigation";
import { OrderClientCard } from "@/components/dashboard/order-client-card";
import { OrderCurrencyBlockCard } from "@/components/dashboard/order-currency-block-card";
import {
  OrderRegistrationSummary,
  type LineaDelPedido,
} from "@/components/dashboard/order-registration-summary";
import { OrderStepCounter } from "@/components/dashboard/order-step-counter";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { getBolivarRates } from "@/lib/products/catalog";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { bloquesDeMoneda } from "@/lib/orders/bloques-de-moneda";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  type CatalogOrderItemRow,
  type CatalogOrderRow,
} from "@/lib/orders/catalog-orders";
import { findOrderClient } from "@/lib/orders/order-client-match";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { readOwnerCountry } from "@/lib/owner-country";
import { formatReceiptDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// STEP `1/4 Pedido` — frame `1652:12752`, read with the desktop bridge on
// 2026-10-25.
//
// ===========================================================================
// POR QUÉ ESTA PANTALLA EXISTE APARTE DEL DETALLE DEL PEDIDO
//
// Son dos frames distintos y el sitemap los une con una flecha: «Detalle de
// pedido» (`1655:15864`) --«Selecciona "Registrar pedido"»--> «1/4 Pedido».
//
// Hasta el 2026-10-25 el detalle hacía las dos cosas: enseñaba el pedido Y
// ofrecía registrar cada moneda. Funcionaba, y aun así son dos pantallas por
// una razón que se nota con el cliente delante: al detalle se llega para
// MIRAR --qué pidió, cuándo, si ya está atendido-- y una pantalla que además
// tiene botones que escriben dinero invita a tocarlos sin haber decidido
// nada. Separarlas convierte «voy a registrar esto» en una decisión con su
// propio toque.
//
// EL DETALLE SE QUEDA CON LO QUE NO ESCRIBE: la tarjeta «Datos del
// comprador» en frío, los totales y «Contactar vía WhatsApp». Aquí vive todo
// lo que termina en una venta.
//
// Y LAS DOS TARJETAS DE COMPRADOR SON DISTINTAS A PROPÓSITO desde el
// 2026-10-25. Esta --`OrderClientCard`-- coteja contra la cuenta y abre la
// ficha, porque aquí es donde se decide a quién se le apunta la deuda; la del
// detalle es una lista de datos y nada más. Eran la misma y el dueño leyó las
// dos pantallas como una sola.
// LA MISMA FILA QUE EL DETALLE: rótulo a la izquierda, valor a la derecha.
// Copiada y no importada porque son cuatro líneas y exportarla desde una
// `page.tsx` de Next para que otra la use es un acoplamiento peor que la
// copia. Si crecen, se van a un componente las dos a la vez.
function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{nombre}</span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
    </div>
  );
}

export default async function RegistrarPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // `.eq("owner_id", user.id)` EXPLÍCITO: el id viene de la URL.
  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) console.error("[orders] 1/4 pedido:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  // UN PEDIDO TERMINADO NO VUELVE A ENTRAR AQUÍ. `registered_at` y no
  // `sale_id`: desde la migración `158` el segundo guarda solo la PRIMERA
  // venta, así que está puesto mientras el pedido va por la mitad.
  if (pedido.registered_at != null) redirect(`/productos/ordenes/${pedido.id}`);

  const { data: filas } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", pedido.id);
  const items = (filas ?? []) as CatalogOrderItemRow[];

  const [clienteDelPedido, rateContext] = await Promise.all([
    findOrderClient(
      supabase,
      user.id,
      pedido.customer_document,
      pedido.customer_document_type,
    ),
    getOwnerRateContext(supabase, user.id),
  ]);
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  // LO QUE ESTE COMPRADOR YA DEBÍA, para la fila «Deuda antigua» del resumen.
  // Solo cuando hay UNA ficha emparejada: con varias no se sabe de cuál es el
  // saldo, y enseñar el de una cualquiera sería peor que no enseñar ninguno.
  const deudaAntigua: Partial<Record<PriceCurrency, number>> = {};
  if (clienteDelPedido.kind === "uno") {
    const { data: saldo } = await supabase
      .from("client_summary")
      .select("balance, balance_usd, balance_eur")
      .eq("client_id", clienteDelPedido.cliente.id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (saldo) {
      if (saldo.balance_usd != null) deudaAntigua.USD = Number(saldo.balance_usd);
      if (saldo.balance_eur != null) deudaAntigua.EUR = Number(saldo.balance_eur);
      if (saldo.balance != null && saldo.balance_usd == null && saldo.balance_eur == null) {
        // Un negocio colombiano lleva un solo libro y su moneda es `null` en
        // `movements`; `client_summary` lo deja en `balance` a secas.
        deudaAntigua.COP = Number(saldo.balance);
      }
    }
  }

  // CUÁNDO PIDIÓ, EN LA ZONA DEL DUEÑO y no en la del servidor, que corre en
  // UTC. La misma función que el detalle, para que las dos pantallas escriban
  // la misma fecha con las mismas palabras.
  const country = await readOwnerCountry(supabase, user.id);
  const cuando = formatReceiptDateTime(pedido.created_at, country);

  // Solo dígitos. La columna ya viene normalizada; esto cubre lo que haya
  // entrado por otra puerta que el carrito.
  const whatsappDigits = (pedido.customer_whatsapp ?? "").replace(/\D/g, "");
  const primerNombre = pedido.customer_name.trim().split(/\s+/)[0];
  const mensajeWhatsapp = `Hola ${primerNombre}, sobre tu pedido...`;

  const bloques = bloquesDeMoneda(items, undefined);
  const lineasParaResumen: LineaDelPedido[] = items.map((i) => ({
    id: i.id,
    cantidad: Number(i.quantity),
    precioUnitario: Number(i.unit_price),
    moneda: i.currency as PriceCurrency,
  }));

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}`}
        soloEnTelefono={false}
      />
      <ScreenTitle>Nuevo pedido</ScreenTitle>
      <OrderStepCounter pedidoId={pedido.id} paso={1} nombre="Pedido" />

      <OrderClientCard
        nombreDelPedido={pedido.customer_name}
        documentoDelPedido={pedido.customer_document ?? ""}
        tipoDeDocumento={pedido.customer_document_type}
        telefono={pedido.customer_whatsapp_raw ?? pedido.customer_whatsapp ?? ""}
        coincidencia={clienteDelPedido}
        // La tasa vigente, para la hoja de la cuenta del cliente.
        ledger={rateContext ? { rate: rateContext.effectiveRate } : null}
      />

      {/* ── LAS DOS FILAS DEL PEDIDO Y EL BOTÓN DE WHATSAPP ────────────
          Frame `1652:12752`, nodos «Order Details» y «WhatsApp button»: van
          AQUÍ, entre la tarjeta del comprador y la sección «Pedido». Faltaban
          desde que este paso nació, y no por decisión: se quedaron en el
          detalle al partir la pantalla en dos.

          NO SON UNA REPETICIÓN DEL DETALLE aunque las dos pantallas las
          dibujen. Lo que contestan cambia de sitio con el tendero: en el
          detalle, «¿cuándo pidió esto y puedo escribirle?»; aquí, con el
          cliente al teléfono y a punto de apuntarle una deuda, «¿esto es de
          hoy, y tengo permiso para mandarle el recibo?». La segunda decide si
          marca la casilla de avisos en el paso 4/4.

          SIN EL LÁPIZ QUE DIBUJA EL FRAME. Corregir la fecha de un pedido o
          el permiso de WhatsApp no está construido --el permiso va por número
          y no por cliente, que es `CT-69` y sigue abierto--, y un icono de
          editar que no edita es peor que ninguno. */}
      <div className="flex flex-col rounded-[10px] border px-4 py-1">
        <Fila nombre="Fecha del pedido:">{cuando}</Fila>
        <Fila nombre="Notificaciones por WhatsApp">
          {pedido.wants_whatsapp_notices ? "Aceptada" : "Sin aceptar"}
        </Fila>
      </div>

      {whatsappDigits ? (
        <a
          href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(mensajeWhatsapp)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          Contactar vía WhatsApp
          <WhatsappIcon className="size-4" />
        </a>
      ) : null}

      <h2 className="mt-1 text-xl font-semibold">Pedido</h2>
      <div className="flex flex-col gap-2">
        {/* EN QUÉ VA A QUEDAR ESTE PEDIDO, en cuanto haya algo registrado. No
            dibuja nada hasta entonces, que es la diferencia entre los dos
            estados de este frame. */}
        <OrderRegistrationSummary
          pedidoId={pedido.id}
          lineas={lineasParaResumen}
          deudaAntigua={deudaAntigua}
          rates={rates}
        />
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Este pedido no tiene líneas.
          </p>
        ) : (
          bloques.map((bloque) => (
            <OrderCurrencyBlockCard
              key={bloque.moneda}
              pedidoId={pedido.id}
              bloque={bloque}
              rates={rates}
              hrefRegistrar={`/productos/ordenes/${pedido.id}/registrar/confirmar?moneda=${bloque.moneda}`}
            />
          ))
        )}
      </div>

      {/* ── AQUÍ NO VA NINGÚN BOTÓN, Y ESO ES LO QUE DICE EL SITEMAP ───
          Los dos frames de esta pantalla --`1652:12752` en la primera pasada
          y `1654:15525` en la segunda-- terminan en los bloques de moneda.
          Ninguno dibuja un pie. El único camino hacia adelante es el
          «Registrar» de un bloque, y el segundo frame lo confirma: con los
          dólares ya resueltos su botón pasa a «Editar» y el de los euros
          sigue diciendo «Registrar».

          ═══════════════════════════════════════════════════════════════
          AQUÍ VIVÍA «CONTINUAR», Y SE QUITÓ EL 2026-10-25

          El dueño lo aprobó avisado de que era suyo --regla del 2026-10-24,
          *«aparecerá solo cuando al menos uno de los productos ya esté
          registrado»*, con su modal de «faltan X»--. Lo que inclinó la
          balanza fue medirlo: **el botón mentía y daba vueltas.**

          Recorrido real, medido en dev el 2026-10-25 con un pedido de dos
          monedas: «Continuar» → modal *«Falta 1 moneda por registrar. Lo de
          esa moneda no entrará en la venta»* → «Continuar igual» → 4/4
          Información del cliente → «Registrar» → **otra vez el 1/3 con
          «Continuar»**. El bucle es inevitable por construcción: la pantalla
          del cliente solo escribe la venta cuando NO queda ninguna moneda
          pendiente, así que con una pendiente guarda la ficha en el borrador
          y devuelve aquí. Siempre.

          O sea que la promesa del modal --«esa moneda no entrará en la
          venta»-- nunca se cumplió: no había forma de registrar parte de un
          pedido, solo una puerta que parecía serlo.

          ───────────────────────────────────────────────────────────────
          LO QUE SE PIERDE, DICHO EN VOZ ALTA

          Con esto, la regla del 2026-10-24 --dejar fuera una moneda a
          propósito-- queda SIN IMPLEMENTAR, no implementada de otra forma.
          El tendero que solo quiera registrar los dólares de un pedido mixto
          tiene que registrar también los euros o salirse (la flecha de
          atrás; el borrador se queda en el navegador y la base no recibe
          nada). Está dicho en el informe del día para que el dueño decida si
          lo quiere de vuelta bien hecho. */}
    </div>
  );
}
