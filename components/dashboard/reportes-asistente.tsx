"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ChevronUp, ThumbsDown, ThumbsUp } from "lucide-react";
import { track } from "@/lib/mixpanel";
import { calificarAsistente } from "@/app/(app)/reportes/actions";
import { cn } from "@/lib/utils";
import { partirPorImportes } from "@/lib/reports/assistant/importes";

// ═══════════════════════════════════════════════════════════════════════
// EL ASISTENTE — frame `1804:15424`
//
// Encargo del dueño el 2026-10-29. Un bloque arriba de las tres pestañas con
// el resumen del día: una o dos frases de diagnóstico, «Recomendaciones:» y
// hasta tres viñetas, y un pie para calificarlo.
//
// ───────────────────────────────────────────────────────────────────────
// EXPANDIDO SIEMPRE. SIN MEMORIA. ES LITERAL.
//
// *«Debe estar expandido por defecto siempre que se entre a la funcionalidad
// de "Reportes"»*. El plegado vive en `useState` y muere al salir de la
// pantalla: NO se guarda en `localStorage`.
//
// Se escribe aquí porque lo normal es lo contrario --un bloque que se puede
// plegar suele recordar que lo plegaste-- y quien lea esto dentro de seis
// meses va a pensar que falta. No falta: un tendero que lo plegó una vez
// porque tenía prisa no decidió no volver a verlo nunca.
//
// ───────────────────────────────────────────────────────────────────────
// SE CARGA SOLO, Y POR ESO LA PANTALLA NO SE RALENTIZA
//
// El resumen cuesta unas veinte consultas el día que se genera. Pedirlo desde
// el servidor dejaría la pantalla entera esperando por un bloque que es un
// añadido. Así que este componente lo pide por su cuenta al montarse y enseña
// su esqueleto mientras tanto: Reportes abre tan rápido como ayer.
//
// ───────────────────────────────────────────────────────────────────────
// EL DEGRADADO SE QUEDA, Y ESO DESPLAZA UNA DECISIÓN DEL DÍA ANTERIOR
//
// El 2026-10-28 el dueño mandó QUITAR un degradado igual de tres tarjetas del
// Inicio y del catálogo: *«tan tenue que en un teléfono al sol no se distingue
// de un fondo plano»*, y además costaba un estilo en línea que no se puede
// sobreescribir con una clase. Esa razón sigue siendo cierta y está escrita en
// `inicio-resumen-cards.tsx`.
//
// El 2026-10-29, preguntado y con esa decisión delante, eligió dejarlo aquí.
// Su motivo: este bloque SÍ tiene que destacar sobre el resto de la pantalla
// --las tarjetas no lo necesitaban-- y el del frame tiene tres paradas en vez
// de dos, así que se ve más. Las dos decisiones quedan escritas.
//
// EL BORDE NO ES EL DEL FRAME. El frame pide un token `--subtle` (#9a9a9a) que
// no existe en `globals.css`. Se usa `border-input`, que es el gris que este
// sistema ya tiene para separar sin gritar; inventar un token para un solo
// componente es cómo nacen las paletas que no coinciden.
// ═══════════════════════════════════════════════════════════════════════

type Nota = {
  summary: string;
  recommendations: string[];
  degraded: boolean;
  rating: "useful" | "not_useful" | null;
  empty: boolean;
};

export function ReportesAsistente() {
  const [nota, setNota] = useState<Nota | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const [calificacion, setCalificacion] = useState<"useful" | "not_useful" | null>(null);
  const [, startTransition] = useTransition();
  const pedido = useRef(false);

  useEffect(() => {
    // UNA SOLA VEZ POR MONTAJE. En desarrollo React monta dos veces a
    // propósito, y sin esta guarda el primer tendero del día gastaría dos de
    // sus tres intentos antes de ver nada.
    if (pedido.current) return;
    pedido.current = true;
    fetch("/api/reportes/asistente")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Nota) => {
        setNota(d);
        // EL PULGAR QUE YA DIO, SI LO DIO. Sin esto el componente nace sin
        // memoria y vuelve a preguntar por una nota que el tendero ya
        // calificó: no era «una vez al día», era una vez por visita.
        if (d.rating) setCalificacion(d.rating);
      })
      .catch(() => setFallo(true));
  }, []);

  // NI ESQUELETO ETERNO NI BLOQUE VACÍO. Si la petición se cae del todo
  // --sin red, sesión caducada-- el bloque desaparece en vez de quedarse
  // cargando para siempre. Es lo único que esta pantalla no puede resolver
  // sola, y un hueco silencioso estorba menos que una animación infinita.
  if (fallo || (nota && !nota.summary)) return null;

  return (
    <div
      className="flex w-full flex-col gap-4 rounded-lg border border-input p-2.5"
      style={{
        backgroundImage:
          "linear-gradient(87.33deg, var(--accent) 0%, var(--background) 50%, var(--accent) 100%)",
      }}
    >
      <div className="flex w-full items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Image src="/logo-primary.svg" alt="Sevenz" width={67} height={24} className="h-6 w-auto" />
            <span className="text-sm leading-5">Asistente</span>
          </div>

          {/* ── LA PREGUNTA QUE EL RESUMEN CONTESTA ──────────────────
              Encargo del dueño el 2026-10-30: *«agreguemos la pregunta
              "¿Cómo va la semana? Reporte diario", ayudará al dueño a tener
              contexto acerca del reporte generado»*, con la captura y el
              recuadro en rojo.

              ESTO NO ESTÁ EN EL FRAME `1804:15424`, y se dice en voz alta:
              es un añadido suyo posterior, no algo que yo deduje del diseño.

              VA DENTRO DEL PLEGABLE y no encima, porque describe el informe,
              no el bloque: plegado, lo que queda es «Asistente», que es lo
              que el frame dibuja.

              Y SE PINTA TAMBIÉN MIENTRAS CARGA, antes que el texto. Es lo
              único que explica qué se está preparando durante los segundos
              del esqueleto; ponerlo después dejaría tres rayas grises sin
              decir de qué son.

              «Reporte diario» EN GRIS Y NO COMO PARTE DE LA PREGUNTA: son dos
              cosas distintas --lo que contesta y cada cuánto se rehace-- y el
              dueño las escribió juntas en una línea. El color las separa sin
              inventar puntuación que él no puso. */}
          {abierto ? (
            <p className="text-xs leading-4">
              {/* SEMIBOLD, TWO WEIGHTS ABOVE THE REGULAR BODY -- the owner's
                  request of 2026-10-31, together with «Recomendaciones» and
                  the amounts. «Reporte diario» stays regular and grey: it says
                  how often, not what. */}
              <span className="font-semibold">¿Cómo va la semana?</span>{" "}
              <span className="text-muted-foreground">Reporte diario</span>
            </p>
          ) : null}

          {abierto ? (
            nota ? (
              <div className="flex flex-col gap-0 text-xs leading-4">
                <p className="whitespace-pre-wrap">
                  <ConImportes frase={nota.summary} />
                </p>
                {nota.recommendations.length ? (
                  <>
                    <p className="mt-4 font-semibold">Recomendaciones:</p>
                    {/* `ms-[18px]` Y `list-disc` SON DEL FRAME, no una elección:
                        la viñeta y su sangría están especificadas. */}
                    <ul className="list-disc">
                      {nota.recommendations.map((r) => (
                        <li key={r} className="ms-[18px]">
                          <ConImportes frase={r} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : (
              <Esqueleto />
            )
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-label={abierto ? "Ocultar el resumen" : "Ver el resumen"}
          // 40px DE ZONA TOCABLE ALREDEDOR DE UN ICONO DE 16. El frame dibuja
          // el icono; lo que se toca con el pulgar en un teléfono es esto.
          className="-m-3 shrink-0 p-3"
        >
          <ChevronUp className={cn("size-4 transition-transform", !abierto && "rotate-180")} aria-hidden />
        </button>
      </div>

      {/* EL PIE SOLO CUANDO HAY ALGO QUE CALIFICAR. Preguntar «¿qué tan útil
          te parece?» debajo de un esqueleto es preguntar por algo que todavía
          no se ha leído. */}
      {/* SIN DATOS NO SE PREGUNTA. Decisión del dueño el 2026-10-30:
          preguntar «¿qué tan útil te parece este reporte?» debajo de un texto
          que dice que todavía no hay nada que reportar es preguntar por algo
          que no existe -- y la respuesta, cualquiera que fuese, no diría nada
          sobre el asistente. */}
      {abierto && nota && !nota.empty ? (
        <div className="flex w-full items-center justify-between border-t pt-2">
          <span className="text-xs leading-4 text-muted-foreground">
            {calificacion ? "Gracias, lo tendremos en cuenta." : "¿Qué tan útil te parece este reporte?"}
          </span>
          {calificacion ? null : (
            <div className="flex items-start gap-2">
              <Pulgar
                icono={<ThumbsDown className="size-4" aria-hidden />}
                etiqueta="Poco"
                onClick={() => calificar("not_useful")}
              />
              <Pulgar
                icono={<ThumbsUp className="size-4" aria-hidden />}
                etiqueta="Mucho"
                onClick={() => calificar("useful")}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  function calificar(rating: "useful" | "not_useful") {
    // SE PINTA ANTES DE GUARDAR. El tendero ya hizo lo que tenía que hacer;
    // esperar a la red para agradecérselo convierte un toque en una pausa. Si
    // el guardado falla, lo que se pierde es una fila de analítica, no su
    // opinión.
    setCalificacion(rating);
    track("AI Report Rated", { calificacion: rating });
    startTransition(async () => {
      await calificarAsistente(rating);
    });
  }
}

/**
 * ¿CUÁNTOS USUARIOS CALIFICAN EL INFORME AI EN LA SECCIÓN DE REPORTES?
 *
 * Encargo del dueño el 2026-10-29, con esas palabras y pidiendo *«la propiedad
 * para calificación bien o mal»*.
 *
 * QUÉ DECIDE, que es lo que separa este evento de una columna que nadie abre:
 *
 *   · Si casi nadie toca los pulgares, el asistente no se está leyendo --o se
 *     lee y da igual--, y lo honesto es dejar de invertir en él antes de
 *     construir la parte que lo haría seguir el selector de fechas.
 *   · Si lo califican y la mayoría dice «Poco», el problema no es el producto
 *     sino el texto: el prompt y el orden de los cuatro motivadores están en
 *     este repo y se pueden cambiar en una tarde.
 *   · Y si dice «Mucho», entonces vale la pena lo caro: pasar al nivel de pago
 *     de Gemini y que el resumen siga el periodo que el tendero elija.
 *
 * LA PROPIEDAD GUARDA `useful` / `not_useful`, no «Mucho» / «Poco». Lo que el
 * tendero lee es Mucho y Poco; lo que se archiva son valores que sobreviven a
 * que mañana esas dos palabras cambien en la pantalla.
 *
 * VA EN EL NAVEGADOR porque es un GESTO: alguien tocó un pulgar. Eso no
 * existe en el servidor, igual que los otros cuatro eventos de Reportes --ver
 * la nota de `reportes-analitica.tsx`--. Lo que se obtiene es un suelo, no un
 * recuento exacto, y así hay que presentarlo. Su hermano `AI Report Failed` va
 * al revés, en el servidor, justamente porque ahí no hay ningún gesto que
 * medir: la caída el tendero no la ve.
 *
 * Y HAY UNA SEGUNDA MITAD QUE MIXPANEL NO PUEDE DAR: la columna `rating` de
 * `report_assistant_notes` guarda el pulgar junto al texto que lo provocó.
 * Mixpanel dirá cuántos calificaron; la tabla dirá QUÉ les pareció malo.
 */
function Pulgar({
  icono,
  etiqueta,
  onClick,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${etiqueta} útil`}
      className="flex size-10 flex-col items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-accent"
    >
      {icono}
      <span className="text-xs leading-4">{etiqueta}</span>
    </button>
  );
}

/** Dos líneas grises del alto que tendrá el texto. Ni spinner ni «Cargando…». */
function Esqueleto() {
  return (
    <div className="flex flex-col gap-1.5" aria-label="Preparando tu resumen" role="status">
      <span className="h-3 w-full animate-pulse rounded bg-muted" />
      <span className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      <span className="h-3 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

/**
 * La frase, con cada importe en semibold.
 *
 * THE FLAGS ARE GONE AND THE AMOUNTS ARE MARKED INSTEAD -- the owner's
 * request of 2026-10-31: «Elimina las banderas de los saldos en el asistente,
 * marca los saldos». Semibold is two weights above the regular body, as he
 * asked.
 *
 * WHAT THIS DISPLACES, kept here in case it is ever reversed: on 2026-10-30
 * he had asked for a flag before every amount, because the summary mixes two
 * books in one sentence and «$» is both the dollar and the Colombian peso.
 * The symbol is enough on its own because a business is EITHER Venezuelan
 * («$» dollar, «€» euro, «Bs.» bolívar) OR Colombian (pesos only), so the
 * two «$» never meet in the same summary.
 *
 * `whitespace-nowrap` so an amount never breaks across lines between its
 * symbol and its digits.
 */
function ConImportes({ frase }: { frase: string }) {
  return (
    <>
      {partirPorImportes(frase).map((t, i) =>
        t.moneda ? (
          <span key={i} className="whitespace-nowrap font-semibold">
            {t.texto}
          </span>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </>
  );
}
