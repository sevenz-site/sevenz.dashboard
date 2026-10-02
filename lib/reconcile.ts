import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";

// Por qué una fila pide una segunda mirada. Eran tres cosas muy distintas
// metidas en el mismo booleano, y la pantalla las explicaba todas con la misma
// frase — "no cuadra con el saldo escrito en tu libreta" —, que es falsa en dos
// de los tres casos.
//
//   "no_cuadra"       el saldo escrito a mano NO coincide con el calculado.
//                     La única que de verdad significa "revisa esta cuenta", y
//                     la única que se pinta en rojo.
//   "sin_saldo"       esa línea no traía ningún saldo escrito. No es que no
//                     cuadre: es que no había nada con qué comparar, y en un
//                     cuaderno a mano es lo NORMAL — casi nadie apunta el total
//                     corrido en cada renglón. Marcar esto en rojo pintaba una
//                     libreta entera de rojo y no distinguía nada.
//   "lectura_dudosa"  la IA no se fio de lo que leyó en esa línea.
export type ReviewReason = "no_cuadra" | "lectura_dudosa" | "sin_saldo";

export type ReviewRow = ExtractedMovement & {
  rowId: string;
  matched_client_id: string | null;
  computed_balance: number;
  needs_review: boolean;
  // Null cuando la fila está bien. Cuando no, el motivo concreto, para que la
  // tabla pueda decir cuál es en vez de un color sin explicación.
  review_reason: ReviewReason | null;
  // True when there's no existing client on file with a document_id for
  // this row — either it's a brand-new client, or it matched an existing
  // one that's never had a cédula/documento recorded. False (no need to
  // ask again) when the matched client already has one.
  needs_document_id: boolean;
  // El saldo corrido DENTRO DE LA PÁGINA, que es contra lo que se compara el
  // total escrito a mano. Ver la nota larga sobre la base, abajo.
  page_balance: number;
  // True cuando el arranque de la página se dedujo del primer total escrito en
  // vez de ser un cero seguro. En ese caso ESTA fila es la que definió la base,
  // así que no se puede comprobar contra sí misma.
  defines_base: boolean;
};

const RECONCILE_TOLERANCE = 1;

export type ReconcileClient = {
  id: string;
  name: string;
  // The currency-less COP balance. Meaningful for a CO owner; for a VE owner
  // the two below are the real ones.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  document_id: string | null;
  // El que el cliente YA tiene guardado. No lo usa la reconciliación de saldos:
  // existe para que `agruparPorCliente` no pida un teléfono que ya está.
  whatsapp: string | null;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────
// CT-29: QUIÉN SE PARECE A QUIÉN
//
// Hasta el 2026-10-02 el emparejamiento era `Map.get(nombreNormalizado)`: o la
// grafía coincidía ENTERA o no había candidato. Con dos fichas deliberadas de
// la misma persona —"Karina castillo (negocio lomas)" y "Karina castillo
// (kari)", caso real de producción— un renglón que diga solo "Karina castillo"
// no casaba con ninguna, el aviso del duplicado ni se pintaba, y la dueña se
// enteraba al final, cuando la cédula chocaba y la subida se paraba en seco.
//
// La regla nueva es CONTENCIÓN, no parecido: uno contiene al otro entero.
// "Karina castillo" está dentro de "Karina castillo (kari)", así que son
// candidatos. "Karina" sola también lo estaría, y eso es deliberado — en una
// libreta se escribe el nombre corto. Lo que NO hace es inventar parecidos por
// distancia de edición: "Carina" y "Karina" no se tocan. Un falso positivo aquí
// se paga con una pregunta de más; un falso negativo, con la deuda en la ficha
// equivocada, y por eso se prefiere preguntar.
//
// LA CONTENCIÓN ES POR PALABRAS ENTERAS, no por subcadena. La primera versión
// usaba `includes` sobre el texto y proponía "Ana" para "Mariana Gómez", porque
// "ana" está dentro de "mariana". En una cartera de doscientos clientes eso es
// ruido, y un aviso que sale siempre deja de leerse — justo cuando aparece en el
// cliente al que de verdad le hace falta. Visto al escribir su prueba.
//
// Así que: todas las palabras del nombre corto tienen que estar, como palabras,
// en el largo. "Karina castillo" ⊂ "Karina castillo (kari)" ✓. "Ana" ⊄ "Mariana
// Gómez" ✗. Los paréntesis y la puntuación no son palabras y no estorban.
function palabras(nombre: string): string[] {
  return normalizeName(nombre)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length > 0);
}

export function seParecen(a: string, b: string): boolean {
  const x = palabras(a);
  const y = palabras(b);
  if (x.length === 0 || y.length === 0) return false;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  const enElLargo = new Set(largo);
  return corto.every((p) => enElLargo.has(p));
}

// The running balance is per client AND per currency, never per client alone.
//
// A VE owner's $50 and €20 are two independent debts, not one debt seen two
// ways — the rule the whole app follows. One accumulator per client would add
// them together, and the damage would be silent: "Saldo calculado" would show
// a plausible number, and the read_balance comparison below would raise
// "Revisar" on rows that are fine while passing rows that are not. A broken
// check that looks like a working one is worse than no check.
function balanceKey(name: string, currency: LedgerCurrency | null): string {
  return `${normalizeName(name)}|${currency ?? "COP"}`;
}

function seedBalance(client: ReconcileClient, currency: LedgerCurrency | null): number {
  if (currency === "USD") return client.balance_usd;
  if (currency === "EUR") return client.balance_eur;
  return client.balance;
}

// ─────────────────────────────────────────────────────────────────────────
// CT-19: DE DÓNDE ARRANCA LA PÁGINA, QUE ES TODO EL PROBLEMA
//
// El total escrito a mano en la libreta y el saldo que calcula Sevenz solo son
// comparables si los dos arrancan del mismo sitio. La versión anterior
// arrancaba el saldo corrido en LO QUE EL CLIENTE YA DEBE EN SEVENZ y lo
// comparaba contra un total que el tendero escribió EN ESA PÁGINA. Medido en
// dev el 2026-09-25: "Juanito Alimaña" ya debía USD 54,94, así que la misma
// foto importada en dólares marcaba sus tres líneas desviadas exactamente
// 54,94, y en euros —donde no debía nada— cuadraba. El rojo mentía.
//
// Lo que se hace ahora, decidido el 2026-09-25 (opción B + comparar tramos):
//
//   Cliente NUEVO en Sevenz    la página arranca en cero CON CERTEZA, así que
//                              se comprueban todos los totales, incluido el
//                              primero.
//   Cliente que YA tiene saldo no se puede saber si esa página empieza de cero
//                              o continúa una anterior. Así que el PRIMER total
//                              escrito DEDUCE el arranque, y a partir de ahí se
//                              comprueba el resto: cada total contra el
//                              anterior más los montos que hay en medio. Eso no
//                              necesita base, que es justo el dato que falta.
//
// Y el saldo previo se enseña como DATO y no como acusación: vive en
// `computed_balance`, que es lo que lee el resumen de "cómo queda cada
// cliente", separado de `page_balance`, que es lo que lee la comprobación.
// Un solo número para los dos trabajos acierta en uno y miente en el otro.
//
// LO QUE ESTO NO RESUELVE, y conviene no creer que sí: una página sin ningún
// total escrito no se puede comprobar de ninguna forma —eso es "sin verificar"
// y así se dice—, y un cliente existente cuya página trae UN SOLO total
// tampoco, porque ese total se gasta en deducir la base.
export function reconcileMovements(
  extracted: ExtractedMovement[],
  existingClients: ReconcileClient[],
  // CT-29: el emparejamiento que el dueño eligió a mano, por `nameKey`. MANDA
  // SOBRE EL NOMBRE, y por eso existe: cuando el renglón dice "Karina castillo"
  // y la ficha elegida se llama "Karina castillo (kari)", ninguna comparación de
  // nombres las uniría. Lo que las une es que alguien lo dijo.
  emparejados: Record<string, string> = {},
): ReviewRow[] {
  const byName = new Map(existingClients.map((c) => [normalizeName(c.name), c]));
  const porId = new Map(existingClients.map((c) => [c.id, c]));

  // Primero se agrupa por (cliente, moneda) conservando el orden, porque la
  // base de una página solo se puede deducir viendo el grupo entero. La versión
  // anterior era un `.map` de una pasada y por eso no podía: decidía sobre cada
  // fila sin saber lo que venía después.
  const grupos = new Map<string, number[]>();
  extracted.forEach((m, i) => {
    const k = balanceKey(m.client_name, m.currency);
    const g = grupos.get(k);
    if (g) g.push(i);
    else grupos.set(k, [i]);
  });

  const salida: ReviewRow[] = new Array(extracted.length);

  for (const indices of grupos.values()) {
    const primero = extracted[indices[0]];
    const elegido = emparejados[normalizeName(primero.client_name)];
    const matched = (elegido ? porId.get(elegido) : undefined) ?? byName.get(normalizeName(primero.client_name));
    const seed = matched ? seedBalance(matched, primero.currency) : 0;

    // ¿Se puede dar por cierto que la página arranca en cero?
    //
    // Solo si el cliente no existe todavía en Sevenz. Un cliente con saldo 0 NO
    // vale: pudo quedar en cero después de pagar y esta página puede ser la
    // continuación de otra. La certeza viene de no existir, no de deber cero.
    const arranqueCierto = !matched;

    // La base, cuando hay que deducirla, sale del primer total escrito: es el
    // valor que hace que ese total cuadre con los montos que lo preceden.
    let base = 0;
    let indiceQueDefineLaBase = -1;
    if (!arranqueCierto) {
      let acumulado = 0;
      for (const i of indices) {
        const m = extracted[i];
        acumulado += m.type === "charge" ? m.amount : -m.amount;
        if (m.read_balance !== null) {
          base = m.read_balance - acumulado;
          indiceQueDefineLaBase = i;
          break;
        }
      }
    }

    let paginaCorrida = base;
    let sevenzCorrido = seed;

    for (const i of indices) {
      const m = extracted[i];
      const delta = m.type === "charge" ? m.amount : -m.amount;
      paginaCorrida += delta;
      sevenzCorrido += delta;

      const defineBase = i === indiceQueDefineLaBase;
      // Comprobable: trae total escrito Y no es el que se gastó en deducir la
      // base. Cuando el arranque es cierto, ninguna fila se gasta en eso.
      const comprobable = m.read_balance !== null && !defineBase;
      const cuadra =
        comprobable && Math.abs((m.read_balance as number) - paginaCorrida) <= RECONCILE_TOLERANCE;

      salida[i] = {
        ...m,
        // The uid assigned when the batch entered review, never the name and
        // never the currency.
        //
        // This is a React key, so anything in it the owner can edit turns an
        // edit into a remount: the row becomes a different element, its inputs
        // are rebuilt and focus is lost mid-keystroke. The shared-client field
        // rewrites every row's name on each keystroke, which by name would have
        // remounted the whole table per character.
        //
        // Position would survive that but not deletion: removing a row shifts
        // every index above it, so React would reuse the wrong element and the
        // set of rows opted out of the shared client would move to their
        // neighbours. Falls back to the index only for a caller that supplies
        // no uid.
        rowId: m.uid ?? String(i),
        matched_client_id: matched?.id ?? null,
        // El saldo que le queda al cliente EN SEVENZ si se importa esto. Lo lee
        // el resumen de "cómo queda cada cliente", y por eso sí suma el saldo
        // previo.
        computed_balance: sevenzCorrido,
        page_balance: paginaCorrida,
        defines_base: defineBase,
        needs_review: m.confidence === "low" || (comprobable && !cuadra) || (!comprobable && !defineBase),
        // El orden importa: se queda con el motivo MÁS accionable. Un desajuste
        // real trae dos cifras que el dueño puede comparar con el cuaderno
        // delante; "no me fie de la lectura" solo le dice que mire. Si se dan
        // los dos, gana el que se puede resolver.
        review_reason: comprobable && !cuadra
          ? "no_cuadra"
          : m.confidence === "low"
            ? "lectura_dudosa"
            : defineBase
              ? null
              : m.read_balance === null
                ? "sin_saldo"
                : null,
        needs_document_id: !matched?.document_id,
      };
    }
  }

  return salida;
}

// ─────────────────────────────────────────────────────────────────────────
// LA VISTA POR CLIENTE, que es la que pide el rediseño de la revisión
//
// La pantalla vieja era una tabla de MOVIMIENTOS; la nueva es una lista de
// CLIENTES, y cada uno se abre en su propio detalle. Esto traduce lo uno en lo
// otro sin volver a calcular nada: lee las filas ya reconciliadas.

export type EstadoDeSuma = "cuadra" | "no_cuadra" | "sin_verificar";

export type LibroDelCliente = {
  currency: LedgerCurrency | null;
  // Lo que suma esta página en esta moneda.
  totalPagina: number;
  // Lo que el cliente ya debe en Sevenz, para enseñarlo como dato.
  saldoPrevio: number;
  // Cómo queda si se importa: saldoPrevio + totalPagina.
  saldoFinal: number;
  estado: EstadoDeSuma;
  // Las dos cifras del desajuste, para poder decirlas. Null si cuadra o si no
  // se pudo comprobar.
  //
  // SALEN DEL ÚLTIMO TOTAL ESCRITO DE LA PÁGINA, no de la primera fila que
  // descuadra. Cambiado el 2026-10-01 (CT-27), por decisión del usuario.
  //
  // Antes salían de la primera `no_cuadra`, y eso solo da el número correcto
  // cuando el error es un desfase constante —el caso de CT-12, una página que
  // arranca con una deuda que Sevenz no tiene, donde las 23 filas difieren en
  // los mismos 99—. En cuanto el error está en medio, corregir en el primer
  // descuadre deja el total final en otro sitio: con la libreta del mockup M
  // daba 60 donde la libreta cerraba en 50.
  //
  // El último total escrito es el único número que el dueño escribió a mano,
  // miró y dio por bueno. Cuadrar contra él garantiza que la cifra final sea
  // exactamente la suya, que es lo que significa "manda mi libreta".
  escrito: number | null;
  calculado: number | null;
  // El `rowId` de la línea que lleva ese último total escrito. El ajuste no se
  // ancla ahí —va al final de la página, ver `construirAjuste`—, pero esa fila
  // es la que dice que hay un total con el que comparar, y de ella sale la
  // fecha cuando hace falta.
  filaDelTotal: string | null;
};

// El cliente que ya existe con ese mismo nombre. NO es una decisión: es un
// candidato, y el dueño elige. Esa es toda la ficha CT-22 — antes se
// emparejaba en silencio y las deudas de dos personas distintas acababan en
// una sola ficha, sin aviso y sin vuelta atrás.
export type CandidatoDuplicado = {
  id: string;
  name: string;
  document_id: string | null;
  whatsapp: string | null;
  balance: number;
  balance_usd: number;
  balance_eur: number;
};

export type ClienteRevisado = {
  nameKey: string;
  name: string;
  rowIds: string[];
  movimientos: number;
  // TODOS los que se parecen, no uno. Con dos fichas de la misma persona, elegir
  // una por el sistema es elegir a quién le cae la deuda — y el sistema no sabe.
  // Ordenados: primero la coincidencia exacta, luego por parecido.
  candidatos: CandidatoDuplicado[];
  // Un libro por moneda. Nunca se suman entre sí: un $50 y un €20 son dos
  // deudas independientes, no una vista de dos formas.
  libros: LibroDelCliente[];
  necesitaDocumento: boolean;
  // Solo para un dueño VE. Un negocio colombiano lleva un único libro y su
  // `currency` es null a propósito, así que ahí esto es siempre false.
  necesitaMoneda: boolean;
  faltaWhatsapp: boolean;
};

export function agruparPorCliente(
  filas: ReviewRow[],
  existingClients: ReconcileClient[],
  opciones: { esVE: boolean },
): ClienteRevisado[] {
  const orden: string[] = [];
  const acumulado = new Map<string, ReviewRow[]>();

  for (const f of filas) {
    const k = normalizeName(f.client_name);
    const ya = acumulado.get(k);
    if (ya) ya.push(f);
    else {
      acumulado.set(k, [f]);
      orden.push(k);
    }
  }

  return orden.map((k) => {
    const suyas = acumulado.get(k)!;
    // Exacto primero: si existe una ficha con esa misma grafía, es la que el
    // dueño espera ver arriba.
    const parecidos = existingClients
      .filter((c) => seParecen(c.name, k))
      .sort((a, b) => {
        const ea = normalizeName(a.name) === k ? 0 : 1;
        const eb = normalizeName(b.name) === k ? 0 : 1;
        if (ea !== eb) return ea - eb;
        return a.name.localeCompare(b.name, "es");
      });
    // El exacto sigue mandando sobre el saldo de arranque y sobre si falta
    // documento: esas dos cosas necesitan UN cliente, no una lista.
    const existente = parecidos.find((c) => normalizeName(c.name) === k) ?? null;

    // Un libro por moneda, en el orden en que aparecen.
    const monedas: (LedgerCurrency | null)[] = [];
    for (const f of suyas) if (!monedas.includes(f.currency)) monedas.push(f.currency);

    const libros: LibroDelCliente[] = monedas.map((currency) => {
      const deEsaMoneda = suyas.filter((f) => f.currency === currency);
      const totalPagina = deEsaMoneda.reduce(
        (t, f) => t + (f.type === "charge" ? f.amount : -f.amount),
        0,
      );
      const saldoPrevio = existente ? seedBalance(existente, currency) : 0;

      // El estado sale de las filas, no se recalcula: una que no cuadra manda
      // sobre todas. Y "sin verificar" no es un fallo — es que no había nada
      // con qué comparar, que en un cuaderno a mano es lo normal.
      const desajustada = deEsaMoneda.find((f) => f.review_reason === "no_cuadra");
      const comprobables = deEsaMoneda.filter((f) => f.read_balance !== null && !f.defines_base);

      let estado: EstadoDeSuma;
      if (desajustada) estado = "no_cuadra";
      else if (comprobables.length === 0) estado = "sin_verificar";
      else estado = "cuadra";

      // El ÚLTIMO total escrito de la página manda sobre el importe del ajuste
      // (ver la nota de `escrito` arriba). `estado` sigue saliendo de CUALQUIER
      // fila que descuadre, que es otra pregunta: una cosa es "esta cuenta hay
      // que mirarla" y otra "cuánto falta para cerrar en lo que escribiste".
      const ultimoTotal = comprobables.length ? comprobables[comprobables.length - 1] : null;
      // Si el último total SÍ cuadra, no hay nada que preguntar aunque alguna
      // fila de en medio esté en rojo: el cierre ya es el del dueño, y el rojo
      // es un renglón que leer otra vez, no dinero que falte. Null y null deja
      // la pregunta sin salir y `construirAjuste` sin construir nada.
      const hayDesfase =
        ultimoTotal !== null && (ultimoTotal.read_balance ?? 0) !== ultimoTotal.page_balance;

      return {
        currency,
        totalPagina,
        saldoPrevio,
        saldoFinal: saldoPrevio + totalPagina,
        estado,
        escrito: hayDesfase ? ultimoTotal!.read_balance : null,
        calculado: hayDesfase ? ultimoTotal!.page_balance : null,
        filaDelTotal: ultimoTotal?.rowId ?? null,
      };
    });

    return {
      nameKey: k,
      name: suyas[0].client_name,
      rowIds: suyas.map((f) => f.rowId),
      movimientos: suyas.length,
      libros,
      candidatos: parecidos.map((c) => ({
        id: c.id,
        name: c.name,
        document_id: c.document_id,
        whatsapp: c.whatsapp,
        balance: c.balance,
        balance_usd: c.balance_usd,
        balance_eur: c.balance_eur,
      })),
      necesitaDocumento: !existente?.document_id,
      necesitaMoneda: opciones.esVE && suyas.some((f) => f.currency === null),
      // Falta de verdad solo si NO lo trae la revisión Y el cliente tampoco lo
      // tiene ya guardado. Mirar solo las filas decía "Falta el WhatsApp" a
      // clientes que lo tenían desde hacía meses: la foto de una libreta no
      // trae teléfonos casi nunca, así que ese aviso salía prácticamente
      // siempre — y un aviso que sale siempre deja de leerse, justo cuando
      // aparece en el cliente al que de verdad le falta.
      faltaWhatsapp: suyas.every((f) => !f.whatsapp?.trim()) && !existente?.whatsapp?.trim(),
    };
  });
}
