// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// EL RESUMEN DE UNA VENTA: `/ventas/<id>`, frame `1389:8595`.
//
// SÍ ESCRIBE en dev: crea cliente, producto, ventas y movimientos, y el
// `finally` los borra aunque el script se caiga a mitad.
//
// ===========================================================================
// ESTO PIDE LA PÁGINA DE VERDAD, POR HTTP Y CON LA SESIÓN DEL DUEÑO
//
// Es la diferencia que hace que la suite valga algo. `resumenDeVenta` vive en
// un fichero `"use server"` y no se puede importar desde aquí, así que la
// alternativa era copiar sus consultas a este script — y dos consultas
// escritas mirándose entre sí coinciden perfectamente y pueden estar las dos
// equivocadas. Es exactamente lo que `CLAUDE.md` cuenta de las plantillas de
// WhatsApp: tres controles verdes y doce envíos rotos.
//
// Así que lo que se comprueba es el HTML que el tendero recibiría, pedido al
// `next dev` de la máquina con la cookie de sesión. Si falta un grant, si una
// política filtra las filas, si la cifra sale mal o si el rótulo es el otro,
// aquí se ve.
//
// REQUIERE `npm run dev` CORRIENDO en el puerto 3000 — y apuntando a dev,
// porque lee el mismo `.env.local` que este script comprueba.
//
// ===========================================================================
// LA FILA QUE JUSTIFICA TODO ESTO ES LA 4
//
// «Deuda antigua» se calcula con una FECHA —lo que el cliente debía antes de
// esta venta— y no restando esta venta del saldo de hoy. Las dos dan el mismo
// número en el instante justo después de guardar, que es cuando cualquiera lo
// probaría. Se separan el día siguiente, cuando el tendero vuelve a abrir el
// enlace: la resta empieza a inventar una cifra que nunca existió. La 4 mueve
// el saldo DESPUÉS de la venta y vuelve a pedir la página.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// EL FORMATO DE LOS IMPORTES CAMBIÓ EL 2026-10-24, y por eso estas cadenas
// llevan coma decimal: el dólar y el euro pasaron de «$20.00» a «$20,00»
// cuando el punto de miles se volvió el estándar de toda la app (decisión del
// dueño, ver `DESIGN-SYSTEM.md`). Esta suite fue una de las dos que lo
// cazaron, que es justo lo que tenía que pasar — compara el texto que de
// verdad sale a pantalla, no el que alguien recuerda.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "ZZ QA resumen";
const clientes = [];
const productos = [];
const ventas = [];
const movimientos = [];

// Una pausa corta entre el cargo viejo y la venta. `created_at` lo pone la
// base con precisión de microsegundos, así que no hace falta para distinguir
// las filas — hace falta para que el orden sea evidente al leer el fallo si
// algún día esta suite se pone roja.
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const { data: ve } = await admin
    .from("owners")
    .select("id, country")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (!ve) {
    console.error("ME NIEGO A CORRER: no hay ningún negocio VE en dev.");
    process.exit(1);
  }

  // ── LA COOKIE DE SESIÓN, sin teclear ninguna contraseña ─────────────
  //
  // `generateLink` + `verifyOtp` da una sesión de verdad, y el formato de la
  // cookie es el de `@supabase/ssr`: el JSON de la sesión en base64url, y
  // partido en trozos si pasa del tamaño que un navegador admite. Es el mismo
  // patrón de `qa/papelera-fixture.mjs`.
  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  if (!correo) throw new Error("el dueño VE no tiene correo con el que abrir sesión");
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);

  const nombreCookie = `sb-${ref}-auth-token`;
  const valor =
    "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
  const MAX = 3180;
  const trozos =
    valor.length <= MAX
      ? [`${nombreCookie}=${valor}`]
      : Array.from(
          { length: Math.ceil(valor.length / MAX) },
          (_, i) => `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        );
  const cookie = trozos.join("; ");

  // LOS COMENTARIOS DEL HTML SE QUITAN ANTES DE BUSCAR NADA, y no es cosmética.
  //
  // React separa un texto de la expresión que va pegada a él con un
  // `<!-- -->`, así que «Resumen de compra en {nombre}» llega al navegador
  // como `Resumen de compra en <!-- -->Dólares`. Buscar la frase entera daba
  // -1 con la pantalla perfectamente pintada: un fallo de la prueba que se lee
  // igual que un fallo del producto, y que costó una vuelta el 2026-10-18.
  async function pedirResumen(saleId) {
    const r = await fetch(`${BASE}/ventas/${saleId}`, {
      headers: { cookie },
      redirect: "manual",
      cache: "no-store",
    });
    const html = (await r.text()).replace(/<!--[\s\S]*?-->/g, "");
    return { status: r.status, html };
  }

  // ── EL FIXTURE ──────────────────────────────────────────────────────
  // CON DOCUMENTO Y TELÉFONO, que es lo que la tarjeta «Datos del comprador»
  // enseña desde el 2026-10-18. Se guardan en crudo —dígitos pegados, como los
  // guarda la app— justo para que la comprobación 1c mire el FORMATEO y no
  // una cadena que ya venía con puntos.
  const { data: cliente } = await admin
    .from("clients")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} cliente`,
      document_id: "12345678",
      whatsapp: "584141234567",
    })
    .select("id")
    .single();
  clientes.push(cliente.id);

  const { data: mostrador } = await admin
    .from("clients")
    .select("id")
    .eq("owner_id", ve.id)
    .eq("is_walk_in", true)
    .maybeSingle();
  let mostradorId = mostrador?.id ?? null;
  if (!mostradorId) {
    const { data: nuevo } = await admin
      .from("clients")
      .insert({ owner_id: ve.id, name: `${MARCA} mostrador`, is_walk_in: true })
      .select("id")
      .single();
    mostradorId = nuevo.id;
    clientes.push(nuevo.id);
  }

  const { data: prod } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      base_currency_retail: "USD",
      price_retail: 10,
    })
    .select("id")
    .single();
  productos.push(prod.id);

  // LA DEUDA VIEJA: 30 USD, de antes de la venta.
  const { data: viejo } = await admin
    .from("movements")
    .insert({
      client_id: cliente.id,
      created_by: ve.id,
      type: "charge",
      amount: 30,
      currency: "USD",
      source: "manual",
      description: `${MARCA} deuda vieja`,
    })
    .select("id")
    .single();
  movimientos.push(viejo.id);

  await esperar(1200);

  // LA VENTA: 20 USD con 5 abonados (quedan 15 fiados) y 7 EUR pagados
  // completos. Dos libros en una sola venta, que es lo que el frame dibuja
  // con sus dos tarjetas.
  const { data: venta } = await admin
    .from("sales")
    .insert({ owner_id: ve.id, client_id: cliente.id, created_by: ve.id })
    .select("id, created_at")
    .single();
  ventas.push(venta.id);

  await admin.from("sale_lines").insert([
    {
      sale_id: venta.id,
      product_id: prod.id,
      name: `${MARCA} producto`,
      quantity: 2,
      unit_price: 10,
      currency: "USD",
    },
    {
      sale_id: venta.id,
      product_id: null,
      name: `${MARCA} cosa en euros`,
      quantity: 1,
      unit_price: 7,
      currency: "EUR",
    },
  ]);
  await admin.from("sale_payments").insert([
    { sale_id: venta.id, currency: "USD", amount: 5 },
    { sale_id: venta.id, currency: "EUR", amount: 7 },
  ]);
  const { data: cargo } = await admin
    .from("movements")
    .insert({
      client_id: cliente.id,
      created_by: ve.id,
      type: "charge",
      amount: 15,
      currency: "USD",
      source: "manual",
      sale_id: venta.id,
      description: `${MARCA} lo que quedó`,
    })
    .select("id")
    .single();
  movimientos.push(cargo.id);

  // ── 1. LA PÁGINA RESPONDE Y DICE LO QUE PASÓ ────────────────────────
  const r1 = await pedirResumen(venta.id);
  check(
    "1. el DUEÑO abre /ventas/<id> con su sesión y la página responde 200",
    r1.status === 200,
    `HTTP ${r1.status}`,
  );
  check(
    "1b. y dice que la transacción quedó registrada",
    r1.html.includes("Transacción registrada con éxito"),
    r1.status === 200 ? "" : "la página ni siquiera cargó",
  );

  // ── 1c. LOS DATOS DEL COMPRADOR, Y YA FORMATEADOS ────────────
  //
  // Frame `1414:12447`. Se comprueban las tres filas Y su formato: el
  // documento con sus puntos y el teléfono partido en operadora y número. Si
  // solo se mirara que el dato está, un «584141234567» seguido pasaría igual
  // de verde — y esa tarjeta existe para que alguien compruebe de un vistazo
  // que la cuenta es la suya.
  check(
    "1c. la tarjeta «Datos del comprador», con el documento y el teléfono legibles",
    r1.html.includes("Datos del comprador") &&
      r1.html.includes("Nombre y apellido") &&
      r1.html.includes("12.345.678") &&
      r1.html.includes("+58 414 1234567"),
    "ver el HTML si falla",
  );

  // ── 2. LAS DOS TARJETAS, EN EL ORDEN DEL FRAME ──────────────────────
  const iUsd = r1.html.indexOf("Resumen de compra en Dólares");
  const iEur = r1.html.indexOf("Resumen de compra en Euros");
  check(
    "2. una tarjeta por moneda, dólares antes que euros",
    iUsd >= 0 && iEur >= 0 && iUsd < iEur,
    `dólares en ${iUsd} · euros en ${iEur}`,
  );

  // ── 3. LAS CIFRAS DEL LIBRO EN DÓLARES ──────────────────────────────
  //
  // 20 de venta, 5 abonados, 15 fiados, 30 de antes, 45 en total. Se
  // comprueban los cinco números y no solo el último: un error de signo en la
  // deuda antigua deja el total correcto si el abono lo compensa.
  const usd = r1.html.slice(iUsd, iEur >= 0 ? iEur : undefined);
  check(
    "3. el libro en dólares: total 20, abonó 5, debe 15, antigua 30, total 45",
    usd.includes("$20,00") &&
      usd.includes("Abonó en Dólares") &&
      usd.includes("$5,00") &&
      usd.includes("Debe (esta venta)") &&
      usd.includes("$15,00") &&
      usd.includes("Deuda antigua") &&
      usd.includes("$30,00") &&
      usd.includes("Deuda total") &&
      usd.includes("$45,00"),
    "ver el HTML si falla",
  );

  // ── 4. «DEUDA ANTIGUA» ES UNA FECHA, NO UNA RESTA ───────────────────
  //
  // ESTA ES LA FILA QUE JUSTIFICA LA SUITE. Se registra un cargo nuevo DESPUÉS
  // de la venta y se vuelve a pedir la misma página. Con la resta —saldo de
  // hoy menos esta venta— la deuda antigua saltaría de 30 a 130 y el resumen
  // diría que el cliente ya debía 130 antes de una compra que ocurrió antes.
  const { data: posterior } = await admin
    .from("movements")
    .insert({
      client_id: cliente.id,
      created_by: ve.id,
      type: "charge",
      amount: 100,
      currency: "USD",
      source: "manual",
      description: `${MARCA} posterior`,
    })
    .select("id")
    .single();
  movimientos.push(posterior.id);

  const r4 = await pedirResumen(venta.id);
  const usd4 = r4.html.slice(
    r4.html.indexOf("Resumen de compra en Dólares"),
    r4.html.indexOf("Resumen de compra en Euros"),
  );
  check(
    "4. un cargo POSTERIOR no cambia la deuda antigua del resumen",
    usd4.includes("$30,00") && !usd4.includes("$130,00") && usd4.includes("$45,00"),
    usd4.includes("$130,00") ? "subió a 130 — se está restando en vez de mirar la fecha" : "sigue en 30",
  );

  // ── 5. EL LIBRO SALDADO DICE «PAGO DE CONTADO» ──────────────────────
  //
  // Y NO «Abonó en Euros». No es sinónimo: lo primero cierra la cuenta, lo
  // segundo es un abono a una deuda que sigue viva. El frame las dibuja como
  // dos tarjetas distintas justo por eso.
  const eur = r4.html.slice(r4.html.indexOf("Resumen de compra en Euros"));
  check(
    "5. el libro en euros queda saldado: «Pago de contado», sin «Debe»",
    eur.includes("Pago de contado") &&
      !eur.includes("Abonó en Euros") &&
      !eur.includes("Debe (esta venta)"),
    "ver el HTML si falla",
  );

  // ── 6. EL MOSTRADOR NO TIENE DEUDA ANTIGUA QUE ENSEÑAR ──────────────
  const { data: ventaMostrador } = await admin
    .from("sales")
    .insert({ owner_id: ve.id, client_id: mostradorId, created_by: ve.id })
    .select("id")
    .single();
  ventas.push(ventaMostrador.id);
  await admin.from("sale_lines").insert({
    sale_id: ventaMostrador.id,
    product_id: prod.id,
    name: `${MARCA} producto`,
    quantity: 1,
    unit_price: 10,
    currency: "USD",
  });
  await admin
    .from("sale_payments")
    .insert({ sale_id: ventaMostrador.id, currency: "USD", amount: 10 });

  const r6 = await pedirResumen(ventaMostrador.id);
  check(
    "6. una venta de mostrador: contado, y ni una palabra de deuda",
    r6.status === 200 &&
      r6.html.includes("Pago de contado") &&
      !r6.html.includes("Deuda antigua") &&
      !r6.html.includes("Deuda total"),
    `HTTP ${r6.status}`,
  );
  // Y SIN TARJETA DE COMPRADOR, porque no hay comprador que nombrar. Una
  // tarjeta con tres rayas diría que faltan datos de alguien, cuando lo cierto
  // es que no hay alguien.
  check(
    "6b. y sin la tarjeta «Datos del comprador», que no tendría a quién nombrar",
    !r6.html.includes("Datos del comprador"),
    r6.html.includes("Datos del comprador") ? "la dibujó vacía" : "no se dibuja",
  );

  // ── 7. LA VENTA DE OTRO NEGOCIO NO SE ABRE ──────────────────────────
  //
  // El id llega por la barra de direcciones, que es la puerta más abierta que
  // hay. La comprobación de propiedad vive en `resumenDeVenta` y no en la
  // RLS a secas, que es la regla de `CLAUDE.md`; esta fila la ejerce.
  const { data: otro } = await admin
    .from("owners")
    .select("id")
    .neq("id", ve.id)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (otro) {
    const { data: clienteAjeno } = await admin
      .from("clients")
      .insert({ owner_id: otro.id, name: `${MARCA} ajeno` })
      .select("id")
      .single();
    clientes.push(clienteAjeno.id);
    const { data: ventaAjena } = await admin
      .from("sales")
      .insert({ owner_id: otro.id, client_id: clienteAjeno.id })
      .select("id")
      .single();
    ventas.push(ventaAjena.id);
    const r7 = await pedirResumen(ventaAjena.id);
    check(
      "7. la venta de OTRO negocio devuelve 404, no su contenido",
      r7.status === 404 && !r7.html.includes("Resumen de compra en"),
      `HTTP ${r7.status}`,
    );
  } else {
    check("7. la venta de OTRO negocio devuelve 404", false, "no hay un segundo negocio en dev");
  }

  // ── 8. UN ID INVENTADO TAMPOCO ──────────────────────────────────────
  const r8 = await pedirResumen("00000000-0000-4000-8000-000000000000");
  check("8. un id que no existe devuelve 404", r8.status === 404, `HTTP ${r8.status}`);
} catch (e) {
  check("la suite llegó al final", false, e instanceof Error ? e.message : String(e));
} finally {
  if (movimientos.length) await admin.from("movements").delete().in("id", movimientos);
  if (ventas.length) await admin.from("sales").delete().in("id", ventas);
  if (productos.length) await admin.from("products").delete().in("id", productos);
  if (clientes.length) await admin.from("clients").delete().in("id", clientes);

  const { count: quedanClientes } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  const { count: quedanLineas } = await admin
    .from("sale_lines")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check(
    "9. limpieza: no queda nada de la prueba en dev",
    quedanClientes === 0 && quedanLineas === 0,
    `${quedanClientes} clientes · ${quedanLineas} líneas`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
