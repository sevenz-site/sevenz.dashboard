"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { BloqueCrudo, ProductoPublico } from "@/lib/products/public-pricing";
import { bloqueDesdeRpc, escalonParaCantidad, precioEnMoneda } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";

// LOS PRODUCTOS QUE EL TENDERO PUEDE VENDER, con sus precios ya resueltos.
//
// ===========================================================================
// POR QUÉ NO SIRVE `buscarProductos`, QUE YA EXISTE
//
// Esa devuelve `priceRetail` y `baseCurrencyRetail` y nada más, que es lo que
// el selector de un fiado necesita: una cifra en el libro del movimiento. La
// venta necesita otra cosa — **en qué monedas se puede cobrar cada línea y a
// qué precio en cada una**, porque el carrito del sitemap deja cambiarla con
// su «Cambiar».
//
// ===========================================================================
// Y DEVUELVE EL PRODUCTO EN LA MISMA FORMA QUE VE EL CLIENTE
//
// `ProductoPublico` es el tipo que `/c/[token]` usa, y eso no es comodidad:
// el precio que el tendero cobra y el que su cliente vio en el catálogo
// tienen que salir de la MISMA función. Con dos caminos, el día que uno
// cambie —un escalón, un precio fijado a mano, una moneda desactivada— el
// mostrador y el catálogo empiezan a decir cifras distintas por el mismo
// producto, y nadie se entera hasta que un cliente lo reclama.
//
// Por eso la pantalla llama a `escalonParaCantidad`, `monedasDelBloque` y
// `precioEnMoneda` con lo que esto devuelve: son las tres que el catálogo
// público ya usa.
export type ProductoParaVenta = {
  id: string;
  name: string;
  unit: string | null;
  photoPath: string | null;
  producto: ProductoPublico;
};

export type ProductosParaVenta = {
  productos: ProductoParaVenta[];
  // LAS TASAS VIAJAN UNA VEZ, con la lista. Sin ellas el navegador no puede
  // convertir y tendría que preguntar por cada línea que cambie de moneda.
  rates: BolivarRates | null;
  // LAS MONEDAS QUE EL LIBRO SABE GUARDAR, y es la decisión del dueño del
  // 2026-10-17 hecha dato: un negocio venezolano cobra en dólares o euros, y
  // uno colombiano en pesos. NI BOLÍVARES NI USDT.
  //
  // Los bolívares no porque `movements.currency` no los admite: se paga en
  // bolívares y se guarda convertido, que es para lo que existe
  // `entry_currency` desde la migración `022`. El USDT no porque vuelve con
  // el paso 11 (`CT-79`).
  monedasDelLibro: PriceCurrency[];
};

// LA MISMA LISTA DE COLUMNAS PARA LAS DOS CONSULTAS, y no por ahorrar letras:
// la búsqueda de la pantalla y la relectura del servidor tienen que leer
// exactamente los mismos campos de precio. Con dos listas, añadir una columna
// a una sola hace que el servidor cobre con datos distintos de los que el
// tendero vio, y la diferencia no se nota hasta que un precio no cuadra.
const COLUMNAS_PRODUCTO =
  "id, name, unit, photo_path, price_retail, price_wholesale, base_currency, base_currency_retail, base_currency_wholesale, wholesale_min_quantity";

type FilaDeProducto = {
  id: string;
  name: string;
  unit: string | null;
  photo_path: string | null;
  price_retail: number | string | null;
  price_wholesale: number | string | null;
  base_currency: string | null;
  base_currency_retail: string | null;
  base_currency_wholesale: string | null;
  wholesale_min_quantity: number | null;
};

// ===========================================================================
// EL LIBRO DEL NEGOCIO, Y POR QUÉ NO SE DEDUCE DE QUE HAYA TASA O NO
//
// La versión anterior de esta pantalla hacía `rates ? ["USD","EUR"] : ["COP"]`,
// que acierta en los dos casos corrientes y falla en el tercero: un negocio
// VENEZOLANO al que no se le ha podido leer la tasa del BCV tiene `rates`
// nulo, y esa línea lo mandaba a cobrar en PESOS.
//
// Es exactamente el fallo que `resolveMovementRateSnapshot` existe para
// prevenir y que `CLAUDE.md` cuenta en su apartado 3: `getOwnerRateContext`
// devuelve el mismo `null` para «el dueño es colombiano» y para «el dueño es
// venezolano y ahora mismo no hay tasa guardada». Por eso aquí se pregunta por
// el PAÍS, que es el dato que de verdad decide el libro, y la tasa solo sirve
// para convertir.
type ContextoDeVenta =
  | { ok: true; rates: BolivarRates | null; monedasDelLibro: PriceCurrency[] }
  | { ok: false; error: string };

async function contextoDeVenta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
): Promise<ContextoDeVenta> {
  const resultado = await getOwnerRateContextResult(supabase, ownerId);

  if (resultado.kind === "pais_desconocido") {
    return { ok: false, error: "No pudimos leer los datos de tu negocio. Vuelve a intentarlo en un momento." };
  }
  if (resultado.kind === "co") return { ok: true, rates: null, monedasDelLibro: ["COP"] };

  // Venezolano sin tasa: el libro sigue siendo dólares y euros. Lo que no se
  // puede es convertir, así que `precioEnMoneda` dejará fuera las monedas
  // derivadas y ofrecerá solo la base y las fijadas a mano. Una caja que vende
  // menos monedas es un problema; una que archiva el fiado en el libro
  // equivocado es otro mucho peor.
  if (resultado.kind === "ve_sin_tasa") return { ok: true, rates: null, monedasDelLibro: ["USD", "EUR"] };

  const rates = await getBolivarRates(resultado.context.effectiveRate);
  return { ok: true, rates, monedasDelLibro: ["USD", "EUR"] };
}

// LOS PRECIOS FIJADOS A MANO Y LAS MONEDAS ACTIVAS, en dos consultas para toda
// la lista y no dos por producto.
async function armarProductos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filas: FilaDeProducto[],
): Promise<ProductoParaVenta[]> {
  const ids = filas.map((p) => p.id);
  if (ids.length === 0) return [];

  const [{ data: overrides }, { data: activas }] = await Promise.all([
    supabase.from("product_price_overrides").select("product_id, tier, currency, amount").in("product_id", ids),
    supabase.from("product_currencies").select("product_id, tier, currency").in("product_id", ids),
  ]);

  const fijados = new Map<string, Partial<Record<PriceCurrency, number>>>();
  for (const o of overrides ?? []) {
    const clave = `${o.product_id}:${o.tier}`;
    const actual = fijados.get(clave) ?? {};
    actual[o.currency as PriceCurrency] = Number(o.amount);
    fijados.set(clave, actual);
  }
  const monedas = new Map<string, PriceCurrency[]>();
  for (const c of activas ?? []) {
    const clave = `${c.product_id}:${c.tier}`;
    monedas.set(clave, [...(monedas.get(clave) ?? []), c.currency as PriceCurrency]);
  }

  const bloque = (p: FilaDeProducto, tier: "retail" | "wholesale"): BloqueCrudo | null => {
    const price = tier === "retail" ? p.price_retail : p.price_wholesale;
    if (price == null) return null;
    const base = tier === "retail" ? p.base_currency_retail : p.base_currency_wholesale;
    return {
      price: Number(price),
      pinned: fijados.get(`${p.id}:${tier}`) ?? {},
      base_currency: (base ?? p.base_currency) as PriceCurrency | null,
      currencies: monedas.get(`${p.id}:${tier}`) ?? null,
    };
  };

  return filas.map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    photoPath: p.photo_path,
    producto: {
      // `bloqueDesdeRpc` es la misma traducción que hace el catálogo público,
      // incluido su respaldo para la ventana en la que el código está
      // desplegado y la migración `114` todavía no ha corrido.
      retail: bloqueDesdeRpc(bloque(p, "retail"), (p.base_currency ?? "USD") as PriceCurrency),
      wholesale: bloqueDesdeRpc(bloque(p, "wholesale"), (p.base_currency ?? "USD") as PriceCurrency),
      wholesale_min_quantity: p.wholesale_min_quantity,
    },
  }));
}

export async function buscarProductosParaVenta(query: string): Promise<ProductosParaVenta> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { productos: [], rates: null, monedasDelLibro: [] };

  const contexto = await contextoDeVenta(supabase, user.id);
  if (!contexto.ok) return { productos: [], rates: null, monedasDelLibro: [] };
  const { rates, monedasDelLibro } = contexto;

  const texto = query.trim();
  let consulta = supabase
    .from("products")
    .select(COLUMNAS_PRODUCTO)
    // EL `owner_id` SALE DE LA SESIÓN Y NUNCA DEL NAVEGADOR. Es la misma
    // comprobación explícita que pide `CLAUDE.md` para toda acción que lea una
    // fila por un id que llegó de fuera -- aquí ni siquiera llega, y aun así se
    // filtra, porque la RLS es el respaldo y no la única defensa.
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .order("name", { ascending: true })
    .limit(12);
  if (texto !== "") consulta = consulta.ilike("name", `%${texto}%`);

  const { data, error } = await consulta;
  if (error) {
    console.error("buscarProductosParaVenta:", error.message);
    return { productos: [], rates, monedasDelLibro };
  }

  return { rates, monedasDelLibro, productos: await armarProductos(supabase, (data ?? []) as FilaDeProducto[]) };
}

// ===========================================================================
// GUARDAR LA VENTA
// ===========================================================================

// LO QUE EL NAVEGADOR MANDA DE UNA LÍNEA: qué producto, cuánto y en qué
// moneda. **EL PRECIO NO VIAJA.** Es la misma regla que ya sigue
// `create_catalog_order` —«el PRECIO lo calcula esta función, nunca viaja en la
// petición»— y aquí importa igual aunque quien llame sea el dueño: un precio
// que llega de fuera convierte cualquier pantalla en un sitio donde escribir la
// cifra que se quiera, y el historial del cliente queda diciendo que el acuerdo
// fue ese.
export type LineaDeVentaEntrada = {
  productId: string;
  quantity: number;
  currency: PriceCurrency;
};

// UN PAGO, Y AQUÍ SÍ MANDA EL NAVEGADOR LA CIFRA — porque es otra clase de
// dato. El precio es un hecho del negocio que el servidor tiene guardado; el
// pago es lo que el tendero DICE que recibió, y de eso no hay versión en la
// base que contrastar. Lo que el servidor sí defiende es el techo: no se puede
// cobrar más de lo que suma la venta.
//
// `entryCurrency: "VES"` dice «me pagó en bolívares» y obliga a traer
// `entryAmount`. La TASA la pone el servidor, nunca esto — ver el comentario
// largo dentro de `registrarVenta`, que cuenta por qué sella la tasa y no
// recalcula el monto.
export type PagoDeVentaEntrada = {
  currency: PriceCurrency;
  amount: number;
  entryCurrency?: "VES" | PriceCurrency | null;
  entryAmount?: number | null;
  photoPath?: string | null;
  description?: string | null;
};

// EL PLAZO DEL RESTO QUE QUEDA FIADO, por moneda. Va por moneda porque una
// venta puede quedar a medias en dos libros a la vez —cinco dólares y tres
// euros— y cada deuda es independiente: el `recalc` del saldo nunca suma un
// libro con el otro.
export type CreditoDeVentaEntrada = {
  currency: PriceCurrency;
  plazoDias: number;
  cuotas: number | null;
};

export type VentaEntrada = {
  clientId: string;
  lineas: LineaDeVentaEntrada[];
  pagos: PagoDeVentaEntrada[];
  credito: CreditoDeVentaEntrada[];
  nota?: string | null;
};

export type ResultadoVenta =
  | {
      ok: true;
      saleId: string;
      cobrado: { currency: PriceCurrency; amount: number }[];
      fiado: { currency: PriceCurrency; amount: number; movementId: string }[];
    }
  | { ok: false; error: string };

// Dos decimales, redondeo corriente: el mismo que usa el resto del código de
// precios, para que el total de la pantalla y el del servidor no se separen por
// un escalón de redondeo.
const redondear = (n: number) => Math.round(n * 100) / 100;

// Medio céntimo de holgura al comparar pagado contra total. Sin ella, una venta
// pagada completa con tres líneas convertidas puede quedar con un resto de
// 0,004 y nacer con un fiado de cero que nadie entiende.
const HOLGURA = 0.005;

// La moneda del catálogo traducida al libro de `movements`: un negocio
// colombiano guarda `currency` nulo, que es la respuesta y no una ausencia.
const libroDeMoneda = (c: PriceCurrency): LedgerCurrency | null => (c === "USD" || c === "EUR" ? c : null);

export async function registrarVenta(entrada: VentaEntrada): Promise<ResultadoVenta> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar y repite la venta." };

  if (entrada.lineas.length === 0) return { ok: false, error: "Agrega al menos un producto a la venta." };
  if (entrada.lineas.length > 60) return { ok: false, error: "Son demasiados productos para una sola venta." };

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente y no
  // solo por RLS -- la regla de `CLAUDE.md` para toda fila que se lee por un id
  // que llega del navegador. Aquí decide a nombre de quién queda una deuda.
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, is_walk_in")
    .eq("id", entrada.clientId)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!cliente) return { ok: false, error: "No encontramos ese cliente." };

  const contexto = await contextoDeVenta(supabase, user.id);
  if (!contexto.ok) return { ok: false, error: contexto.error };
  const { rates, monedasDelLibro } = contexto;

  // ── LOS PRECIOS SE VUELVEN A CALCULAR AQUÍ ──────────────────────────
  const ids = [...new Set(entrada.lineas.map((l) => l.productId))];
  const { data: filas, error: errorProductos } = await supabase
    .from("products")
    .select(COLUMNAS_PRODUCTO)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .in("id", ids);
  if (errorProductos) {
    console.error("registrarVenta productos:", errorProductos.message);
    return { ok: false, error: "No pudimos leer tus productos. Vuelve a intentarlo." };
  }

  const productos = await armarProductos(supabase, (filas ?? []) as FilaDeProducto[]);
  const porId = new Map(productos.map((p) => [p.id, p]));

  const lineasResueltas: {
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    currency: PriceCurrency;
    tier: "retail" | "wholesale";
  }[] = [];

  for (const linea of entrada.lineas) {
    const producto = porId.get(linea.productId);
    // Un producto que no es suyo, o que está en la papelera, ni siquiera llegó
    // en `filas`: el filtro por `owner_id` es el que lo dejó fuera. No se
    // distingue de «no existe», que es lo mismo que hace la vista previa del
    // catálogo con un id al azar.
    if (!producto) return { ok: false, error: "Uno de los productos ya no está disponible." };

    if (!Number.isFinite(linea.quantity) || linea.quantity <= 0) {
      return { ok: false, error: `Revisa la cantidad de ${producto.name}.` };
    }
    if (!monedasDelLibro.includes(linea.currency)) {
      return { ok: false, error: `No puedes cobrar ${producto.name} en esa moneda.` };
    }

    const tier = escalonParaCantidad(producto.producto, linea.quantity);
    if (!tier) return { ok: false, error: `La cantidad de ${producto.name} es menor que el mínimo que vendes.` };

    const bloque = tier === "retail" ? producto.producto.retail : producto.producto.wholesale;
    const unitPrice = precioEnMoneda(bloque, linea.currency, rates);
    // `null` significa «no hay número», nunca cero: un producto sin precio en
    // esa moneda no se cobra a cero, se rechaza. Pasa de verdad cuando el
    // negocio es venezolano y ahora mismo no hay tasa para convertir.
    if (unitPrice == null) {
      return { ok: false, error: `No tenemos precio de ${producto.name} en esa moneda.` };
    }

    lineasResueltas.push({
      productId: producto.id,
      name: producto.name,
      quantity: linea.quantity,
      unitPrice,
      currency: linea.currency,
      tier,
    });
  }

  // ── TOTALES Y RESTO, POR MONEDA ─────────────────────────────────────
  const totales = new Map<PriceCurrency, number>();
  for (const l of lineasResueltas) {
    totales.set(l.currency, redondear((totales.get(l.currency) ?? 0) + l.quantity * l.unitPrice));
  }

  const pagado = new Map<PriceCurrency, number>();
  const pagosResueltos: {
    currency: PriceCurrency;
    amount: number;
    entryCurrency: string | null;
    entryAmount: number | null;
    rateUsed: number | null;
    photoPath: string | null;
    description: string | null;
  }[] = [];

  for (const pago of entrada.pagos) {
    if (!monedasDelLibro.includes(pago.currency)) {
      return { ok: false, error: "Ese pago está en una moneda que tu negocio no maneja." };
    }
    if (!totales.has(pago.currency)) {
      return { ok: false, error: "Hay un pago en una moneda que esta venta no cobra." };
    }

    let rateUsed: number | null = null;

    // ── LOS BOLÍVARES: SE SELLA LA TASA, NO SE RECALCULA EL MONTO ─────
    //
    // La cifra en bolívares es lo que el tendero tecleó y se guarda tal cual:
    // es el registro más defendible en una disputa, que es para lo que existe
    // `entry_amount` desde la migración `022`. La tasa la pone el SERVIDOR, no
    // el navegador — igual que `usarPrevista` es una casilla y no un número.
    //
    // LO QUE NO SE HACE ES DIVIDIR UNA POR LA OTRA PARA SACAR EL MONTO DEL
    // LIBRO, y la primera versión de esto sí lo hacía. Suena a más riguroso y
    // rompe el caso corriente: una venta de 20 $ pagada completa en bolívares
    // vuelve de la división como 19,99 o 20,01, y entonces el resto da un
    // céntimo y la venta nace con un FIADO DE 0,01 $ que nadie entiende y que
    // va a quedar ahí para siempre, porque nadie cobra un céntimo.
    //
    // El monto del libro es una decisión del tendero, no una derivación: él
    // puede aceptar unos bolívares de menos y dar la cuenta por cerrada, y eso
    // es exactamente lo que pasa en una bodega. Lo que el servidor sí defiende
    // es el techo —más abajo se rechaza cobrar más de lo que suma la venta—, y
    // ese techo es la protección de verdad. Que `entry_amount / rate_used` no
    // cuadre al céntimo con `amount` no es una incoherencia: es el redondeo del
    // tendero, y conviene que quede escrito.
    if (pago.entryCurrency === "VES") {
      if (!rates) return { ok: false, error: "Ahora mismo no tenemos la tasa del BCV para convertir los bolívares." };
      if (!pago.entryAmount || !Number.isFinite(pago.entryAmount) || pago.entryAmount <= 0) {
        return { ok: false, error: "Revisa el monto en bolívares." };
      }
      const tasa = pago.currency === "USD" ? rates.usd : rates.eur;
      if (!tasa || tasa <= 0) {
        return { ok: false, error: "Ahora mismo no tenemos la tasa del BCV para convertir los bolívares." };
      }
      rateUsed = tasa;
    }

    if (!Number.isFinite(pago.amount) || pago.amount <= 0) {
      return { ok: false, error: "Revisa el monto del pago." };
    }

    const enElLibro = redondear(pago.amount);
    pagosResueltos.push({
      currency: pago.currency,
      amount: enElLibro,
      entryCurrency: pago.entryCurrency ?? pago.currency,
      entryAmount: pago.entryCurrency === "VES" ? pago.entryAmount! : enElLibro,
      rateUsed,
      photoPath: pago.photoPath ?? null,
      description: pago.description?.trim() ? pago.description.trim().slice(0, 500) : null,
    });
    pagado.set(pago.currency, redondear((pagado.get(pago.currency) ?? 0) + enElLibro));
  }

  const restos: { currency: PriceCurrency; amount: number }[] = [];
  for (const [currency, total] of totales) {
    const abonado = pagado.get(currency) ?? 0;
    if (abonado - total > HOLGURA) {
      return { ok: false, error: "Estás cobrando más de lo que suma la venta en esa moneda." };
    }
    const resto = redondear(total - abonado);
    if (resto > HOLGURA) restos.push({ currency, amount: resto });
  }

  // UNA VENTA DE MOSTRADOR NO PUEDE QUEDAR FIADA, y no es una restricción
  // técnica: el cliente mostrador es UNO por negocio, así que una deuda suya
  // sería la deuda de «todos los que pasaron por la caja». Nadie podría cobrar
  // eso, y el saldo de ese cliente crecería para siempre.
  if (restos.length > 0 && cliente.is_walk_in) {
    return { ok: false, error: "Para dejar algo fiado tienes que elegir o crear un cliente." };
  }

  const creditoPorMoneda = new Map(entrada.credito.map((c) => [c.currency, c]));
  for (const resto of restos) {
    const credito = creditoPorMoneda.get(resto.currency);
    if (!credito) return { ok: false, error: "Falta decir en cuánto tiempo te pagan lo que queda." };
    if (!Number.isInteger(credito.plazoDias) || credito.plazoDias < 1 || credito.plazoDias > 365) {
      return { ok: false, error: "El plazo tiene que estar entre 1 y 365 días." };
    }
    // Las cuotas van de 2 a 36 y necesitan plazo: es el `check` de la migración
    // `118`, comprobado aquí para que el tendero lea una frase y no un error de
    // Postgres. Una sola cuota se guarda como null, que es lo mismo y es el
    // comportamiento de siempre.
    if (credito.cuotas != null && (!Number.isInteger(credito.cuotas) || credito.cuotas < 2 || credito.cuotas > 36)) {
      return { ok: false, error: "Las cuotas van de 2 a 36." };
    }
  }

  // ── LA ESCRITURA, Y SU ORDEN ────────────────────────────────────────
  //
  // CUATRO INSERCIONES QUE NO PUEDEN SER UNA TRANSACCIÓN desde el cliente de
  // Supabase. El orden está elegido por cuál es el estado a medias menos malo:
  //
  // 1. La venta, 2. sus líneas, 3. sus pagos -- las tres cuelgan de `sales` con
  //    `on delete cascade`, así que borrar la venta las borra todas. Eso
  //    convierte el fallo de cualquiera de ellas en algo que SÍ se puede
  //    deshacer a mano.
  // 4. El fiado del resto, que es lo único que no cuelga de la venta. Va al
  //    final porque si falla, se borra la venta y no queda nada; al revés —el
  //    fiado primero— un fallo dejaría una deuda sin los productos que la
  //    explican.
  //
  // Lo que NO se puede dejar pasar es lo contrario: una venta guardada con su
  // pago y sin el cargo del resto. Ahí el tendero perdería dinero en silencio,
  // porque la pantalla diría que todo salió bien.
  const { data: venta, error: errorVenta } = await supabase
    .from("sales")
    .insert({
      owner_id: user.id,
      client_id: cliente.id,
      created_by: user.id,
      note: entrada.nota?.trim() ? entrada.nota.trim().slice(0, 500) : null,
    })
    .select("id")
    .single();
  if (errorVenta || !venta) {
    console.error("registrarVenta sales:", errorVenta?.message);
    return { ok: false, error: "No pudimos guardar la venta. Vuelve a intentarlo." };
  }

  const deshacer = async (motivo: string, detalle: string | undefined) => {
    console.error(`registrarVenta ${motivo}:`, detalle);
    const { error } = await supabase.from("sales").delete().eq("id", venta.id);
    // Si la compensación falla, queda una venta a medias. Se deja constancia con
    // su id, que es lo único que permite encontrarla después.
    if (error) console.error(`registrarVenta no pudo deshacer la venta ${venta.id}:`, error.message);
  };

  const { error: errorLineas } = await supabase.from("sale_lines").insert(
    lineasResueltas.map((l) => ({
      sale_id: venta.id,
      product_id: l.productId,
      name: l.name,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      currency: l.currency,
      tier: l.tier,
    })),
  );
  if (errorLineas) {
    await deshacer("sale_lines", errorLineas.message);
    return { ok: false, error: "No pudimos guardar los productos de la venta. Vuelve a intentarlo." };
  }

  if (pagosResueltos.length > 0) {
    const { error: errorPagos } = await supabase.from("sale_payments").insert(
      pagosResueltos.map((p) => ({
        sale_id: venta.id,
        currency: p.currency,
        amount: p.amount,
        entry_currency: p.entryCurrency,
        entry_amount: p.entryAmount,
        rate_used: p.rateUsed,
        photo_path: p.photoPath,
        description: p.description,
      })),
    );
    if (errorPagos) {
      await deshacer("sale_payments", errorPagos.message);
      return { ok: false, error: "No pudimos guardar el pago. Vuelve a intentarlo." };
    }
  }

  const fiado: { currency: PriceCurrency; amount: number; movementId: string }[] = [];
  for (const resto of restos) {
    const credito = creditoPorMoneda.get(resto.currency)!;
    const snapshot = await resolveMovementRateSnapshot(supabase, user.id, libroDeMoneda(resto.currency));
    if (!snapshot.ok) {
      await deshacer("tasa", snapshot.reason);
      return { ok: false, error: snapshot.error };
    }
    const sello = snapshot.snapshot;

    const { data: movimiento, error: errorMovimiento } = await supabase
      .from("movements")
      .insert({
        client_id: cliente.id,
        created_by: user.id,
        type: "charge",
        amount: resto.amount,
        currency: sello.currency,
        // LO QUE EL CLIENTE VA A LEER EN SU SALDO. No dice «venta»: dice qué se
        // llevó, y el detalle está en las líneas de la venta.
        description: lineasResueltas
          .filter((l) => l.currency === resto.currency)
          .map((l) => l.name)
          .join(", ")
          .slice(0, 500),
        source: "manual",
        plazo_dias: credito.plazoDias,
        cuotas: credito.cuotas,
        sale_id: venta.id,
        rate_mode_used: sello.rateModeUsed,
        exchange_rate_used: sello.exchangeRateUsed,
        official_bcv_rate_at_time: sello.officialBcvRateAtTime,
        entry_currency: sello.entryCurrency,
        entry_amount: sello.entryCurrency ? resto.amount : null,
        rate_usd_at_time: sello.rateUsdAtTime,
        rate_eur_at_time: sello.rateEurAtTime,
      })
      .select("id")
      .single();
    if (errorMovimiento || !movimiento) {
      // Se borran también los cargos que ya entraron en esta misma venta: un
      // fiado en dólares sin su hermano en euros es una deuda a medias, y el
      // tendero volvería a guardar la venta entera.
      for (const hecho of fiado) await supabase.from("movements").delete().eq("id", hecho.movementId);
      await deshacer("movements", errorMovimiento?.message);
      return { ok: false, error: "No pudimos guardar lo que queda fiado. Vuelve a intentarlo." };
    }
    fiado.push({ currency: resto.currency, amount: resto.amount, movementId: movimiento.id });
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${cliente.id}`);

  return {
    ok: true,
    saleId: venta.id,
    cobrado: [...pagado].map(([currency, amount]) => ({ currency, amount })),
    fiado,
  };
}
