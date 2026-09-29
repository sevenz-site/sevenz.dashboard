// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Prueba `import_libreta(jsonb)`, la función que hace que una libreta entre
// entera o no entre (migración 073).
//
// POR QUÉ EXISTE ESTE ARCHIVO. El fallo que la función elimina no se ve
// mirando: `confirmImport` recorría las filas una a una y ante el primer error
// devolvía con las que ya habían entrado. La fila 27 de 30 dejaba 26 escritas,
// el dueño entendía «no se importó», lo reintentaba, y 26 clientes acababan con
// sus fiados duplicados. Una prueba que solo mire el camino feliz no distingue
// la función nueva de la vieja: las dos importan bien cuando todo va bien.
//
// Así que lo que se afirma aquí es, sobre todo, **que cuando falla no queda
// nada**. Se provoca el fallo a propósito en la última fila de la tanda.
//
// LAS DOS GUARDAS DE UNA FUNCIÓN `SECURITY DEFINER`, que son lo primero:
//   - anon no puede llamarla.
//   - con la clave de servicio `auth.uid()` es nulo y la función se niega, así
//     que no hay forma de importar a nombre de otro dueño desde un script.
//
// ESCRIBE EN DEV y lo limpia: borra exactamente lo que creó, comparando los
// ids de antes y de después. No borra por nombre ni por fecha, que se llevaría
// por delante datos reales.
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
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

// ── las dos guardas ─────────────────────────────────────────────────────
{
  const { error } = await anon.rpc("import_libreta", { p_payload: {} });
  check("anon NO puede llamar a import_libreta()", !!error, error ? error.code : "LO CONSIGUIO");
}
{
  const { data, error } = await admin.rpc("import_libreta", { p_payload: {} });
  check(
    "con la clave de servicio se niega: auth.uid() es nulo",
    !error && data?.code === "sin_sesion",
    error ? error.message : `code=${data?.code}`,
  );
}

// ── una sesión real de dueño, para el resto ─────────────────────────────
//
// Se emite igual que en el resto de pruebas del repo: enlace mágico + verifyOtp.
// Nunca se teclea una contraseña.
const EMAIL = process.env.QA_OWNER_EMAIL ?? "qa-papelera@example.com";
const { data: link, error: eLink } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (eLink) {
  console.error("no se pudo emitir la sesión:", eLink.message);
  process.exit(1);
}
const { data: ses, error: eOtp } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
if (eOtp) {
  console.error("verifyOtp:", eOtp.message);
  process.exit(1);
}
const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
});
const ownerId = ses.user.id;
console.log(`\ndueño de prueba: ${EMAIL} (${ownerId.slice(0, 8)})\n`);

// Fotografía de antes, para poder devolver dev como estaba.
const antes = async () => {
  const c = await admin.from("clients").select("id").eq("owner_id", ownerId);
  const m = await admin.from("movements").select("id, client_id");
  return {
    clientes: new Set((c.data ?? []).map((x) => x.id)),
    movimientos: new Set((m.data ?? []).map((x) => x.id)),
  };
};
const foto = await antes();

const sello = Date.now().toString().slice(-8);
const mov = (key, tipo, monto) => ({
  client_key: key,
  client_id: null,
  type: tipo,
  amount: monto,
  currency: null,
  description: `QA 073 ${sello}`,
  rate_mode_used: null,
  exchange_rate_used: null,
  official_bcv_rate_at_time: null,
  entry_currency: null,
  entry_amount: null,
  rate_usd_at_time: null,
  rate_eur_at_time: null,
});

// La nota que escribe el rediseño cuando el dueño importa una página cuya suma
// no cuadraba. Se compara letra por letra: si la función la recortara o la
// pasara por algún `btrim` distinto, aquí se vería.
const NOTA = "Importado aunque la suma no cuadraba: tu libreta decía $99,00 y con estos montos daba $30,00.";

let creadosParaLimpiar = { clientes: [], movimientos: [] };

try {
  // ── LO QUE DE VERDAD SE PRUEBA: que un fallo no deje nada ─────────────
  //
  // Dos clientes nuevos con el MISMO documento normalizado. El primero entraría
  // sin problema; el segundo choca con el índice único de la 033. Con el bucle
  // viejo, el primero quedaba escrito.
  {
    const payload = {
      clients_new: [
        { key: "a", name: `QA 073 Uno ${sello}`, document_id: `X-${sello}`, whatsapp: null, document_country: "CO" },
        { key: "b", name: `QA 073 Dos ${sello}`, document_id: `x.${sello}`, whatsapp: null, document_country: "CO" },
      ],
      client_documents: [],
      client_whatsapps: [],
      movements: [mov("a", "charge", 10), mov("b", "charge", 20)],
    };
    const { data, error } = await dueno.rpc("import_libreta", { p_payload: payload });
    check(
      "dos documentos iguales en la misma tanda: se rechaza ANTES de escribir",
      !error && data?.ok === false && data?.code === "documento_repetido_en_lote",
      error ? error.message : `code=${data?.code}`,
    );

    const ahora = await antes();
    const nuevosClientes = [...ahora.clientes].filter((id) => !foto.clientes.has(id));
    const nuevosMovs = [...ahora.movimientos].filter((id) => !foto.movimientos.has(id));
    check(
      "y NO queda ni un cliente ni un movimiento escrito",
      nuevosClientes.length === 0 && nuevosMovs.length === 0,
      `${nuevosClientes.length} clientes, ${nuevosMovs.length} movimientos`,
    );
  }

  // ── LA PRUEBA DE LA TRANSACCIÓN, que es la razón de ser de la 073 ─────
  //
  // Las dos afirmaciones de arriba se rechazan en la VALIDACIÓN, o sea antes de
  // escribir nada: no prueban que se deshaga, prueban que no se empieza. La
  // atomicidad solo se demuestra con un fallo que ocurra DESPUÉS de haber
  // escrito algo.
  //
  // Un `type` inválido lo consigue: la validación no lo mira, así que los dos
  // clientes se crean primero (paso 5) y la restricción de `movements` salta
  // después. Si la función no fuera atómica, esos dos clientes se quedarían —
  // que es exactamente lo que hacía el bucle viejo.
  {
    const payload = {
      clients_new: [
        { key: "a", name: `QA 073 Rollback ${sello}`, document_id: `R1-${sello}`, whatsapp: null, document_country: "CO" },
        { key: "b", name: `QA 073 Rollback2 ${sello}`, document_id: `R2-${sello}`, whatsapp: null, document_country: "CO" },
      ],
      client_documents: [],
      client_whatsapps: [],
      movements: [mov("a", "charge", 10), { ...mov("b", "charge", 20), type: "esto_no_existe" }],
    };
    const { error } = await dueno.rpc("import_libreta", { p_payload: payload });
    check(
      "un fallo A MITAD de la escritura levanta excepción",
      !!error,
      error ? error.code : "NO FALLO — la restriccion no salto",
    );

    const ahora = await antes();
    const nuevosClientes = [...ahora.clientes].filter((id) => !foto.clientes.has(id));
    const nuevosMovs = [...ahora.movimientos].filter((id) => !foto.movimientos.has(id));
    check(
      "y SE DESHACE TODO: ni los clientes que ya se habían creado",
      nuevosClientes.length === 0 && nuevosMovs.length === 0,
      `${nuevosClientes.length} clientes, ${nuevosMovs.length} movimientos`,
    );
  }

  // ── el camino feliz, para saber que la función sirve para algo ────────
  {
    const payload = {
      clients_new: [
        { key: "a", name: `QA 073 Uno ${sello}`, document_id: `X-${sello}`, whatsapp: null, document_country: "CO" },
        { key: "b", name: `QA 073 Dos ${sello}`, document_id: `Y-${sello}`, whatsapp: "573001112233", document_country: "CO" },
      ],
      client_documents: [],
      client_whatsapps: [],
      // CUATRO movimientos para el mismo cliente y la misma moneda, no dos.
      // Con una cadena de dos filas, el orden aleatorio que la 075 arregla
      // acierta la mitad de las veces y la comprobación del saldo pasaba por
      // casualidad. Con cuatro, las probabilidades de que salga bien por azar
      // son de una entre doce.
      //
      // Una sola lleva nota, a propósito: ver las comprobaciones de la 074.
      movements: [
        { ...mov("a", "charge", 10), owner_note: NOTA },
        mov("b", "charge", 20),
        mov("a", "charge", 40),
        mov("a", "payment", 5),
        mov("a", "charge", 7),
      ],
    };
    const { data, error } = await dueno.rpc("import_libreta", { p_payload: payload });
    check(
      "una libreta buena entra entera",
      !error && data?.ok === true && data?.imported === 5 && data?.clients_created === 2,
      error ? error.message : JSON.stringify(data),
    );

    const ahora = await antes();
    creadosParaLimpiar.clientes = [...ahora.clientes].filter((id) => !foto.clientes.has(id));
    creadosParaLimpiar.movimientos = [...ahora.movimientos].filter((id) => !foto.movimientos.has(id));
    check(
      "y quedan escritos exactamente 2 clientes y 5 movimientos",
      creadosParaLimpiar.clientes.length === 2 && creadosParaLimpiar.movimientos.length === 5,
      `${creadosParaLimpiar.clientes.length} clientes, ${creadosParaLimpiar.movimientos.length} movimientos`,
    );

    // ── LA NOTA DEL DUEÑO (migración 074) ───────────────────────────────
    //
    // Dos afirmaciones, y las dos hacen falta. Que la nota se guarde es la
    // menos interesante: la que de verdad importa es que las OTRAS filas de la
    // misma tanda salgan en null. Si la función escribiera la nota en todas —un
    // error de una sola línea en el insert—, la pantalla se llenaría de "la
    // suma no cuadraba" en movimientos que cuadran perfectamente, y eso no
    // levanta ningún error: se ve bien y miente.
    const { data: conNota, error: eNota } = await admin
      .from("movements")
      .select("id, amount, owner_note")
      .in("id", creadosParaLimpiar.movimientos);
    // Sin esto el fallo llegaba como `[]`, que se lee como "no guardó nada"
    // cuando en realidad la columna no existe todavía en este entorno. Son dos
    // problemas muy distintos y el mensaje tiene que decir cuál.
    if (eNota) {
      console.log(`      (la consulta falló: ${eNota.code} ${eNota.message})`);
    }
    const nota = (conNota ?? []).filter((m) => m.owner_note !== null);
    check(
      "la nota del dueño se guarda en la fila que la traía",
      nota.length === 1 && nota[0].owner_note === NOTA,
      JSON.stringify((conNota ?? []).map((m) => [m.amount, m.owner_note])),
    );
    check(
      "y las demás filas de la misma tanda quedan SIN nota",
      (conNota ?? []).length === 5 && nota.length === 1,
      `${nota.length} de ${(conNota ?? []).length} con nota`,
    );

    // ── EL ORDEN Y LOS SALDOS (migración 075) ────────────────────
    //
    // ESTA ES LA COMPROBACIÓN QUE FALTABA, y su ausencia dejó pasar un fallo de
    // dinero: contar filas no dice nada de si las cuentas salen. La libreta
    // entraba entera —las tres filas, con sus montos— y el cliente figuraba
    // debiendo el importe de una sola de ellas.
    //
    // `now()` es constante dentro de una transacción, así que sin la 075 toda
    // la tanda nace con el mismo `created_at` y el trigger del saldo desempata
    // por `id`, que es un uuid aleatorio.
    //
    // La invariante que se comprueba no depende de este fixture: en cada
    // cadena (cliente, moneda), el `running_balance` de la última fila tiene
    // que ser la suma de sus movimientos.
    const { data: filasDeSaldo } = await admin
      .from("movements")
      .select("id, client_id, currency, type, amount, running_balance, created_at")
      .in("id", creadosParaLimpiar.movimientos)
      .order("created_at");

    const cadenas = new Map();
    for (const m of filasDeSaldo ?? []) {
      const k = `${m.client_id}|${m.currency ?? "COP"}`;
      if (!cadenas.has(k)) cadenas.set(k, []);
      cadenas.get(k).push(m);
    }
    const malas = [];
    for (const [k, filasCadena] of cadenas) {
      const suma = filasCadena.reduce(
        (t, m) => t + (m.type === "charge" ? Number(m.amount) : -Number(m.amount)),
        0,
      );
      const ultima = Number(filasCadena[filasCadena.length - 1].running_balance);
      if (Math.abs(suma - ultima) > 0.001) malas.push(`${k}: suma ${suma} vs saldo ${ultima}`);
    }
    check(
      "el saldo corrido de cada cadena acaba en la suma de sus movimientos",
      malas.length === 0,
      malas.length ? malas.join(" · ") : `${cadenas.size} cadenas correctas`,
    );

    // Y que el orden sea el del payload, no uno cualquiera: dos filas de la
    // misma tanda no pueden compartir `created_at`.
    const instantes = (filasDeSaldo ?? []).map((m) => m.created_at);
    check(
      "cada movimiento de la tanda tiene su propio created_at",
      new Set(instantes).size === instantes.length,
      `${new Set(instantes).size} instantes distintos de ${instantes.length} filas`,
    );
  }

  // ── un cliente que ya existe no se puede duplicar por documento ───────
  {
    const payload = {
      clients_new: [
        { key: "c", name: `QA 073 Tres ${sello}`, document_id: `x${sello}`, whatsapp: null, document_country: "CO" },
      ],
      client_documents: [],
      client_whatsapps: [],
      movements: [mov("c", "charge", 30)],
    };
    const { data } = await dueno.rpc("import_libreta", { p_payload: payload });
    check(
      "un documento que el dueño ya tiene: se rechaza y dice de quién es",
      data?.ok === false && data?.code === "documento_de_otro_cliente" && !!data?.client_name,
      `code=${data?.code} client_name=${data?.client_name}`,
    );
  }

  // ── un client_id que no es de este dueño ──────────────────────────────
  {
    const { data: ajeno } = await admin
      .from("clients")
      .select("id")
      .neq("owner_id", ownerId)
      .limit(1)
      .maybeSingle();
    if (!ajeno) {
      console.log("SKIP  un client_id de otro dueño se rechaza  — no hay clientes de otro dueño en dev");
    } else {
      const payload = {
        clients_new: [],
        client_documents: [],
        client_whatsapps: [],
        movements: [{ ...mov(null, "charge", 40), client_key: null, client_id: ajeno.id }],
      };
      const { data } = await dueno.rpc("import_libreta", { p_payload: payload });
      check(
        "un client_id de OTRO dueño se rechaza",
        data?.ok === false && data?.code === "cliente_invalido",
        `code=${data?.code}`,
      );
    }
  }

  // ── sin movimientos ───────────────────────────────────────────────────
  {
    const { data } = await dueno.rpc("import_libreta", {
      p_payload: { clients_new: [], client_documents: [], client_whatsapps: [], movements: [] },
    });
    check("una tanda vacía se rechaza", data?.ok === false && data?.code === "sin_movimientos", `code=${data?.code}`);
  }
} finally {
  // ── devolver dev como estaba ──────────────────────────────────────────
  if (creadosParaLimpiar.movimientos.length) {
    await admin.from("movements").delete().in("id", creadosParaLimpiar.movimientos);
  }
  if (creadosParaLimpiar.clientes.length) {
    await admin.from("clients").delete().in("id", creadosParaLimpiar.clientes);
  }
  const final = await antes();
  const sobran =
    [...final.clientes].filter((id) => !foto.clientes.has(id)).length +
    [...final.movimientos].filter((id) => !foto.movimientos.has(id)).length;
  console.log(
    `\nLIMPIEZA: ${creadosParaLimpiar.clientes.length} clientes y ${creadosParaLimpiar.movimientos.length} movimientos borrados · sobran ${sobran}`,
  );
  check("dev queda como estaba", sobran === 0);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
