import { notFound, redirect } from "next/navigation";
import { OrderCurrencyBlockCard } from "@/components/dashboard/order-currency-block-card";
import { OrderCurrencyRestoreCard } from "@/components/dashboard/order-currency-restore-card";
import { OrderStepCounter } from "@/components/dashboard/order-step-counter";
import { OrderRegisteredClientCard } from "@/components/dashboard/order-registered-client-card";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { getBolivarRates } from "@/lib/products/catalog";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { bloquesDeMoneda } from "@/lib/orders/bloques-de-moneda";
import {
  quitadasPorMoneda,
  unicaMonedaDelPedido,
} from "@/lib/orders/pasos-del-registro";
import {
  estaDescartado,
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  type CatalogOrderItemRow,
  type CatalogOrderRow,
} from "@/lib/orders/catalog-orders";
import { findOrderClient } from "@/lib/orders/order-client-match";
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
  //
  // Y UNO DESCARTADO TAMPOCO, desde el 2026-10-26. Ver `estaDescartado`: sin
  // esta mitad, descartar un pedido y volver por la flecha de atrás del
  // navegador escribía la venta igual.
  if (pedido.registered_at != null || estaDescartado(pedido)) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const { data: filas } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    // SOLO LAS VIVAS -- migración `161`. Las quitadas se leen aparte, abajo,
    // para dibujar su tarjeta de «Restaurar».
    .is("deleted_at", null)
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

  const bloques = bloquesDeMoneda(items, undefined);

  // LAS MONEDAS QUITADAS. Deciden dos cosas: la tarjeta de «Restaurar» de
  // abajo y si esta pantalla sigue teniendo trabajo. Ver `quitadasPorMoneda`.
  const quitadas = await quitadasPorMoneda(supabase, pedido.id);

  const unicaMoneda = unicaMonedaDelPedido(bloques, quitadas.size > 0);
  if (unicaMoneda) {
    redirect(
      `/productos/ordenes/${pedido.id}/registrar/confirmar?moneda=${unicaMoneda}`,
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}`}
        soloEnTelefono={false}
      />
      <ScreenTitle>Nuevo pedido</ScreenTitle>
      {/* `sinPasoDePedido={false}` SIEMPRE AQUÍ, y no es un literal perezoso:
          si fuera `true` esta pantalla no existiría — el redirect de arriba ya
          se habría llevado al tendero. */}
      <OrderStepCounter pedidoId={pedido.id} paso="pedido" sinPasoDePedido={false} />

      {/* ── AQUÍ YA NO VA NADA DEL COMPRADOR, Y ES EL ENCARGO ──────────
          El frame `1652:12752` se rehizo el 2026-10-26 y esta pantalla se
          quedó con el título, el contador y los bloques de moneda. Sus
          palabras: *«el cambio se basa en dejar solo los pedidos por
          moneda»*.

          QUÉ SE QUITÓ: la tarjeta del comprador con su avatar, el aviso de
          si ya está en la cuenta, los botones «Ver ‹cliente›» / «Ver
          clientes», las filas «Fecha del pedido» y «Notificaciones por
          WhatsApp», y «Contactar vía WhatsApp». Todo eso estaba aquí esta
          misma mañana porque el frame de entonces lo dibujaba.

          Y TIENE SENTIDO CON LO DE AYER: esta pantalla solo existe cuando el
          pedido tiene MÁS DE UNA moneda, así que su única pregunta es «¿cuál
          registro primero?». Quién pidió y si ya está en la cuenta se
          contesta en el detalle, una pantalla antes, donde el aviso vive
          ahora dentro de la tarjeta «Datos del comprador».

          ───────────────────────────────────────────────────────────────
          LO QUE SE PIERDE, DICHO EN VOZ ALTA

          «Ver ‹cliente›» DESAPARECE DEL FLUJO salvo en el paso 4/4. El dueño
          pidió el 2026-10-25 que ese botón abriera una hoja *«en todas las
          pantallas del flujo de registrar pedido»*; de las dos que lo tenían,
          una lo perdió ayer con la tarjeta nueva del detalle y la otra lo
          pierde hoy. Queda en el 4/4, que es donde se decide a quién se le
          apunta la deuda.

          Y CON ÉL, «Ver clientes»: un pedido cuyo documento coincide con
          VARIAS fichas ya no tiene desde aquí forma de mirarlas. El aviso del
          detalle lo sigue diciendo --«ya existe en varias cuentas»-- pero
          hasta el 4/4 no hay dónde abrirlas. */}
      {/* ── EL CLIENTE QUE QUEDÓ APUNTADO EN LA PRIMERA MONEDA ─────────
          Frame `1708:15043`: la tarjeta va ARRIBA del título «Pedido», no
          entre los bloques. Solo se dibuja a partir de la segunda pasada
          --antes no hay cliente que enseñar-- y por eso es un componente de
          navegador: ese dato vive en el borrador, que el servidor no ve. */}
      <OrderRegisteredClientCard pedidoId={pedido.id} />

      <h2 className="mt-1 text-xl font-semibold">Pedido</h2>
      <div className="flex flex-col gap-2">
        {/* ── AQUÍ NO VA NINGÚN RESUMEN DE LA VENTA ──────────────────
            Vivía aquí `OrderRegistrationSummary` --«Total en X», «Abonó»,
            «Debe (esta venta)», «Deuda antigua», «Deuda total»-- desde el
            frame `1564:11979`. El dueño lo mandó quitar el 2026-10-26:
            *«está mal, en ningún momento te pedí que la agregaras.
            Elimínala de allí, en este punto no se ha registrado la venta»*.

            Y LA RAZÓN QUE DA ES DE FONDO, no de maquetación: cobrar la
            primera moneda es un PRE-REGISTRO. La venta no existe hasta que
            se registran las dos, así que una tarjeta que anuncia «Deuda
            total» en medio del flujo afirma algo que la base todavía no
            dice. Si el tendero se va ahí, no hay deuda ninguna.

            EL FRAME NUEVO DE ESTA PANTALLA (`1708:15043`) tampoco la dibuja:
            entre la tarjeta del cliente y los bloques de moneda no hay nada.

            `resumirPorMoneda` SE QUEDA EXPORTADA en
            `order-registration-summary.tsx`: es la única cuenta de «qué hay
            resuelto» del flujo y tenerla en un sitio es lo que impide que dos
            pantallas se contradigan. */}
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
              // LA ÚLTIMA MONEDA NO SE QUITA. Lo decide la PÁGINA porque la
              // pregunta es sobre el pedido entero y cada tarjeta solo conoce
              // su bloque. La acción del servidor lo vuelve a comprobar.
              sePuedeQuitar={bloques.length > 1}
            />
          ))
        )}

        {/* ── LO QUITADO, EN SU SITIO ──────────────────────────────────
            Encargo del dueño el 2026-10-26, con el patrón que él mismo
            nombró: la fila quitada de la verificación de la libreta. Se
            queda a la vista para poder devolverla antes de registrar. */}
        {[...quitadas.entries()].map(([moneda, cuantos]) => (
          <OrderCurrencyRestoreCard
            key={`quitada-${moneda}`}
            pedidoId={pedido.id}
            moneda={moneda as PriceCurrency}
            cuantosProductos={cuantos}
          />
        ))}
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
