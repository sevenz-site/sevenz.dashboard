export type MovementType = "charge" | "payment";
export type MovementSource = "photo_import" | "manual";

export type ExchangeRateMode = "BCV_AUTO" | "CUSTOM";
export type DisplayCurrency = "USD" | "EUR";

// The two currencies a VE owner's debt can be denominated in. Each is its
// own independent ledger: a client can owe $50 and €20 at the same time, and
// a dollar payment only ever reduces the dollar debt.
export type LedgerCurrency = "USD" | "EUR";
export const LEDGER_CURRENCIES: LedgerCurrency[] = ["USD", "EUR"];
export const DEFAULT_LEDGER_CURRENCY: LedgerCurrency = "USD";

export type Movement = {
  id: string;
  client_id: string;
  type: MovementType;
  amount: number;
  description: string | null;
  // La nota interna del dueño. NO es `description`: `description` es lo único de
  // esta fila que el cliente lee en `/s/[token]`, y esto es lo contrario — algo
  // que solo ve el dueño. Migración 074. Hoy la escribe una sola cosa: importar
  // una libreta cuya suma no cuadraba con el total escrito a mano.
  owner_note: string | null;
  source: MovementSource;
  running_balance: number;
  // EL CÓDIGO CORTO DE LA TRANSACCIÓN — migración 147. `null` solo en filas
  // escritas antes de esa migración y que el relleno no alcanzara; hoy, en
  // dev y en producción, no hay ninguna. Se deja opcional porque el tipo lo
  // comparten consultas que no piden esta columna.
  transaction_code?: string | null;
  needs_review: boolean;
  photo_path: string | null;
  plazo_dias: number | null;
  // How many cuotas the fiado was agreed in (migration `118`). null = single
  // payment, and that is every row stored before 2026-10-16. Only a charge with
  // a plazo can carry it -- the check constraint refuses anything else.
  cuotas: number | null;
  // LA VENTA DE LA QUE NACIÓ, si nació de una (migración `124`). null en todo
  // lo registrado antes del 2026-10-17 y en lo que entra por la libreta.
  //
  // Un fiado manual es «una venta sin pago», así que desde esa fecha lo
  // normal es que un cargo del formulario SÍ la tenga: es donde viven las
  // líneas de qué se llevó el cliente.
  sale_id: string | null;
  // A QUÉ FIADO SE DIRIGIÓ ESTE ABONO (migración `126`). null en un cargo
  // siempre, y en los cientos de abonos anteriores al 2026-10-19, que la cola
  // FIFO repartió sobre el saldo total y por eso dicen «Repartidos al saldo
  // total» en vez de nombrar un fiado.
  applies_to_movement_id: string | null;
  created_at: string;
  // Which ledger this movement belongs to. null for a country='CO' owner,
  // whose single ledger is COP.
  currency: LedgerCurrency | null;
  // Exchange-rate snapshot: null for every movement recorded by a country
  // = 'CO' owner. official_bcv_rate_at_time is always filled in for a 'VE'
  // owner even when rate_mode_used = 'CUSTOM' — the objective comparison
  // point for a future dispute.
  rate_mode_used: ExchangeRateMode | null;
  exchange_rate_used: number | null;
  official_bcv_rate_at_time: number | null;
  // What the owner actually typed, before conversion (amount is always Bs).
  // entry_currency 'VES' means no conversion happened at all.
  entry_currency: MovementCurrencyCode | null;
  entry_amount: number | null;
  // Both effective rates at write time, so any Bs figure on this movement can
  // be converted to either display currency using the rate that applied then.
  rate_usd_at_time: number | null;
  rate_eur_at_time: number | null;
};

// Mirrors lib/exchange-rate/convert.ts's MovementCurrency — declared here
// too so lib/types.ts stays free of a dependency on that module.
export type MovementCurrencyCode = "VES" | "USD" | "EUR";

// Payment terms selectable on a charge. null ("Sin especificar") means no
// due date — those charges fall back to the old immediate-mora behavior.
export const PLAZO_PAGO_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "7", label: "7 días", days: 7 },
  { value: "15", label: "15 días", days: 15 },
  { value: "30", label: "30 días", days: 30 },
  { value: "45", label: "45 días", days: 45 },
  { value: "sin_especificar", label: "Sin especificar", days: null },
];
// En qué moneda escribe el dueño el monto de un movimiento. NO es el libro
// donde entra la deuda: un fiado tecleado en bolívares se guarda en dólares o
// en euros, porque el libro no tiene dimensión de bolívares y añadirle una
// partiría en dos el saldo de cada cliente.
export type MonedaTecleada = "VES" | LedgerCurrency;

export const MONEDAS_TECLEABLES: { value: MonedaTecleada; label: string }[] = [
  { value: "VES", label: "Bolívares" },
  { value: "USD", label: "Dólares" },
  { value: "EUR", label: "Euros" },
];

export const DEFAULT_PLAZO_PAGO = "7";
// El valor del desplegable que abre el campo de días. Nunca llega al servidor:
// en cuanto se elige, lo que viaja es el número tecleado.
export const PLAZO_PAGO_OTRO = "otro";

// Highest number the unread badge spells out; anything above renders as "9+".
// Shared so the counting query and the badge agree — the query stops looking
// once it has this many, so a larger display cap would silently show a wrong
// number rather than a bigger one.
export const BADGE_MAX = 9;

export type OwnerPlan = "free" | "pro";
// Gates the exchange-rate feature end to end: only 'VE' owners see any of
// the Bs/BCV UI. 'CO' is the default — every existing owner is unaffected.
export type OwnerCountry = "CO" | "VE";

export type Owner = {
  id: string;
  email: string;
  business_name: string;
  first_name: string | null;
  last_name: string | null;
  whatsapp: string | null;
  address: string | null;
  tax_id: string | null;
  logo_path: string | null;
  plan: OwnerPlan;
  payment_info: string | null;
  country: OwnerCountry;
  onboarding_completed_at: string | null;
  // Consentimiento para recibir avisos por WhatsApp (migración 065). Meta
  // exige recogerlo fuera de WhatsApp y poder demostrarlo, así que junto a la
  // fecha se guarda LA FRASE que el dueño leyó: el texto de la pantalla va a
  // cambiar, y la evidencia tiene que ser lo que esa persona leyó, no lo que
  // diga la pantalla dentro de un año.
  //
  // `null` en `whatsapp_opt_in_at` significa "no acepta", y es el estado de
  // todos hasta que lo enciendan a mano.
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_in_text: string | null;
  whatsapp_opt_out_at: string | null;
  // Cuándo se le enseñó el diálogo que lo ofrece, y cuántas veces (migración
  // 066). En el servidor y no en el navegador: iOS Safari borra localStorage
  // y el contador volvería a cero solo.
  whatsapp_prompt_last_at: string | null;
  whatsapp_prompt_count: number;
  created_at: string;
};

// No row = implicit BCV_AUTO + USD (the settings screen only upserts once
// the owner actually saves).
export type OwnerExchangeSettings = {
  owner_id: string;
  rate_mode: ExchangeRateMode;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
  custom_rate_set_at: string | null;
  display_currency: DisplayCurrency;
  updated_at: string;
};

export type BcvRate = {
  usd: number;
  eur: number;
  source: string;
  fetched_at: string;
};

export type Client = {
  id: string;
  owner_id: string;
  name: string;
  whatsapp: string | null;
  address: string | null;
  document_id: string | null;
  // V/E/J en Venezuela, CC/CE/NIT en Colombia (migración 125). NULL = se
  // guardó antes de que el selector existiera, o no se sabe el país.
  document_type: string | null;
  // Which country issued document_id. Inherited from the owner's own
  // country when the client is created, correctable per client — CO and VE
  // cédulas can share the same digits and belong to different people, so
  // this pairs with document_id as the real identity key.
  document_country: OwnerCountry | null;
  profile_picture_path: string | null;
  created_at: string;
  is_flagged: boolean;
  // The two hiding states from PAPELERA-PLAN.md. Both nullable timestamps,
  // matching movements.deleted_at. Independent of is_flagged: a client does
  // not have to be mala paga to be trashed, and trashing never sets the flag.
  trashed_at: string | null;
  deleted_at: string | null;
};

export type ClientSummary = {
  client_id: string;
  owner_id: string;
  name: string;
  whatsapp: string | null;
  document_id: string | null;
  client_created_at: string;
  // The COP ledger (country='CO'). A VE owner's debt lives in the two
  // per-currency balances below instead.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  has_pending_review: boolean;
  last_payment_at: string | null;
  mora_reference_at: string;
  days_since_payment: number;
  oldest_unpaid_charge_at: string | null;
  oldest_unpaid_charge_plazo_dias: number | null;
  // CUÁNDO VENCE LO SIGUIENTE QUE DEBE, calculado por la base (migración
  // `118`). Sin cuotas es el final del plazo del cargo más viejo, que es lo
  // que esta pantalla calculaba sola hasta entonces. Con cuotas es el
  // vencimiento de la PRÓXIMA cuota sin pagar.
  oldest_unpaid_charge_due_at: string | null;
  is_flagged: boolean;
  // CUÁNDO PASÓ ALGO POR ÚLTIMA VEZ CON ESTE CLIENTE — migración `130`. El
  // mayor entre su último movimiento vivo y su última venta viva, con el alta
  // del cliente de respaldo, así que nunca es `null` desde la base. Mira las
  // DOS tablas porque una venta pagada entera no escribe en `movements`.
  //
  // Opcional en el tipo a propósito: entre desplegar este código y correr la
  // `130` las filas llegan sin ella, y una pantalla rota es peor que un orden
  // que cae en su respaldo.
  last_movement_at?: string | null;
  // EL FIADO QUE DECIDE EL CHIP, desde la migración `134`: el abierto cuyo
  // propio vencimiento queda más atrás, y si ninguno ha vencido, el que vence
  // antes. Sustituye a `oldest_unpaid_charge_*` en esa función — ese trío
  // sigue en la vista porque el código que hay en producción lo lee mientras
  // la migración corre, pero ya no lo lee ninguna pantalla de aquí.
  //
  // OPCIONALES POR LA MISMA RAZÓN QUE `last_movement_at`: entre desplegar
  // este código y correr la `134` las filas llegan sin ellos, y lo que hace
  // el `?? null` de cada sitio es caer en «sin plazo», no reventar.
  worst_unpaid_charge_at?: string | null;
  worst_unpaid_charge_plazo_dias?: number | null;
  worst_unpaid_charge_due_at?: string | null;
  // CUÁNTOS FIADOS VENCIDOS, para el contador del chip. `null` cuando el
  // cliente no debe nada: la función no devuelve fila y el left join deja
  // todo en nulo.
  overdue_charge_count?: number | null;
  // ── LO MISMO, UN JUEGO POR LIBRO — migración `146`, `CT-137` ────────
  //
  // El cuarteto de arriba es del cliente ENTERO, así que un chip calculado
  // con él mezcla los dos libros. Con 158,50 $ a favor y 3,50 € de deuda la
  // lista decía «A favor» con la deuda impresa al lado. Estos doce campos son
  // los que dejan juzgar cada libro por separado.
  //
  // OPCIONALES, y el `undefined` significa algo: la clave AUSENTE es una base
  // sin la `146` corrida, y ahí `estadoDeCliente` vuelve al juicio combinado
  // de siempre. `null` es otra cosa — es un libro sin nada abierto.
  worst_unpaid_charge_at_cop?: string | null;
  worst_unpaid_charge_plazo_dias_cop?: number | null;
  worst_unpaid_charge_due_at_cop?: string | null;
  overdue_charge_count_cop?: number | null;
  worst_unpaid_charge_at_usd?: string | null;
  worst_unpaid_charge_plazo_dias_usd?: number | null;
  worst_unpaid_charge_due_at_usd?: string | null;
  overdue_charge_count_usd?: number | null;
  worst_unpaid_charge_at_eur?: string | null;
  worst_unpaid_charge_plazo_dias_eur?: number | null;
  worst_unpaid_charge_due_at_eur?: string | null;
  overdue_charge_count_eur?: number | null;
};

// client_summary_all — the same view without the "hide the hidden" filter.
// Only three callers are allowed to read it: the Papelera screen, /admin
// metrics, and get_shared_balance. Everything else reads client_summary, so
// that forgetting to filter shows too little rather than too much.
export type ClientSummaryAll = ClientSummary & {
  trashed_at: string | null;
  deleted_at: string | null;
  // What the client owed at the moment they were hidden, frozen per currency.
  // This is what lets a later report explain why a total dropped, instead of
  // the total simply changing. Null while the client is visible.
  trashed_balance: number | null;
  trashed_balance_usd: number | null;
  trashed_balance_eur: number | null;
};

export type ClientFlag = {
  id: string;
  client_id: string;
  owner_id: string;
  reason: string;
  flagged_at: string;
  unflagged_at: string | null;
};

export type ClientStatus =
  | "sin_deuda"
  | "a_favor"
  | "dentro_del_plazo"
  | "plazo_vencido"
  | "sin_plazo"
  | "critico";

const CRITICO_THRESHOLD_DAYS = 30;

// Status reflects the balance first (does the client owe, or are they owed?).
// While there IS a debt: if the oldest unpaid charge has a plazo (payment
// term) and it hasn't expired yet, the client is simply "dentro_del_plazo" —
// not late. Once that term expires it's "plazo_vencido"; if that charge never
// had a term at all it's "sin_plazo" — same severity, different reason, so
// callers can tell them apart. Either way it still escalates to "critico"
// after CRITICO_THRESHOLD_DAYS since the last payment.
// RECIBE UN OBJETO Y NO CINCO ARGUMENTOS SUELTOS, desde la migración `134`.
//
// Hasta entonces el cargo que decidía el estado era `oldest_unpaid_charge_*`
// —el fiado MÁS ANTIGUO— y ahora es `worst_unpaid_charge_*`, el más vencido.
// Las dos ternas tienen exactamente los mismos tipos, así que una llamada
// posicional que siguiera pasando la vieja habría compilado sin una sola
// queja y habría seguido pintando el chip con la regla anterior: el fallo
// silencioso que esta migración existe para quitar, entrando por la puerta de
// atrás. Con campos con nombre, el compilador enumera los nueve sitios.
//
// Es la misma técnica que el quinto argumento obligatorio de la `118`, subida
// un escalón porque ahora lo que cambia no es cuántos datos entran sino cuál
// de dos juegos idénticos es el correcto.
export function getClientStatus({
  balance,
  daysSincePayment,
  worstChargeAt,
  worstChargePlazoDias,
  worstChargeDueAt,
}: {
  balance: number;
  daysSincePayment: number;
  // `client_summary.worst_unpaid_charge_*`: el fiado abierto cuyo propio
  // vencimiento queda más atrás. Si ninguno ha vencido, el que vence antes.
  worstChargeAt: string | null;
  worstChargePlazoDias: number | null;
  // La base ya hizo la cuenta, cuotas incluidas: aquí solo se compara con hoy.
  worstChargeDueAt: string | null;
}): ClientStatus {
  if (balance === 0) return "sin_deuda";
  if (balance < 0) return "a_favor";

  const hasPlazo = worstChargeAt !== null && worstChargePlazoDias !== null;
  if (hasPlazo) {
    // CON FECHA DE VENCIMIENTO, MANDA ELLA. Es la de la próxima cuota sin
    // pagar, y sin cuotas coincide con el final del plazo.
    //
    // El `else` no es una ruta muerta ni un resto: `due_at` llega en null si
    // el cargo no tiene plazo (ahí no se entra), y también durante el rato en
    // que la migración `118` esté en un entorno y no en el otro. En ese caso
    // se juzga como siempre, que es exactamente lo que hay que hacer mientras
    // la columna no exista.
    if (worstChargeDueAt !== null) {
      if (Date.now() <= new Date(worstChargeDueAt).getTime()) return "dentro_del_plazo";
    } else {
      const daysSinceCharge = Math.floor(
        (Date.now() - new Date(worstChargeAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceCharge <= worstChargePlazoDias) return "dentro_del_plazo";
    }
  }

  if (daysSincePayment > CRITICO_THRESHOLD_DAYS) return "critico";
  return hasPlazo ? "plazo_vencido" : "sin_plazo";
}

// Label for the balance figure itself (distinct from ClientStatus, which
// only applies when there's a debt) — "Debe" only makes sense when the
// client actually owes money.
export function getBalanceLabel(balance: number): string {
  if (balance > 0) return "Debe";
  if (balance < 0) return "A favor";
  return "Sin deuda";
}

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  sin_deuda: "Sin deuda",
  a_favor: "A favor",
  dentro_del_plazo: "Dentro del plazo",
  plazo_vencido: "Plazo vencido",
  sin_plazo: "Sin plazo",
  critico: "Crítico",
};

// EL CHIP DICE CUÁNTOS FIADOS VENCIDOS HAY, no solo que hay alguno.
//
// Pedido por el dueño el 2026-10-21 junto con la `134`, y es la mitad que
// convierte el aviso en una conversación: «Plazo vencido» y «Plazo vencido
// (3)» son dos cosas distintas que decirle al cliente, y el dato ya viajaba
// en `client_summary.overdue_charge_count`.
//
// SOLO DESDE DOS. Un «(1)» no añade nada —si el chip dice vencido, es obvio
// que hay al menos uno— y le pone un número a la mayoría de las filas, que es
// la forma de que nadie lea el número cuando de verdad importa.
//
// Y SOLO EN LOS ESTADOS QUE CUENTAN DEUDA VENCIDA. En «Dentro del plazo» el
// contador es cero por definición, y en «Sin deuda» o «A favor» no hay nada
// que contar. `critico` lo lleva a petición del dueño: es un plazo vencido
// agravado por los 30 días sin abonar, así que el número significa lo mismo.
export function clientStatusLabel(
  status: ClientStatus,
  overdueCount: number | null,
  // DESDE UNO, en las tarjetas de «Por cobrar» de cada moneda. El dueño las
  // pidió con contador el 2026-10-23 y volvió a reclamarlo al verlas sin
  // número: su cliente tenía UN vencido en cada libro, y con el umbral de dos
  // —el de las listas— las dos salían sin cifra, que desde fuera se lee como
  // que el contador no se puso.
  //
  // Las LISTAS conservan el umbral, y la razón sigue en pie: ahí un «(1)»
  // le pondría número a casi todas las filas y dejaría de destacar al cliente
  // con cinco. En una tarjeta de libro no hay filas que comparar — hay dos
  // tarjetas— así que el número es información y no ruido.
  desdeUno = false,
): string {
  const base = CLIENT_STATUS_LABEL[status];
  const count = overdueCount ?? 0;
  const llevaContador =
    status === "plazo_vencido" || status === "sin_plazo" || status === "critico";
  const showsCount = llevaContador && count > (desdeUno ? 0 : 1);
  return showsCount ? `${base} (${count})` : base;
}

export const CLIENT_STATUS_DESCRIPTION: Record<ClientStatus, string> = {
  sin_deuda: "No debe nada",
  a_favor: "Pagó de más",
  dentro_del_plazo: "Debe, pero aún no vence su plazo",
  plazo_vencido: "Debe, y ya venció el plazo que se le dio",
  sin_plazo: "Debe, y nunca se le puso plazo",
  critico: "Debe hace más de 30 días sin abonar",
};

export const CLIENT_STATUS_BADGE_CLASS: Record<ClientStatus, string> = {
  // text-foreground (not text-muted-foreground) — on bg-muted,
  // muted-foreground only clears ~4.35:1 contrast, just under WCAG AA's
  // 4.5:1 for this text size.
  sin_deuda: "bg-muted text-foreground border-transparent",
  a_favor:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  dentro_del_plazo:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  plazo_vencido:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  sin_plazo:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  critico:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
};

// Deliberately not part of CLIENT_STATUS_BADGE_CLASS's palette — "Mala paga"
// is the owner's own judgment call, not a computed payment-status signal, so
// it always shows as a second badge alongside the status one, styled to read
// as a different kind of thing (a "blacklist" mark, not a severity level).
export const MALA_PAGA_BADGE_CLASS = "border-transparent bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";

// El chip de una cuenta en /admin. Vive aquí, junto a CLIENT_STATUS_BADGE_CLASS
// y MALA_PAGA_BADGE_CLASS, porque es la misma paleta: si estos colores se
// escribieran en el componente de /admin, el día que se ajuste el ámbar de
// "plazo vencido" la pantalla de cuentas se quedaría con el viejo.
//
// EL MAPA, y por qué cada uno:
//
//   activa_pro    NEGRO, el mismo de "mala paga". Es el chip que más pesa de
//                 la paleta, y un negocio que paga es la única fila que quieres
//                 distinguir de un vistazo entre veinticuatro.
//   activa_free   VERDE. Activa igual, pero es un regalo: se lee bien y no se
//                 confunde con quien paga.
//   demo          AZUL, el mismo de "dentro del plazo". Es literalmente eso:
//                 un plazo corriendo que todavía no venció.
//   vencida       ÁMBAR, el mismo de "plazo vencido". Mismo concepto otra vez —
//                 se pasó la fecha y sigue ahí.
//   bloqueada     ROJO.
//   cancelada     NEUTRO. Ya no pide nada de ti.
export const CUENTA_BADGE_CLASS = {
  activa_pro: "border-transparent bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
  activa_free:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  demo: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  vencida:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  bloqueada:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  cancelada: "bg-muted text-foreground border-transparent",
} as const;

// Keyed by the tier label computeCreditScore() returns (lib/credit-score.ts)
// — kept here alongside the other badge-class maps rather than in that pure
// module, consistent with how CLIENT_STATUS_BADGE_CLASS lives here too.
export const CREDIT_SCORE_TIER_BADGE_CLASS: Record<string, string> = {
  Excelente:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  Bueno: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  Regular:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  Malo: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  "Sin historial": "bg-muted text-foreground border-transparent",
};

export type ExtractedMovement = {
  client_name: string;
  date: string | null;
  type: MovementType;
  amount: number;
  description: string | null;
  read_balance: number | null;
  confidence: "high" | "low";
  // Never extracted by the AI (a libreta photo doesn't show it) — filled in
  // by the owner during review, only actually required for a client who
  // doesn't already have one on file (see ReviewRow.needs_document_id).
  document_id: string | null;
  // Tampoco sale de la foto, y a diferencia del documento NUNCA bloquea: es
  // opcional en todas partes desde el 2026-09-21. Está aquí para que el dueño
  // pueda aprovechar la revisión y añadirlo, no para exigirlo — una libreta
  // suele tener el teléfono apuntado arriba, junto al nombre.
  whatsapp: string | null;
  // Assigned when the batch enters the review screen, never by the extraction.
  // Identity that survives deleting a row: positions shift when one is removed,
  // so anything remembered about a row by position (which rows opted out of the
  // shared client, which React element this is) would silently move to a
  // different row.
  uid?: string;
  // Also not extracted: a handwritten page rarely marks its currency, and the
  // owner is the one who knows. Set during review, per row, because one
  // libreta can mix — which is why this is not resolved once for the batch.
  //
  // Only meaningful for a VE owner, who keeps independent USD and EUR ledgers.
  // For a CO owner it stays null and the movement joins the currency-less COP
  // chain, where null *is* the correct value.
  currency: LedgerCurrency | null;
};

// Who typed a client's document. See supabase/063_document_source.sql.
//
// ONE PLACE, TYPED, and that is not ceremony: the database has a CHECK on this
// column, so a typo does not produce odd data — it produces a rejected INSERT.
// And the insert being rejected is the one that registers a client. A typo here
// turns into "the shopkeeper cannot register anyone", which is a money-path
// outage.
export const DOCUMENT_SOURCE = { OWNER: "owner", CLIENT: "client" } as const;
export type DocumentSource = (typeof DOCUMENT_SOURCE)[keyof typeof DOCUMENT_SOURCE];
