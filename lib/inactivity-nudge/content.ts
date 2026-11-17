// THE FOUR INACTIVITY NUDGES: their order, and the words of each, for both channels.
//
// Owner's decisions of 2026-11-17 (MS-53): «Las 4, sin SENIAT», one every 3 weeks, by WhatsApp
// and by email. `inactive_nudge_tax_invoice` is approved by Meta too and is NOT in this list on
// purpose: it promises SENIAT invoicing, which does not exist yet.
//
// THE WHATSAPP TEXT IS NOT HERE: it lives in Meta, approved on 2026-11-16 as MARKETING, and only
// `owner_name` travels with it. These bullets are the EMAIL's, copied from the approved bodies
// (read back from Meta through Kapso on 2026-11-17), so the two channels say the same thing. If
// a template is ever replaced by a `_v2`, its bullets here change with it.

export const NUDGE_TEMPLATES = [
  "inactive_nudge_credit",
  "inactive_nudge_catalog",
  "inactive_nudge_inventory",
  "inactive_nudge_cash_sales",
] as const;

export type NudgeTemplate = (typeof NUDGE_TEMPLATES)[number];

/** The rotation: the first nudge is about credit, the fifth starts the round again. */
export function nudgeTemplateFor(nudgesAlreadySent: number): NudgeTemplate {
  const i = Math.max(0, Math.floor(nudgesAlreadySent)) % NUDGE_TEMPLATES.length;
  return NUDGE_TEMPLATES[i];
}

type NudgeCopy = {
  subject: string;
  // The question after «Hola {name},», as in the template's first line.
  opening: string;
  // Every bullet but the last one («Puedes desactivar estos avisos en Mi negocio.»), which the
  // email replaces with its own unsubscribe lines.
  bullets: string[];
};

export const NUDGE_COPY: Record<NudgeTemplate, NudgeCopy> = {
  inactive_nudge_credit: {
    subject: "¿Sabes hoy quién te debe y desde cuándo?",
    opening: "¿sabes hoy quién te debe y desde cuándo?",
    bullets: [
      "En Sevenz anotas cada fiado y ves al momento el saldo de cada cliente.",
      "Tu cliente recibe por WhatsApp el recibo de cada abono y un recordatorio antes de su fecha de pago.",
      "Cada lunes y cada jueves te llega por WhatsApp quién te debe y qué plazos vencen.",
    ],
  },
  inactive_nudge_catalog: {
    subject: "¿Vendes por WhatsApp? Recibe pedidos sin escribir uno por uno",
    opening:
      "¿vendes por WhatsApp? Con Sevenz tus clientes pueden hacerte pedidos sin escribirte uno por uno.",
    bullets: [
      "Compartes el enlace de tu catálogo y arman su pedido desde su teléfono, con tus precios al día.",
      "Registras cada pedido como venta, de contado o fiado.",
      "Los jueves te avisamos por WhatsApp si tienes pedidos sin atender.",
    ],
  },
  inactive_nudge_inventory: {
    subject: "¿Sabes cuánto te deja de ganancia cada producto?",
    opening: "¿sabes cuánto te deja de ganancia cada producto?",
    bullets: [
      "Con el costo y el precio de cada producto, Sevenz actualiza tu inventario y te dice su margen y qué se vende más.",
      "Ves qué productos se están agotando antes de que te falten.",
      "Los jueves te avisamos por WhatsApp de los productos agotados o por agotarse.",
    ],
  },
  inactive_nudge_cash_sales: {
    subject: "¿Sabes cuánto vendiste esta semana?",
    opening: "¿sabes cuánto vendiste esta semana? Anota tus ventas de contado en segundos.",
    bullets: [
      "Registras lo que tu cliente se llevó y cómo te pagó.",
      "En Reportes ves cuánto vendiste en el día, la semana o el mes.",
      "Cada lunes te llega por WhatsApp lo que vendiste en los últimos 7 días.",
    ],
  },
};

/** The name in the greeting: first name, else the business, as every owner template does. */
export function nudgeOwnerName(firstName: string | null, businessName: string | null): string {
  return firstName?.trim() || businessName?.trim() || "";
}

/** The plain-text email. `unsubscribeUrl` is the one-click link, never left out. */
export function nudgeEmailText(
  template: NudgeTemplate,
  name: string,
  appUrl: string,
  unsubscribeUrl: string,
): { subject: string; text: string } {
  const c = NUDGE_COPY[template];
  const greeting = name ? `Hola ${name}, ${c.opening}` : `Hola, ${c.opening}`;
  const text = [
    greeting,
    "",
    ...c.bullets.map((b) => `• ${b}`),
    "",
    `Abrir Sevenz: ${appUrl}`,
    "",
    "Sevenz no pide códigos ni pagos.",
    "",
    "Te escribimos porque tienes una cuenta en Sevenz y llevas unos días sin registrar ventas.",
    `Para dejar de recibir estos consejos: ${unsubscribeUrl}`,
    "También puedes desactivarlos en Mi negocio, en Notificaciones.",
  ].join("\n");
  return { subject: c.subject, text };
}
