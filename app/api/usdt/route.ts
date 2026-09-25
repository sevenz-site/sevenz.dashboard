import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchUsdtP2p } from "@/lib/exchange-rate/usdt-p2p";

export const runtime = "nodejs";
// Sin prerenderizado: lo que devuelve depende de la hora, no de la ruta.
export const dynamic = "force-dynamic";

// El precio del USDT, servido desde nuestro propio origen.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ UNA RUTA Y NO UNA COLUMNA EN LA BASE
//
// El primer diseño lo guardaba en `bcv_exchange_rate_fetches` junto a la tasa
// oficial, y estaba mal por una razón medible: **el cron corre una vez al
// día**. La tasa del BCV se PUBLICA una vez al día, así que una foto diaria
// es exacta. El USDT no se publica: es un precio continuo. Medido sobre el
// paralelo —el proxy más cercano— en los 15 días hasta el 2026-09-24, el
// movimiento diario típico es del **0,77 %** y llegó al **2,11 %**. Una foto
// de la mañana llega a la noche siendo una suposición.
//
// Y no se arregla con un cron más frecuente: el plan Hobby de Vercel da dos
// crons y cada uno dispara una vez al día, y los dos están ocupados.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ DESDE EL SERVIDOR Y NO DESDE EL NAVEGADOR DEL DUEÑO
//
// La regla del iPhone de CLAUDE.md: iOS Safari bloquea peticiones a terceros
// con regularidad, y en septiembre eso ya nos costó los eventos de Mixpanel
// de un dueño que usó la app ocho de nueve días. Si el dashboard llamara a
// CriptoYa directamente desde el navegador, ese dueño vería la pestaña de
// USDT vacía sin entender por qué.
//
// Desde aquí, el navegador habla con `app.sevenz.site` —su propio origen,
// literalmente la app que abrió— y las restricciones de terceros no aplican.
// Dentro de la PWA instalada vale lo mismo: comprobado que `public/sw.js`
// solo intercepta tres archivos de shell y deja pasar todo lo demás, así que
// no puede servir una respuesta vieja de esta ruta.
//
// De paso, CriptoYa ve como mucho una petición por minuto por instancia, da
// igual cuántos dueños estén mirando.

const CACHE_MS = 60_000;

// La caché vive en memoria del proceso, no en Redis ni en la base. Es lo
// correcto para un dato que caduca en un minuto: montar almacenamiento
// compartido para esto costaría más que la petición que ahorra. En
// serverless cada instancia tiene la suya, así que el peor caso es que unas
// pocas instancias pidan una vez cada una por minuto — muy por debajo de las
// 120/min que permite CriptoYa.
let cache: { precio: Awaited<ReturnType<typeof fetchUsdtP2p>>; en: number } | null = null;

export async function GET() {
  // Con sesión. Esta calculadora solo existe dentro de la app, así que no hay
  // motivo para dejar el endpoint abierto — y un endpoint abierto es uno que
  // alguien puede martillear. La página pública `/s/[token]` no lleva
  // calculadora, así que no pierde nada.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const ahora = Date.now();
  if (cache && ahora - cache.en < CACHE_MS) {
    return NextResponse.json({ usdt: cache.precio, cacheado: true });
  }

  // `fetchUsdtP2p` nunca lanza: devuelve null y deja el motivo en el log del
  // servidor. Así que aquí no hay nada que enmascarar — el texto de CriptoYa
  // no puede llegar al navegador ni por accidente.
  const precio = await fetchUsdtP2p();

  // También se cachea el null. Si la fuente está caída, preguntarle otra vez
  // en cada apertura de la calculadora es castigar al dueño con la espera del
  // timeout una y otra vez; con esto la espera es de un minuto como mucho.
  cache = { precio, en: ahora };

  return NextResponse.json({ usdt: precio, cacheado: false });
}
