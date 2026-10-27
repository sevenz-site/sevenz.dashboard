// THE ORDER BEING TURNED INTO A SALE, LINE BY LINE, WHILE THE SHOPKEEPER
// WALKS THE FLOW.
//
// ===========================================================================
// NOTHING IS WRITTEN TO THE DATABASE UNTIL THE VERY END
//
// The sitemap's own arrows say so: «Registrar» on a line opens 1/2, 1/2 goes
// to 2/2, and 2/2 comes BACK to the order (`1564:11979`), which then goes to
// the client's details and only there to «Registrar y finalizar». Four
// screens, three navigations, and the sale is written once at the end.
//
// So each line's payment has to survive the walk, and it is `sessionStorage`
// that carries it — the same decision, for the same reason, as
// `lib/abonos/borrador.ts`: what lives here is a draft IN FLIGHT, not a
// record.
//
// ===========================================================================
// IF IT IS LOST, NOTHING IS LOST
//
// `CLAUDE.md` is explicit that iOS wipes browser storage without asking, and
// that nothing which matters may depend on the browser cooperating. This
// obeys that rule by WHAT it holds, not by where: lose it and the shopkeeper
// types the amount again. No money is misfiled, no movement is half-written,
// because while this is alive the database holds nothing at all.
//
// What must NOT happen is that it comes back from the dead: yesterday's
// draft, over an order whose prices have since changed, would draw a sale
// nobody agreed to and say nothing about it. Hence the expiry.

// ── UNA LLAVE POR PEDIDO ──────────────────────────────────────────────
//
// `PR-G3`, medido en dev el 2026-10-26 y arreglado ese mismo día. Había UNA
// llave para toda la app, con el `pedidoId` dentro, y `leerBorrador` comparaba
// ese id: empezar un segundo pedido no corrompía el primero, lo SUSTITUÍA, y
// el primero dejaba de existir sin que nada avisara.
//
// QUÉ SE VEÍA, medido con un pedido de dos monedas a medias --dólares puestos,
// cliente elegido--: al volver, la pantalla pasaba de `1/3 Pedido` con la
// tarjeta del cliente a `1/4 Pedido` sin ella y con los dos bloques diciendo
// «Registrar». Sin un aviso. No se pierde dinero --la base no tiene nada hasta
// el último paso-- pero sí lo tecleado.
//
// Y LA FICHA DE ESE BORDE DECÍA «EN DOS PESTAÑAS», QUE ERA FALSO: esto vive en
// `sessionStorage`, que es de cada pestaña, así que dos pestañas nunca se han
// pisado. Lo que se pisa es un pedido tras otro en la MISMA pestaña, que es lo
// que de verdad hace un tendero cuando le entra alguien con prisa.
//
// EL COSTO, dicho por delante: ahora pueden convivir varios borradores, uno
// por pedido empezado. Son ~400 bytes cada uno, `sessionStorage` muere con la
// pestaña, y `barrerCaducados` tira los de más de dos horas en cada escritura.
const PREFIJO = "sevenz:pedido-registro";

function claveDe(pedidoId: string): string {
  return `${PREFIJO}:${pedidoId}`;
}

// Two hours, the same as the payment split's. Registering an order is a
// counter-top conversation: it starts and ends with the customer in front of
// you. Past that, whatever is stored is far likelier to be an abandoned
// session than something anybody wants back.
const CADUCIDAD_MS = 2 * 60 * 60 * 1000;

// ONE CURRENCY'S PAYMENT, exactly as `PagoCampos` hands it over. The field
// names are that component's `Registro` and not a translation of it: renaming
// them here would mean a mapping in both directions, and a mapping is where a
// currency quietly swaps places with an amount.
//
// IT USED TO BE PER LINE, UNTIL `CT-147` (2026-10-25). Two lines in dollars
// with different terms meant one of the two terms was dropped on the way into
// `registrarVenta`, whose credit has always been per currency. Asking once per
// currency is what makes that impossible rather than merely unlikely.
export type PagoDeMoneda = {
  // What goes into this currency's ledger TODAY.
  amount: number;
  // What was actually handed over, and in what. `null` = the ledger's own
  // currency. This is the pair `CLAUDE.md` calls «el monto que tecleó el
  // tendero»: it is kept verbatim and never recomputed from `amount`.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  plazo: string;
  cuotas: string;
  usarPrevista: boolean;
  photoPath: string | null;
  description: string;
};

// WHAT «EDITAR» CHANGED ON A LINE, which is quantity and currency and
// nothing else. The product's catalogue data is not touched from inside a
// sale -- see `order-line-edit-form.tsx`.
//
// IT IS SEPARATE FROM THE PAYMENT because the two screens write it at
// different moments and either can happen without the other: «Registrar»
// goes straight to the payment and never edits, «Editar» edits and then goes
// to the payment. One object with both would make each screen responsible for
// carrying the other's half -- which is exactly how the payment split lost
// its `aManoBs` on 2026-10-23.
// ===========================================================================
// AND THE FINAL SUMMARY HAS TO SAY SO WHEN IT DIFFERS
//
// The owner's decision of 2026-10-24, answering the question this very edit
// raises: *«el resumen final debe decir "el cliente pidió 5" y lo que se está
// registrando cuando difiera»*.
//
// So «Resumen V2» (frame `1519:11271`) reads BOTH numbers and shows the pair
// only where they disagree -- what the customer asked for and what is being
// registered. That is why this type exists apart from the sealed line instead
// of overwriting it: the moment the edit replaced `catalog_order_items`, the
// original quantity would be gone and the summary would have nothing to
// compare against.
//
// IT IS NOT BUILT YET -- the summary screen does not exist. This note is here
// and not only in a commit message because whoever builds it will be reading
// this file to find the edit, not searching the history for a decision they
// do not know was taken.
export type LineaEditada = {
  quantity: number;
  currency: string;
  // ── EL PRECIO QUE LA HOJA ENSEÑÓ, PARA DIBUJARLO ─────────────────────
  //
  // Decisión del dueño el 2026-10-26, preguntada con las dos salidas
  // delante: *«B) Manda la edición»*. Cambiar la cantidad recalcula el
  // escalón, así que subir de 1 a 5 unidades cobra al MAYOR.
  //
  // ESO DESPLAZA UNA DECISIÓN ESCRITA, y las dos quedan: `registrarVenta`
  // decía *«El escalón también se respeta sellado: recalcularlo por la
  // cantidad nueva podría saltar a mayoreo y cambiar el precio por detrás»*.
  // Era verdad y era prudente, pero la hoja «Editar pedido» ya recalculaba y
  // ya enseñaba el precio nuevo: lo que había no era un precio estable, era
  // una pantalla prometiendo una cifra y una venta escribiendo otra. Medido
  // en dev ese día con el Alicate: la hoja decía «Agregar $28,75» y la venta
  // se escribía por $285,00.
  //
  // ESTE NÚMERO NO VIAJA AL SERVIDOR, y eso no es un detalle: `CLAUDE.md` y
  // `create_catalog_order` dicen lo mismo --«el PRECIO lo calcula esta
  // función, nunca viaja en la petición»--. Vive aquí solo para que la
  // tarjeta, el total y el botón de cobro dibujen lo mismo que la hoja.
  // `registrarVenta` lo vuelve a calcular por su cuenta con las MISMAS dos
  // funciones --`escalonParaCantidad` y `precioEnMoneda`--, que es lo que
  // impide que pantalla y venta se separen otra vez.
  //
  // `undefined` en un borrador escrito antes de este cambio, o cuando no hay
  // tasa con la que calcularlo: entonces se dibuja el precio sellado, que es
  // la pantalla de ayer.
  unitPrice?: number;
};

// WHO THE SALE GOES TO, decided on the last step before the summary.
//
// NOTHING IS CREATED YET. `fichaId` names an existing ficha; `null` means a
// new client has to be made at the end, out of these fields. Creating it on
// the client screen would leave an orphan ficha behind every time somebody
// walks back out of the flow — a person in the shopkeeper's list who never
// bought anything.
//
// THE FIELDS TRAVEL EVEN WITH A FICHA MATCHED, because «Registrar a cuenta
// separada» (frame `1542:11888`) exists: the shopkeeper can say «this is not
// that Pedro» and open a new ficha with the order's own data.
export type ClienteDelRegistro = {
  fichaId: string | null;
  name: string;
  documentId: string;
  documentType: string | null;
  whatsapp: string;
  address: string;
  // The owner ticked «Confirmo que <nombre> autoriza recibirlas». It is the
  // EVIDENCE of consent, so it is stored as its own fact and not inferred
  // from the phone being present.
  consienteWhatsapp: boolean;
};

export type BorradorDeRegistro = {
  pedidoId: string;
  // Keyed by CURRENCY — "USD", "EUR", "COP". A currency block the shopkeeper
  // has not resolved yet is simply absent, which is what `1/4 Pedido` reads to
  // know which blocks still show «Registrar».
  monedas: Record<string, PagoDeMoneda>;
  // Keyed by `catalog_order_items.id` as well. Absent = the shopkeeper did not
  // edit that line, so what the customer ordered stands.
  editadas?: Record<string, LineaEditada>;
  cliente?: ClienteDelRegistro;
  guardadoEn: number;
};

function interpretar(crudo: string | null): BorradorDeRegistro | null {
  if (!crudo) return null;
  try {
    const b = JSON.parse(crudo) as BorradorDeRegistro;
    if (
      !b ||
      typeof b.pedidoId !== "string" ||
      typeof b.guardadoEn !== "number"
    )
      return null;
    if (Date.now() - b.guardadoEn > CADUCIDAD_MS) return null;
    return b;
  } catch {
    return null;
  }
}

// LOS BORRADORES CADUCADOS SE TIRAN AL ESCRIBIR, no en un temporizador.
//
// Con una llave sola no hacía falta: la caducidad se comprobaba al leerla y
// esa era toda la limpieza. Con una llave por pedido, un borrador abandonado
// se queda ahí aunque nadie vuelva a abrir ese pedido, así que la escritura
// --que es la única puerta de este fichero-- barre de paso.
//
// VA ENVUELTO ENTERO: enumerar `sessionStorage` lanza en los mismos sitios
// donde lanza leerlo, y una pantalla que se cayera aquí sería inservible justo
// en los teléfonos más estrictos.
function barrerCaducados(): void {
  try {
    const sobran: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k || !k.startsWith(`${PREFIJO}:`)) continue;
      if (interpretar(sessionStorage.getItem(k)) === null) sobran.push(k);
    }
    for (const k of sobran) sessionStorage.removeItem(k);
  } catch {
    // Igual que arriba: el almacén dijo que no y no hay nada que limpiar.
  }
}

// WHAT THIS ORDER HAS RESOLVED SO FAR. It takes the order's id and returns
// nothing for any other, which is the whole guard: a draft belongs to ONE
// order, and opening a second one must not inherit the first one's payments.
//
// Desde el 2026-10-26 ese guardia lo da la LLAVE y no una comparación: cada
// pedido tiene la suya, así que el borrador de otro no se puede ni leer por
// accidente -- ni pisar.
export function leerBorrador(pedidoId: string): BorradorDeRegistro | null {
  // EVERY READ IS WRAPPED. In a private window, or with site data blocked,
  // the accessor itself throws — it does not return empty. A screen that
  // crashed on that would be unusable for exactly the owners whose phones are
  // strictest, which in this product is most of them.
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(claveDe(pedidoId));
  } catch {
    return null;
  }
  const b = interpretar(crudo);
  if (!b || b.pedidoId !== pedidoId) return null;
  return b;
}

// ── QUIÉN SE ENTERA DE QUE ESTO CAMBIÓ ────────────────────────────────
//
// `sessionStorage` NO avisa a la pestaña que escribe. El evento `storage` del
// navegador solo se dispara en las OTRAS pestañas, así que un componente que
// lea este borrador no tiene forma de saber que alguien lo acaba de tocar: se
// queda con la cifra vieja hasta que React lo repinte por cualquier otro
// motivo.
//
// QUÉ COSTÓ NO TENER ESTO, el 2026-10-26. El dueño editó una línea de un
// pedido --de 1 unidad a 4--, dio a «Agregar», y la tarjeta de detrás siguió
// diciendo «Cantidad del pedido: 1». *«Resultado: no se agregan»*. La
// cantidad SÍ se guardaba, y de hecho la venta se escribió con 4: lo único
// que no ocurría era que la pantalla se enterara.
//
// Y ES PEOR QUE UN DESAJUSTE VISUAL: esa tarjeta es la última que el tendero
// mira antes de cobrar. Diciendo 1 cuando se van a cobrar 4, lo que enseña no
// es un número desactualizado — es el número equivocado, justo donde se
// decide el dinero.
//
// SE AVISA DESDE `escribir`, que es la única puerta de escritura de este
// fichero. Pegado ahí, no hay forma de guardar algo sin avisar.
const oyentes = new Set<() => void>();

export function suscribirseAlBorrador(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

function avisarDelCambio(): void {
  for (const oyente of [...oyentes]) oyente();
}

// A SNAPSHOT WITH A STABLE IDENTITY, for `useSyncExternalStore`.
//
// VARIOS COMPONENTES LEEN ESTE BORRADOR EN LA MISMA PANTALLA --el resumen
// por moneda, la tarjeta de cada bloque, el contador de pasos-- y están en
// sitios distintos del DOM, así que no pueden ser uno solo. (Hasta el
// 2026-10-25 uno de ellos era el «Continuar» del pie, que el sitemap no
// dibuja y se quitó; los demás siguen.)
//
// `leerBorrador` parses JSON and hands back a FRESH object every call, which
// React compares with `Object.is` and repaints forever. Caching by the raw
// stored string gives both of them the same object while nothing has changed,
// and a new one the moment something has.
// LA CACHÉ GUARDA TAMBIÉN DE QUÉ PEDIDO ES, desde que hay una llave por
// pedido. Dos pantallas de dos pedidos distintos pueden pedir su instantánea
// una detrás de otra --el detalle de uno y el `1/x` de otro durante una
// navegación-- y sin el id, dos borradores con el mismo texto crudo se
// servirían el uno por el otro.
let pedidoEnCache: string | null = null;
let crudoEnCache: string | null = null;
let valorEnCache: BorradorDeRegistro | null = null;

export function instantanea(pedidoId: string): BorradorDeRegistro | null {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(claveDe(pedidoId));
  } catch {
    return null;
  }
  if (crudo !== crudoEnCache || pedidoId !== pedidoEnCache) {
    crudoEnCache = crudo;
    pedidoEnCache = pedidoId;
    valorEnCache = leerBorrador(pedidoId);
  }
  return valorEnCache && valorEnCache.pedidoId === pedidoId
    ? valorEnCache
    : null;
}

// The server has no `sessionStorage`, so the server snapshot is always «empty»
// and the summary appears on mount. That flicker is inherent to a draft that
// lives in the browser; the alternative is a round trip for something that is
// not a record yet.
export const SIN_BORRADOR = null;

// ── TODA ESCRITURA PASA POR AQUÍ, Y ESO ES EL ARREGLO ─────────────────
//
// `CLAUDE.md` lleva la cicatriz escrita desde el 2026-10-23: la pantalla del
// reparto guardaba el borrador entero en cada render y borraba el `aManoBs`
// que la del monto acababa de escribir. La cifra se guardaba bien y se perdía
// un instante después.
//
// ESTE FICHERO TENÍA EL MISMO FALLO Y NADIE LO HABÍA VISTO: `fijarPagoDeLinea`
// escribía `{pedidoId, lineas, guardadoEn}` sin arrastrar `editadas` ni
// `cliente`, así que guardar un pago borraba la edición de una línea y los
// datos del cliente. Encontrado el 2026-10-25 al reescribir el borrador por
// moneda.
//
// LA DEFENSA NO ES ACORDARSE DE ARRASTRAR: es que no haya forma de escribir
// sin hacerlo. Una sola función, que lee lo que hay y mezcla el cambio
// encima; las demás no tocan `sessionStorage`.
function escribir(
  pedidoId: string,
  cambio: (actual: BorradorDeRegistro | null) => Partial<BorradorDeRegistro>,
): void {
  try {
    const actual = leerBorrador(pedidoId);
    const base: BorradorDeRegistro = {
      pedidoId,
      monedas: actual?.monedas ?? {},
      editadas: actual?.editadas ?? {},
      cliente: actual?.cliente,
      guardadoEn: Date.now(),
    };
    sessionStorage.setItem(
      claveDe(pedidoId),
      JSON.stringify({ ...base, ...cambio(actual), guardadoEn: Date.now() }),
    );
    barrerCaducados();
  } catch {
    // Storage refused. The shopkeeper will be asked for the amount again,
    // which is the designed failure of this whole file.
  }
  // FUERA DEL `try`, Y A PROPÓSITO: si el almacenamiento falló, lo que hay en
  // memoria tampoco cambió, pero avisar de más solo cuesta un repintado que
  // enseña lo mismo. Avisar de menos cuesta una cifra falsa en pantalla.
  avisarDelCambio();
}

export function leerPagoDeMoneda(
  pedidoId: string,
  moneda: string,
): PagoDeMoneda | null {
  return leerBorrador(pedidoId)?.monedas[moneda] ?? null;
}

export function fijarPagoDeMoneda(
  pedidoId: string,
  moneda: string,
  pago: PagoDeMoneda,
): void {
  escribir(pedidoId, (actual) => ({
    monedas: { ...(actual?.monedas ?? {}), [moneda]: pago },
  }));
}

export function quitarPagoDeMoneda(pedidoId: string, moneda: string): void {
  escribir(pedidoId, (actual) => {
    const monedas = { ...(actual?.monedas ?? {}) };
    delete monedas[moneda];
    return { monedas };
  });
}

// ── «EDITAR» PUEDE DEJAR UN ABONO APUNTANDO A NADA ────────────────────
//
// EL BORDE QUE MÁS CUESTA DE ESTE REDISEÑO, y no falla: el tendero teclea
// cuánto paga en dólares, vuelve atrás, y con «Editar» mueve a euros la única
// línea que había en dólares. El bloque de dólares desaparece de la pantalla
// y su abono sigue guardado, apuntando a una moneda que ya no tiene nada que
// cobrar. No hay error, la venta se guarda, y el dinero queda abonado donde
// no se debía.
//
// `monedasVivas` ES OBLIGATORIO, no opcional, y eso es la mitad del arreglo.
// Un saneado en una función aparte se puede olvidar desde la pantalla que
// edita --que es exactamente cómo el campo de cuotas se quedó fuera de uno de
// sus dos formularios el 2026-10-16--. Pedido aquí, el compilador no deja
// editar una línea sin decir qué monedas quedan vivas después.
export function fijarLineaEditada(
  pedidoId: string,
  lineaId: string,
  edicion: LineaEditada,
  monedasVivas: readonly string[],
): void {
  const vivas = new Set(monedasVivas);
  escribir(pedidoId, (actual) => {
    const monedas: Record<string, PagoDeMoneda> = {};
    for (const [m, pago] of Object.entries(actual?.monedas ?? {})) {
      if (vivas.has(m)) monedas[m] = pago;
    }
    return {
      monedas,
      editadas: { ...(actual?.editadas ?? {}), [lineaId]: edicion },
    };
  });
}

export function leerLineaEditada(
  pedidoId: string,
  lineaId: string,
): LineaEditada | null {
  return leerBorrador(pedidoId)?.editadas?.[lineaId] ?? null;
}

export function fijarCliente(
  pedidoId: string,
  cliente: ClienteDelRegistro,
): void {
  escribir(pedidoId, () => ({ cliente }));
}

// BORRA EL DE UN PEDIDO, NO «EL BORRADOR».
//
// Pide el id desde el 2026-10-26 y eso NO es solo consecuencia de la llave: es
// la otra mitad de `PR-G3`. `OrderDraftReset` llama aquí desde el detalle de
// un pedido --para que salirse del flujo tire lo editado, encargo del dueño de
// ese mismo día-- y sin el id borraba el borrador de CUALQUIER pedido. O sea
// que abrir el pedido de Luis tiraba lo que había a medias en el de Pedro,
// aunque las llaves ya fueran dos.
//
// Con el id, cada pantalla tira lo suyo y la instrucción del dueño se cumple
// igual: lo que se reinicia al salirse del flujo de un pedido es el de ESE
// pedido.
export function borrarBorrador(pedidoId: string): void {
  try {
    sessionStorage.removeItem(claveDe(pedidoId));
  } catch {
    // Same as above.
  }
  avisarDelCambio();
}
