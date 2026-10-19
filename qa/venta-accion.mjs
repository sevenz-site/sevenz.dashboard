// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev: clientes, un producto y ventas. El `finally` lo borra
// aunque el script se caiga a mitad.
//
// REQUIERE `npm run dev` CORRIENDO en el puerto 3000.
//
// ===========================================================================
// LLAMA A `registrarVenta` DE VERDAD, QUE ES LO QUE NINGUNA OTRA SUITE HACE
//
// `qa:venta` escribe en `sales`, `sale_lines` y `movements` con la clave de
// servicio, así que prueba el ESQUEMA: los grants, las políticas, las cascadas.
// Lo que no puede probar es la acción del servidor, porque vive en un fichero
// `"use server"` y no se puede importar desde Node.
//
// Y ahí está casi toda la defensa de la venta. Las reglas del dinero —no cobrar
// más de lo que suma, el plazo entre 1 y 365, las cuotas entre 2 y 36, el
// cliente que tiene que ser del dueño, y que el MOSTRADOR no puede quedar
// fiado— son TypeScript, no restricciones de la base. Una suite que escribe con
// la clave de servicio las pasa todas por encima sin tocarlas.
//
// El caso que lo hizo necesario es `CT-102`: la ficha decía que `registrarVenta`
// aceptaba dejar fiado al mostrador. Cuando se fue a cerrar el 2026-10-19
// resultó que el guardia ya existía desde el día anterior... y seguía sin
// haberse ejecutado nunca. Se cerró leyendo el código, que es exactamente lo
// que `CLAUDE.md` dice que no basta. Esta suite es la prueba que faltaba.
//
// ===========================================================================
// CÓMO SE LLAMA A UNA ACCIÓN DE SERVIDOR DESDE FUERA
//
// Next las expone en la URL de la página con una cabecera `Next-Action` que
// lleva el id de la acción. El id es un hash que CAMBIA en cada compilación, así
// que escribirlo aquí a mano haría que la suite se rompiera sola el martes
// siguiente.
//
// Se descubre en vez de fijarse: en desarrollo Next emite
// `createServerReference("<id>", …, "registrarVenta")` en el chunk del cliente
// —el NOMBRE va al lado del id, para que sus propios errores sean legibles— así
// que el emparejamiento es explícito y no hay nada que adivinar. Si algún día
// Next deja de emitir el nombre, esta suite falla en el primer paso con un
// mensaje que lo dice, que es mejor que probar la acción equivocada.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

const MARCA = "QA ACCION";
const creados = { clientes: [], productos: [], ventas: [] };

// ── EL ID DE LA ACCIÓN SE LE PIDE AL SERVIDOR QUE SE VA A PROBAR ───────
//
// LA PRIMERA VERSIÓN LO LEÍA DEL DISCO, de `.next/static`, y estaba mal por
// dos razones que juntas daban HTTP 404 en cada llamada:
//
//   · `.next/static` es lo que dejó el último `npm run build`. El `next dev`
//     sirve OTROS chunks, con otros ids — y contra un despliegue remoto el
//     disco de esta máquina no tiene nada que ver con lo que responde.
//   · La expresión permitía 200 caracteres entre el id y el nombre, así que
//     emparejaba el id de una acción con el nombre de la SIGUIENTE. Un id
//     ajeno es exactamente un 404.
//
// Así que se le pregunta a la URL que se está probando: se baja la página, se
// saca de su HTML la lista de chunks, y se busca la llamada COMPLETA a
// `createServerReference`, acotada a un solo paréntesis. Con eso la suite vale
// igual contra `localhost` y contra el despliegue de dev.
async function idDeLaAccion(base, nombre, cookie) {
  const res = await fetch(`${base}/ventas/nueva`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`/ventas/nueva respondió HTTP ${res.status} en ${base}`);
  const html = await res.text();

  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
  if (urls.length === 0) {
    throw new Error(`la página de ${base} no declara ningún chunk — ¿la sesión no entró y devolvió el login?`);
  }

  // UN NIVEL MÁS, porque el HTML no basta: `next dev` carga el chunk del
  // asistente de forma PEREZOSA, así que la acción no está en lo que la página
  // declara de entrada — está en un chunk al que esos chunks apuntan. La
  // primera versión se quedaba en el primer nivel y no encontraba nada, lo que
  // parecía «Next cambió de formato» y era solo buscar demasiado pronto.
  //
  // Un nivel y se para: el grafo completo son cientos de ficheros y esto es
  // una suite, no un rastreador.
  const vistos = new Set(urls);
  const textos = new Map();
  for (const u of [...urls]) {
    const r = await fetch(`${base}${u}`);
    if (!r.ok) continue;
    const t = await r.text();
    textos.set(u, t);
    for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
      if (!vistos.has(m[1]) && vistos.size < 400) {
        vistos.add(m[1]);
        urls.push(m[1]);
      }
    }
  }

  // ── EL PATRÓN, Y LAS DOS FORMAS DE EQUIVOCARLO ──────────────────────
  //
  // Lo que Next emite, ya minificado, es así:
  //
  //   "40fd08a4…",W.callServer,void 0,W.findSourceMapURL,"registrarVenta"
  //
  // · PEDIR `createServerReference(` LITERAL NO VALE: ese nombre se minifica
  //   —la llamada queda como `(0,W.createServerReference)(…)` o un alias— así
  //   que exigirlo no encuentra nada, ni en el build ni en desarrollo.
  // · UN COMODÍN QUE ADMITA PARÉNTESIS TAMPOCO: salta a la referencia
  //   siguiente y empareja este id con el nombre de OTRA acción, que es
  //   exactamente el HTTP 404 de la primera versión.
  //
  // `[^()]` entre el id y el nombre es lo que lo acota: en el emparejamiento
  // de verdad no hay ningún paréntesis en medio, solo los dos argumentos.
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);

  for (const u of urls) {
    let t = textos.get(u);
    if (t == null) {
      const r = await fetch(`${base}${u}`);
      if (!r.ok) continue;
      t = await r.text();
    }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

try {
  // ── LA SESIÓN DEL DUEÑO, sin teclear contraseña ───────────────────────
  const { data: ve } = await admin
    .from("owners")
    .select("id, business_name")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

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
  const cookie = (
    valor.length <= MAX
      ? [`${nombreCookie}=${valor}`]
      : Array.from(
          { length: Math.ceil(valor.length / MAX) },
          (_, i) => `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        )
  ).join("; ");

  // El id se descubre DESPUÉS de tener la sesión: `/ventas/nueva` está detrás
  // del guardia de sesión, y sin cookie devuelve el login, cuyo HTML no carga
  // el chunk del asistente.
  const accion = await idDeLaAccion(BASE, "registrarVenta", cookie);
  check(
    `0. el id de \`registrarVenta\` se descubre en los chunks que sirve ${BASE}`,
    accion != null,
    accion
      ? `emparejado DENTRO de su propia llamada, ${accion.slice(0, 10)}…`
      : "NO ENCONTRADO — ¿Next dejó de emitir el nombre junto al id?",
  );
  if (!accion) throw new Error("sin id de acción no hay nada que probar");

  // ── LA LLAMADA ────────────────────────────────────────────────────────
  //
  // La respuesta es el formato de flight de React, no JSON: trae la vuelta de
  // la acción embebida entre otras líneas. Se busca el objeto que lleva `ok`,
  // que es la forma de `ResultadoVenta`.
  async function registrar(entrada) {
    const res = await fetch(`${BASE}/ventas/nueva`, {
      method: "POST",
      headers: {
        "Next-Action": accion,
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: cookie,
      },
      body: JSON.stringify([entrada]),
    });
    const texto = await res.text();
    // ── EL OBJETO SE RECORTA CONTANDO LLAVES, NO CON UNA EXPRESIÓN ──────
    //
    // La respuesta es el formato de flight de React, no JSON: el resultado de
    // la acción viene embebido entre otras líneas, así que hay que encontrar
    // dónde empieza y dónde acaba.
    //
    // UNA EXPRESIÓN NO SIRVE Y YA FALLÓ: `\{"ok".*?\}(?=[,\]])` se para en la
    // primera `}` seguida de `]`, que en una venta guardada es la del array
    // `cobrado` —`"cobrado":[{"currency":"USD","amount":10}]`— así que
    // devolvía medio objeto y `JSON.parse` moría en la posición 100. Las
    // llaves anidadas se cuentan; no se adivinan.
    const m = (() => {
      const i = texto.indexOf('{"ok":');
      if (i < 0) return null;
      let prof = 0;
      let enCadena = false;
      let escapado = false;
      for (let j = i; j < texto.length; j++) {
        const c = texto[j];
        if (escapado) { escapado = false; continue; }
        if (c === "\\") { escapado = true; continue; }
        if (c === '"') { enCadena = !enCadena; continue; }
        if (enCadena) continue;
        if (c === "{") prof++;
        else if (c === "}" && --prof === 0) return [texto.slice(i, j + 1)];
      }
      return null;
    })();

    // ── UN TRANSPORTE ROTO NO ES UN RECHAZO ─────────────────────────────
    //
    // La primera versión devolvía `{ok:false}` cuando no entendía la
    // respuesta, y con HTTP 404 en TODAS las llamadas **nueve filas se
    // pusieron verdes**: las que esperan un rechazo daban el 404 por bueno.
    // Una suite que pinta verde con la acción inalcanzable dice exactamente
    // lo contrario de la verdad, que es peor que no tenerla.
    //
    // Por eso aquí se LANZA. Un 404, una sesión caducada o un formato
    // desconocido tumban la corrida con su causa, y ninguna fila se evalúa.
    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} llamando a la acción en ${BASE} — ¿id equivocado, o esa URL no sirve esta versión?`,
      );
    }
    if (!m) {
      throw new Error(`respuesta sin resultado legible (HTTP ${res.status}): ${texto.slice(0, 160)}`);
    }
    const r = JSON.parse(m[0]);
    if (r.ok && r.saleId) creados.ventas.push(r.saleId);
    return r;
  }

  // ── EL FIXTURE ────────────────────────────────────────────────────────
  const { data: prod } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      base_currency_retail: "USD",
      base_currency_wholesale: "USD",
      price_retail: 10,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  creados.productos.push(prod.id);

  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  creados.clientes.push(cliente.id);

  const { data: enPapelera } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} papelera`, trashed_at: new Date().toISOString() })
    .select("id")
    .single();
  creados.clientes.push(enPapelera.id);

  // El cliente de OTRO dueño, para la comprobación de propiedad.
  const { data: otro } = await admin
    .from("owners")
    .select("id")
    .neq("id", ve.id)
    .order("id")
    .limit(1)
    .single();
  const { data: ajeno } = await admin
    .from("clients")
    .insert({ owner_id: otro.id, name: `${MARCA} ajeno` })
    .select("id")
    .single();
  creados.clientes.push(ajeno.id);

  // El mostrador del dueño: lo crea la propia app, así que se busca y si no
  // está se crea con la misma forma que `resolverMostrador`.
  let mostrador = (
    await admin.from("clients").select("id").eq("owner_id", ve.id).eq("is_walk_in", true).maybeSingle()
  ).data;
  if (!mostrador) {
    const { data } = await admin
      .from("clients")
      .insert({ owner_id: ve.id, name: "Mostrador", is_walk_in: true })
      .select("id")
      .single();
    mostrador = data;
    creados.clientes.push(mostrador.id);
  }

  const linea = { productId: prod.id, quantity: 1, currency: "USD" };
  const credito = (extra = {}) => [{ currency: "USD", plazoDias: 15, cuotas: null, ...extra }];

  // ══════════════════════════════════════════════════════════════════════
  // 1. EL CAMINO FELIZ, por los dos lados
  // ══════════════════════════════════════════════════════════════════════
  const r1 = await registrar({
    clientId: cliente.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 10 }],
    credito: [],
  });
  check("1a. venta pagada entera: se guarda", r1.ok === true, r1.ok ? r1.saleId : r1.error);

  if (r1.ok) {
    const { count } = await admin
      .from("movements")
      .select("id", { count: "exact", head: true })
      .eq("sale_id", r1.saleId);
    check(
      "1b. y NO escribe ningún movimiento — el contado no entra en el libro de deudas",
      count === 0,
      `movimientos ${count}`,
    );
  }

  const r2 = await registrar({
    clientId: cliente.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 5 }],
    credito: credito(),
  });
  check("2a. pago parcial de 5 sobre 10: se guarda", r2.ok === true, r2.ok ? "ok" : r2.error);
  if (r2.ok) {
    const { data: mov } = await admin
      .from("movements")
      .select("amount, type, currency, plazo_dias")
      .eq("sale_id", r2.saleId)
      .single();
    check(
      "2b. y el cargo es por el RESTO (5), no por el total",
      Number(mov?.amount) === 5 && mov?.type === "charge" && mov?.currency === "USD",
      `${mov?.type} ${mov?.amount} ${mov?.currency} · plazo ${mov?.plazo_dias}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. EL MOSTRADOR — `B-28`, el caso que `CT-102` nunca ejecutó
  // ══════════════════════════════════════════════════════════════════════
  const r3 = await registrar({
    clientId: mostrador.id,
    lineas: [linea],
    pagos: [],
    credito: credito(),
  });
  check(
    "3a. FIADO AL MOSTRADOR: rechazado — es el guardia de CT-102, ejecutado por primera vez",
    r3.ok === false && /elegir o crear un cliente/i.test(r3.error ?? ""),
    r3.ok ? "SE GUARDÓ, el guardia no está" : r3.error,
  );

  const r4 = await registrar({
    clientId: mostrador.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 10 }],
    credito: [],
  });
  check(
    "3b. pero el mostrador SÍ puede comprar de contado — el guardia frena el fiado, no la venta",
    r4.ok === true,
    r4.ok ? "ok" : r4.error,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 3. EL TECHO DEL COBRO
  // ══════════════════════════════════════════════════════════════════════
  const r5 = await registrar({
    clientId: cliente.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 20 }],
    credito: [],
  });
  check(
    "4a. cobrar 20 de una venta de 10: rechazado",
    r5.ok === false && /más de lo que suma/i.test(r5.error ?? ""),
    r5.ok ? "SE GUARDÓ" : r5.error,
  );

  // LA HOLGURA: medio céntimo. Dejar 0,004 sin cobrar no puede nacer un fiado.
  const r6 = await registrar({
    clientId: cliente.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 9.997 }],
    credito: [],
  });
  check("5a. dejar 0,003 sin cobrar: la venta entra sin pedir plazo", r6.ok === true, r6.ok ? "ok" : r6.error);
  if (r6.ok) {
    const { count } = await admin
      .from("movements")
      .select("id", { count: "exact", head: true })
      .eq("sale_id", r6.saleId);
    check(
      "5b. y NO nace un fiado de tres milésimas que nadie entendería",
      count === 0,
      `movimientos ${count}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. EL PLAZO Y LAS CUOTAS
  // ══════════════════════════════════════════════════════════════════════
  const casos = [
    ["6a. plazo 0 días: rechazado", credito({ plazoDias: 0 }), false],
    ["6b. plazo 366 días: rechazado", credito({ plazoDias: 366 }), false],
    ["6c. plazo 365 días: ENTRA — el borde por el lado que pasa", credito({ plazoDias: 365 }), true],
    ["6d. plazo NULL entra: «Sin especificar» es una opción real", credito({ plazoDias: null }), true],
    ["7a. 1 cuota: rechazado", credito({ cuotas: 1 }), false],
    ["7b. 37 cuotas: rechazado", credito({ cuotas: 37 }), false],
    ["7c. 2 cuotas: ENTRA — el borde de abajo", credito({ cuotas: 2 }), true],
    ["7d. 36 cuotas: ENTRA — el borde de arriba", credito({ cuotas: 36 }), true],
    ["7e. cuotas sin plazo: rechazado", credito({ plazoDias: null, cuotas: 3 }), false],
  ];
  for (const [nombre, cred, esperaOk] of casos) {
    const r = await registrar({ clientId: cliente.id, lineas: [linea], pagos: [], credito: cred });
    check(nombre, r.ok === esperaOk, r.ok ? "guardada" : r.error);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. PROPIEDAD — el id llega del navegador
  // ══════════════════════════════════════════════════════════════════════
  const r7 = await registrar({
    clientId: ajeno.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 10 }],
    credito: [],
  });
  check(
    "8a. cliente de OTRO dueño: rechazado",
    r7.ok === false && /No encontramos ese cliente/i.test(r7.error ?? ""),
    r7.ok ? "SE GUARDÓ" : r7.error,
  );

  const r8 = await registrar({
    clientId: enPapelera.id,
    lineas: [linea],
    pagos: [{ currency: "USD", amount: 10 }],
    credito: [],
  });
  check(
    "8b. cliente en la PAPELERA: rechazado",
    r8.ok === false,
    r8.ok ? "SE GUARDÓ" : r8.error,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 6. EL CARRITO
  // ══════════════════════════════════════════════════════════════════════
  const r9 = await registrar({ clientId: cliente.id, lineas: [], pagos: [], credito: [] });
  check("9a. venta sin productos: rechazada", r9.ok === false, r9.ok ? "SE GUARDÓ" : r9.error);

  const r10 = await registrar({
    clientId: cliente.id,
    lineas: Array.from({ length: 61 }, () => ({ ...linea })),
    pagos: [],
    credito: credito(),
  });
  check(
    "9b. 61 líneas: rechazada — el tope son 60",
    r10.ok === false && /demasiados productos/i.test(r10.error ?? ""),
    r10.ok ? "SE GUARDÓ" : r10.error,
  );

  const r11 = await registrar({
    clientId: cliente.id,
    lineas: Array.from({ length: 60 }, () => ({ ...linea })),
    pagos: [],
    credito: credito(),
  });
  check("9c. 60 líneas exactas: ENTRAN", r11.ok === true, r11.ok ? "ok" : r11.error);
} catch (e) {
  // ── UNA EXCEPCIÓN ES UNA FILA ROJA, NO UN SILENCIO ──────────────────
  //
  // El `process.exit()` del `finally` se ejecuta ANTES de que Node imprima una
  // excepción no capturada, así que sin este `catch` un fallo de transporte
  // —que es justo lo que ahora se lanza a propósito— desaparecía: la corrida
  // decía «2/2 pasan» y no contaba que no había llegado a probar nada.
  check("ERROR: la corrida se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  // ── LIMPIEZA ─────────────────────────────────────────────────────────
  if (creados.ventas.length) await admin.from("sales").delete().in("id", creados.ventas);
  // Los movimientos cuelgan del cliente, no de la venta (`sale_id` es
  // `on delete set null`), así que se borran por sus clientes.
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("sales").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  if (creados.productos.length) await admin.from("products").delete().in("id", creados.productos);

  const { count: quedanC } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  const { count: quedanP } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check(
    "10. limpieza: no queda nada de la prueba en dev",
    (quedanC ?? 0) === 0 && (quedanP ?? 0) === 0,
    `${quedanC} clientes · ${quedanP} productos`,
  );

  const fallan = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallan}/${filas.length} pasan.`);
  process.exit(fallan ? 1 : 0);
}
