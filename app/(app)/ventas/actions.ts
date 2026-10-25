"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { guardarPermisoDeclarado } from "@/lib/whatsapp/declared-consent";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { BloqueCrudo, ProductoPublico } from "@/lib/products/public-pricing";
import { bloqueDesdeRpc, escalonParaCantidad, precioEnMoneda } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import { formatDocumentId, formatReceiptDateTime } from "@/lib/format";
import { claveDeFila, filasDeContado, type VentaDeContado } from "@/lib/ventas-de-contado";
import { estadoDelFiado, type EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { telefonoLegible } from "@/lib/phone";
import { mensajeDeError } from "@/lib/errores-legibles";
import type { ClientSummary, LedgerCurrency, Movement } from "@/lib/types";

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
  description: string | null;
  stock: number | null;
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
  // La fecha de la tasa prevista, si la hay. Solo para la casilla de la hoja
  // de cobro: la cifra nunca viaja desde el navegador.
  prevista: { fecha: string } | null;
};

// LA MISMA LISTA DE COLUMNAS PARA LAS DOS CONSULTAS, y no por ahorrar letras:
// la búsqueda de la pantalla y la relectura del servidor tienen que leer
// exactamente los mismos campos de precio. Con dos listas, añadir una columna
// a una sola hace que el servidor cobre con datos distintos de los que el
// tendero vio, y la diferencia no se nota hasta que un precio no cuadra.
const COLUMNAS_PRODUCTO =
  "id, name, unit, photo_path, description, stock_opening, price_retail, price_wholesale, base_currency, base_currency_retail, base_currency_wholesale, wholesale_min_quantity";

type FilaDeProducto = {
  id: string;
  name: string;
  unit: string | null;
  photo_path: string | null;
  description: string | null;
  // `stock_opening` y no `stock`, y el nombre dice por qué: es el asiento de
  // APERTURA que el tendero escribió al crear el producto. Nadie lo mueve —
  // fiar no descuenta— hasta que exista la máquina de eventos (migración 084).
  // La hoja lo enseña como «Disponible: N» porque es lo único que hay, y es
  // mejor que el dato que el tendero puso que ningún dato.
  stock_opening: number | string | null;
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
  | {
      ok: true;
      rates: BolivarRates | null;
      monedasDelLibro: PriceCurrency[];
      // LA TASA QUE EL BCV YA PUBLICÓ PERO QUE AÚN NO RIGE. La hoja de cobro
      // ofrece aplicarla —«Aplicar tasa BCV prevista para el lunes…»— y para
      // eso necesita su FECHA, que es lo que el tendero lee. La cifra no viaja
      // al servidor: allí se vuelve a buscar, porque un número que llega del
      // navegador podría sellar cualquier cosa en el respaldo de un fiado.
      prevista: { fecha: string } | null;
    }
  | { ok: false; error: string };

async function contextoDeVenta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
): Promise<ContextoDeVenta> {
  const resultado = await getOwnerRateContextResult(supabase, ownerId);

  if (resultado.kind === "pais_desconocido") {
    return { ok: false, error: "No pudimos leer los datos de tu negocio. Vuelve a intentarlo en un momento." };
  }
  if (resultado.kind === "co") return { ok: true, rates: null, monedasDelLibro: ["COP"], prevista: null };

  // Venezolano sin tasa: el libro sigue siendo dólares y euros. Lo que no se
  // puede es convertir, así que `precioEnMoneda` dejará fuera las monedas
  // derivadas y ofrecerá solo la base y las fijadas a mano. Una caja que vende
  // menos monedas es un problema; una que archiva el fiado en el libro
  // equivocado es otro mucho peor.
  if (resultado.kind === "ve_sin_tasa") {
    return { ok: true, rates: null, monedasDelLibro: ["USD", "EUR"], prevista: null };
  }

  const rates = await getBolivarRates(resultado.context.effectiveRate);
  return {
    ok: true,
    rates,
    monedasDelLibro: ["USD", "EUR"],
    prevista: resultado.context.prevista ? { fecha: resultado.context.prevista.fecha } : null,
  };
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
    description: p.description,
    stock: p.stock_opening == null ? null : Number(p.stock_opening),
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
  if (!user) return { productos: [], rates: null, monedasDelLibro: [], prevista: null };

  const contexto = await contextoDeVenta(supabase, user.id);
  if (!contexto.ok) return { productos: [], rates: null, monedasDelLibro: [], prevista: null };
  const { rates, monedasDelLibro, prevista } = contexto;

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
    return { productos: [], rates, monedasDelLibro, prevista };
  }

  return {
    rates,
    monedasDelLibro,
    prevista,
    productos: await armarProductos(supabase, (data ?? []) as FilaDeProducto[]),
  };
}

// ONE PRODUCT, BY ITS ID, IN THE SHAPE THE CUSTOMER SEES.
//
// The catalogue order's «1/2 Edita producto» (frame `1566:13300`) opens the
// product behind ONE order line, so it knows the id and has nothing to search
// for. It goes through `armarProductos` exactly like the search above, which
// is the point: the price the shopkeeper charges and the price his customer
// saw in the catalogue have to come out of the same function, or the counter
// and the catalogue start quoting different figures for the same product and
// nobody finds out until a customer complains.
//
// `.eq("owner_id", user.id)` EXPLICITLY, because here the id DOES come from
// the browser — it is in the URL of that screen.
export async function productoParaVentaPorId(
  id: string,
): Promise<ProductosParaVenta> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { productos: [], rates: null, monedasDelLibro: [], prevista: null };

  const contexto = await contextoDeVenta(supabase, user.id);
  if (!contexto.ok) return { productos: [], rates: null, monedasDelLibro: [], prevista: null };
  const { rates, monedasDelLibro, prevista } = contexto;

  const { data, error } = await supabase
    .from("products")
    .select(COLUMNAS_PRODUCTO)
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .limit(1);

  if (error) {
    console.error("productoParaVentaPorId:", error.message);
    return { productos: [], rates, monedasDelLibro, prevista };
  }

  return {
    rates,
    monedasDelLibro,
    prevista,
    productos: await armarProductos(supabase, (data ?? []) as FilaDeProducto[]),
  };
}

// ===========================================================================
// EL CLIENTE MOSTRADOR, resuelto cuando el tendero lo pide
// ===========================================================================
//
// EL NOMBRE DEL CLIENTE COMODÍN vive aquí y no en la base por una razón: es
// texto que el tendero lee, así que cambiarlo es cambiar una palabra en un
// archivo, no una migración sobre filas de 24 negocios.
const NOMBRE_MOSTRADOR = "Mostrador";

// SE CREA AL ELEGIRLO, NO AL ABRIR LA PANTALLA. Hasta el 2026-10-18 esto
// pasaba en la propia página, así que entrar en `/ventas/nueva` creaba la fila
// aunque la venta fuera para un cliente con nombre — y desde que «Agregar» de
// Inicio abre aquí, eso le habría pasado a TODOS los dueños al primer toque,
// con `CT-99` todavía abierto: un cliente llamado «Mostrador» en su lista sin
// haber hecho una sola venta de mostrador.
//
// Y tampoco se crea en la migración `124`: 24 filas para negocios que quizá
// nunca vendan al mostrador son 24 filas que alguien tiene que explicar
// después. Nace la primera vez que hace falta.
export async function resolverMostrador(): Promise<{ id: string; name: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tu sesión se cerró. Vuelve a entrar." };

  // CREAR EL MOSTRADOR ES CREAR UN CLIENTE, así que pasa por la misma puerta
  // que el resto de las escrituras. Ver el comentario de `registrarVenta`.
  if (!(await puedeEscribir(supabase, user.id))) return { error: MENSAJE_CUENTA_PAUSADA };

  // EL ÍNDICE ÚNICO PARCIAL ES QUIEN DE VERDAD GARANTIZA QUE HAYA UNO SOLO.
  // Dos pestañas pidiéndolo a la vez pasarían las dos por esta lectura sin
  // encontrar nada y las dos intentarían crearlo; la segunda falla en la base,
  // y entonces se vuelve a leer. Sin ese segundo intento, una de las dos se
  // quedaría sin mostrador por una carrera que dura milisegundos.
  const existente = await supabase
    .from("clients")
    .select("id, name")
    .eq("owner_id", user.id)
    .eq("is_walk_in", true)
    .maybeSingle();
  if (existente.data) return existente.data;

  const creado = await supabase
    .from("clients")
    .insert({ owner_id: user.id, name: NOMBRE_MOSTRADOR, is_walk_in: true })
    .select("id, name")
    .maybeSingle();
  if (creado.data) return creado.data;

  const segunda = await supabase
    .from("clients")
    .select("id, name")
    .eq("owner_id", user.id)
    .eq("is_walk_in", true)
    .maybeSingle();
  if (segunda.data) return segunda.data;

  // Ni con las dos: aquí ya no es una carrera, es que algo falla de verdad. El
  // detalle real al log y una frase que no cuenta la forma de la base.
  console.error("resolverMostrador:", creado.error?.message);
  return { error: "No pudimos abrir la venta de mostrador. Vuelve a intentarlo." };
}

// ===========================================================================
// LO QUE ESTE CLIENTE YA DEBÍA
// ===========================================================================
//
// «Deuda antigua» en la tarjeta del paso 3 (frame `1389:8504`): lo que el
// cliente arrastra de ANTES de esta venta, para que «Deuda total» diga lo que
// de verdad va a deber al terminar.
//
// POR MONEDA Y SIN SUMAR NADA. `client_summary` lleva `balance_usd` y
// `balance_eur` separados porque son dos deudas independientes que se cobran
// por separado — sumarlas aquí sería inventar una cifra que el tendero no
// puede cobrar. Un negocio colombiano lleva una sola, en `balance`.
//
// DEVUELVE TAMBIÉN SI ACEPTA AVISOS, y no en una llamada aparte: el paso 4
// necesita las dos cosas del mismo cliente en el mismo momento, y dos
// consultas separadas pueden volver en distinto orden y dejar la tarjeta
// contando una mezcla de dos personas.
export type DatosDelCliente = {
  saldo: Partial<Record<PriceCurrency, number>>;
  // `client_accepts_whatsapp`, la MISMA función que usa la puerta de envío.
  // Preguntarlo con una consulta propia aquí sería tener dos definiciones de
  // «acepta», y la que decide si sale un mensaje es la suya.
  aceptaAvisos: boolean;
};

export async function datosDelCliente(clientId: string): Promise<DatosDelCliente> {
  const vacio: DatosDelCliente = { saldo: {}, aceptaAvisos: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return vacio;

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente. Es
  // la regla de `CLAUDE.md` para toda fila que se lee por un id que llega del
  // navegador, y aquí se leería el saldo de otro negocio.
  const [{ data }, acepta] = await Promise.all([
    supabase
      .from("client_summary")
      .select("balance, balance_usd, balance_eur")
      .eq("client_id", clientId)
      .eq("owner_id", user.id)
      .maybeSingle(),
    supabase.rpc("client_accepts_whatsapp", { p_client_id: clientId }),
  ]);
  if (!data) return vacio;

  return {
    saldo: {
      USD: Number(data.balance_usd ?? 0),
      EUR: Number(data.balance_eur ?? 0),
      COP: Number(data.balance ?? 0),
    },
    aceptaAvisos: acepta.data === true,
  };
}

// ===========================================================================
// EL PERMISO DE WHATSAPP DE UN CLIENTE QUE YA EXISTE
// ===========================================================================
//
// La casilla del paso 4 cuando el tendero eligió a alguien de su lista (frame
// `1411:12272`). El alta de un cliente nuevo lo manda dentro de su `FormData`;
// aquí no hay formulario que enviar, así que va por su cuenta.
//
// SOLO ESCRIBE UN SÍ. Desmarcarla no retira un permiso: la casilla solo se
// pinta cuando el cliente NO los tiene activados, así que lo único que puede
// decir es «hoy me autorizó». Retirar un permiso es otra acción, vive en la
// ficha del cliente y tiene su propia pantalla.
export async function guardarPermisoDeVenta(
  clientId: string,
  clientName: string,
  acepta: boolean,
): Promise<void> {
  if (!acepta) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN. Es la regla de
  // `CLAUDE.md` para toda fila que se toca por un id que llega del navegador,
  // y aquí se escribiría un permiso en la ficha de otro negocio.
  const { data: cliente } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!cliente) return;

  await guardarPermisoDeclarado(supabase, {
    clientId,
    ownerId: user.id,
    clientName,
    source: "owner_movement_form",
    seMostro: true,
    acepta: true,
  });
}

// ===========================================================================
// LA CUENTA DE UN CLIENTE, PARA MIRARLA SIN SALIR DE LA VENTA
// ===========================================================================
//
// Lo que enseña la hoja de «Ver cuenta de…» cuando la cédula tecleada ya
// pertenece a alguien (frame del 2026-10-18). Sirve para una sola decisión:
// ¿es la misma persona que ya tengo apuntada, o de verdad hace falta una
// cuenta aparte?
//
// Por eso trae su ficha Y sus movimientos: el nombre solo no basta —dos
// hermanos comparten apellido y a veces hasta el apodo— y lo que de verdad
// distingue es qué le fiaron y cuándo.
export type CuentaDelCliente = {
  fila: ClientSummary | null;
  movimientos: Movement[];
  // Las ventas pagadas enteras, que no son movimientos. Ver el comentario
  // dentro de la función.
  ventasDeContado: VentaDeContado[];
  // El estado del plazo de cada fiado, por el id de su movimiento. Ver el
  // comentario de `estadosDeFiado` al final de `cuentaDelCliente`.
  estadosDeFiado: Record<string, EstadoDelPlazo | null>;
  // Lo que cada fiado todavía debe, por el id de su movimiento.
  pendientePorFiado: Record<string, number>;
};

export async function cuentaDelCliente(clientId: string): Promise<CuentaDelCliente> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { fila: null, movimientos: [], ventasDeContado: [], estadosDeFiado: {}, pendientePorFiado: {} };

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN. Es la regla de
  // `CLAUDE.md` para toda fila leída por un id que llega del navegador, y aquí
  // se leería el historial de un cliente de otro negocio.
  const { data: fila } = await supabase
    .from("client_summary")
    .select("*")
    .eq("client_id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!fila) return { fila: null, movimientos: [], ventasDeContado: [], estadosDeFiado: {}, pendientePorFiado: {} };

  // LOS ÚLTIMOS CINCUENTA. Es una mirada para decidir, no la ficha: quien
  // necesite el historial entero lo tiene en la pantalla del cliente, y traer
  // mil filas dentro de una venta cuesta espera en el momento de cobrar.
  const { data: movimientos } = await supabase
    .from("movements")
    .select("*")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  // ── Y LAS VENTAS PAGADAS ENTERAS ────────────────────────────────
  //
  // NO SALÍAN. Esta hoja leía solo `movements`, y una venta pagada no escribe
  // nada ahí (migración `124`), así que enseñaba los fiados y los abonos de un
  // cliente y se callaba sus compras al contado. Lo reportó el dueño el
  // 2026-10-18 abriendo «Ver cuenta de …»: la ficha del cliente ya las
  // mezclaba desde esa mañana y esta hoja no, que es exactamente la clase de
  // diferencia que aparece cuando una pantalla se arregla y su hermana no.
  //
  // MISMA FUNCIÓN QUE LA FICHA, `filasDeContado`, para que las dos cuenten lo
  // mismo. Sin límite de 50 aquí: son las ventas de un solo cliente y la
  // consulta ya está acotada por él.
  const movementRows = (movimientos ?? []) as Movement[];
  // POR (VENTA, LIBRO) Y NO POR VENTA, igual que en la ficha del cliente y
  // por la misma razón: una venta mixta deja cargo en una moneda y está
  // cobrada en la otra, y descartarla entera escondía lo cobrado. Las dos
  // pantallas tienen que construir esta clave igual, por eso `claveDeFila`
  // se exporta en vez de escribir la cadena aquí.
  const clavesConCargo = new Set<string>();
  for (const m of movementRows) {
    if (m.sale_id && m.type === "charge") {
      clavesConCargo.add(claveDeFila(m.sale_id, m.currency));
    }
  }

  const { data: ventasCrudas } = await supabase
    .from("sales")
    .select("id, created_at")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  let ventasDeContado: VentaDeContado[] = [];
  const idsDeVenta = (ventasCrudas ?? []).map((v) => v.id as string);
  if (idsDeVenta.length > 0) {
    const [{ data: pagos }, { data: lineasDeVenta }] = await Promise.all([
      supabase.from("sale_payments").select("sale_id, currency, amount").in("sale_id", idsDeVenta),
      supabase
        .from("sale_lines")
        .select("sale_id, name, quantity, unit_price, currency")
        .in("sale_id", idsDeVenta),
    ]);
    ventasDeContado = filasDeContado(
      (ventasCrudas ?? []).map((v) => ({ id: v.id as string, created_at: v.created_at as string })),
      pagos ?? [],
      lineasDeVenta ?? [],
      clavesConCargo,
    );
  }

  // LOS MISMOS CHIPS DE ESTADO QUE LA FICHA DEL CLIENTE. Esta hoja pinta la
  // misma lista con el mismo componente, y una de las dos sin chips no se lee
  // como «aquí no caben»: se lee como que a estos fiados no les pasa nada.
  //
  // Es el fallo del 2026-10-18 otra vez, dicho arriba en esta misma función:
  // la ficha enseñaba las ventas de contado y esta hoja no. Misma lista, dos
  // puertas, y solo se arregló una.
  const estadosDeFiado: Record<string, EstadoDelPlazo | null> = {};
  const pendientePorFiadoMapa: Record<string, number> = {};
  if (movementRows.some((m) => m.type === "charge")) {
    const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
      p_client_id: clientId,
    });
    const pendientePorFiado = new Map<string, number>();
    for (const c of (abiertos ?? []) as { movement_id: string; pending: number }[]) {
      pendientePorFiado.set(c.movement_id, Number(c.pending));
    }
    for (const m of movementRows) {
      if (m.type !== "charge") continue;
      const pendiente = pendientePorFiado.get(m.id) ?? 0;
      pendientePorFiadoMapa[m.id] = pendiente;
      estadosDeFiado[m.id] = estadoDelFiado({
        createdAt: m.created_at,
        plazoDias: m.plazo_dias,
        cuotas: m.cuotas,
        amount: Number(m.amount),
        pendiente,
      });
    }
  }

  return { fila: fila as ClientSummary, movimientos: movementRows, ventasDeContado, estadosDeFiado, pendientePorFiado: pendientePorFiadoMapa };
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
  // THE ORDER LINE THIS CAME FROM, when the sale is a catalogue order being
  // registered. See `pedidoId` below: it is how the SERVER finds the sealed
  // price, and the browser never sends a price of its own.
  orderItemId?: string;
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
//
// `plazoDias` PUEDE SER NULL, y no es una concesión: «Sin especificar» es una
// de las cinco opciones de `PLAZO_PAGO_OPTIONS` y el fiado manual la admite
// desde siempre. La primera versión de esto pedía un número obligatorio, así
// que elegir esa opción perfectamente normal devolvía «El plazo tiene que
// estar entre 1 y 365 días» — un error sobre algo que el tendero no había
// hecho mal y no podía arreglar sin adivinar.
export type CreditoDeVentaEntrada = {
  currency: PriceCurrency;
  plazoDias: number | null;
  cuotas: number | null;
  // LA CASILLA «Aplicar tasa BCV prevista», y es una MARCA, no una cifra: el
  // navegador no manda ningún número, solo pide que se use la tasa que el
  // servidor ya tiene guardada. Si mandara el número, una petición hecha a
  // mano podría sellar cualquier cosa en el respaldo de un fiado.
  //
  // Se ignora sin ruido si no hay prevista o si ya entró en vigor: ahí la
  // tasa correcta es la vigente, que es lo que se sella.
  usarPrevista?: boolean;
  // EL COMPROBANTE Y LA NOTA DEL FIADO, que van al movimiento del cargo:
  // `movements.photo_path` y `movements.description`, los mismos campos que
  // usa el fiado manual.
  //
  // ESTABAN LLEGÁNDOLE Y SE CAÍAN EN SILENCIO. La pantalla ya los mandaba y
  // este tipo no los declaraba, y `tsc` no dijo nada porque un `.map()` no
  // dispara la comprobación de propiedades de más — el array ya viene con su
  // tipo inferido, así que no hay literal «fresco» que revisar. Es exactamente
  // el fallo que `CLAUDE.md` describe el 2026-10-16: el formulario envía, el
  // servidor acepta, la fila se guarda sin el campo, y nadie se entera hasta
  // semanas después.
  photoPath?: string | null;
  description?: string | null;
};

export type VentaEntrada = {
  clientId: string;
  lineas: LineaDeVentaEntrada[];
  pagos: PagoDeVentaEntrada[];
  credito: CreditoDeVentaEntrada[];
  nota?: string | null;
  // ── REGISTRAR UN PEDIDO DEL CATÁLOGO ────────────────────────────────
  //
  // Cuando viene, esta venta ES ese pedido, y los precios salen de
  // `catalog_order_items` y no del catálogo de hoy. Decisión del dueño el
  // 2026-10-24, preguntado cuál de los dos se cobra: «al congelado».
  //
  // EL PRECIO SIGUE SIN VIAJAR DESDE EL NAVEGADOR, y es toda la razón de que
  // esto sea el id de un pedido y no un número: el servidor lee la cifra
  // sellada del pedido que ya tiene, igual que si no la leyera del catálogo.
  // Un campo `precioSellado` habría sido un hueco por el que cobrar
  // cualquier cosa.
  //
  // También sella `sale_id` y `registered_at` en el pedido cuando la venta
  // queda escrita, que es lo que impide registrarlo dos veces.
  pedidoId?: string;
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

  // ── LA CUENTA PAUSADA NO ESCRIBE ────────────────────────────────────
  //
  // FALTABA, y es un hueco que entró con esta acción el 2026-10-17: todas las
  // demás que escriben —las ocho de la ficha del cliente, las cuatro del
  // panel, la del import— preguntan esto antes de tocar nada, y ésta nació sin
  // preguntarlo.
  //
  // NO BASTA CON ESCONDER EL BOTÓN. La guardia de la pantalla vive en el botón
  // flotante y en el disparador del diálogo; una venta se guarda con una
  // petición al servidor, que un formulario a medio enviar o una pestaña
  // abierta desde antes de la pausa puede disparar igual.
  //
  // Y SE PREGUNTA ANTES en vez de dejar que falle la RLS, por el mismo motivo
  // que explica `createClientWithMovement`: un insert rechazado vuelve como
  // «new row violates row-level security policy», y un update rechazado no
  // vuelve como error en absoluto —afecta a cero filas y la pantalla diría que
  // se guardó—. Preguntando antes, los dos casos dicen lo mismo y en
  // castellano.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

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

  // ── LOS PRECIOS SELLADOS DEL PEDIDO ─────────────────────────────────
  //
  // Filtrados por el pedido Y por su dueño, para que un `orderItemId` de otro
  // negocio pegado en la petición no traiga su precio.
  const selladas = new Map<
    string,
    { unit_price: number; currency: PriceCurrency; tier: "retail" | "wholesale" }
  >();
  if (entrada.pedidoId) {
    const { data: pedido } = await supabase
      .from("catalog_orders")
      .select("id")
      .eq("id", entrada.pedidoId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!pedido) return { ok: false, error: "No encontramos ese pedido." };
    // ── LA PARADA DURA, AHORA POR MONEDA Y NO POR PEDIDO ──────────────
    //
    // Sigue siendo la que vale: las pantallas ya tienen la suya, pero una
    // petición repetida --un doble toque, una pestaña vieja-- llega aquí sin
    // pasar por ninguna, y lo que está en juego es que el cliente deba el
    // doble.
    //
    // LO QUE CAMBIÓ ES QUÉ CUENTA COMO REPETIDA. Hasta la migración `158` un
    // pedido daba UNA venta, así que `sale_id != null` bastaba. Desde la
    // decisión del dueño del 2026-10-25 --dos monedas son dos ventas-- esa
    // condición rechazaría la SEGUNDA moneda, que es trabajo legítimo. Lo
    // repetido es volver a registrar una moneda que este pedido ya tiene
    // vendida.
    //
    // SE PREGUNTA POR `sales.catalog_order_id` Y NO POR `catalog_orders.
    // sale_id`: el segundo solo guarda la PRIMERA venta, así que con él la
    // tercera moneda pasaría dos veces.
    const { data: ventasDelPedido } = await supabase
      .from("sales")
      .select("id, sale_lines(currency)")
      .eq("catalog_order_id", pedido.id)
      .is("deleted_at", null);
    const monedasVendidas = new Set<string>();
    for (const v of ventasDelPedido ?? []) {
      for (const l of (v.sale_lines ?? []) as { currency: string | null }[]) {
        if (l.currency != null) monedasVendidas.add(String(l.currency));
      }
    }
    const repetida = entrada.lineas.find((l) => monedasVendidas.has(String(l.currency)));
    if (repetida) {
      return { ok: false, error: "Esa parte del pedido ya se registró." };
    }
    const { data: lineasDelPedido } = await supabase
      .from("catalog_order_items")
      .select("id, unit_price, currency, tier")
      .eq("order_id", entrada.pedidoId);
    for (const l of lineasDelPedido ?? []) {
      selladas.set(l.id, {
        unit_price: Number(l.unit_price),
        currency: l.currency as PriceCurrency,
        tier: l.tier === "wholesale" ? "wholesale" : "retail",
      });
    }
  }

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

    // ── EL PRECIO SELLADO MANDA, CUANDO LO HAY ──────────────────────
    //
    // Y SOLO SI LA MONEDA NO CAMBIÓ. Un precio sellado existe en UNA moneda:
    // la que el cliente vio. Si el tendero movió la línea a otra con
    // «Editar», no hay nada sellado que cobrar ahí y el precio sale del
    // catálogo, como en cualquier venta --que es lo que él acaba de elegir al
    // cambiarla--. El escalón también se respeta sellado: recalcularlo por la
    // cantidad nueva podría saltar a mayoreo y cambiar el precio por detrás.
    const sellada = linea.orderItemId ? selladas.get(linea.orderItemId) : undefined;
    const usaSellado = sellada != null && sellada.currency === linea.currency;
    const tierFinal = usaSellado ? sellada.tier : tier;
    const bloque = tierFinal === "retail" ? producto.producto.retail : producto.producto.wholesale;
    const unitPrice = usaSellado ? sellada.unit_price : precioEnMoneda(bloque, linea.currency, rates);
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
      tier: tierFinal,
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
    if (
      credito.plazoDias != null &&
      (!Number.isInteger(credito.plazoDias) || credito.plazoDias < 1 || credito.plazoDias > 365)
    ) {
      return { ok: false, error: "El plazo tiene que estar entre 1 y 365 días." };
    }
    // Las cuotas van de 2 a 36 y NECESITAN PLAZO para dividirlo: las dos cosas
    // son el `check` de la migración `118`, comprobadas aquí para que el
    // tendero lea una frase y no un error de Postgres. Una sola cuota se guarda
    // como null, que es lo mismo y es el comportamiento de siempre.
    if (credito.cuotas != null) {
      if (!Number.isInteger(credito.cuotas) || credito.cuotas < 2 || credito.cuotas > 36) {
        return { ok: false, error: "Las cuotas van de 2 a 36." };
      }
      if (credito.plazoDias == null) {
        return { ok: false, error: "Para pactar cuotas hace falta un plazo que repartir." };
      }
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
      // EL ENLACE CON EL PEDIDO VA EN EL INSERT, no en un `update` después.
      // Migración `158`: varias ventas pueden compartir pedido, una por
      // moneda, así que esta columna es la que de verdad los une. Puesta
      // aquí, una venta nacida de un pedido no puede existir ni un instante
      // sin decir de cuál -- que es justo el hueco por el que se pierde el
      // rastro cuando el `update` de después falla.
      catalog_order_id: entrada.pedidoId ?? null,
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
    const snapshot = await resolveMovementRateSnapshot(
      supabase,
      user.id,
      libroDeMoneda(resto.currency),
      credito.usarPrevista === true,
    );
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
        // ── LA DESCRIPCIÓN ES LO QUE EL TENDERO ESCRIBIÓ. SOLO ESO ─────
        //
        // Caía en los nombres de los productos cuando él no escribía nada, y
        // el dueño lo mandó quitar el 2026-10-22: *«en la descripción estás
        // poniendo los productos; si no escribió descripción déjala vacía con
        // un "-", si escribió agrégala allí pero si no, no»*.
        //
        // POR QUÉ ESTABA: era la única forma de que la fila del historial
        // dijera «Fiado · Casco» en vez de «Fiado» a secas. Pero rellenar un
        // campo del tendero con un dato que él no puso tiene un precio: la
        // ficha enseña «Descripción: Casco» como si lo hubiera escrito, y no
        // hay forma de distinguirlo de una descripción de verdad.
        //
        // LOS NOMBRES SIGUEN SALIENDO EN LA FILA, pero de donde viven: de
        // `sale_lines`. Las dos listas los resuelven desde ahí desde el mismo
        // día.
        //
        // LO YA GUARDADO NO SE TOCA. Un fiado anterior tiene el nombre del
        // producto metido en su `description` y ahí se queda: borrarlo
        // exigiría distinguir cuál fue escrito por el tendero y cuál copiado
        // de la venta, y esa diferencia no está guardada en ningún sitio. Así
        // que durante un tiempo convivirán fichas con descripción heredada y
        // fichas con «—». Es el precio de no borrar lo que no se puede
        // distinguir.
        description: credito.description?.trim() ? credito.description.trim().slice(0, 500) : null,
        photo_path: credito.photoPath ?? null,
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

  // ── EL PEDIDO APUNTA A SU PRIMERA VENTA ─────────────────────────────
  //
  // DESPUÉS de escribir la venta y no antes, y el orden importa: si esto
  // fuera primero y la venta fallara, el pedido apuntaría a una venta que no
  // existe.
  //
  // SOLO SI ESTÁ VACÍO. Desde la `158` un pedido puede dar varias ventas y
  // `sale_id` significa «la primera»; pisarlo con la segunda moneda borraría
  // el único dato que dice por dónde empezó. El enlace completo ya viaja en
  // `sales.catalog_order_id`, puesto en el insert de arriba.
  //
  // QUIÉN LO DA POR TERMINADO NO ES ESTA FUNCIÓN, y es deliberado: un pedido
  // está registrado cuando TODAS sus monedas tienen venta, y cuáles son sus
  // monedas depende de lo que «Editar» haya movido --que esta función no sabe
  // y no tiene por qué saber--. Lo sella `registrarPedidoComoVenta`, que sí
  // tiene delante las líneas y sus ediciones.
  //
  // UN FALLO AQUÍ NO TUMBA LA VENTA, que ya está escrita y es la que lleva el
  // dinero. Se escribe en el log para que se pueda arreglar a mano, que es lo
  // único peor que esto: que no se sepa.
  if (entrada.pedidoId) {
    const { error: errorSello } = await supabase
      .from("catalog_orders")
      .update({ sale_id: venta.id })
      .eq("id", entrada.pedidoId)
      .eq("owner_id", user.id)
      .is("sale_id", null);
    if (errorSello) {
      console.error("registrarVenta sello del pedido:", errorSello.message, {
        pedidoId: entrada.pedidoId,
        saleId: venta.id,
      });
    }
    revalidatePath(`/productos/ordenes/${entrada.pedidoId}`);
    revalidatePath("/productos/ordenes");
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

// ===========================================================================
// EL RESUMEN DE UNA VENTA YA GUARDADA
// ===========================================================================

export type BloqueDelResumen = {
  currency: PriceCurrency;
  lineas: { name: string; quantity: number; total: number }[];
  total: number;
  // Lo que el cliente entregó hoy en este libro.
  cobrado: number;
  // Lo que quedó debiendo de ESTA venta.
  debe: number;
  // Lo que ya debía ANTES de esta venta, en este mismo libro. `null` cuando no
  // hay cuenta que mirar: una venta de mostrador no es de nadie.
  deudaAntigua: number | null;
};

// QUIÉN SE LLEVÓ LA COMPRA, tal y como lo enseña la tarjeta «Datos del
// comprador» de los frames `1414:12447` y `1414:12570`. Ya formateado: el
// documento con sus puntos y el teléfono separado en operadora y número, que
// es como se comprueba de un vistazo.
//
// `null` ENTERO EN EL MOSTRADOR, y por eso es un objeto y no tres campos
// sueltos: una venta sin cliente no tiene estos datos a medias, no los tiene.
// Con tres campos nullables la pantalla tendría que decidir cuántos huecos
// hacen falta para no dibujar la tarjeta, y ahí es donde aparece una tarjeta
// con tres rayas.
export type CompradorDelResumen = {
  // EL ID VA DENTRO DEL COMPRADOR, y no suelto en `ResumenDeVenta`, porque el
  // botón «Ver ‹nombre›» tiene exactamente la misma condición que la tarjeta
  // «Datos del comprador»: existe cuando hay alguien a quien nombrar. En una
  // venta de mostrador `comprador` es `null` y las dos cosas desaparecen
  // juntas, sin que haya que acordarse de repetir la condición.
  id: string;
  nombre: string;
  documento: string;
  telefono: string;
};

export type ResumenDeVenta =
  | {
      ok: true;
      saleId: string;
      // Cuándo se hizo, ya formateada y en la zona del negocio. Ver dónde se
      // calcula, al final de `resumenDeVenta`.
      fecha: string;
      // EL CÓDIGO CORTO DE ESTA TRANSACCIÓN — migración `147`.
      //
      // Encargo del dueño el 2026-10-24, con dos capturas: *«Ni en las
      // pantallas de ¡Transacción registrada con éxito! ni en los png que se
      // comparten incluiste los códigos de transacción»*. El flujo del abono
      // ya lo llevaba desde el día anterior; el de una venta no, ni fiada ni
      // de contado, porque las dos terminan en esta misma pantalla.
      //
      // `null` CUANDO LA FILA ES ANTERIOR A LA MIGRACIÓN y nadie la rellenó.
      // La pantalla no dibuja nada en ese caso, igual que `CodigoDeTransaccion`:
      // un «Código: —» promete algo que buscar que ninguna búsqueda encuentra.
      codigo: string | null;
      comprador: CompradorDelResumen | null;
      bloques: BloqueDelResumen[];
      rates: BolivarRates | null;
    }
  | { ok: false; error: string };

// LO QUE LA VENTA DEJÓ, RECONSTRUIDO DESDE LA BASE Y NO DESDE LA PANTALLA.
//
// `registrarVenta` ya devuelve `cobrado` y `fiado`, así que el asistente
// podría pintar este resumen con lo que tiene en memoria y ahorrarse esta
// consulta. No se hace, por dos razones que no son de estilo:
//
//   · ESTA PANTALLA TIENE URL. El tendero puede recargarla, volver a ella o
//     compartirla con el teléfono en la mano media hora después; un resumen
//     que vive en el estado de React se queda en blanco en cuanto eso pasa.
//   · Y LO QUE SE ENSEÑA ES LO QUE SE GUARDÓ. Un resumen dibujado con las
//     cifras del navegador diría que todo salió bien aunque el servidor
//     hubiera redondeado distinto o topado un pago. Esta pantalla es lo que
//     el tendero le enseña a su cliente: tiene que salir del mismo sitio del
//     que sale su saldo.
export async function resumenDeVenta(saleId: string): Promise<ResumenDeVenta> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  // LA VENTA SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente y no
  // solo por RLS -- la regla de `CLAUDE.md` para toda fila leída por un id que
  // llega del navegador. Aquí se leería la compra de un cliente de otro
  // negocio, con sus productos y su deuda.
  const { data: venta } = await supabase
    .from("sales")
    // `transaction_code` SALE DE AQUI, de la venta, y no de sus movimientos.
    // Es lo unico que funciona en una venta de contado: pagada entera no
    // escribe ni un movimiento (migracion `124`), asi que su codigo solo vive
    // en esta fila. Es la razon por la que la migracion `147` puso la columna
    // en `sales` ademas de en `movements`.
    .select("id, client_id, created_at, transaction_code")
    .eq("id", saleId)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!venta) return { ok: false, error: "No encontramos esa venta." };

  const [{ data: lineas }, { data: pagos }, { data: cliente }, contexto] = await Promise.all([
    supabase.from("sale_lines").select("name, quantity, unit_price, currency").eq("sale_id", venta.id),
    supabase.from("sale_payments").select("currency, amount").eq("sale_id", venta.id),
    supabase
      .from("clients")
      // `id` LO LLEVA EL COMPRADOR desde el 2026-10-19, para el botón «Ver
      // ‹nombre›» del resumen. Sale de aquí y no del navegador: la página ya
      // comprobó que la venta es del dueño de la sesión, así que este id es el
      // del cliente de ESA venta y no uno que alguien pueda cambiar en la URL.
      .select("id, name, document_id, document_type, whatsapp, is_walk_in")
      .eq("id", venta.client_id)
      .maybeSingle(),
    contextoDeVenta(supabase, user.id),
  ]);

  // LO QUE DEBÍA ANTES, Y «ANTES» ES UNA FECHA, no «el saldo de hoy menos esta
  // venta». La resta parece equivalente y solo lo es en el instante justo
  // después de guardar: el día que el tendero vuelva a abrir este enlace —o
  // simplemente registre un abono y use el botón de atrás— el saldo ya no es
  // el mismo y la resta empieza a inventar una cifra que nunca existió.
  //
  // Con la fecha, «Deuda antigua» es un hecho histórico y dice lo mismo hoy
  // que dentro de un año, que es lo que una pantalla compartible necesita.
  //
  // `sale_id` se descarta además de la fecha: los cargos de esta venta se
  // escriben inmediatamente después de la fila de `sales` y dos marcas de
  // tiempo iguales harían que su propia deuda se contara como antigua.
  const { data: previos } = venta.client_id
    ? await supabase
        .from("movements")
        .select("type, amount, currency, sale_id")
        .eq("client_id", venta.client_id)
        .is("deleted_at", null)
        .lte("created_at", venta.created_at)
    : { data: [] };

  const deudaPrevia = new Map<PriceCurrency, number>();
  for (const m of previos ?? []) {
    if (m.sale_id === venta.id) continue;
    // `currency` nulo es el libro de un negocio colombiano, que es una
    // respuesta y no una ausencia -- el mismo criterio que `libroDeMoneda`.
    const libro = (m.currency ?? "COP") as PriceCurrency;
    const signo = m.type === "charge" ? 1 : -1;
    deudaPrevia.set(libro, (deudaPrevia.get(libro) ?? 0) + signo * Number(m.amount));
  }

  const totales = new Map<PriceCurrency, number>();
  const porMoneda = new Map<PriceCurrency, { name: string; quantity: number; total: number }[]>();
  for (const l of lineas ?? []) {
    const moneda = l.currency as PriceCurrency;
    const total = redondear(Number(l.quantity) * Number(l.unit_price));
    porMoneda.set(moneda, [
      ...(porMoneda.get(moneda) ?? []),
      { name: l.name as string, quantity: Number(l.quantity), total },
    ]);
    totales.set(moneda, redondear((totales.get(moneda) ?? 0) + total));
  }

  const cobrados = new Map<PriceCurrency, number>();
  for (const p of pagos ?? []) {
    const moneda = p.currency as PriceCurrency;
    cobrados.set(moneda, redondear((cobrados.get(moneda) ?? 0) + Number(p.amount)));
  }

  // EL ORDEN ES EL DEL FRAME —dólares, euros, pesos—, no el de llegada de las
  // filas: dos ventas con los mismos libros tienen que enseñar sus tarjetas en
  // el mismo orden, o el tendero las compara mal.
  const ORDEN: PriceCurrency[] = ["USD", "EUR", "COP"];
  const monedas = ORDEN.filter((c) => totales.has(c) || cobrados.has(c));

  const esMostrador = cliente?.is_walk_in === true;
  const bloques: BloqueDelResumen[] = monedas.map((currency) => {
    const total = totales.get(currency) ?? 0;
    const cobrado = cobrados.get(currency) ?? 0;
    const debe = redondear(Math.max(0, total - cobrado));
    return {
      currency,
      lineas: porMoneda.get(currency) ?? [],
      total,
      cobrado,
      debe,
      // Una deuda previa negativa es un cliente con saldo a favor. Se enseña
      // como cero y no en negativo: la fila dice «Deuda antigua», y un número
      // rojo con signo menos debajo de esa palabra se lee al revés de lo que
      // significa.
      deudaAntigua: esMostrador ? null : redondear(Math.max(0, deudaPrevia.get(currency) ?? 0)),
    };
  });

  // ── CUÁNDO SE HIZO LA VENTA ──────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-22: la pantalla de éxito y el PNG que se
  // comparte desde ella no llevaban fecha.
  //
  // SE FORMATEA AQUÍ, EN EL SERVIDOR, Y EN LA ZONA DEL NEGOCIO, por la misma
  // razón que el documento dos líneas más abajo —lo leen la pantalla y el
  // canvas— y por una más que solo aplica a una fecha: `Intl` sin zona usa la
  // de quien ejecuta. En el servidor eso es UTC, así que una venta de las
  // nueve de la noche en Caracas saldría fechada al día siguiente.
  //
  // EL PAÍS SALE DE `monedasDelLibro` y no de otra consulta: un negocio
  // colombiano tiene un solo libro y es COP. `contextoDeVenta` ya resolvió el
  // país para saberlo, y volver a preguntarlo sería una lectura más para un
  // dato que ya está aquí.
  const esColombiano = contexto.ok && contexto.monedasDelLibro[0] === "COP";

  return {
    ok: true,
    saleId: venta.id,
    fecha: formatReceiptDateTime(venta.created_at as string, esColombiano ? "CO" : "VE"),
    codigo: (venta.transaction_code as string | null) ?? null,
    // SE FORMATEA AQUÍ Y NO EN CADA PANTALLA. Esto lo leen dos sitios —la
    // pantalla y el canvas de la imagen— y un documento con puntos en una y
    // sin ellos en la otra es la misma venta contando dos cosas distintas.
    //
    // `formatDocumentId` ya devuelve «—» cuando no hay, que es la regla de
    // `DESIGN-SYSTEM.md`: la fila se queda y el hueco se ve, en vez de que un
    // dato que falta desaparezca sin dejar rastro.
    comprador:
      esMostrador || !cliente
        ? null
        : {
            id: cliente.id as string,
            nombre: cliente.name as string,
            documento: formatDocumentId(
              (cliente.document_id as string | null) ?? null,
              (cliente.document_type as string | null) ?? null,
            ),
            telefono: cliente.whatsapp ? telefonoLegible(cliente.whatsapp as string) : "—",
          },
    bloques,
    rates: contexto.ok ? contexto.rates : null,
  };
}

// ===========================================================================
// ELIMINAR UNA VENTA
// ===========================================================================
//
// Encargo del dueño el 2026-10-20, al pedir el «⋮» del detalle de una venta de
// contado: *«Agreguemos de una vez "⋮" en el detalle de la venta para
// eliminarla»*.
//
// NO EXISTÍA NINGÚN CAMINO QUE BORRARA UNA VENTA. El único `delete` sobre
// `sales` en todo el repo era el rollback interno de cuando falla el registro.
// El dinero cobrado de contado no tenía ficha ni forma de deshacerse.
//
// ===========================================================================
// BORRA LA VENTA ENTERA, NO LA PARTE DE UNA MONEDA, Y ESO ES DELIBERADO
//
// El menú vive en la pantalla de UNA moneda, así que la tentación es borrar
// solo esa parte. No se puede, y la razón es de datos:
//
//   · Quitar los pagos de una moneda y dejar sus líneas deja una venta que
//     `registrarVenta` nunca habría guardado: productos vendidos, nada
//     cobrado y ningún cargo que lo represente.
//   · Quitar las dos cosas sería un borrado DURO: `sale_lines` y
//     `sale_payments` no tienen `deleted_at`, así que no habría vuelta atrás.
//     Todo lo demás de esta app se borra en blando y se puede restaurar.
//
// Así que «Eliminar venta» borra la venta y los fiados que nacieron de ella.
// La confirmación lo dice con sus cifras: lo que no se puede evitar es que el
// tendero no sepa lo que se lleva por delante.
//
// POR ESO SE LLAMA DISTINTO QUE EL DEL FIADO. «Eliminar transacción», en la
// ficha de un fiado, sigue borrando SOLO ese movimiento. Dos alcances, dos
// nombres; no es una inconsistencia, es la distinción dicha en voz alta.
export async function eliminarVenta(
  saleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  if (!(await puedeEscribir(supabase, user.id))) return { ok: false, error: MENSAJE_CUENTA_PAUSADA };

  // LA PROPIEDAD, EN CÓDIGO. `sales` lleva `owner_id` directo y aun así se
  // compara aquí: es la regla de `CLAUDE.md` para toda fila que se toca por un
  // id que llega del navegador.
  const { data: venta } = await supabase
    .from("sales")
    .select("id, owner_id, client_id")
    .eq("id", saleId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!venta || venta.owner_id !== user.id) {
    return { ok: false, error: "No encontramos esa venta." };
  }

  // Los movimientos que nacieron de ella, para borrarlos con ella y para
  // dejar su rastro restaurable.
  const { data: movimientos } = await supabase
    .from("movements")
    .select("id, client_id")
    .eq("sale_id", saleId)
    .is("deleted_at", null);

  const ahora = new Date().toISOString();

  // ═══════════════════════════════════════════════════════════════════════
  // THE MOVEMENTS GO FIRST AND THE SALE LAST, AND EVERY FAILURE RETURNS.
  //
  // Both halves of that sentence are the fix for `CT-122`, found reading this
  // function during the launch-A regression on 2026-10-21. It had the sale
  // deleted first, a `continue` when a movement failed, and `ok: true` at the
  // end whatever happened -- so a single failed update left the customer owing
  // money for a sale that no longer appeared anywhere, and the screen said it
  // had worked.
  //
  // WHY THE ORDER MATTERS AND NOT JUST THE RETURN. Any failure here leaves a
  // half-done state; what the order decides is WHICH half, and whether the
  // owner can try again:
  //
  //   · Sale first (the old way): a failed movement leaves the sale gone from
  //     the list and the debt alive. There is nothing left to tap, so the
  //     retry is impossible and the money stays wrong.
  //   · Movements first (this way): a failure leaves the sale still listed,
  //     so «Eliminar venta» is right there to press again -- and the second
  //     run skips what it already deleted, because the query above filters on
  //     `deleted_at is null`. It converges.
  //
  // The control that made this a finding rather than an opinion is
  // `deleteMovement` in `dashboard/actions.ts`: it has been in production for
  // months doing this for a single transaction, and it returns an error both
  // when the delete fails and when the recalc does. This now matches it.
  // ═══════════════════════════════════════════════════════════════════════
  for (const m of movimientos ?? []) {
    const { error } = await supabase
      .from("movements")
      .update({ deleted_at: ahora })
      .eq("id", m.id);
    if (error) {
      return { ok: false, error: mensajeDeError("eliminar la venta", error, "eliminarVenta") };
    }
    // EL RASTRO QUE HACE QUE SE PUEDA RESTAURAR. Es la misma tabla que usa
    // `deleteMovement`, así que el fiado sale en la misma notificación de
    // siempre y `restoreMovement` lo devuelve — y con él la venta, porque esa
    // función revive también la venta de la que nació.
    //
    // THIS ONE DOES NOT RETURN, and that is the one deliberate exception. The
    // movement is already deleted and the ledger is already right; what is
    // missing is only the notification offering to undo it. Failing the whole
    // action here would tell the owner the sale was not deleted when it was,
    // which is the very lie this fix exists to remove.
    const { error: errorAviso } = await supabase.from("movement_deletions").insert({
      movement_id: m.id,
      owner_id: user.id,
      client_id: m.client_id,
    });
    if (errorAviso) console.error("[venta] aviso de borrado:", errorAviso.message);
  }

  const { error: errorVenta } = await supabase
    .from("sales")
    .update({ deleted_at: ahora })
    .eq("id", saleId)
    .eq("owner_id", user.id);

  if (errorVenta) {
    return { ok: false, error: mensajeDeError("eliminar la venta", errorVenta, "eliminarVenta") };
  }

  // UN RECÁLCULO FALLIDO TAMBIÉN DEVUELVE ERROR. Si esto no corre, el saldo
  // del cliente sigue contando lo que acaba de borrarse: la pantalla diría
  // que la venta se eliminó y el cliente seguiría debiendo por ella. Es el
  // mismo descuadre silencioso de más arriba, entrando por otra puerta.
  const { error: errorRecalc } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: venta.client_id,
  });
  if (errorRecalc) {
    return { ok: false, error: mensajeDeError("recalcular el saldo", errorRecalc, "recalc") };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${venta.client_id}`);
  return { ok: true };
}
