// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Prueba `registrar_abono_repartido(jsonb)` y `payment_group_summary(uuid)`,
// las dos de la migración `137`: un billete que cubre varios fiados deja de
// ser varias transacciones.
//
// ESCRIBE EN DEV y lo limpia: crea un cliente de prueba con sus fiados y borra
// exactamente lo que creó, por id, en el `finally` — también si se cae a mitad.
//
// ===========================================================================
// CORRE COMO EL TENDERO, Y ESO ES LO PRIMERO
//
// La función es `security definer` y lo primero que hace es mirar
// `auth.uid()`. Con la clave de servicio eso es `null`, así que una suite
// escrita con esa clave vería SIEMPRE `sin_sesion` y pasaría en verde con los
// repartos rotos para todo el mundo. Es la regla de `CLAUDE.md` —«una suite
// que cubre lo que el dueño escribe tiene al menos un control que corre como
// el dueño»— en el caso que la hace obvia.
//
// ===========================================================================
// LA FILA QUE JUSTIFICA EL ARCHIVO ES LA 3: QUE NO ESCRIBA NADA AL FALLAR
//
// Todo lo demás se nota. Un reparto que se niega cuando debería aceptar lo ve
// el tendero en el momento. Un reparto que escribe DOS de sus TRES líneas y
// luego dice que falló no se nota: el tendero lo registra otra vez, y el
// cliente acaba habiendo pagado cinco veces un billete que entregó una.
//
// Es exactamente el fallo que `import_libreta` (073) vino a cerrar —la fila 27
// de 30 dejaba 26 escritas y 26 clientes acababan con sus fiados duplicados—
// y aquí cuesta más, porque es dinero que ya cambió de manos.
//
// Por eso el caso 3 no se limita a comprobar que devuelve error: CUENTA los
// movimientos del cliente antes y después. Una prueba que solo mire el código
// de error pasaría igual con media transacción escrita.
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

// ¿Está corrida la 137? Se comprueba lo primero y con su propio mensaje: sin
// esto, todas las filas de abajo fallan a la vez y el motivo real queda
// enterrado bajo diez líneas rojas que parecen diez problemas distintos.
{
  const { data } = await admin
    .from("schema_migrations")
    .select("key")
    .eq("key", "137_un_abono_repartido_es_un_pago")
    .maybeSingle();
  if (!data) {
    console.error(
      "\nLa migración 137 no está corrida en esta base. Córrela antes:\n  supabase/137_un_abono_repartido_es_un_pago.sql\n",
    );
    process.exit(1);
  }
}

const MARCA = "QA ABONO REPARTIDO";
const creados = { clientes: [] };
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

try {
  // ── LAS DOS GUARDAS ────────────────────────────────────────────────────
  {
    const { error } = await anon.rpc("registrar_abono_repartido", { p_lineas: [] });
    check("anon NO puede llamar a registrar_abono_repartido()", !!error, error ? error.code : "LO CONSIGUIO");
  }
  {
    const { data, error } = await admin.rpc("registrar_abono_repartido", { p_lineas: [] });
    check(
      "con la clave de servicio se niega: auth.uid() es nulo",
      !error && data?.code === "sin_sesion",
      error ? error.message : JSON.stringify(data),
    );
  }
  {
    const { error } = await anon.rpc("payment_group_summary", {
      p_group_id: "00000000-0000-4000-8000-000000000000",
    });
    check("anon NO puede llamar a payment_group_summary()", !!error, error ? error.code : "LO CONSIGUIO");
  }

  // ── EL FIXTURE, Y LA SESIÓN DEL TENDERO ────────────────────────────────
  const { data: ve } = await admin
    .from("owners")
    .select("id")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  if (!correo) throw new Error("el dueño VE no tiene correo con el que abrir sesión");
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  const { data: sesion, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);
  const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sesion.session.access_token}` } },
  });
  console.log(`\ndueño de prueba: ${correo} (${ve.id.slice(0, 8)})\n`);

  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  creados.clientes.push(cliente.id);

  const cargo = async (monto, dias, moneda = "USD") => {
    const { data } = await admin
      .from("movements")
      .insert({
        client_id: cliente.id,
        created_by: ve.id,
        type: "charge",
        amount: monto,
        currency: moneda,
        plazo_dias: 15,
        created_at: hace(dias),
      })
      .select("id")
      .single();
    return data.id;
  };

  const cuantosMovimientos = async () => {
    const { count } = await admin
      .from("movements")
      .select("id", { count: "exact", head: true })
      .eq("client_id", cliente.id)
      .is("deleted_at", null);
    return count;
  };

  const a = await cargo(50, 40);
  const b = await cargo(30, 20);
  const c = await cargo(10, 5);
  const eur = await cargo(25, 10, "EUR");

  // ── 1. EL CAMINO BUENO ─────────────────────────────────────────────────
  let grupo = null;
  {
    const { data, error } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [
        { fiado_id: a, amount: 50 },
        { fiado_id: b, amount: 30 },
        { fiado_id: c, amount: 4 },
      ],
    });
    grupo = data?.group_id ?? null;
    check(
      "un reparto de 3 líneas se guarda entero",
      !error && data?.ok === true && Array.isArray(data?.movement_ids) && data.movement_ids.length === 3,
      error ? error.message : JSON.stringify(data?.code ?? data?.movement_ids?.length),
    );
  }
  {
    const { data } = await admin
      .from("movements")
      .select("id, amount, applies_to_movement_id, payment_group_id, currency")
      .eq("payment_group_id", grupo);
    const unSoloGrupo = new Set((data ?? []).map((m) => m.payment_group_id)).size === 1;
    const suma = (data ?? []).reduce((s, m) => s + Number(m.amount), 0);
    check(
      "las 3 filas comparten UN payment_group_id y suman 84",
      data?.length === 3 && unSoloGrupo && Math.abs(suma - 84) < 0.005,
      `${data?.length} filas · suma ${suma}`,
    );
    check(
      "cada línea queda dirigida a SU fiado",
      new Set((data ?? []).map((m) => m.applies_to_movement_id)).size === 3,
      (data ?? []).map((m) => m.applies_to_movement_id?.slice(0, 8)).join(", "),
    );
  }

  // ── 2. EL RESUMEN QUE LEE EL RECIBO ────────────────────────────────────
  {
    const { data, error } = await admin.rpc("payment_group_summary", { p_group_id: grupo });
    // La ÚLTIMA línea y no la primera: `new_balance` es el `running_balance`
    // de la fila por la que se pregunta, así que con la primera el recibo le
    // diría al cliente un saldo que todavía debe lo que las otras pagaron.
    const { data: ultima } = await admin
      .from("movements")
      .select("id")
      .eq("payment_group_id", grupo)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .single();
    check(
      "payment_group_summary da el TOTAL del grupo, no el de una línea",
      !error && data?.ok === true && Math.abs(Number(data.total) - 84) < 0.005 && data.lines === 3,
      error ? error.message : JSON.stringify({ total: data?.total, lines: data?.lines }),
    );
    check(
      "y apunta a la ÚLTIMA línea, que es la que lleva el saldo final",
      data?.last_movement_id === ultima?.id,
      `${data?.last_movement_id?.slice(0, 8)} vs ${ultima?.id?.slice(0, 8)}`,
    );
  }

  // ── 3. LA FILA QUE JUSTIFICA EL ARCHIVO ────────────────────────────────
  //
  // Una línea mala en medio y NADA escrito. Se cuenta antes y después: mirar
  // solo el código de error pasaría igual con media transacción dentro.
  {
    const antes = await cuantosMovimientos();
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [
        { fiado_id: c, amount: 1 },
        // `a` quedó SALDADO en el reparto de arriba —50 de 50— así que ya no
        // sale de `get_open_charges_for_client` y se rechaza por ahí, no por
        // el tope. Vale igual para lo que esta fila mide, que es que la línea
        // BUENA de delante tampoco se escriba.
        { fiado_id: a, amount: 999 },
      ],
    });
    const despues = await cuantosMovimientos();
    check(
      "una línea inválida deja el reparto ENTERO sin escribir",
      data?.ok === false && antes === despues,
      `code=${data?.code} · movimientos antes ${antes}, después ${despues}`,
    );
  }

  // ── 4. CADA NEGATIVA, POR SU MOTIVO ────────────────────────────────────
  {
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [{ fiado_id: c, amount: 999 }],
    });
    check(
      "no deja abonar más de lo que ESE fiado debe",
      data?.ok === false && data?.code === "excede_el_fiado",
      JSON.stringify(data?.code),
    );
  }
  // ── 4b. MEZCLAR MONEDAS: AHORA SE PUEDE, Y ESTA FILA ESTABA AL REVÉS ───
  //
  // Hasta la migración `141` esto comprobaba lo CONTRARIO: que un reparto con
  // un fiado en dólares y otro en euros se rechazara con `monedas_mezcladas`.
  // Era la decisión del dueño del 2026-10-22, y el 2026-10-23 la cambió al
  // diseñar la opción única de «Bolívares»: *«A los fiados más críticos sin
  // importar moneda»*.
  //
  // LO QUE ESTA FILA ENSEÑÓ DE PASO, y es la razón de que lleve este comentario
  // tan largo: mientras la `141` no entró —falló dos veces y la transacción la
  // deshizo entera— esta suite dio 18/18 con esta fila en VERDE. Verde porque
  // la regla vieja seguía viva. Una suite escrita contra el comportamiento
  // anterior no distingue «la migración no entró» de «todo bien», y lo único
  // que lo destapó fue mirar `schema_migrations` y `pg_proc`.
  {
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [
        { fiado_id: c, amount: 1 },
        { fiado_id: eur, amount: 1 },
      ],
    });
    check(
      "SÍ deja mezclar monedas en un reparto (migración 141)",
      data?.ok === true,
      data?.ok ? JSON.stringify(data.currencies) : JSON.stringify(data?.code),
    );

    // CADA LÍNEA EN LA MONEDA DE SU FIADO, leída de la base y no de lo que
    // devolvió la función. Es el punto entero de la `141`: la moneda sale del
    // fiado y nunca del payload, así que lo que hay que mirar es la fila
    // escrita.
    const ids = data?.ok ? data.movement_ids : [];
    const { data: filas } = await admin
      .from("movements")
      .select("id, currency, applies_to_movement_id, payment_group_id")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

    const porFiado = new Map((filas ?? []).map((f) => [f.applies_to_movement_id, f.currency]));
    check(
      "y cada línea queda en la moneda de SU fiado, no en una común",
      porFiado.get(c) === "USD" && porFiado.get(eur) === "EUR",
      `al fiado en dólares le quedó ${porFiado.get(c)} · al de euros ${porFiado.get(eur)}`,
    );

    check(
      "las dos líneas siguen siendo UN pago: mismo payment_group_id",
      (filas ?? []).length === 2 &&
        filas[0].payment_group_id != null &&
        filas[0].payment_group_id === filas[1].payment_group_id,
      `${(filas ?? []).length} filas · grupo ${filas?.[0]?.payment_group_id ?? "ninguno"}`,
    );

    // ── EL RECIBO DE UN GRUPO MIXTO ───────────────────────────────────
    //
    // `abono_confirmation_v3` lleva UN importe, así que un grupo de dos libros
    // no tiene un total que quepa en él. La función se niega a dar uno, y el
    // emisor ya trata `ok:false` como «omitido»: no manda recibo en vez de
    // mandar uno con un número que es falso en las dos monedas.
    const grupo = filas?.[0]?.payment_group_id ?? null;
    const { data: resumen } = await admin.rpc("payment_group_summary", { p_group_id: grupo });
    check(
      "el resumen del recibo NO da un total único para un grupo mixto",
      resumen?.ok === false && resumen?.reason === "monedas_mezcladas" && resumen?.total == null,
      JSON.stringify({ ok: resumen?.ok, reason: resumen?.reason, total: resumen?.total }),
    );

    // Y SÍ DA EL DESGLOSE, que es lo que permitirá decidir después entre un
    // mensaje por moneda o uno solo, sin otra migración.
    const porMoneda = resumen?.por_moneda ?? [];
    const usd = porMoneda.find((p) => p.currency === "USD");
    const e = porMoneda.find((p) => p.currency === "EUR");
    check(
      "pero sí el desglose por libro, con su total y su última línea",
      porMoneda.length === 2 &&
        Number(usd?.total) === 1 &&
        Number(e?.total) === 1 &&
        usd?.last_movement_id != null &&
        e?.last_movement_id != null &&
        usd.last_movement_id !== e.last_movement_id,
      JSON.stringify(porMoneda),
    );

    // Limpieza de este bloque: lo escrito aquí no existía antes y el `finally`
    // de la suite borra por marca, no por grupo.
    if (ids.length) await admin.from("movements").delete().in("id", ids);
  }
  {
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [
        { fiado_id: c, amount: 1 },
        { fiado_id: c, amount: 1 },
      ],
    });
    check(
      "no deja el MISMO fiado dos veces en un reparto",
      data?.ok === false && data?.code === "fiado_repetido",
      JSON.stringify(data?.code),
    );
  }
  {
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [{ fiado_id: c, amount: 0 }],
    });
    check(
      "no deja una línea de cero",
      data?.ok === false && data?.code === "monto_invalido",
      JSON.stringify(data?.code),
    );
  }
  {
    const { data } = await dueno.rpc("registrar_abono_repartido", { p_lineas: [] });
    check("no deja un reparto vacío", data?.ok === false && data?.code === "tamano", JSON.stringify(data?.code));
  }

  // ── 5. EL FIADO DE OTRO DUEÑO, Y SU CONTROL ────────────────────────────
  //
  // La fila de propiedad. Y va con control: sin él pasaría igual si el id no
  // existiera, que es comprobar que algo falla y no que el candado funciona.
  {
    const { data: otro } = await admin
      .from("movements")
      .select("id, clients!inner(owner_id)")
      .eq("type", "charge")
      .is("deleted_at", null)
      .neq("clients.owner_id", ve.id)
      .limit(1)
      .maybeSingle();

    if (!otro) {
      check("hay un fiado de otro dueño con el que probar la frontera", false, "no hay ninguno en dev");
    } else {
      const { data } = await dueno.rpc("registrar_abono_repartido", {
        p_lineas: [{ fiado_id: otro.id, amount: 1 }],
      });
      check(
        "un fiado de OTRO dueño se rechaza",
        data?.ok === false && data?.code === "fiado_ajeno",
        JSON.stringify(data?.code),
      );
    }
  }
  {
    // EL CONTROL: el mismo camino con un fiado propio SÍ entra. Sin esta fila,
    // la anterior pasaría también si la función rechazara todo.
    const antes = await cuantosMovimientos();
    const { data } = await dueno.rpc("registrar_abono_repartido", {
      p_lineas: [{ fiado_id: c, amount: 1 }],
    });
    const despues = await cuantosMovimientos();
    check(
      "control: un fiado PROPIO sí entra por ese mismo camino",
      data?.ok === true && despues === antes + 1,
      `code=${data?.code ?? "ok"} · ${antes} → ${despues}`,
    );
  }

  // ── 6. UN GRUPO QUE NO EXISTE ──────────────────────────────────────────
  {
    const { data } = await admin.rpc("payment_group_summary", {
      p_group_id: "00000000-0000-4000-8000-000000000000",
    });
    check("un grupo sin líneas devuelve null, no un total inventado", data === null, JSON.stringify(data));
  }
} finally {
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
    const { count } = await admin
      .from("movements")
      .select("id", { count: "exact", head: true })
      .in("client_id", creados.clientes);
    check("limpieza: no queda nada de la prueba en dev", count === 0, `${count} movimientos sobran`);
  }
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
