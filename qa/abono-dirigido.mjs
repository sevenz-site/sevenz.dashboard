// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev: un cliente de prueba y sus movimientos. El `finally` los
// borra aunque el script se caiga a mitad.
//
// REQUIERE QUE LA MIGRACIÓN `126` ESTÉ CORRIDA EN DEV.
//
// ===========================================================================
// LO QUE ESTA SUITE TIENE QUE PROBAR, Y EL ORDEN IMPORTA
//
// La `126` toca el reparto de abonos, que es lo que decide el estado de TODOS
// los clientes: el puntaje de crédito, la etiqueta de «plazo vencido» y los
// avisos de WhatsApp leen todos esa misma cola. Así que lo primero no es la
// función nueva: es que **lo viejo siga dando exactamente lo mismo**.
//
// Por eso los casos 1 y 2 no prueban nada nuevo a propósito. Si esos dos se
// ponen rojos, da igual lo bien que funcione el abono dirigido.
//
// ===========================================================================
// CORRE COMO EL DUEÑO, NO CON LA CLAVE DE SERVICIO
//
// `get_open_charges_for_client` y la cola NO son `security definer`: corren
// como quien llama, y es la política de `movements` la que decide qué cliente
// se ve. Con la clave de servicio RLS se salta entera, así que una suite
// escrita con ella pasaría aunque al tendero le faltara el permiso — que es
// exactamente el fallo de la migración `108` que `CLAUDE.md` cuenta: `qa:pedidos`
// en 14 de 14 con la pantalla rota para todo el mundo.
//
// El fixture se escribe con la clave de servicio; las PREGUNTAS se hacen con la
// sesión del dueño.

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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA ABONO DIRIGIDO";
const creados = { clientes: [] };

// Fechas separadas a mano: la cola ordena por `created_at`, así que un fixture
// escrito en el mismo milisegundo deja el orden a merced del id y la prueba se
// vuelve intermitente.
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

try {
  const { data: ve } = await admin
    .from("owners")
    .select("id")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

  // ── LA SESIÓN DEL DUEÑO ───────────────────────────────────────────────
  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  if (!correo) throw new Error("el dueño VE no tiene correo con el que abrir sesión");
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: sesion, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);
  const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sesion.session.access_token}` } },
  });

  // ── EL FIXTURE ────────────────────────────────────────────────────────
  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  creados.clientes.push(cliente.id);

  // DEVUELVE TAMBIEN LA FECHA QUE SE USO AL CREARLO. Recalcular `hace(2)` al
  // comparar fue un bug de esta suite en su primera corrida: `Date.now()` ya se
  // habia movido unos milisegundos, asi que la igualdad no se cumplia nunca y
  // el caso 2b salia rojo con la aplicacion correcta.
  const cargo = async (monto, dias, plazo = 15) => {
    const at = hace(dias);
    const { data } = await admin
      .from("movements")
      .insert({
        client_id: cliente.id,
        created_by: ve.id,
        type: "charge",
        amount: monto,
        currency: "USD",
        plazo_dias: plazo,
        created_at: at,
      })
      .select("id")
      .single();
    return { id: data.id, at };
  };
  const abono = async (monto, dias, dirigidoA = null) => {
    const { data } = await admin
      .from("movements")
      .insert({
        client_id: cliente.id,
        created_by: ve.id,
        type: "payment",
        amount: monto,
        currency: "USD",
        created_at: hace(dias),
        applies_to_movement_id: dirigidoA,
      })
      .select("id")
      .single();
    return data.id;
  };

  const abiertos = async () => {
    const { data, error } = await dueno.rpc("get_open_charges_for_client", {
      p_client_id: cliente.id,
    });
    if (error) throw new Error(`get_open_charges_for_client: ${error.message} (${error.code})`);
    return data ?? [];
  };

  // ══════════════════════════════════════════════════════════════════════
  // 1 y 2. LO VIEJO NO SE MUEVE — es lo único que de verdad puede romper
  //        a los 24 negocios, así que va primero.
  // ══════════════════════════════════════════════════════════════════════
  const f1 = await cargo(100, 60); // el más viejo
  const f2 = await cargo(50, 2);
  const c1 = f1.id;
  const c2 = f2.id;

  let r = await abiertos();
  check(
    "1. sin abonos, los dos fiados salen con su importe entero",
    r.length === 2 &&
      Number(r.find((x) => x.movement_id === c1)?.pending) === 100 &&
      Number(r.find((x) => x.movement_id === c2)?.pending) === 50,
    r.map((x) => `${Number(x.pending)}`).join(" · "),
  );

  // Un abono SIN dirigir: la regla de siempre, el más viejo primero.
  const p1 = await abono(100, 1);
  r = await abiertos();
  check(
    "2. un abono SIN dirigir tapa el fiado más viejo entero, como hasta hoy",
    r.length === 1 && r[0].movement_id === c2 && Number(r[0].pending) === 50,
    r.length === 1 ? `queda solo el de 50` : `quedan ${r.length}`,
  );

  // Y la cola, que es lo que decide el estado del cliente, dice lo mismo.
  const { data: cola1 } = await dueno.rpc("get_oldest_unpaid_charge_for_currency", {
    p_client_id: cliente.id,
    p_currency: "USD",
  });
  // EL DETALLE ENSENA LAS DOS FECHAS, no una frase fija. La primera version
  // decia «coincide» siempre que la cola devolviera algo, asi que al fallar
  // conto lo contrario de lo que pasaba.
  const esperado = new Date(f2.at).getTime();
  const obtenido = cola1?.length ? new Date(cola1[0].charge_at).getTime() : null;
  check(
    "2b. y la cola que decide «plazo vencido» apunta a ese mismo fiado",
    cola1?.length === 1 && obtenido === esperado,
    obtenido == null
      ? "la cola no devolvió nada"
      : `cola ${new Date(obtenido).toISOString()} · esperado ${f2.at}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 3. EL ABONO DIRIGIDO se resta de SU fiado, no del más viejo
  // ══════════════════════════════════════════════════════════════════════
  await admin.from("movements").delete().eq("id", p1);
  const p2 = await abono(50, 1, c2); // dirigido al NUEVO, no al viejo
  r = await abiertos();
  check(
    "3. un abono dirigido al fiado NUEVO lo tapa a él, y el viejo sigue entero",
    r.length === 1 && r[0].movement_id === c1 && Number(r[0].pending) === 100,
    r.map((x) => `${Number(x.pending)}`).join(" · "),
  );

  // Parcial dirigido.
  await admin.from("movements").delete().eq("id", p2);
  const p3 = await abono(30, 1, c1);
  r = await abiertos();
  check(
    "3b. un abono parcial dirigido deja SU fiado con el resto",
    Number(r.find((x) => x.movement_id === c1)?.pending) === 70 &&
      Number(r.find((x) => x.movement_id === c2)?.pending) === 50,
    r.map((x) => `${Number(x.pending)}`).join(" · "),
  );

  // ══════════════════════════════════════════════════════════════════════
  // 4. EL FIADO BORRADO: el abono dirigido cae en el reparto viejo
  // ══════════════════════════════════════════════════════════════════════
  await admin
    .from("movements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", c1);
  r = await abiertos();
  check(
    "4. borrado su fiado, el abono dirigido NO se pierde: cubre el que queda",
    r.length === 1 && r[0].movement_id === c2 && Number(r[0].pending) === 20,
    r.length ? `el de 50 queda en ${Number(r[0].pending)}` : "no quedó ninguno",
  );

  // ══════════════════════════════════════════════════════════════════════
  // 5. Y AL RESTAURARLO, el abono vuelve a donde el tendero dijo
  // ══════════════════════════════════════════════════════════════════════
  await admin.from("movements").update({ deleted_at: null }).eq("id", c1);
  r = await abiertos();
  check(
    "5. restaurado el fiado, el abono vuelve a aterrizar en él",
    Number(r.find((x) => x.movement_id === c1)?.pending) === 70 &&
      Number(r.find((x) => x.movement_id === c2)?.pending) === 50,
    r.map((x) => `${Number(x.pending)}`).join(" · "),
  );

  // ══════════════════════════════════════════════════════════════════════
  // 6. UN ABONO DIRIGIDO DE MÁS no deja el fiado en negativo
  // ══════════════════════════════════════════════════════════════════════
  await admin.from("movements").delete().eq("id", p3);
  await abono(999, 1, c2);
  r = await abiertos();
  check(
    "6. un abono dirigido mayor que su fiado lo deja en 0, no en negativo, y NO arrastra al otro",
    Number(r.find((x) => x.movement_id === c1)?.pending) === 100 &&
      r.find((x) => x.movement_id === c2) === undefined,
    r.map((x) => `${x.movement_id === c1 ? "viejo" : "nuevo"}:${Number(x.pending)}`).join(" · "),
  );

  // ══════════════════════════════════════════════════════════════════════
  // 7. ANON NO PUEDE LLAMARLA
  // ══════════════════════════════════════════════════════════════════════
  // UN CLIENTE ANONIMO NUEVO, Y NO EL DE ARRIBA. El `anon` que abre este script
  // deja de serlo en cuanto se le hace `verifyOtp` para sacar la sesion del
  // dueno: `persistSession: false` evita que la guarde en disco, pero la sesion
  // queda puesta EN MEMORIA. Con el contaminado, este caso salia rojo diciendo
  // «LA LLAMO» — y era verdad, porque ya no era anonimo. Dos corridas perdidas.
  const anonLimpio = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { error: eAnon } = await anonLimpio.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  // LO QUE DE VERDAD LO PARA ES EL PERMISO DE LA TABLA, no el de la funcion:
  // `anon` no tiene SELECT sobre `movements`, asi que la llamada muere dentro
  // aunque pudiera ejecutarse. Es mas fuerte que el `revoke` del grant, y
  // conviene saberlo: quitar el revoke no abriria nada, y aun asi se deja
  // puesto porque una superficie publica que contesta es una superficie.
  check(
    "7. anon no puede leer por get_open_charges_for_client",
    eAnon != null && eAnon.code === "42501",
    eAnon ? `${eAnon.code}: ${eAnon.message.slice(0, 48)}` : "LA LLAMÓ Y DEVOLVIÓ DATOS",
  );
} catch (e) {
  check("ERROR: la corrida se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  const { count } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("8. limpieza: no queda nada de la prueba en dev", (count ?? 0) === 0, `quedan ${count}`);

  const fallan = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallan}/${filas.length} pasan.`);
  process.exit(fallan ? 1 : 0);
}
