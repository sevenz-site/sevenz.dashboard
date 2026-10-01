import type {
  CandidatoDuplicado,
  ClienteRevisado,
} from "@/lib/reconcile";

// ──────────────────────────────────────────────────────────────────────────
// QUÉ ESTADO TIENE LA TARJETA DE UN CLIENTE
//
// Vive aquí y no en el componente que la pinta porque es lógica pura que decide
// QUÉ IMPIDE SUBIR una libreta, y dentro de un archivo `"use client"` con JSX no
// se puede probar desde Node. Se movió el 2026-09-30 al escribir
// `qa/bordes-subir-libreta.mjs`. Los colores y el texto de cada chip siguen en
// el componente: eso sí es pantalla.

export type DecisionDuplicado = "mismo" | "otra";

// La revisión, por CLIENTE y no por movimiento.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ DEJA DE SER UNA TABLA
//
// La pantalla anterior era una fila por MOVIMIENTO: una libreta de seis páginas
// se convertía en cuarenta filas con ocho columnas, en un teléfono de 375px. El
// dueño no piensa en movimientos sueltos, piensa en personas: "¿está bien lo de
// Petronila?". Y lo que hay que revisar —la suma, la moneda, la cédula, si ese
// "Juanito" es el suyo— son preguntas POR PERSONA, no por línea.
//
// Así que arriba se resume por cliente y el detalle se abre aparte. Una tarjeta
// se lee de un vistazo y dice su estado con color, con chip y con una frase; la
// tabla decía lo mismo repartido en cuarenta filas y ninguna se leía.
//
// ─────────────────────────────────────────────────────────────────────────
// EL ORDEN DE LOS ESTADOS NO ES ESTÉTICO
//
// Una tarjeta tiene UN estado, el más accionable, porque un cliente puede tener
// tres problemas a la vez y pintarlos todos deja al dueño sin saber por dónde
// empezar. La prioridad es: lo que IMPIDE importar primero, lo que hay que
// decidir después, lo que conviene mirar al final.
//
//   faltan_datos   falta la cédula de un cliente nuevo, o la moneda. Bloquea.
//   duplicado      hay un cliente con ese nombre y nadie ha dicho si es el
//                  mismo. Bloquea, porque las dos respuestas se equivocan en
//                  direcciones opuestas — ver la nota de `DecisionDuplicado`.
//   revisar_suma   los totales escritos no cuadran con los montos. No bloquea:
//                  la libreta puede tener un error de suma de verdad y el dueño
//                  es quien decide.
//   sin_verificar  no había totales con los que comparar. NO es un fallo — en
//                  un cuaderno a mano es lo normal.
//   cuadra         todo bien.
//
// EL WHATSAPP NUNCA BLOQUEA y va en ámbar, no en rojo. El mapa original lo
// pintaba rojo junto a la cédula; la decisión del 2026-09-28 fue la contraria y
// manda la decisión, no el mockup. `lib/types.ts` lo dice desde el 2026-09-21:
// es opcional en todas partes.
export type EstadoTarjeta =
  // Ya entro en la base. Manda sobre todos los demas: lo que le faltara o
  // sobrara dejo de importar en cuanto se guardo.
  | "subido"
  | "faltan_datos"
  | "duplicado"
  | "revisar_suma"
  | "sin_verificar"
  | "cuadra";

export type ClienteConEstado = ClienteRevisado & {
  estado: EstadoTarjeta;
  // El cliente existente que se parece a este, para poder preguntar. Viene
  // APARTE de `candidato` y de una reconciliación contra la lista COMPLETA de
  // clientes, porque `candidato` desaparece en cuanto el dueño responde "es otra
  // persona" —y tiene que desaparecer, o el saldo previo de esa otra persona se
  // colaría en los totales—, pero los dos botones tienen que seguir ahí para
  // poder cambiar de idea.
  candidatoVisible: CandidatoDuplicado | null;
  // Lo que falta, ya redactado. Puede haber más de una cosa: "Falta cédula" y
  // "Falta WhatsApp" son dos avisos distintos y se enseñan los dos, separados,
  // porque uno impide importar y el otro no.
  bloqueos: string[];
  avisos: string[];
  // Ya esta en la base: se subio suelto con su propio boton. La tarjeta se
  // queda en su sitio para que se vea lo que llevas hecho, se puede abrir para
  // mirar lo que entro, y pierde los botones.
  subido: boolean;
  // Si este cliente, EL SOLO, se puede subir ya. Es lo que enciende su boton y
  // lo que cuenta el del lote.
  puedeSubir: boolean;
};

// Traduce la vista por cliente en lo que se pinta. Vive aquí y no en
// `lib/reconcile.ts` porque es una decisión de PANTALLA —qué se enseña primero
// cuando hay tres problemas a la vez—, no de datos.
export function conEstado(
  clientes: ClienteRevisado[],
  filas: {
    client_name: string;
    document_id: string | null;
    needs_document_id: boolean;
    currency?: string | null;
  }[],
  decisiones: Record<string, DecisionDuplicado>,
  candidatos: Map<string, CandidatoDuplicado>,
  opciones: {
    // Solo un negocio venezolano elige moneda. Para uno colombiano la columna
    // es null a proposito y preguntarla seria un bloqueo imposible de resolver.
    exigeMoneda?: boolean;
    // Los `nameKey` que ya entraron.
    subidos?: Set<string>;
  } = {},
): ClienteConEstado[] {
  return clientes.map((c) => {
    const subido = opciones.subidos?.has(c.nameKey) ?? false;
    const candidatoVisible = candidatos.get(c.nameKey) ?? null;
    const suyas = filas.filter((f) => f.client_name.trim().toLowerCase() === c.nameKey);

    const bloqueos: string[] = [];
    // EL MISMO CRITERIO, FILA A FILA, que el bloqueo del pie de la pantalla
    // (`missingDocumentId`). Antes esto preguntaba si ALGUNA fila traía cédula
    // y el pie si le FALTABA a alguna: con una sola fila sin ella —la línea de
    // ajuste recién creada, por ejemplo— la tarjeta decía "Todo cuadra"
    // mientras el botón de subir estaba apagado. Dos medidas distintas de la
    // misma cosa siempre acaban contradiciéndose; esta es la que manda.
    if (suyas.some((f) => f.needs_document_id && !f.document_id?.trim())) {
      bloqueos.push("Falta la cédula. Sin ella no se puede importar.");
    }
    // LA MONEDA SI SE REPITE EN CADA TARJETA, desde el 2026-10-01.
    //
    // Hasta entonces no, y por una razon buena: era un bloqueo de la TANDA, con
    // su selector arriba y su mensaje en el pie, asi que ponerlo aqui pintaba
    // las seis tarjetas de rojo con el mismo texto y tapaba lo unico que las
    // distingue. Lo que cambio es que ahora cada cliente se sube por separado,
    // asi que la moneda dejo de ser una condicion de la libreta y paso a serlo
    // de cada persona: sin decirlo en su tarjeta, su boton estaria apagado sin
    // ninguna explicacion al lado.
    //
    // El riesgo viejo sigue existiendo —nadie ha elegido moneda y salen seis
    // tarjetas rojas iguales—, y lo que lo contiene es que el selector de la
    // tanda sigue arriba: un toque las arregla todas.
    if (opciones.exigeMoneda && suyas.some((f) => !f.currency)) {
      bloqueos.push("Falta la moneda. Sin ella no se puede importar.");
    }

    const avisos: string[] = [];
    if (c.libros.some((l) => l.estado === "sin_verificar")) {
      avisos.push(
        "Esta libreta no traía totales con los que comparar. Revisa los montos para estar seguro.",
      );
    }
    // El WhatsApp NO bloquea, y la frase no promete lo que todavía no hacemos:
    // hoy Sevenz no envía ningún mensaje a un cliente (`MS-3`, bloqueada por
    // `NG-1`). Dice que llegará y por qué conviene apuntarlo ahora, que es
    // cierto el día que se publica y sigue siéndolo el día que se active.
    if (c.faltaWhatsapp) {
      // Corto en la tarjeta. La explicación entera —que todavía no mandamos
      // avisos a clientes pero lo haremos— vive UNA vez, junto al campo donde
      // se escribe, y no seis veces en una lista que así no se lee.
      avisos.push("Falta el WhatsApp. Es opcional, pero conviene apuntarlo ahora.");
    }

    const estado: EstadoTarjeta = subido
      ? "subido"
      : bloqueos.length
      ? "faltan_datos"
      : candidatoVisible && !decisiones[c.nameKey]
        ? "duplicado"
        : c.libros.some((l) => l.estado === "no_cuadra")
          ? "revisar_suma"
          : c.libros.some((l) => l.estado === "sin_verificar")
            ? "sin_verificar"
            : "cuadra";

    // Un cliente se puede subir cuando no le falta nada que impida importar y
    // su duplicado esta decidido. Es la MISMA cuenta que hacia el pie para la
    // tanda entera, aplicada a una persona.
    const puedeSubir =
      !subido && bloqueos.length === 0 && !(candidatoVisible && !decisiones[c.nameKey]);

    // UNA TARJETA SUBIDA NO PIDE NADA. Ni bloqueos, ni avisos, ni la pregunta
    // del duplicado: ya esta en la base y no hay nada que decidir.
    //
    // Lo del duplicado no es cosmetico. Al subir a Pedro, Pedro pasa a existir
    // como cliente, asi que la deteccion de repetidos lo encuentra -- y su
    // propia tarjeta le preguntaba al dueno si Pedro es el mismo Pedro, con sus
    // dos botones. Visto al probarlo el 2026-10-01.
    if (subido) {
      return {
        ...c,
        estado,
        bloqueos: [],
        avisos: [],
        candidatoVisible: null,
        subido,
        puedeSubir: false,
      };
    }

    return { ...c, estado, bloqueos, avisos, candidatoVisible, subido, puedeSubir };
  });
}
