"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2, RotateCw, TriangleAlert, Sparkles, Camera, CircleAlert } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { TiraDeFotos } from "@/components/import/tira-de-fotos";
import { ModalDeMoneda } from "@/components/import/modal-de-moneda";
import { isoDeLaFecha } from "@/lib/fecha-de-libreta";
import { construirAjuste } from "@/lib/ajuste-de-libreta";
import {
  asignarLineaSuelta,
  asignarTodasLasSueltas,
  motivoDeLineasPendientes,
  nombresParaAsignar,
  pendientesDeResolver,
  esLineaSuelta,
  separarLineasSueltas,
} from "@/lib/lineas-sueltas";
import { LineasSueltas } from "@/components/import/lineas-sueltas";
import { BotonDeshacer } from "@/components/import/boton-deshacer";
import { empujar, sacar, type Instantanea } from "@/lib/historial-de-revision";
import {
  ConfirmarEmparejamiento,
  ListaDeCandidatos,
} from "@/components/import/emparejar-cliente";
import {
  cargarRevision,
  guardarRevision,
  olvidarRevision,
} from "@/lib/revision-guardada";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from "@/components/ui/attachment";
import { useImportJobs, type ImportJobStatus } from "@/components/import/import-context";
import { reconcileMovements, agruparPorCliente, seParecen } from "@/lib/reconcile";
import { MAX_IMPORT_PHOTOS } from "@/lib/config";
import { type ExtractedMovement, type LedgerCurrency } from "@/lib/types";
import { confirmImport, type ImportRow } from "@/app/(app)/import/actions";
import {
  DetalleDelCliente,
  type DecisionDeTotal,
  type EleccionDeTotal,
  type EntradaDelHistorial,
} from "@/components/import/detalle-del-cliente";
import {
  RevisarClientes,
  conEstado,
  type ClienteConEstado,
  type DecisionDuplicado,
  type EntradaDeLaRevision,
} from "@/components/import/revisar-clientes";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { useTrampaDeAtras } from "@/hooks/use-trampa-de-atras";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";

// Lo que dice el diálogo al intentar salir con una libreta a medias. No
// menciona "guardar" porque aquí guardar es importar veintitantos movimientos,
// y eso tiene su propia confirmación: el diálogo de salida solo ofrece
// quedarse o irse.
const TEXTO_SALIR_DE_LA_REVISION = {
  titulo: "¿Salir sin subir la libreta?",
  cuerpo:
    "Tienes movimientos leídos que todavía no se han guardado. Si sales ahora se pierden, junto con las correcciones que hayas hecho.",
};
import { ConfirmarImportacion } from "@/components/import/confirmar-importacion";
import { PasosImportar } from "@/components/dashboard/pasos-importar";

import type { CandidatoDuplicado, ClienteRevisado, LibroDelCliente, ReconcileClient } from "@/lib/reconcile";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import type { OwnerCountry } from "@/lib/types";

type ExistingClient = ReconcileClient;

// LA NOTA DEL DUEÑO, y solo se escribe en un caso.
//
// Cuando el dueño lee "la suma da $30 y tu cuenta en libreta da $99" y decide
// importarlo así de todas formas, esa decisión no se deduce de ninguna columna:
// desaparece al cerrar la pantalla. Tres meses después el cliente reclama y
// nadie —tampoco el dueño— puede distinguir un desajuste que se miró y se
// aceptó de uno que nadie vio nunca. Ver la migración 074.
//
// Se marca SOLO la línea desajustada, no las demás de esa página. Es la que
// lleva la prueba —las dos cifras—, y estampar la misma frase en las ocho
// líneas de la libreta convierte un dato en ruido: ocho avisos idénticos se leen
// como decoración, y el que de verdad importa se pierde entre ellos.
//
// "Creado a través de Subir libreta" NO se guarda aquí: se deduce de
// `source = 'photo_import'` y `created_at`, y la lista de movimientos ya lo
// pinta ("· de libreta"). Guardarlo otra vez sería un segundo sitio libre de
// contradecir al primero.
const NOTA_DE_AJUSTE =
  "Esta línea la agregó Sevenz al subir la libreta, porque el dueño dijo que el total escrito a mano era el bueno y los montos leídos no llegaban a él.";

function notaDeDesajuste(r: {
  review_reason: string | null;
  read_balance: number | null;
  page_balance: number;
  currency: LedgerCurrency | null;
}): string | null {
  if (r.review_reason !== "no_cuadra" || r.read_balance === null) return null;
  const importe = (n: number) =>
    r.currency ? formatDisplayCurrency(n, r.currency) : formatCurrency(n);
  return `Importado aunque la suma no cuadraba: tu libreta decía ${importe(r.read_balance)} y con estos montos daba ${importe(r.page_balance)}.`;
}

const ATTACHMENT_STATE: Record<ImportJobStatus, "uploading" | "processing" | "done" | "error"> = {
  queued: "uploading",
  processing: "processing",
  done: "done",
  error: "error",
};

const STATUS_LABEL: Record<ImportJobStatus, string> = {
  queued: "En cola...",
  processing: "Leyendo con IA...",
  done: "Listo",
  error: "Error",
};

export function ImportFlow({
  existingClients,
  ownerCountry,
  rateContext,
}: {
  existingClients: ExistingClient[];
  // Solo para la línea de bolívares del resumen de confirmación. Null en un
  // negocio colombiano, y también en uno venezolano sin tasa todavía: entonces
  // el resumen no pinta esa línea, nunca se inventa una tasa.
  rateContext: MovementRateContext | null;
  // Nunca null: la página no monta este componente si no pudo leer el país,
  // porque sin él no se sabe si las filas llevan moneda. Tipado así a
  // propósito, para que el valor por defecto silencioso no pueda volver.
  ownerCountry: string;
}) {
  const router = useRouter();
  // Only a VE owner has a currency to choose. A CO owner's ledger has no
  // currency dimension at all — null means COP — so showing them a selector
  // would invent a decision they don't have.
  const showCurrency = ownerCountry === "VE";
  // Narrowed once here: the page hands this down as a plain string.
  const country: OwnerCountry = ownerCountry === "VE" ? "VE" : "CO";
  const { jobs, isProcessing, startImport, removeJob, clearJobs } = useImportJobs();
  const [confirming, setConfirming] = useState(false);
  // Cuenta pausada: se para ANTES de la foto. Escanearla gasta cuota de
  // Gemini y veinte minutos de revision para nada.
  const guardia = useGuardiaDeCuentaPausada();
  // El borrador de una revisión a medias, leído una sola vez al montar.
  //
  // NO SE ENTRA SOLO EN LA REVISIÓN. Se ofrece, con un aviso en la pantalla de
  // subir. Meter al dueño de golpe en una revisión que él no acaba de abrir es
  // desconcertante —sobre todo si volvió para subir OTRA libreta— y además
  // obligaría a tocar `setRevisando` y `setDirty` desde un efecto, que es justo
  // el patrón que esta base de código ya tiene prohibido.
  const borrador = useMemo(() => cargarRevision(), []);
  const [borradorDescartado, setBorradorDescartado] = useState(false);

  const [reviewMovements, setReviewMovements] = useState<ExtractedMovement[] | null>(null);
  const { setDirty, guard } = useUnsavedChangesGuard();
  const { setRevisando } = useRevisionEnCurso();
  // El botón atrás del teléfono y el gesto de deslizar: la salida más probable
  // en un móvil, y la única que no pasa por ningún onClick nuestro.
  const consumirCentinela = useTrampaDeAtras(reviewMovements !== null, guard);

  // Entrar y salir de la revisión, en un solo sitio. Los tres estados van
  // juntos siempre —hay filas, hay que avisar al salir, la barra se esconde—
  // y separarlos es cómo uno se queda desincronizado: una barra escondida sin
  // nada que revisar, o un aviso de "sin guardar" cuando ya se guardó.
  function abrirRevision(movimientos: ExtractedMovement[]) {
    setReviewMovements(movimientos);
    setRevisando(true);
    setDirty(true, undefined, consumirCentinela, TEXTO_SALIR_DE_LA_REVISION);
    // La moneda se pregunta al entrar, no al final. Un negocio colombiano no
    // tiene esta pregunta: su libro no lleva moneda.
    if (showCurrency) setModalMoneda(true);
  }

  function cerrarRevision() {
    // La revisión terminó —se subió o se salió—, así que el borrador sobra.
    olvidarRevision();
    // Y hay que taparlo también en memoria. `borrador` es un `useMemo` del
    // montaje: vaciar `sessionStorage` no lo borra, así que el render que viene
    // justo antes del `router.push("/dashboard")` —ya sin revisión y sin
    // fotos— cumplía las cuatro condiciones del banner y ofrecía "Seguir con
    // esa revisión" encima de los movimientos que se acababan de guardar.
    // Tocarlo habría sido subir la libreta dos veces. Visto en dev el
    // 2026-10-01, tras subir un lote de 7 completo.
    setBorradorDescartado(true);
    setReviewMovements(null);
    setRevisando(false);
    setDirty(false);
    setModalMoneda(false);
    setEliminados(new Set());
    setClientesQuitados({});
  }

  // "Every row is the same person" — for an owner who photographs one client's
  // pages rather than a page of many clients.
  //
  // It has to rewrite the NAME as well as the document, not just the document.
  // confirmImport groups new clients by name and refuses a cédula that is
  // already taken, so one document across two spellings of one person ("Ana
  // Torres" on one page, "A. Torres" on the next) would create the first
  // client and then fail on the second — halfway through, with movements
  // already saved. One client means one name and one document.
  const [sameClient, setSameClient] = useState(false);
  const [sharedName, setSharedName] = useState("");
  const [sharedDocument, setSharedDocument] = useState("");
  const [sharedWhatsapp, setSharedWhatsapp] = useState("");
  // A page usually holds one client but can mix, so the shared value is a
  // default rather than a rule: any row can opt out and keep its own client.
  // Keyed by uid, not position — deleting a row would otherwise hand its
  // opt-out to whichever row moved up into its place.
  const [unlinked, setUnlinked] = useState<Set<string>>(new Set());

  // Los `uid` de los movimientos que el dueno quito. Siguen en
  // `reviewMovements` para poder recuperarlos desde el historial, en su sitio
  // y sin prisa; se filtran antes de calcular nada.
  const [eliminados, setEliminados] = useState<Set<string>>(new Set());
  // Por cliente quitado, los renglones que se llevo POR DELANTE esa
  // eliminacion — no todos los suyos. Es lo que permite devolverlos al
  // recuperarlo sin resucitar lo que el dueno habia quitado aparte.
  const [clientesQuitados, setClientesQuitados] = useState<Record<string, string[]>>({});


  const doneJobs = jobs.filter((j) => j.status === "done");
  const errorJobs = jobs.filter((j) => j.status === "error");
  const hasJobs = jobs.length > 0;

  // Applied on top of what was read, never written back into it, so unticking
  // the box restores the original names and documents instead of losing them.
  const movimientosVivos = useMemo(() => {
    if (!reviewMovements) return null;
    // Los quitados salen de aqui: para los saldos, las sumas y el resumen no
    // existen. Siguen en `reviewMovements` solo para poder recuperarlos.
    const vivos = reviewMovements.filter((m) => !m.uid || !eliminados.has(m.uid));
    if (!sameClient) return vivos;
    return vivos.map((m) =>
      // An opted-out row keeps exactly what was read, because the override is
      // applied here and never written back into reviewMovements. Re-linking it
      // restores the shared value; unticking the box restores every original.
      m.uid && unlinked.has(m.uid)
        ? m
        : {
            ...m,
            client_name: sharedName,
            document_id: sharedDocument.trim() || null,
            whatsapp: sharedWhatsapp.trim() || null,
          },
    );
  }, [reviewMovements, eliminados, sameClient, sharedName, sharedDocument, sharedWhatsapp, unlinked]);

  // CT-25: LAS LINEAS SIN CLIENTE SALEN DE LA TUBERIA, NO DE LA LIBRETA.
  //
  // `/api/extract` ya no las tira (ver el comentario de `parseExtractionResponse`),
  // asi que llegan aqui con `client_name` vacio. No pueden entrar en
  // `reconcileMovements`: alli el nombre ES la clave de agrupacion, y una clave
  // vacia fabrica una tarjeta sin nombre con los saldos de varias personas
  // mezclados. Van a su propia seccion, arriba, y vuelven a la tuberia en cuanto
  // alguien les pone nombre.
  //
  // "Todos el mismo cliente" las rescata gratis: `movimientosVivos` ya escribio
  // el nombre compartido en todas, asi que a esta altura ninguna esta suelta.
  const lineasSueltas = useMemo(
    () => (movimientosVivos ? separarLineasSueltas(movimientosVivos).sueltas : []),
    [movimientosVivos],
  );
  const movimientosBase = useMemo(
    () => (movimientosVivos ? separarLineasSueltas(movimientosVivos).conCliente : null),
    [movimientosVivos],
  );

  // Las sueltas que el dueno QUITO. Se siguen enseniando, en gris y con su boton
  // de recuperar, igual que un renglon quitado dentro de una tarjeta.
  //
  // Sin esto, quitar una suelta seria el unico borrado irreversible y sin rastro
  // de toda la pantalla: no vuelve a la seccion —ya no cuenta como pendiente— y
  // tampoco tiene una tarjeta donde aparecer en rojo, porque justamente lo que
  // le falta es un cliente. Un dueno que se equivoca de boton pierde el renglon
  // y no se entera.
  const sueltasQuitadas = useMemo(
    () =>
      (reviewMovements ?? []).filter(
        (m) => esLineaSuelta(m) && Boolean(m.uid) && eliminados.has(m.uid!),
      ),
    [reviewMovements, eliminados],
  );

  // Los nombres que se le ofrecen: primero los de ESTA tanda de fotos, que son
  // los que tiene delante, y despues los que ya tiene guardados en Sevenz.
  const nombresParaLasSueltas = useMemo(
    () =>
      nombresParaAsignar({
        movimientos: movimientosBase ?? [],
        clientesDeSevenz: existingClients,
      }),
    [movimientosBase, existingClients],
  );

  // Lo que queda por resolver antes de poder subir nada: lineas sin cliente y
  // lineas sin monto. Se cuentan sobre los renglones VIVOS —un quitado ya esta
  // resuelto, el dueno lo descarto a proposito.
  const pendientesDeLineas = useMemo(
    () => pendientesDeResolver(movimientosVivos ?? []),
    [movimientosVivos],
  );
  const hayLineasSinResolver =
    pendientesDeLineas.sinCliente > 0 || pendientesDeLineas.sinMonto > 0;

  const [decisiones, setDecisiones] = useState<Record<string, DecisionDuplicado>>({});
  // CT-29. `listaAbierta` es el nameKey cuya lista de candidatos esta abierta;
  // `porConfirmar` es el emparejamiento esperando confirmacion. Separados porque
  // el dialogo sale TAMBIEN sin pasar por la lista, cuando el candidato es uno.
  const [listaAbierta, setListaAbierta] = useState<string | null>(null);
  const [porConfirmar, setPorConfirmar] = useState<
    { nameKey: string; candidato: CandidatoDuplicado } | null
  >(null);

  const clientesSinLosDescartados = useMemo(
    () =>
      // CT-29: "es otra persona" descarta a TODOS los que se parecian, no solo
      // al de grafia identica. Con dos fichas candidatas, dejar una dentro la
      // volveria a emparejar por nombre y la decision no serviria de nada.
      existingClients.filter(
        (c) =>
          !Object.entries(decisiones).some(
            ([nameKey, d]) => d?.cual === "otra" && seParecen(c.name, nameKey),
          ),
      ),
    [existingClients, decisiones],
  );

  // Los emparejamientos explicitos, por nameKey. Van a `reconcileMovements`
  // porque mandan sobre el nombre: es lo unico que puede unir "Karina castillo"
  // con la ficha "Karina castillo (kari)".
  const emparejados = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [nameKey, d] of Object.entries(decisiones)) {
      if (d?.cual === "mismo") salida[nameKey] = d.clientId;
    }
    return salida;
  }, [decisiones]);

  // Los `nameKey` que ya entraron en la base con su propio boton. La tarjeta se
  // queda en su sitio para ver lo que llevas hecho; lo que desaparece es la
  // posibilidad de volver a subirlos.
  const [subidos, setSubidos] = useState<Set<string>>(new Set());
  const [decisionesDeTotal, setDecisionesDeTotal] = useState<
    Record<string, DecisionDeTotal | undefined>
  >({});

  // Se guarda en cada cambio mientras haya revisión abierta. Escribir en
  // `sessionStorage` no es `setState`, así que el efecto no entra en la regla
  // que prohíbe lo otro.
  useEffect(() => {
    if (!reviewMovements) return;
    guardarRevision({
      revisada: true,
      movimientos: reviewMovements,
      eliminados: [...eliminados],
      clientesQuitados,
      decisiones,
      decisionesDeTotal,
      subidos: [...subidos],
      sameClient,
      sharedName,
      sharedDocument,
      sharedWhatsapp,
      unlinked: [...unlinked],
    });
  }, [
    reviewMovements,
    eliminados,
    clientesQuitados,
    decisiones,
    decisionesDeTotal,
    subidos,
    sameClient,
    sharedName,
    sharedDocument,
    sharedWhatsapp,
    unlinked,
  ]);

  // CT-26: GUARDAR LA LECTURA, NO SOLO LA REVISION.
  //
  // El efecto de arriba arranca con `if (!reviewMovements) return;`, asi que
  // entre que la pantalla dice "Listo · N movimientos" y que el dueno toca "Ver
  // resultados" no habia nada guardado — y a esas alturas la peticion a la IA ya
  // se gasto. Recargar ahi, o que iOS recicle la pestana en segundo plano,
  // obligaba a subir la misma foto otra vez y a pagar una segunda lectura.
  //
  // Navegar a otra pantalla nunca estuvo en riesgo: `ImportProvider` vive en el
  // layout de `(app)` y los trabajos sobreviven a un cambio de ruta. Lo que esto
  // cubre es la recarga y el reciclado de pestana.
  //
  // Se marca `revisada: false` para que el aviso no mienta: no hubo revision ni
  // correcciones que recuperar, solo la lectura.
  useEffect(() => {
    if (reviewMovements) return;
    if (confirming || isProcessing) return;
    const leidos = jobs.filter((j) => j.status === "done").flatMap((j) => j.movements);
    if (leidos.length === 0) return;
    guardarRevision({
      revisada: false,
      movimientos: leidos,
      eliminados: [],
      clientesQuitados: {},
      decisiones: {},
      decisionesDeTotal: {},
      subidos: [],
      sameClient: false,
      sharedName: "",
      sharedDocument: "",
      sharedWhatsapp: "",
      unlinked: [],
    });
  }, [jobs, reviewMovements, confirming, isProcessing]);

  // Retomar lo que quedó a medias. Las fotos NO vuelven —no se guardan—, así
  // que la tira sale vacía y el contador de fotos dice cero; lo que vuelve es
  // el trabajo manual, que es lo que costaba media hora.
  function retomarBorrador() {
    if (!borrador) return;
    setEliminados(new Set(borrador.eliminados));
    setClientesQuitados(borrador.clientesQuitados);
    // Un borrador de antes de CT-29 guardaba "mismo" | "otra" en texto plano.
    // "otra" sigue significando lo mismo; "mismo" ya no basta —no dice con cual—
    // asi que se descarta y la pregunta vuelve a salir. Es lo honesto: mejor
    // preguntar otra vez que emparejar con una ficha que nadie eligio.
    setDecisiones(
      Object.fromEntries(
        Object.entries(borrador.decisiones ?? {}).flatMap(([k, d]): [string, DecisionDuplicado][] => {
          if (d === "otra") return [[k, { cual: "otra" }]];
          if (d === "mismo") return [];
          if (d?.cual === "otra") return [[k, { cual: "otra" }]];
          if (d?.cual === "mismo" && d.clientId) return [[k, { cual: "mismo", clientId: d.clientId }]];
          return [];
        }),
      ),
    );
    setDecisionesDeTotal(borrador.decisionesDeTotal as Record<string, DecisionDeTotal | undefined>);
    setSubidos(new Set(borrador.subidos));
    setSameClient(borrador.sameClient);
    setSharedName(borrador.sharedName);
    setSharedDocument(borrador.sharedDocument);
    setSharedWhatsapp(borrador.sharedWhatsapp);
    setUnlinked(new Set(borrador.unlinked));
    abrirRevision(borrador.movimientos);
  }


  // ── EL AJUSTE ES DERIVADO, NO GUARDADO ────────────────────────────────
  //
  // Antes se creaba una vez al elegir "mi libreta" y se metia en
  // `reviewMovements` como una fila mas. A partir de ahi nadie lo volvia a
  // tocar: corregir un monto despues dejaba la linea en su importe viejo, y se
  // importaba una deuda que no era la que el dueno habia aceptado. Medido en
  // dev el 2026-10-01: ajuste de +25 sobre una libreta que decia 95, se corrige
  // un renglon y acaba subiendo 100.
  //
  // Ahora no se guarda: se CALCULA en cada render a partir de la decision y de
  // los renglones que hay en ese momento. Una cifra derivada no puede quedarse
  // vieja, que es la unica forma de que esto no vuelva a pasar.
  //
  // EL LIBRO SOMBRA se reconcilia sobre los renglones SIN los ajustes. Hace
  // falta porque `escrito`/`calculado` salen del ultimo total escrito de la
  // pagina, y en cuanto el ajuste entra ese total pasa a cuadrar — que es su
  // proposito. El libro normal deja de saber cuanto era el desajuste; la sombra
  // no se entera del ajuste y por eso sigue sabiendolo.
  const librosSombra = useMemo(() => {
    const porClave = new Map<string, LibroDelCliente>();
    if (!movimientosBase) return porClave;
    const clientes = agruparPorCliente(
      reconcileMovements(movimientosBase, clientesSinLosDescartados, emparejados),
      clientesSinLosDescartados,
      { esVE: showCurrency },
    );
    for (const c of clientes) {
      for (const l of c.libros) porClave.set(`${c.nameKey}|${l.currency ?? "COP"}`, l);
    }
    return porClave;
  }, [movimientosBase, clientesSinLosDescartados, showCurrency, emparejados]);

  // Un ajuste por cliente que haya dicho que manda su libreta, con el importe
  // que hace falta AHORA. El uid se deriva de la clave en vez de sortearse:
  // asi es estable entre renders sin guardar nada, y la fila no se remonta sola.
  const ajustesDerivados = useMemo(() => {
    const salida = new Map<string, { movimiento: ExtractedMovement; indice: number }>();
    if (!movimientosBase) return salida;
    for (const [clave, decision] of Object.entries(decisionesDeTotal)) {
      if (decision?.cual !== "libreta") continue;
      const sombra = librosSombra.get(clave);
      if (!sombra) continue;
      const nombre = clave.slice(0, clave.lastIndexOf("|"));
      const cliente = movimientosBase.find(
        (m) => (m.client_name ?? "").trim().toLowerCase() === nombre,
      );
      if (!cliente) continue;
      const construido = construirAjuste({
        movimientos: movimientosBase,
        nombreDelCliente: cliente.client_name,
        libro: sombra,
        uid: `ajuste:${clave}`,
      });
      if (construido) salida.set(clave, construido);
    }
    return salida;
  }, [movimientosBase, decisionesDeTotal, librosSombra]);

  const uidsDeAjuste = useMemo(
    () => new Set([...ajustesDerivados.values()].map((a) => a.movimiento.uid!)),
    [ajustesDerivados],
  );

  // Los renglones con los ajustes ya dentro, en su sitio. Es lo que ve todo lo
  // de abajo: las filas, los saldos, el resumen y lo que se sube.
  // Lo mismo pero sobre `reviewMovements`, que conserva los renglones QUITADOS
  // para poder pintarlos en rojo en su sitio.
  //
  // Hace falta porque el historial se recorre sobre `reviewMovements`: sin esto
  // el ajuste contaba en los totales pero no salia en la lista. Visto al probar
  // el arreglo, el 2026-10-01.
  //
  // Desde CT-27 los ajustes van todos al final, asi que aqui basta con
  // concatenar: ya no hay que colocarlos por el UID de un ancla. La lista se
  // filtra por cliente antes de pintarse, asi que "al final de todo" es "al
  // final de lo suyo" en cuanto se ve.
  const movimientosConAjustes = useMemo(() => {
    if (!reviewMovements) return null;
    if (ajustesDerivados.size === 0) return reviewMovements;
    return [...reviewMovements, ...[...ajustesDerivados.values()].map((a) => a.movimiento)];
  }, [reviewMovements, ajustesDerivados]);

  const effectiveMovements = useMemo(() => {
    if (!movimientosBase) return null;
    if (ajustesDerivados.size === 0) return movimientosBase;
    // De mayor a menor indice para que insertar uno no desplace al siguiente.
    const copia = [...movimientosBase];
    const porIndice = [...ajustesDerivados.values()].sort((a, b) => b.indice - a.indice);
    for (const a of porIndice) copia.splice(a.indice, 0, a.movimiento);
    return copia;
  }, [movimientosBase, ajustesDerivados]);

  // Una reconciliación contra la lista COMPLETA de clientes, y su único trabajo
  // es detectar los candidatos de CT-22. No se usa para nada más: las filas de
  // verdad son `filas`, abajo, que ya aplican la decisión del dueño.
  //
  // Tiene que ser contra la lista completa o la tarjeta desaparecería en cuanto
  // se pulsara "es otra persona", y con ella la posibilidad de cambiar de idea.
  const filasParaCandidatos = useMemo(
    () => (effectiveMovements ? reconcileMovements(effectiveMovements, existingClients) : []),
    [effectiveMovements, existingClients],
  );

  // ── CT-22: quién es quién, y lo decide el dueño ─────────────────────────
  //
  // `matched_client_id` empareja por NOMBRE. Hasta ahora ese id viajaba a
  // `confirmImport` sin que nadie confirmara nada, así que dos "María González"
  // distintas acababan en una sola ficha, sin aviso y sin vuelta atrás.
  //
  // Ahora el emparejamiento es un CANDIDATO. Mientras haya alguno sin decidir,
  // la confirmación se bloquea igual que con una cédula que falta.
  const duplicados = useMemo(
    () =>
      agruparPorCliente(filasParaCandidatos, existingClients, { esVE: showCurrency }).filter(
        (c) => c.candidatos.length > 0,
      ),
    [filasParaCandidatos, existingClients, showCurrency],
  );
  // Qué cliente está abierto en el detalle. `null` = la lista.
  const [abierto, setAbierto] = useState<string | null>(null);
  const sinDecidir = duplicados.some((c) => !decisiones[c.nameKey]);

  // LA DECISIÓN ENTRA EN LA RECONCILIACIÓN, no se parchea después.
  //
  // El primer intento fue corregir las filas ya reconciliadas —poner
  // `matched_client_id` en null y `needs_document_id` en true—, y se quedaba
  // corto en dos sitios a la vez: el saldo previo de ese cliente seguía sumado
  // en `computed_balance`, así que el diálogo de confirmación enseñaba "cómo
  // queda" con la deuda de OTRA persona dentro; y la comprobación de sumas
  // seguía deduciendo la base como si el cliente existiera.
  //
  // Quitarlo de la lista de clientes existentes lo arregla de una vez: reconcile
  // vuelve a calcularlo todo sin ese emparejamiento, y las cuatro cosas
  // —matched_client_id, needs_document_id, computed_balance y la base— salen
  // solas. Un cliente nuevo es un cliente nuevo en todo, no en dos campos.
  const filas = useMemo(
    () =>
      effectiveMovements
        ? reconcileMovements(effectiveMovements, clientesSinLosDescartados, emparejados)
        : [],
    [effectiveMovements, clientesSinLosDescartados, emparejados],
  );

  // A client without a cédula/documento on file must get one before the
  // import can be confirmed — same requirement as the manual "Registrar
  // cliente nuevo" form, just applied per row here.
  const missingDocumentId = filas.some((r) => r.needs_document_id && !r.document_id?.trim());
  // La vista por cliente que pinta la lista. Se calcula sobre `filas` —las que
  // ya aplican la decisión del dueño sobre los repetidos— y no sobre
  // `filasParaCandidatos`, que solo existe para detectarlos contra la lista
  // completa de clientes.
  // LA MISMA LISTA FILTRADA QUE `filas`, y no la completa.
  //
  // Pasarle `existingClients` era un fallo de verdad, visto en dev el
  // 2026-09-28: al decir "es otra persona", `filas` sí dejaba de emparejar —así
  // que la importación seguía bloqueada por la cédula que falta— pero esta vista
  // seguía encontrando al cliente viejo por nombre, y por tanto decía
  // `necesitaDocumento: false`. Resultado: la tarjeta NO pintaba el aviso rojo
  // de "Falta la cédula" y el botón de guardar estaba deshabilitado sin ninguna
  // explicación en pantalla. Un callejón sin salida.
  //
  // Y los `libros` heredaban el mismo error: `saldoPrevio` y "queda debiendo"
  // salían con la deuda de la OTRA persona dentro.
  const clientesRevisados = useMemo(
    () => agruparPorCliente(filas, clientesSinLosDescartados, { esVE: showCurrency }),
    [filas, clientesSinLosDescartados, showCurrency],
  );

  // El candidato, en cambio, SÍ sale de la lista completa: es lo único que
  // sobrevive a la decisión, porque es lo que permite cambiar de idea. Sin esto
  // la tarjeta desaparecería en cuanto se pulsara "es otra persona" y con ella
  // los dos botones.
  const candidatos = useMemo(
    () => new Map(duplicados.map((c) => [c.nameKey, c.candidatos])),
    [duplicados],
  );
  // EL NOMBRE QUE LE TOCA A UN MOVIMIENTO. Con el cliente compartido activo el
  // nombre visible es el compartido, salvo que esa linea se haya desvinculado.
  function nombreVisible(m: ExtractedMovement): string {
    return (sameClient && m.uid && !unlinked.has(m.uid) ? sharedName : m.client_name).trim();
  }

  // LA LISTA DE LA REVISION, con los clientes quitados EN SU SITIO.
  //
  // El orden sale de `reviewMovements`, que conserva a todos; `clientesRevisados`
  // ya no ve a los quitados, asi que por si solo perderia su posicion y la fila
  // roja acabaria al final, lejos de donde estaba la persona.
  function entradasDeLaRevision(conEstadoYa: ClienteConEstado[]): EntradaDeLaRevision[] {
    const vivos = new Map(conEstadoYa.map((c) => [c.nameKey, c]));
    const orden: string[] = [];
    const nombres = new Map<string, string>();
    for (const m of movimientosConAjustes ?? []) {
      const nombre = nombreVisible(m);
      // CT-25: las lineas sin cliente no son un cliente. Sin este corte su
      // nombre vacio entraba aqui como una clave mas y, al no encontrarla entre
      // los vivos, la lista pintaba una tarjeta fantasma "Cliente eliminado"
      // justo encima de las de verdad. Visto en dev el 2026-10-01.
      if (!nombre.trim()) continue;
      const k = nombre.toLowerCase();
      if (!nombres.has(k)) {
        nombres.set(k, nombre);
        orden.push(k);
      }
    }
    return orden.map((k) => {
      const vivo = vivos.get(k);
      return vivo
        ? ({ tipo: "cliente", cliente: vivo } as const)
        : ({ tipo: "eliminado", nameKey: k, nombre: nombres.get(k) ?? k } as const);
    });
  }

  // EL HISTORIAL DE UN CLIENTE, con sus quitados intercalados EN SU SITIO.
  //
  // Se recorre `reviewMovements` —que conserva el orden de la libreta y sigue
  // teniendo los quitados— en vez de `filas`, que ya no los ve. Sin esto los
  // renglones en rojo tendrian que pintarse al final, y entonces el dueno no
  // sabria cual de los cuatro "Bulto de jabon" fue el que quito.
  function entradasDelHistorial(nameKey: string) {
    const porId = new Map(filas.map((f) => [f.rowId, f]));
    const salida: EntradaDelHistorial[] = [];
    for (const m of movimientosConAjustes ?? []) {
      if (!m.uid) continue;
      const viva = porId.get(m.uid);
      if (viva) {
        if (viva.client_name.trim().toLowerCase() === nameKey) {
          salida.push({ tipo: "fila", fila: viva });
        }
        continue;
      }
      // Quitada. Su nombre sale del movimiento crudo: no paso por reconcile, y
      // con el cliente compartido activo el nombre visible es el compartido.
      const suNombre = nombreVisible(m).toLowerCase();
      if (eliminados.has(m.uid) && suNombre === nameKey) {
        salida.push({ tipo: "eliminado", mov: m });
      }
    }
    return salida;
  }

  // El cliente abierto en el detalle, resuelto una vez. `abierto` es una clave
  // de nombre y el cliente puede desaparecer de la lista mientras el panel está
  // abierto —al borrar su último movimiento, o al decidir "es otra persona"—, y
  // entonces esto pasa a `undefined` y el panel se cierra solo en vez de quedar
  // abierto y vacío.
  const clienteAbierto = clientesRevisados.find((c) => c.nameKey === abierto);

  // A blank shared name would create a nameless client, so it blocks the same
  // way a missing cédula does — but only while at least one row still uses it.
  // Opting every row out leaves the field unused, and blocking on an unused
  // field is the kind of dead end that has no explanation on screen.
  const someRowLinked = filas.some((r) => !unlinked.has(r.rowId));
  const missingSharedName = sameClient && someRowLinked && !sharedName.trim();
  // Antes las filas nacían en USD. Era el valor por defecto más común y estaba
  // a la vista, pero nada obligaba a mirarlo: una libreta llevada en euros,
  // confirmada de corrido, entraba entera en el libro de dólares — y un
  // movimiento en el libro que no es no da error, se ve bien y cuadra consigo
  // mismo hasta que el cliente reclama.
  //
  // Ahora nacen sin moneda y esto bloquea la confirmación. Un clic en "Todo en
  // USD/EUR" lo resuelve para la tanda entera, que es el camino normal; el
  // selector por fila sigue ahí para la libreta que mezcla.
  const missingCurrency = showCurrency && filas.some((r) => !r.currency);

  // Cuál de las dos monedas marca el radio. Sale de las filas y no de un
  // estado aparte: las filas son la verdad y se pueden cambiar de una en una.
  // Si todas coinciden, esa; si la libreta mezcla —o si todavía no se ha
  // elegido, que es todas en null—, ninguna.
  const monedasEnUso = new Set(filas.map((r) => r.currency));
  const monedaDeLaLibreta = monedasEnUso.size === 1 ? [...monedasEnUso][0] : null;

  // Una sola definición de "no se puede guardar todavía", porque ahora hay DOS
  // botones que la preguntan —el del pie y el de la cabecera— y que discrepen
  // sería un botón que guarda una tanda que el otro considera incompleta.
  // QUÉ es lo que impide guardar, en una frase, y en el mismo sitio que el
  // botón que no se puede pulsar. Antes estos mensajes vivían sueltos encima
  // del pie de la pantalla, así que con la lista larga el dueño veía un botón
  // apagado arriba y su explicación fuera de la vista.
  //
  // Uno solo y por orden: enseñar los cuatro a la vez no dice por dónde
  // empezar, y arreglado el primero aparece el siguiente.
  // LO QUE QUEDA POR SUBIR. De aqui salen el contador del boton del lote, el
  // resumen de encima y a quien sube ese boton: tres cifras que si se calcularan
  // por separado acabarian discrepando.
  const pendientes = clientesRevisados.filter((c) => !subidos.has(c.nameKey));
  const estadosPendientes = conEstado(pendientes, filas, decisiones, candidatos, {
    exigeMoneda: showCurrency,
    subidos,
    hayLineasSinResolver,
  });
  const listosParaSubir = estadosPendientes.filter((c) => c.puedeSubir);
  const sinCompletar = estadosPendientes.length - listosParaSubir.length;
  // El contador cuenta MOVIMIENTOS, y solo los que de verdad van a entrar: a
  // medida que se suben clientes, baja.
  //
  // Y las filas salen de aquí también, no de `filas` entero, porque el resumen
  // de la confirmación es la cuarta cifra que el comentario de arriba avisaba
  // que acabaría discrepando — y discrepó. Pasarle `filas` metía en el resumen
  // a los clientes YA SUBIDOS, y encima `ResumenImportacion` suma los montos
  // de la libreta sobre el saldo que el cliente tiene ahora en Sevenz: subir a
  // Hilda sola y pulsar después el botón del lote la enseñaba por el doble
  // ($25 ya guardados + $25 de sus filas = $50), en la pantalla que pide
  // confirmar dinero. Lo que se escribía era correcto; lo que se leía, no.
  // Visto en dev el 2026-10-01.
  const filasListas = filas.filter((r) =>
    listosParaSubir.some((c) => c.nameKey === r.client_name.trim().toLowerCase()),
  );
  const movimientosListos = filasListas.length;

  // EL RESUMEN DEL PIE. Ya no dice que impide subir la tanda —eso lo dice cada
  // tarjeta, que es donde esta el cliente al que le falta—, dice cuantos quedan
  // fuera y cuantos van a entrar.
  const resumenDelPie =
    sinCompletar > 0 && listosParaSubir.length > 0
      ? `${sinCompletar} ${sinCompletar === 1 ? "cliente sin completar" : "clientes sin completar"}; se ${movimientosListos === 1 ? "subirá" : "subirán"} ${movimientosListos} ${movimientosListos === 1 ? "movimiento" : "movimientos"}.`
      : null;

  // EL ORDEN CAMBIA CUANDO YA SE PUEDE SUBIR ALGO.
  //
  // Mientras no haya nadie listo, el pie dice QUE FALTA, como siempre. Pero en
  // cuanto hay al menos un cliente completo, lo que falta ya lo dice su propia
  // tarjeta —cada una con lo suyo— y aqui lo util es cuantos quedan fuera. Dejar
  // el mensaje viejo seria contradecir al boton: "falta la cedula de uno o mas
  // clientes" encima de un boton encendido que va a subir a los otros cuatro.
  // CT-25 va PRIMERO, por delante incluso de "ya hay alguien listo": mientras
  // cuelgue una linea sin cliente no se sube nadie, asi que el pie tiene que
  // decir eso y no "3 clientes sin completar; se subiran 7 movimientos", que
  // ademas seria falso.
  const motivoQueBloquea = motivoDeLineasPendientes(pendientesDeLineas)
    ?? (listosParaSubir.length > 0
    ? resumenDelPie
    : filas.length === 0
    // Quitar al ultimo cliente deja la lista vacia y el boton apagado. Sin esta
    // frase no hay nada en pantalla que diga por que, ni que la salida es
    // "Volver" — que conserva las fotos y rehace la revision desde cero.
    ? "Quitaste todos los movimientos de esta libreta. Pulsa Volver para empezar la revisión otra vez: tus fotos siguen ahí."
    : missingSharedName
    ? "Escribe el nombre del cliente antes de continuar."
    : missingDocumentId
      ? sameClient
        ? "Falta la cédula/documento del cliente — complétala antes de continuar."
        : "Falta la cédula/documento de uno o más clientes nuevos — complétala antes de continuar."
      : sinDecidir
        ? `Dinos si ${duplicados.filter((c) => !decisiones[c.nameKey]).length === 1 ? "el cliente repetido es" : "los clientes repetidos son"} la misma persona que ya tienes, o alguien distinto.`
        : missingCurrency
          ? "Elige la moneda de la libreta antes de continuar."
          : resumenDelPie);

  // YA NO EXIGE QUE LA TANDA ENTERA ESTE PERFECTA, desde el 2026-10-01.
  //
  // Antes bastaba un cliente incompleto para apagar el boton de los seis: el
  // dueno tenia seis personas listas y no podia subir ninguna hasta resolver la
  // septima. Ahora el boton sube a TODOS los que esten completos y deja al resto
  // en la revision, asi que solo se apaga cuando no hay nadie listo.
  //
  // `missingSharedName` sigue siendo global a proposito: con "todos el mismo
  // cliente" marcado, el nombre compartido es de la tanda entera y sin el no hay
  // ningun cliente que subir.
  const noSePuedeConfirmar =
    confirming ||
    // CT-25: una linea sin cliente o sin monto bloquea la tanda ENTERA. No
    // pertenece a ninguna tarjeta todavia, asi que no hay un boton suyo que
    // apagar; y dejar subir al resto es exactamente como se pierde — el dueno
    // sube, la pantalla se vacia, y nadie vuelve a por ella.
    hayLineasSinResolver ||
    filas.length === 0 ||
    missingSharedName ||
    listosParaSubir.length === 0 ||
    // CT-22 ya no bloquea la tanda: bloquea al cliente repetido, dentro de
    // `puedeSubir`. Las dos respuestas se siguen equivocando en silencio y en
    // direcciones opuestas —una funde dos personas, la otra parte el historial
    // de una—, asi que ese cliente no se sube hasta responder; los demas si.
    false;

  function handleFilesSelected(fileList: FileList | null) {
    if (guardia()) return;
    if (!fileList) return;
    startImport(Array.from(fileList));
  }

  function handleViewResults() {
    // La moneda no sale de la extracción porque la foto no la dice. Tampoco se
    // siembra ya con un valor por defecto: la elige el dueño antes de guardar.
    abrirRevision(
      doneJobs.flatMap((j) => j.movements).map((m) => ({
        ...m,
        uid: crypto.randomUUID(),
        // null en los dos casos, con dos significados: en un negocio CO es la
        // respuesta definitiva — su libro no tiene moneda —, y en uno VE es un
        // dato que todavía falta y que missingCurrency exige antes de guardar.
        currency: null,
      })),
    );
    setUnlinked(new Set());
  }

  // A libreta is usually kept in one currency even though it can mix, so
  // setting all rows at once is the common path and the per-row select is the
  // exception — not the other way round.
  // Lo que había ANTES de la última aplicación en masa. `null` = no hay nada
  // que deshacer, y entonces el botón no se enseña: un deshacer que no deshace
  // nada es peor que ninguno.
  // CT-31. Sustituye al deshacer de un solo nivel que habia aqui para la
  // moneda: ahora aplicar moneda es un paso mas del historial, como los demas.
  const [pasado, setPasado] = useState<Instantanea[]>([]);

  // LA FOTO DEL ESTADO DE AHORA. Se llama ANTES de cambiar nada, y siempre desde
  // un manejador de evento — nunca dentro de un updater de `setState`, que React
  // puede ejecutar dos veces y dejaria dos pasos identicos en la pila.
  function recordar() {
    setPasado((prev) =>
      empujar(prev, {
        movimientos: reviewMovements ?? [],
        eliminados: [...eliminados],
        clientesQuitados,
        decisiones,
        decisionesDeTotal,
        sameClient,
        sharedName,
        sharedDocument,
        sharedWhatsapp,
        unlinked: [...unlinked],
      }),
    );
  }

  function deshacer() {
    const { pasado: resto, instantanea } = sacar(pasado);
    if (!instantanea) return;
    setPasado(resto);
    setReviewMovements(instantanea.movimientos);
    setEliminados(new Set(instantanea.eliminados));
    setClientesQuitados(instantanea.clientesQuitados);
    setDecisiones(instantanea.decisiones);
    setDecisionesDeTotal(
      instantanea.decisionesDeTotal as Record<string, DecisionDeTotal | undefined>,
    );
    setSameClient(instantanea.sameClient);
    setSharedName(instantanea.sharedName);
    setSharedDocument(instantanea.sharedDocument);
    setSharedWhatsapp(instantanea.sharedWhatsapp);
    setUnlinked(new Set(instantanea.unlinked));
  }
  const [forzarMoneda, setForzarMoneda] = useState(false);
  const [modalMoneda, setModalMoneda] = useState(false);

  // POR DEFECTO SOLO TOCA LO QUE SIGUE SIN ASIGNAR.
  //
  // Pisar todo era destructivo en silencio: si el dueño ya había corregido a
  // mano cinco clientes a euros y luego pulsaba "Todo Dólares" —algo que se
  // hace al principio, con prisa— esos cinco se perdían sin aviso. Así nunca
  // destruye trabajo, y para el caso raro de querer forzarlos está la casilla,
  // que es explícita.
  // ── LA DECISION DEL TOTAL VIAJA CON LA MONEDA ─────────────────────────
  //
  // Se guarda bajo `nombre|moneda`, asi que cambiar la moneda despues de haber
  // elegido dejaba la decision en una clave que ya nadie miraba. Medido en dev
  // el 2026-10-01, y pasaba en los dos ordenes:
  //
  //   Elijo "mi libreta" sin moneda  -> clave pedro|COP, casilla marcada, +$95
  //   Pulso Dolares                  -> clave pedro|USD, VACIA: casilla
  //                                     desmarcada sola, el ajuste desaparece
  //                                     y Pedro vuelve a deber 70.
  //
  // Y al volver a la moneda anterior la decision vieja RESUCITABA, porque
  // seguia ahi: una respuesta dada en otro contexto se reaplicaba sola.
  //
  // El dueno cambio la moneda, no su respuesta a "cual total es el correcto".
  // Asi que la decision se muda con el, y se borra de la clave vieja -- eso
  // ultimo es lo que mata la resurreccion.
  //
  // SI EL DESTINO YA TIENE DECISION, GANA LA QUE ESTABA. Pisarla seria cambiar
  // una respuesta que el dueno dio sobre ESE libro, que es lo contrario de lo
  // que se intenta arreglar aqui.
  //
  // No se muda al cambiar la moneda de UNA fila suelta (la hoja de edicion):
  // ahi el renglon cambia de libro de verdad, y la decision pertenece al libro
  // que deja atras, no al que estrena.
  // RENOMBRAR A UNA PERSONA DE LA REVISIÓN.
  //
  // Pedido el 2026-10-02: "el nombre del cliente debe poder editarse en todos
  // los casos". Y no es cosmético — el nombre ES la clave de agrupación, así que
  // renombrar junta y separa tarjetas: escribir "Karina castillo (kari)" sobre
  // un renglón que decía "Karina castillo" lo empareja con la ficha que ya
  // existe, sin pasar por el diálogo.
  //
  // POR ESO HAY QUE MUDAR LAS CLAVES. `decisiones`, `clientesQuitados` y
  // `decisionesDeTotal` van indexadas por `nameKey`: dejarlas donde estaban es
  // como se pierde una decisión ya tomada —y peor, como reaparece sobre otra
  // persona si alguien reusa el nombre viejo—. Es el mismo cuidado que
  // `mudarDecisionesDeMoneda`, y por la misma razón.
  //
  // Si la clave destino YA tiene decisión, gana la que estaba: el dueño la tomó
  // mirando a ESA tarjeta, y pisarla con la de otra sería decidir por él.
  function renombrarCliente(nameKeyViejo: string, nombreNuevo: string) {
    const limpio = nombreNuevo.trim();
    const nuevo = limpio.toLowerCase();
    if (!limpio || nuevo === nameKeyViejo) return;
    recordar();

    setReviewMovements((prev) =>
      prev
        ? prev.map((m) =>
            (m.client_name ?? "").trim().toLowerCase() === nameKeyViejo
              ? { ...m, client_name: limpio }
              : m,
          )
        : prev,
    );

    setDecisiones((prev) => {
      if (!(nameKeyViejo in prev)) return prev;
      const { [nameKeyViejo]: suya, ...resto } = prev;
      return nuevo in resto ? resto : { ...resto, [nuevo]: suya };
    });
    setClientesQuitados((prev) => {
      if (!(nameKeyViejo in prev)) return prev;
      const { [nameKeyViejo]: suyos, ...resto } = prev;
      return nuevo in resto ? resto : { ...resto, [nuevo]: suyos };
    });
    setDecisionesDeTotal((prev) => {
      const salida: typeof prev = {};
      for (const [clave, d] of Object.entries(prev)) {
        const i = clave.lastIndexOf("|");
        const suNombre = i < 0 ? clave : clave.slice(0, i);
        const moneda = i < 0 ? "" : clave.slice(i);
        const destino = suNombre === nameKeyViejo ? `${nuevo}${moneda}` : clave;
        if (destino in salida) continue;
        salida[destino] = d;
      }
      return salida;
    });

    // La hoja del detalle se identifica por nameKey: sin esto, renombrar la
    // cierra de golpe en mitad de la edición.
    setAbierto((actual) => (actual === nameKeyViejo ? nuevo : actual));
  }

  function mudarDecisionesDeMoneda(
    afectada: (m: ExtractedMovement) => boolean,
    moneda: LedgerCurrency,
  ) {
    if (!reviewMovements) return;
    // Las claves de origen salen de las monedas que las filas tienen AHORA,
    // antes de que `setReviewMovements` las cambie.
    const origenes = new Map<string, Set<string>>();
    for (const m of reviewMovements) {
      if (!afectada(m)) continue;
      const nameKey = nombreVisible(m).trim().toLowerCase();
      const suyas = origenes.get(nameKey) ?? new Set<string>();
      suyas.add(m.currency ?? "COP");
      origenes.set(nameKey, suyas);
    }
    if (origenes.size === 0) return;
    setDecisionesDeTotal((prev) => {
      const siguiente = { ...prev };
      for (const [nameKey, monedasViejas] of origenes) {
        const destino = `${nameKey}|${moneda}`;
        if (siguiente[destino]) continue;
        for (const vieja of monedasViejas) {
          const origen = `${nameKey}|${vieja}`;
          if (origen === destino) continue;
          if (siguiente[origen]) {
            siguiente[destino] = siguiente[origen];
            delete siguiente[origen];
            break;
          }
        }
      }
      return siguiente;
    });
  }

  function applyCurrencyToAll(currency: LedgerCurrency, incluirYaAjustadas = false) {
    // `setAntesDeAplicar` va FUERA del updater, por lo mismo que el toast de
    // `removeMovement`: un updater tiene que ser puro, y React puede llamarlo
    // dos veces para la misma actualización.
    if (!reviewMovements) return;
    recordar();
    mudarDecisionesDeMoneda((m) => incluirYaAjustadas || !m.currency, currency);
    setReviewMovements((prev) =>
      prev ? prev.map((m) => (incluirYaAjustadas || !m.currency ? { ...m, currency } : m)) : prev,
    );
  }



  // Por `uid` y no por posición: el detalle de un cliente recibe solo SUS
  // filas, y con índices la edición aterrizaba en otro cliente. Pasó de verdad
  // el 2026-09-28 — se tecleó una cédula en "QA No Cuadra" y apareció en "QA
  // Cuadra".
  function updateMovement(rowId: string, patch: Partial<ExtractedMovement>) {
    recordar();
    setReviewMovements((prev) =>
      prev ? prev.map((m) => (m.uid === rowId ? { ...m, ...patch } : m)) : prev,
    );
  }

  // La moneda de UN cliente, de un toque. Pisa las de sus líneas a propósito, al
  // contrario que el "Todo Dólares" de la lista: allí el dueño decide para la
  // tanda entera y no puede ver lo que ya corrigió, aquí está mirando a una
  // persona y a sus movimientos, así que pisar es lo que pidió.
  function aplicarMonedaAlCliente(rowIds: string[], moneda: LedgerCurrency) {
    if (!reviewMovements) return;
    const suyas = new Set(rowIds);
    // `recordar()` FUERA del updater: un updater tiene que ser puro y React
    // puede llamarlo dos veces para la misma actualizacion, lo que dejaria dos
    // pasos identicos en la pila.
    recordar();
    mudarDecisionesDeMoneda((m) => Boolean(m.uid && suyas.has(m.uid)), moneda);
    setReviewMovements((prev) =>
      prev ? prev.map((m) => (m.uid && suyas.has(m.uid) ? { ...m, currency: moneda } : m)) : prev,
    );
  }

  // Seeded with the name Gemini read most often, so the common case is one
  // tick and no typing. It stays editable, and the datalist of existing
  // clients is still available through the table's own matching.
  function toggleSameClient(next: boolean) {
    setSameClient(next);
    if (next && !sharedName && reviewMovements && reviewMovements.length > 0) {
      const counts = new Map<string, number>();
      for (const m of reviewMovements) {
        const n = m.client_name.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) setSharedName(best[0]);
      const withDoc = reviewMovements.find((m) => m.document_id?.trim());
      if (withDoc?.document_id) setSharedDocument(withDoc.document_id);
      const withWa = reviewMovements.find((m) => m.whatsapp?.trim());
      if (withWa?.whatsapp) setSharedWhatsapp(withWa.whatsapp);
    }
  }

  function toggleLinked(rowId: string) {
    setUnlinked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  // Quitar un movimiento, CON VUELTA ATRÁS.
  //
  // La papelera está a un toque de los campos que el dueño está corrigiendo, en
  // un teléfono, y borraba sin preguntar y sin deshacer: un roce y ese fiado
  // desaparecía de la libreta antes de llegar siquiera a Sevenz. No se pone una
  // confirmación —serían veinticinco confirmaciones en una revisión normal— sino
  // un deshacer, que no estorba a quien acierta.
  //
  // Se guarda la POSICIÓN además de la fila: el orden manda en el saldo corrido
  // y en la comprobación de sumas, así que devolverla al final en vez de a su
  // sitio cambiaría las cuentas de esa página.
  // QUITAR UN MOVIMIENTO YA NO LO BORRA: LO MARCA.
  //
  // La fila se queda en `reviewMovements` y en su sitio, y aparece en rojo en el
  // historial con un boton de recuperar, hasta que se sube la libreta. Antes se
  // quitaba del array y el deshacer era un toast, que dura cinco segundos: eso
  // obliga a reaccionar a tiempo. Ahora el dueno puede quitar un renglon, seguir
  // revisando veinte clientes y recuperarlo al final.
  //
  // Para todo lo que calcula —saldos, sumas, el resumen— no existe:
  // `effectiveMovements` los filtra antes de reconciliar.
  function removeMovement(rowId: string) {
    recordar();
    setEliminados((prev) => new Set(prev).add(rowId));
  }

  // CT-25. Escribir el nombre en la fila la saca de "sin cliente" y la mete en
  // la tuberia normal: a partir de ahi es un renglon como cualquier otro, con su
  // tarjeta, su saldo corrido y su comprobacion contra el total escrito.
  function asignarSuelta(uid: string, nombre: string) {
    recordar();
    setReviewMovements((prev) => (prev ? asignarLineaSuelta(prev, uid, nombre) : prev));
  }

  // El caso corriente: los huerfanos de una pagina son todos del mismo cliente,
  // el de la hoja anterior. Se asignan solo los que siguen VIVOS — uno que el
  // dueno acaba de quitar no debe resucitar con nombre puesto.
  function asignarTodasSueltas(nombre: string) {
    recordar();
    setReviewMovements((prev) =>
      prev ? asignarTodasLasSueltas(prev, nombre, eliminados) : prev,
    );
  }

  function restaurarMovimiento(rowId: string) {
    recordar();
    setEliminados((prev) => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }

  // Quitar a una persona entera de la tanda. Marca todos sus renglones de una
  // vez, asi que sigue siendo recuperable renglon a renglon si hiciera falta.
  // Quitar a una persona entera de la tanda.
  //
  // Se apunta QUE renglones marco ESTA eliminacion, no solo que el cliente se
  // fue: si el dueno ya habia quitado un movimiento suelto suyo antes, al
  // recuperar al cliente ese movimiento NO debe volver — el dueno lo quito a
  // proposito, y devolverselo seria deshacer una decision que no pidio deshacer.
  function eliminarCliente(nameKey: string, rowIds: string[]) {
    recordar();
    const nuevos = rowIds.filter((id) => !eliminados.has(id));
    setEliminados((prev) => {
      const next = new Set(prev);
      for (const id of nuevos) next.add(id);
      return next;
    });
    setClientesQuitados((prev) => ({ ...prev, [nameKey]: nuevos }));
    setAbierto(null);
  }

  function restaurarCliente(nameKey: string) {
    recordar();
    const suyos = clientesQuitados[nameKey] ?? [];
    setEliminados((prev) => {
      const next = new Set(prev);
      for (const id of suyos) next.delete(id);
      return next;
    });
    setClientesQuitados((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => k !== nameKey)),
    );
  }

  // ── CUÁL DE LOS DOS TOTALES MANDA ──────────────────────────────────────
  //
  // "Mi libreta dice $140 y estos montos suman $125." Solo el dueño sabe cuál
  // es cierto: su libreta pudo sumar mal, o pudo quedarse un renglón fuera de
  // la foto.
  //
  // SI ELIGE SU LIBRETA, HAY QUE CREAR UNA LÍNEA. No hay otra forma: en Sevenz
  // el saldo no se guarda, se calcula sumando los movimientos
  // (`recalc_client_running_balance`), así que no existe ningún sitio donde
  // escribir "140" y que se quede. Los $15 que faltan tienen que ser un
  // movimiento.
  //
  // Y se crea AQUÍ, en la revisión, no al guardar: así el dueño la ve antes de
  // confirmar, con su monto y su descripción, y puede editarla o borrarla como
  // cualquier otra. Una línea de dinero que apareciera sola en el momento de
  // guardar sería justo lo contrario.

  // Solo APUNTA la decision. La linea de ajuste ya no se crea aqui: se deriva
  // de esta decision y de los renglones que haya en cada momento, mas arriba.
  // Antes se creaba aqui una vez y se quedaba congelada, que es lo que hacia que
  // corregir un monto despues dejara una deuda equivocada.
  //
  // `escrito` y `calculado` se guardan tal como estaban AL DECIDIR, y para una
  // sola cosa: poder notar luego que la cifra cambio y decirselo al dueno. Lo
  // que el panel ensena no sale de aqui, sale del libro sombra.
  function elegirTotal(cliente: ClienteRevisado, libro: LibroDelCliente, cual: EleccionDeTotal) {
    recordar();
    const clave = `${cliente.nameKey}|${libro.currency ?? "COP"}`;
    const sombra = librosSombra.get(clave);
    setDecisionesDeTotal((prev) => ({
      ...prev,
      [clave]: {
        cual,
        escrito: prev[clave]?.escrito ?? sombra?.escrito ?? libro.escrito ?? 0,
        calculado: prev[clave]?.calculado ?? sombra?.calculado ?? libro.calculado ?? 0,
      },
    }));
  }

  // Los `uid` de las líneas que creó el propio Sevenz al decir el dueño que
  // manda su libreta. Van con su nota, distinta de la del desajuste: aquí no
  // hay nada descuadrado — el ajuste lo cuadró —, lo que hay que poder
  // reconstruir tres meses después es de dónde salió ese movimiento.


  // El payload de unas filas concretas. Sale aparte porque ahora hay dos
  // caminos que suben —el boton de una tarjeta y el del lote— y que armaran el
  // payload por separado es justo como se acaban desviando el uno del otro.
  // Lo que esa persona trae EN ESTA LIBRETA, por moneda. Es la mitad de la
  // pregunta que hace la confirmacion: arriba lo que llega, abajo lo que ya hay.
  // Nunca se suman dos monedas, la regla de siempre.
  function textoDeLoQueTrae(nameKey: string | undefined): string {
    if (!nameKey) return "—";
    const suyas = filas.filter((r) => r.client_name.trim().toLowerCase() === nameKey);
    const porMoneda = new Map<string, number>();
    for (const r of suyas) {
      const k = r.currency ?? "COP";
      porMoneda.set(k, (porMoneda.get(k) ?? 0) + (r.type === "charge" ? r.amount : -r.amount));
    }
    const partes = [...porMoneda.entries()].map(([k, total]) =>
      k === "COP" ? formatCurrency(total) : formatDisplayCurrency(total, k as LedgerCurrency),
    );
    return partes.length ? partes.join(" · ") : "—";
  }

  function payloadDe(deEstas: typeof filas): ImportRow[] {
    return deEstas.map((r) => ({
      // CT-22: `filas` ya aplico la decision, asi que con "es otra persona"
      // esto llega en null y se crea un cliente nuevo.
      client_id: r.matched_client_id,
      client_name: r.client_name,
      type: r.type,
      amount: r.amount,
      description: r.description,
      document_id: r.document_id,
      whatsapp: r.whatsapp,
      currency: r.currency,
      owner_note: uidsDeAjuste.has(r.rowId) ? NOTA_DE_AJUSTE : notaDeDesajuste(r),
      created_at: isoDeLaFecha(r.date),
    }));
  }

  // UNA LLAMADA POR CLIENTE, decidido el 2026-10-01.
  //
  // La migracion 073 hizo que una libreta entrara entera o no entrara. Al poder
  // subir cliente a cliente esa garantia se rompe a proposito, pero se conserva
  // DENTRO de cada persona: si el tercero falla, los dos anteriores ya estan
  // guardados y el tercero no deja nada a medias. Es lo unico que importa aqui,
  // porque lo que no puede quedar partido es la cuenta de alguien.
  async function subirClientes(nameKeys: string[]) {
    if (guardia()) return;
    if (nameKeys.length === 0) return;
    setConfirming(true);
    const hechos: string[] = [];
    let movimientos = 0;
    try {
      for (const nameKey of nameKeys) {
        const suyas = filas.filter((r) => r.client_name.trim().toLowerCase() === nameKey);
        if (suyas.length === 0) continue;
        const result = await confirmImport(payloadDe(suyas));
        if (result.error) {
          // Se para en el primero que falla: seguir con los demas dejaria al
          // dueno adivinando cuales entraron.
          if (!avisarCuentaPausada(result.error)) {
            toast.error(result.error, {
              description: hechos.length
                ? `Ya se guardaron ${hechos.length} ${hechos.length === 1 ? "cliente" : "clientes"}. Este no, y puedes intentarlo otra vez.`
                : "No se guardo nada, puedes intentarlo otra vez.",
            });
          }
          break;
        }
        hechos.push(nameKey);
        movimientos += result.imported ?? suyas.length;
      }
    } finally {
      setConfirming(false);
    }
    if (hechos.length === 0) return;

    const subidosAhora = new Set([...subidos, ...hechos]);
    setSubidos(subidosAhora);
    // EL HISTORIAL SE VACIA AL SUBIR. Un cliente ya escrito en la base no se
    // des-sube desde aqui, asi que deshacer hasta antes de la subida enseñaria
    // una revision que ya no se corresponde con lo guardado — y el boton
    // parecería ofrecer justo lo que no puede hacer.
    setPasado([]);

    // Si ya no queda nadie por subir, la revision se acaba y se vuelve a Inicio,
    // igual que antes. Si queda gente, NO se navega: el dueno sigue en la lista
    // con lo que falta.
    const quedan = clientesRevisados.some((c) => !subidosAhora.has(c.nameKey));
    if (quedan) {
      toast.success(
        `${movimientos} ${movimientos === 1 ? "movimiento importado" : "movimientos importados"}. Sigue con el resto.`,
      );
      return;
    }
    toast.success(
      `${movimientos} ${movimientos === 1 ? "movimiento importado" : "movimientos importados"}.`,
    );
    cerrarRevision();
    clearJobs();
    router.push("/dashboard");
  }


  // Se calcula una vez: lo leen el encabezado y la lista, y que discrepen seria
  // un recuento que no cuadra con lo que hay debajo.
  const entradas = reviewMovements
    ? entradasDeLaRevision(
        conEstado(clientesRevisados, filas, decisiones, candidatos, {
          exigeMoneda: showCurrency,
          subidos,
          hayLineasSinResolver,
        }),
      )
    : [];

  if (reviewMovements) {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-2">
        {/* EL TÍTULO VIVE AQUÍ, no en la página, desde CT-31: el deshacer va
            alineado a su derecha y los dos tienen que estar en el mismo
            componente para poder compartir el estado. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Subir libreta</h1>
          <BotonDeshacer pasos={pasado.length} onDeshacer={deshacer} />
        </div>

        {/* EL BOTÓN DE GUARDAR YA NO VA EN LA CABECERA.
            Estuvo ahí porque el único que guardaba quedaba a una pantalla y
            media de scroll; la barra fija del pie resuelve lo mismo mejor —
            está siempre a la vista SIN competir con el título ni con el botón
            de volver, y sobre todo deja sitio encima para decir qué falta. Un
            botón deshabilitado arriba y su explicación en rojo veinte filas más
            abajo era pedirle al dueño que adivinara la relación. */}

        {/* Cuántos clientes salieron y de cuántas fotos. Es lo primero que el
            dueño quiere saber al llegar aquí —"¿las leyó todas?"— y hasta ahora
            tenía que contar las filas él. */}
        {/* CUENTA LO QUE SE ENCONTRO, no lo que queda vivo.
            Este numero describe la LECTURA de la foto, y esa no cambia porque
            el dueno quite a alguien. Contando solo los vivos, quitar a un
            cliente bajaba el encabezado a "2 clientes encontrados" y se lee
            como que la IA leyo mal una pagina que leyo bien. Lo que se quito
            se ve igualmente, en su fila roja. */}
        <p className="text-sm text-muted-foreground">
          {entradas.length} cliente{entradas.length === 1 ? "" : "s"} encontrado
          {entradas.length === 1 ? "" : "s"} de {doneJobs.length} foto
          {doneJobs.length === 1 ? "" : "s"} analizada{doneJobs.length === 1 ? "" : "s"}
        </p>

        <TiraDeFotos fotos={doneJobs.map((j) => ({ id: j.id, previewUrl: j.previewUrl, fileName: j.fileName }))} />

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="same-client"
              checked={sameClient}
              onCheckedChange={(v) => toggleSameClient(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="same-client" className="cursor-pointer">
              Todos el mismo cliente
            </Label>
          </div>

          {sameClient ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="shared-name" className="text-xs">
                  Cliente
                </Label>
                {/* El autocompletado de clientes ya existentes. Vivía en la
                    tabla de movimientos; al retirarla se vino aquí, porque el
                    campo que lo usa es este. Un `list=` que apunta a un id que
                    no existe no da error: simplemente deja de sugerir, en
                    silencio. */}
                <datalist id="known-clients">
                  {existingClients.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
                <Input
                  id="shared-name"
                  list="known-clients"
                  value={sharedName}
                  placeholder="Nombre del cliente"
                  className={sharedName.trim() ? undefined : "border-destructive"}
                  onChange={(e) => setSharedName(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="shared-document" className="text-xs">
                  Cédula/documento
                </Label>
                <DocumentIdInput
                  id="shared-document"
                  country={country}
                  value={sharedDocument}
                  onChange={setSharedDocument}
                />
              </div>
            </div>
          ) : null}

          {/* Debajo del documento y en su propia fila, no al lado: es
              opcional, y ponerlo junto a los dos obligatorios lo haría
              parecer uno más. Una libreta suele llevar el teléfono apuntado
              arriba con el nombre, así que este es el momento natural de
              copiarlo — pero si no está, no pasa nada. */}
          {sameClient ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shared-whatsapp" className="text-xs">
                WhatsApp (opcional)
              </Label>
              <WhatsappInput
                id="shared-whatsapp"
                name="shared-whatsapp"
                preferredDialCode={OWNER_COUNTRY_DIAL_CODE[country]}
                defaultValue={sharedWhatsapp}
                onValueChange={setSharedWhatsapp}
              />
            </div>
          ) : null}
        </div>

        {showCurrency ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className="text-sm font-medium">¿En qué moneda está esta libreta?</span>
            {/* Radio y no dos botones sueltos, con la misma píldora que
                "Cargo / Abono" del alta de movimiento (TipoButtons). Dos
                botones `outline` no dejaban NINGUNA marca de cuál se había
                pulsado: el dueño elegía USD, la pantalla no cambiaba de
                aspecto, y la única prueba de que había funcionado estaba
                veinticinco filas más abajo, en la columna de la moneda.

                El valor no se guarda aparte: se deduce de las filas, que son
                la verdad. Si todas coinciden, esa es la elegida; si la libreta
                mezcla —se permite, cambiando filas sueltas— no se marca
                ninguna, porque marcar una sería mentir sobre las otras. */}
            <div className="flex w-full flex-wrap items-center gap-2">
              {/* El deshacer de la moneda vivia aqui, de un solo nivel. Desde
                  CT-31 es global y esta arriba, junto al titulo: aplicar moneda
                  es un paso mas del historial y no merecia boton propio. */}

              {/* EL MISMO PATRÓN que el selector de moneda de "Agregar
                  movimiento": bandera delante, nombre detrás, píldora rellena
                  cuando está elegida. Antes era un radio con el punto delante y
                  la bandera al final — se veía bien y era un tercer dibujo para
                  la misma pregunta. Aquí las etiquetas dicen "Todo" porque esto
                  aplica a la tanda entera, que es lo único que cambia. */}
              <div className="flex flex-row flex-wrap gap-2">
                {([
                  { moneda: "USD", etiqueta: "Todo Dólares" },
                  { moneda: "EUR", etiqueta: "Todo Euros" },
                ] as const).map(({ moneda, etiqueta }) => (
                  <Button
                    key={moneda}
                    type="button"
                    variant={monedaDeLaLibreta === moneda ? "default" : "outline"}
                    size="sm"
                    className="rounded-full px-3.5"
                    aria-pressed={monedaDeLaLibreta === moneda}
                    onClick={() => applyCurrencyToAll(moneda, forzarMoneda)}
                  >
                    <CurrencyFlagIcon currency={moneda} />
                    {etiqueta}
                  </Button>
                ))}
              </div>
            </div>

            {/* La casilla solo sale cuando de verdad hay algo que forzar: si
                ninguna fila está ya ajustada, ofrecerla es ofrecer una decisión
                sobre un conjunto vacío. */}
            {filas.some((r) => r.currency) && filas.some((r) => !r.currency) ? (
              <label className="flex w-full cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={forzarMoneda}
                  onCheckedChange={(v) => setForzarMoneda(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Aplicar también a {filas.filter((r) => r.currency).length} línea
                  {filas.filter((r) => r.currency).length === 1 ? "" : "s"} que ya ajustaste
                </span>
              </label>
            ) : null}

            <p className="w-full text-xs text-muted-foreground">
              Hay que elegir una para poder importar. Puedes cambiar filas sueltas después, si la
              libreta mezcla.
            </p>

            {/* La vuelta a la modal. Hace falta porque la modal se puede cerrar
                con "Están mezclados" o con la X, y sin esto el dueño que la
                cerró para mirar primero no tendría forma de recuperarla:
                tendría que elegir aquí, radio a radio, lo mismo que la modal
                aplica de un toque. */}
            <Button
              type="button"
              variant="link"
              className="h-auto w-full justify-start p-0 text-xs"
              onClick={() => setModalMoneda(true)}
            >
              Seleccionar moneda
            </Button>
          </div>
        ) : null}

        {/* Fuera del recuadro de la moneda: el recuadro solo existe para un
            negocio venezolano, y la modal también, pero montarla dentro ataría
            su ciclo de vida a un bloque que además se desplaza con el scroll. */}
        {showCurrency ? (
          <ModalDeMoneda
            abierta={modalMoneda}
            onCerrar={() => setModalMoneda(false)}
            onElegir={(moneda) => {
              // `forzarMoneda` no entra aquí: la modal sale al ENTRAR, cuando
              // todavía no hay nada ajustado a mano que pisar. Pasarle la
              // casilla haría que una reapertura posterior borrase correcciones
              // sin que nadie lo pidiera en esta pantalla.
              applyCurrencyToAll(moneda);
              setModalMoneda(false);
            }}
            clientes={clientesRevisados.length}
            movimientos={filas.length}
          />
        ) : null}
        {/* CT-25: ARRIBA DE TODO, antes que las tarjetas. Bloquea la subida
            entera, asi que si estuviera debajo de seis tarjetas el dueno veria
            el boton apagado sin ver por que. */}
        <LineasSueltas
          lineas={lineasSueltas}
          quitadas={sueltasQuitadas}
          nombres={nombresParaLasSueltas}
          onAsignar={asignarSuelta}
          onAsignarTodas={asignarTodasSueltas}
          onQuitar={removeMovement}
          onRecuperar={restaurarMovimiento}
        />

        {/* LA LISTA POR CLIENTE, que es lo que el dueño lee primero.
            La tabla sigue existiendo, pero ya no es la pantalla: es el detalle
            de UN cliente, y se abre tocando su tarjeta. Una libreta de seis
            páginas eran cuarenta filas de ocho columnas en 375px; ahora son
            seis tarjetas que se leen de un vistazo. */}
        <RevisarClientes
          entradas={entradas}
          decisiones={decisiones}
          onDecidir={(nameKey, d) => {
            recordar();
            setDecisiones((prev) => ({ ...prev, [nameKey]: d }));
          }}
          onVerClientes={setListaAbierta}
          onConfirmarCon={(nameKey, candidato) => setPorConfirmar({ nameKey, candidato })}
          onAbrir={setAbierto}
          onRestaurarCliente={restaurarCliente}
          onSubirCliente={(nameKey) => subirClientes([nameKey])}
          subiendo={confirming}
        />

        {/* CT-29: la lista de candidatos y la confirmacion. Van FUERA de la hoja
            del detalle, no dentro: un popup en portal dentro de un Dialog de
            Radix no recibe toques (DESIGN-SYSTEM.md), y ademas las dos salen
            tambien desde la tarjeta, con el detalle cerrado. */}
        <ListaDeCandidatos
          abierta={listaAbierta !== null}
          onCerrar={() => setListaAbierta(null)}
          nombreEnLaLibreta={
            clientesRevisados.find((c) => c.nameKey === listaAbierta)?.name ?? listaAbierta ?? ""
          }
          candidatos={listaAbierta ? (candidatos.get(listaAbierta) ?? []) : []}
          onElegir={(candidato) => {
            if (!listaAbierta) return;
            setPorConfirmar({ nameKey: listaAbierta, candidato });
          }}
          onEsOtraPersona={() => {
            if (!listaAbierta) return;
            recordar();
            setDecisiones((prev) => ({ ...prev, [listaAbierta]: { cual: "otra" } }));
            setListaAbierta(null);
          }}
        />

        <ConfirmarEmparejamiento
          abierta={porConfirmar !== null}
          onCerrar={() => setPorConfirmar(null)}
          onConfirmar={() => {
            if (!porConfirmar) return;
            recordar();
            setDecisiones((prev) => ({
              ...prev,
              [porConfirmar.nameKey]: { cual: "mismo", clientId: porConfirmar.candidato.id },
            }));
            // Se cierran las dos: la confirmacion devuelve a la lista de la
            // revision para seguir con la subida, que es lo que pide el diseño.
            setPorConfirmar(null);
            setListaAbierta(null);
            toast.success(`Emparejado con ${porConfirmar.candidato.name}.`);
          }}
          nombreEnLaLibreta={
            clientesRevisados.find((c) => c.nameKey === porConfirmar?.nameKey)?.name ?? ""
          }
          documentoEnLaLibreta={
            filas.find((r) => r.client_name.trim().toLowerCase() === porConfirmar?.nameKey)
              ?.document_id ?? null
          }
          whatsappEnLaLibreta={
            filas.find((r) => r.client_name.trim().toLowerCase() === porConfirmar?.nameKey)
              ?.whatsapp ?? null
          }
          loQueTraeLaLibreta={textoDeLoQueTrae(porConfirmar?.nameKey)}
          candidato={porConfirmar?.candidato ?? null}
        />

        <Sheet open={clienteAbierto !== undefined} onOpenChange={(v) => !v && setAbierto(null)}>
          <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-xl">
            <SheetHeader>
              {/* El titulo del panel es la ACCION, no el nombre: el nombre va
                  dentro, en grande, junto a su estado y su boton de quitar. */}
              <SheetTitle>Registrar movimientos</SheetTitle>
            </SheetHeader>
            {/* "Registrar movimientos": el detalle de ESE cliente. Sustituye a
                la tabla de movimientos, que se reutilizó mientras la lista por
                cliente se construía y por eso funcionaba — pero enseñaba la
                columna "Cliente" repetida ocho veces con el mismo nombre y se
                desplazaba de lado en un teléfono para llegar al monto. */}
            {clienteAbierto ? (
              <DetalleDelCliente
                cliente={clienteAbierto}
                estado={
                  conEstado([clienteAbierto], filas, decisiones, candidatos, {
                    exigeMoneda: showCurrency,
                    subidos,
                  })[0].estado
                }
                candidatos={candidatos.get(clienteAbierto.nameKey) ?? []}
                onRenombrar={(nombre) => renombrarCliente(clienteAbierto.nameKey, nombre)}
                pasosParaDeshacer={pasado.length}
                onDeshacer={deshacer}
                onVerClientes={() => setListaAbierta(clienteAbierto.nameKey)}
                onConfirmarCon={(candidato) =>
                  setPorConfirmar({ nameKey: clienteAbierto.nameKey, candidato })
                }
                decision={decisiones[clienteAbierto.nameKey]}
                onDecidir={(d) => {
                  recordar();
                  setDecisiones((prev) => ({ ...prev, [clienteAbierto.nameKey]: d }));
                }}
                entradas={entradasDelHistorial(clienteAbierto.nameKey)}
                country={country}
                showCurrency={showCurrency}
                clienteCompartido={sameClient}
                isLinked={(rowId) => !unlinked.has(rowId)}
                onToggleLinked={toggleLinked}
                onUpdate={updateMovement}
                onRemove={removeMovement}
                onRestaurar={restaurarMovimiento}
                esAjuste={(rowId) => uidsDeAjuste.has(rowId)}
                onEliminarCliente={() =>
                  eliminarCliente(clienteAbierto.nameKey, clienteAbierto.rowIds)
                }
                onAplicarMoneda={(moneda) => aplicarMonedaAlCliente(clienteAbierto.rowIds, moneda)}
                decisionesDeTotal={Object.fromEntries(
                  clienteAbierto.libros.map((l) => {
                    const clave = `${clienteAbierto.nameKey}|${l.currency ?? "COP"}`;
                    const d = decisionesDeTotal[clave];
                    if (!d) return [l.currency ?? "COP", undefined];
                    // LAS CIFRAS SALEN DE LA SOMBRA, no de lo guardado al
                    // decidir. Congelarlas era lo que hacia que el panel siguiera
                    // diciendo "la suma de Sevenz: $70" despues de corregir un
                    // monto. La sombra no se entera del ajuste, asi que sigue
                    // sabiendo cuanto falta de verdad.
                    const sombra = librosSombra.get(clave);
                    // "Se actualizo a X": se compara el importe que el ajuste
                    // tiene AHORA contra el que el dueno vio al decidir. Si no
                    // coincide, es que corrigio algo despues y la cifra que
                    // acepto cambio; se le dice, porque el cliente la va a ver.
                    const ahora = ajustesDerivados.get(clave)?.movimiento.amount ?? null;
                    const alDecidir = Math.abs(d.escrito - d.calculado);
                    return [
                      l.currency ?? "COP",
                      {
                        ...d,
                        escrito: sombra?.escrito ?? d.escrito,
                        calculado: sombra?.calculado ?? d.calculado,
                        rehechoA: ahora !== null && ahora !== alDecidir ? ahora : null,
                      },
                    ];
                  }),
                )}
                onElegirTotal={(libro, cual) => elegirTotal(clienteAbierto, libro, cual)}
                subido={subidos.has(clienteAbierto.nameKey)}
                accionSubir={
                  <ConfirmarImportacion
                    className="w-full"
                    soloEsteCliente
                    cuantas={
                      filas.filter((r) => r.client_name.trim().toLowerCase() === clienteAbierto.nameKey)
                        .length
                    }
                    filas={filas.filter(
                      (r) => r.client_name.trim().toLowerCase() === clienteAbierto.nameKey,
                    )}
                    rateContext={rateContext}
                    deshabilitado={
                      confirming ||
                      !estadosPendientes.find((c) => c.nameKey === clienteAbierto.nameKey)?.puedeSubir
                    }
                    guardando={confirming}
                    onConfirm={() => subirClientes([clienteAbierto.nameKey])}
                  />
                }
              />
            ) : null}
          </SheetContent>
        </Sheet>
        {/* LA BARRA FIJA: lo que falta, y justo debajo el botón que no se
            puede pulsar por eso mismo.
            `sticky` y no `fixed`: así sigue siendo parte del flujo, empuja el
            contenido en vez de taparle la última tarjeta, y no hay que
            reservarle hueco con un padding que luego se queda desajustado.
            `pb-[env(safe-area-inset-bottom)]` porque en un iPhone con notch la
            franja de abajo se come el borde del botón. La barra de navegación
            del teléfono no estorba: durante la revisión está escondida. */}
        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {motivoQueBloquea ? (
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {motivoQueBloquea}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            {/* "Volver" no sale de la app, pero sí tira la revisión: las fotos
                se conservan y las correcciones hechas a mano no. Duele lo mismo
                que salir, así que pregunta lo mismo. */}
            <Button
              variant="outline"
              onClick={() => guard(() => cerrarRevision())}
              disabled={confirming}
            >
              Volver
            </Button>
            <ConfirmarImportacion
              className="flex-1"
              cuantas={movimientosListos}
              filas={filasListas}
              rateContext={rateContext}
              deshabilitado={noSePuedeConfirmar}
              guardando={confirming}
              onConfirm={() => subirClientes(listosParaSubir.map((c) => c.nameKey))}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Subir libreta</h1>
      {/* Los tres pasos viven aquí y no en la página porque solo valen para
          este momento: explican cómo se importa, y una vez la libreta está
          leída y el dueño está corrigiendo montos, describen algo que ya
          hizo. En un teléfono son cuatro renglones de los que se come antes
          de llegar a la primera fila. */}
      <PasosImportar className="-mt-2" />

      {/* La bandeja de fotos va AQUÍ, pegada a las instrucciones, y no al
          final de la pantalla. Mientras la IA lee la libreta es lo único que
          se mueve: dejarla debajo de la cuota y del recuadro de subir obligaba
          a bajar media pantalla para ver si seguía procesando, y en un
          teléfono quedaba tapada por la barra inferior. Lo que está pasando
          ahora va antes que lo que ya se hizo. */}
      {hasJobs ? (
        <div className="flex flex-col gap-3">
          <AttachmentGroup className="flex-wrap py-0">
            {jobs.map((job) => (
              <Attachment key={job.id} state={ATTACHMENT_STATE[job.status]} orientation="vertical">
                <AttachmentMedia variant="image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={job.previewUrl} alt={job.fileName} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{job.fileName}</AttachmentTitle>
                  <AttachmentDescription>
                    {job.status === "error" ? job.error : STATUS_LABEL[job.status]}
                    {job.status === "done" ? ` · ${job.movements.length} movimientos` : ""}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Quitar ${job.fileName}`}
                    onClick={() => removeJob(job.id)}
                    disabled={job.status === "processing"}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>

          {errorJobs.length > 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {errorJobs.length} foto{errorJobs.length > 1 ? "s" : ""} no se pudo procesar. Puedes
              quitarla{errorJobs.length > 1 ? "s" : ""} o intentar de nuevo con otra.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button onClick={handleViewResults} disabled={doneJobs.length === 0 || isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Procesando...
                </>
              ) : (
                `Ver resultados (${doneJobs.reduce((sum, j) => sum + j.movements.length, 0)} movimientos)`
              )}
            </Button>
            {!isProcessing ? (
              <Button variant="ghost" onClick={clearJobs}>
                <RotateCw className="size-4" />
                Empezar de nuevo
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}


      {/* UNA REVISIÓN QUE SE QUEDÓ A MEDIAS.
          Se ofrece, no se impone: puede que el dueño haya vuelto a subir OTRA
          libreta, y meterlo de golpe en la de ayer sería desconcertante.
          Se dice que las fotos no vuelven, porque es lo que va a ver. */}
      {borrador && !borradorDescartado && !reviewMovements && !hasJobs ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
          {/* DOS AVISOS, PORQUE SON DOS COSAS DISTINTAS (CT-26).
              `revisada` dice si el dueño llegó a abrir la revisión o si la
              pantalla se cerró con la foto recién leída. Contarle que "las
              correcciones siguen ahí" a quien no llegó a corregir nada es
              mentirle, y encima le hace buscar un trabajo que no existe. */}
          <p className="flex items-start gap-1.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            {borrador.revisada ? (
              <span>
                Dejaste una revisión a medias con{" "}
                <strong>
                  {borrador.movimientos.length}{" "}
                  {borrador.movimientos.length === 1 ? "movimiento" : "movimientos"}
                </strong>
                . Puedes seguir donde la dejaste: las correcciones y las decisiones siguen ahí. Las
                fotos no, así que la tira saldrá vacía.
              </span>
            ) : (
              <span>
                Ya leímos tu libreta:{" "}
                <strong>
                  {borrador.movimientos.length}{" "}
                  {borrador.movimientos.length === 1 ? "movimiento" : "movimientos"}
                </strong>
                . La pantalla se cerró antes de que los revisaras, pero no hace falta volver a subir
                la foto: sigue desde aquí. La tira de fotos saldrá vacía, nada más.
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={retomarBorrador}>
              {borrador.revisada
                ? "Seguir con esa revisión"
                : `Revisar ${borrador.movimientos.length === 1 ? "ese movimiento" : `esos ${borrador.movimientos.length} movimientos`}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                olvidarRevision();
                setBorradorDescartado(true);
              }}
            >
              Descartarla
            </Button>
          </div>
        </div>
      ) : null}

      {/* Sin tope en ningún plan desde el 2026-09-28. Se cae la barra de
          progreso entera —medía un límite que ya no existe— y no se nombra el
          plan: a quien tiene las mismas fotos que cualquiera, leer "Plan Free"
          solo le invita a preguntarse qué se está perdiendo. */}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Sparkles className="size-4 text-primary" />
        Fotos ilimitadas
      </p>

      <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {/* Two inputs, not one with a toggle, because the difference is
                the `capture` attribute and it cannot be changed per click
                without re-rendering the input and losing the tap.

                The old single input carried capture="environment", which sends
                a phone straight to the rear camera and removes the photo
                library from the picker altogether — so an owner who had
                already photographed the libreta, or received it on WhatsApp,
                had no way to reach that image. The label said "elegir o tomar"
                while only "tomar" was possible. */}
            <label
              htmlFor="photos"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Upload className="size-6" />
              {`Toca para elegir fotos de la libreta (hasta ${MAX_IMPORT_PHOTOS})`}
            </label>
            <input
              id="photos"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Phones only: a desktop browser ignores `capture` and would open
                the same ordinary file dialog as the button above, which reads
                as broken. Hidden with CSS rather than by detecting the device,
                so the server and the client render the same markup. */}
            <Button asChild variant="outline" className="sm:hidden">
              <label htmlFor="photos-camera" className="cursor-pointer">
                <Camera className="size-4" />
                Tomar foto
              </label>
            </Button>
            {/* No `multiple`: a camera capture returns exactly one image, so
                asking for several here would promise something the OS does not
                deliver. Several photos still work — one capture at a time, or
                the picker above. */}
            <input
              id="photos-camera"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
            {isProcessing ? (
              <p className="text-sm text-muted-foreground">
                Se está leyendo la libreta con IA — puedes seguir usando el resto de la app mientras
                tanto, el progreso sigue aquí.
              </p>
            ) : null}
          </CardContent>
      </Card>

    </div>
  );
}
