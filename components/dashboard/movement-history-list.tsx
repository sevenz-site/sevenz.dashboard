"use client";

import { useState } from "react";
import type { EstadoDelChip } from "@/components/dashboard/chip-de-estado";
import { HistoryCard } from "@/components/dashboard/history-card";
import { groupPayments } from "@/lib/history/group-payments";
import { vencimientoEfectivo } from "@/lib/estado-del-plazo";
import { getClientStatus } from "@/lib/types";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  FiltrosDelHistorial,
  tituloDeListaVacia,
  type EstadoFiltro,
  type MonedaFiltro,
  type TipoFiltro,
} from "@/components/dashboard/movement-type-filter";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
import type { Movement } from "@/lib/types";
import type { VentaDeContado } from "@/lib/ventas-de-contado";
import { EmptyState } from "@/components/dashboard/empty-state";

const PAGE_SIZE = 10;


// EL FILTRO POR TIPO, pedido por el dueño el 2026-10-16: "Todos", "Fiado" y
// "Abono", a la derecha del rótulo "Historial".
//
// EL RÓTULO ENTRA COMO PROP y no se escribe aquí. Las dos pantallas que usan
// esta lista lo titulan distinto y con tipografías distintas —"Historial de
// movimientos" en 20px en la ficha del tendero, "Historial" en 14px gris en
// la del cliente—, así que el componente coloca el chip a su derecha sin
// decidir cómo se ve el título.
//
// EL CHIP VIVE AQUÍ Y NO EN LA PÁGINA porque el estado es suyo: la lista es
// la que filtra y la que pagina, y las dos cosas tienen que moverse juntas.
// Un chip en la página sería otra vez dos hermanos compartiendo estado.


// ESTA LISTA YA NO SABE NADA DE LA FICHA DE UN MOVIMIENTO.
//
// Hasta el 2026-10-19 montaba un diálogo por fila y tenía que recibir todo lo
// que ese diálogo necesitaba: las fotos firmadas, las tasas, el pendiente por
// fiado, con qué compartir. El detalle pasó a ser una pantalla con dirección
// propia (`/transacciones/[id]`), así que cada fila es un enlace y esos datos
// los carga la página de destino, que es la única que los usa.
export function MovementHistoryList({
  movements,
  ledger = null,
  titulo = null,
  ventasDeContado = [],
  pendientePorFiado = {},
  diasSinPagar = 0,
  productosPorVenta = {},
  navegable = true,
}: {
  movements: Movement[];
  // null = plain COP ledger.
  ledger?: LedgerDisplay | null;
  // El rótulo de la sección, para poder poner el filtro a su derecha. Ver el
  // comentario de `FiltroDeTipo`.
  titulo?: React.ReactNode;
  // LAS VENTAS PAGADAS ENTERAS, que no son movimientos y por eso llegan
  // aparte. Ver `lib/ventas-de-contado.ts`: una venta pagada no escribe nada
  // en `movements`, así que el historial las MEZCLA al pintar en vez de
  // convertirlas en filas de esa tabla -- el saldo, el puntaje de crédito y
  // las gráficas siguen leyendo solo `movements` y no se enteran.
  ventasDeContado?: VentaDeContado[];
  // AQUÍ ESTUVO `estadosDeFiado`, el chip «Dentro del plazo» / «Plazo
  // vencido» de cada fiado. Lo pidió el dueño el 2026-10-20 y lo quitó el
  // 2026-10-21, al reescribir esta fila contra el frame `1512:10061`, que no
  // lo dibuja. El chip sigue vivo donde el frame sí lo pone: en la tabla de
  // cuotas y en las tarjetas de abono dentro de un fiado.
  // LO QUE CADA FIADO TODAVÍA DEBE, por el id de su movimiento. Misma fuente
  // que `estadosDeFiado` -- `get_open_charges_for_client` -- y por eso llegan
  // juntos. Un fiado que falte aquí está saldado.
  pendientePorFiado?: Record<string, number>;
  // ── CUÁNTOS DÍAS LLEVA EL CLIENTE SIN ABONAR NADA ────────────────────
  //
  // Lo único que una fila no puede saber por sí misma y que hace falta para
  // que diga «Crítico»: es un dato del CLIENTE, no del movimiento. Baja de la
  // página, que ya lo tiene leído.
  //
  // CERO POR DEFECTO, que es el lado seguro: con cero nadie llega nunca a
  // «Crítico», así que una pantalla que olvide pasarlo enseña el estado más
  // suave en vez de inventarse una alarma.
  diasSinPagar?: number;
  // AQUÍ ESTUVO `saldoPorMoneda`, el saldo del cliente en cada libro. Lo
  // necesitaba la fila del abono suelto, la única que no tenía un fiado del
  // que informar. Se fue el 2026-10-23 cuando el pie pasó a enseñar
  // `running_balance` en TODAS las filas: esa cifra ya viene en el propio
  // movimiento, así que ninguna fila necesita que le pasen nada.
  // ── CÓMO SE LLAMA CADA FILA: `sale_id` → nombres de sus productos ────
  //
  // La fila decía «Fiado · Casco» porque el guardado copiaba los nombres
  // DENTRO de `description` cuando el tendero no escribía nada. El dueño lo
  // mandó quitar el 2026-10-22 --*«no estar poniendo los productos en la
  // descripción»*-- así que los nombres vienen ahora de donde viven.
  //
  // POR PROP Y NO POR CONSULTA: esto es un componente de cliente. La página ya
  // lee `sale_lines` para las ventas de contado, así que el dato ya estaba
  // allí y no cuesta ninguna lectura más.
  productosPorVenta?: Record<string, string[]>;
  // ── ¿SE PUEDE TOCAR UNA FILA? ────────────────────────────────────────
  //
  // `false` en la hoja «Cuenta de <cliente>» que sale cuando una cédula ya
  // existe, por instrucción del dueño el 2026-10-21: *«el botón ">" no debe
  // aparecer y la card no debe ser clickeable»*.
  //
  // Y tiene razón de fondo, no solo de aspecto: esa hoja aparece en mitad de
  // una venta que vive EN MEMORIA. Tocar una fila navegaba a
  // `/transacciones/<id>` y tiraba la venta entera — el carrito, el cliente a
  // medio escribir y el pago. La hoja está ahí para mirar y decidir, no para
  // irse a otro sitio.
  //
  // El chevron se va con el enlace: decía «aquí se puede entrar», y ya no.
  navegable?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [estado, setEstado] = useState<EstadoFiltro>("todos");
  const [moneda, setMoneda] = useState<MonedaFiltro>("todas");

  // EL CÓDIGO TECLEADO. Cadena vacía es «sin filtrar», no «ningún código»:
  // un buscador que no deja ver nada mientras está vacío sería un filtro
  // puesto que nadie pidió.
  const [codigo, setCodigo] = useState("");

  // ── LAS DOS CLASES DE FILA, EN UNA SOLA LISTA ─────────────────────
  //
  // Un movimiento y una venta de contado no comparten tabla ni forma, así que
  // se juntan aquí con una marca y se ordenan por fecha. La alternativa
  // --dos listas, una debajo de otra-- rompería lo único que el tendero busca
  // en esta pantalla: qué pasó, en orden.
  // ── LOS ABONOS SÍ SALEN AQUÍ, TODOS ──────────────────────────────────
  //
  // Encargo del dueño el 2026-10-22: *«ver los abonos solo dentro del fiado es
  // engorroso, agreguemos los abonos también en el historial de transacciones
  // (el abono se mantiene también en el detalle del fiado) y al abrirlo abre
  // el fiado a donde fue agregado»*.
  //
  // ESTO REVIERTE SU PROPIA DECISIÓN DEL 2026-10-20, y las dos quedan escritas
  // porque la vieja explica por qué el código estuvo así dos días. Entonces
  // dijo: *«como el fiado se lleva sobre una misma cuenta, agregar los
  // movimientos de abonos por separados en el historial sería redundante»*.
  // Lo que cambió no es el argumento —sigue siendo redundante— sino cuál de
  // los dos costes pesa más: la redundancia molesta menos que tener que entrar
  // a un fiado para enterarte de que alguien te pagó.
  //
  // De aquel día sobrevive lo que se aprendió por el camino: un abono SIN
  // dirigir --la cola FIFO lo repartió sin dejar constancia de a cuál-- no
  // tiene ningún fiado donde verse, así que esconderlos todos lo borraba de la
  // app entera. Fueron 104 de 115. Ahora salen todos y ese caso desaparece
  // solo.
  //
  // ── LA FECHA DE UN FIADO VUELVE A SER LA SUYA ────────────────────────
  //
  // El 2026-10-21 la fila de un fiado enseñaba la fecha de su ÚLTIMO ABONO
  // --*«fecha de último abono (en caso de fiado)»*--, y tenía sentido mientras
  // los abonos no salían: era la única forma de saber que algo había pasado.
  //
  // CON EL ABONO EN SU PROPIA FILA ESO SE VUELVE EN CONTRA, y además era un
  // desorden visible: la lista se ORDENABA por `created_at` y ENSEÑABA otra
  // fecha, así que un fiado de agosto abonado ayer decía «ayer» sentado en
  // agosto. Es lo que el dueño reportó el 2026-10-22 pidiendo que el historial
  // vaya *«del más reciente al más antiguo»*.
  //
  // Decidido por él ese día, entre las dos opciones: cada fila por su propia
  // fecha. Así lo que se ordena y lo que se lee son la misma cifra, que es la
  // única forma de que «ordenado por fecha» signifique algo.
  // Para encontrar el fiado que pagó un abono sin recorrer la lista en cada
  // fila. Con doscientos movimientos la diferencia no se nota; el mapa está
  // porque la alternativa es un `find` dentro de un `map`, que es la forma de
  // que un día sí se note.
  const porId = new Map(movements.map((m) => [m.id, m]));

  // ── EL PIE DE UNA FILA, CALCULADO UNA VEZ ──────────────────────────
  //
  // Vive fuera del `map` desde el 2026-10-23 porque el filtro por estado
  // necesita el MISMO chip que se dibuja: si el filtro juzgara por su cuenta,
  // elegir «Plazo vencido» devolvería filas que no llevan ese chip, que es
  // peor que no filtrar. Una función, dos usos, un resultado.
  function pieDeLaFila(m: Movement) {
        const fiadoDeLaFila =
          m.type === "charge" ? m : (porId.get(m.applies_to_movement_id ?? "") ?? null);
        const pendienteDelFiado =
          fiadoDeLaFila == null ? null : (pendientePorFiado[fiadoDeLaFila.id] ?? 0);

        // ── QUÉ CIFRA VA EN «POR COBRAR»: EL SALDO DEL LIBRO ───────────
        //
        // Encargo del dueño el 2026-10-23: *«"Por cobrar" en el pie de cada
        // card es el monto por cobrar total del libro de esa moneda, no del
        // fiado ni de otra transacción (…) es para que le diga al cliente y
        // dueño en cuánto le queda la deuda DESPUÉS DE ESA TRANSACCIÓN»*. Y
        // el criterio con el que lo cerró: *«si el cliente debe 100 y abonó
        // 50, "Por cobrar" es 50 en la card principal de la moneda y en la
        // card de la última transacción. Deben coincidir»*.
        //
        // Eso es `running_balance`: lo que ese libro debía justo después de
        // este movimiento. Su invariante se cumple por construcción —
        // `client_summary.balance_eur` ES el `running_balance` del último
        // movimiento vivo en euros— así que la fila más nueva y la tarjeta
        // de arriba no pueden discrepar.
        //
        // ===============================================================
        // ESTO DESPLAZA LA REGLA DEL 2026-10-21, Y SE DICE ENTERA
        //
        // `running_balance` estuvo aquí y se quitó ese día porque, con los
        // abonos escondidos por el filtro, la fila de arriba decía «Por
        // cobrar $89.72» mientras la tarjeta del mismo cliente decía $68.59,
        // y nada decía cuál cobrar. Entre medias la fila cambió: ahora el
        // pie lo llevan TODAS, así que las cifras se leen como una serie que
        // baja y termina en la de la tarjeta, no como dos números sueltos
        // que se contradicen.
        //
        // LO QUE SIGUE COSTANDO, dicho antes de que alguien lo redescubra:
        // con un filtro puesto —«Fiado», por ejemplo— la fila más nueva que
        // quede en pantalla puede ser vieja, y entonces su cifra NO es la de
        // la tarjeta. Es inherente a enseñar un dato histórico y el dueño lo
        // asumió al elegirlo, avisado de ese caso por su nombre.
        //
        // EL CHIP DE AL LADO HABLA DE OTRA COSA y conviene no confundirlos:
        // dice cómo va ESE fiado (su propio plazo, su propio pendiente),
        // mientras el pie dice qué debía el LIBRO después de esa fila.
        const cifraPorCobrar = m.running_balance ?? null;
        // UN SALDO A FAVOR NO SE ESCRIBE CON UN MENOS. Lo mismo que en la
        // ficha de la transacción, y por el mismo motivo: «Por cobrar −178»
        // bajo ese rótulo se lee como un error de la app. La cifra va en
        // absoluto y el chip de abajo dice de quién es.
        //
        // SOLO PUEDE PASAR EN LA FILA SIN FIADO: el pendiente de un fiado
        // nunca baja de cero. Lo trae el saldo del libro, que sí.
        const aFavor = cifraPorCobrar != null && cifraPorCobrar < 0;
        // ── EL CHIP DE LA FILA: UNO SOLO, Y EL MISMO JUEZ QUE LA TARJETA ──
        //
        // Encargo del dueño el 2026-10-23, en dos pasos. El primero: que cada
        // fiado diga en qué va sin tener que abrirlo. El segundo, al no
        // encontrar en el historial el fiado que ponía «Crítico» a su
        // tarjeta: que la fila hable el MISMO idioma que esa tarjeta.
        //
        // Por eso quien juzga es `getClientStatus`, el mismo de las tarjetas
        // y las listas, aplicado al fiado en vez de al libro: su saldo es lo
        // que ESE fiado debe, y su «peor cargo» es él mismo. Con eso, un
        // fiado vencido o sin plazo de un cliente que lleva más de 30 días
        // sin abonar sale «Crítico», igual que su tarjeta.
        //
        // «PAGADO» SE RESUELVE ANTES y no por `getClientStatus`, que para un
        // saldo en cero diría «Sin deuda»: un fiado saldado no es una cuenta
        // sin deuda, es un fiado que se pagó, y esa palabra la pidió el dueño
        // el 2026-10-21 por su nombre.
        //
        // UN FIADO SIN FECHA dice «Sin plazo» y no se queda en blanco, que es
        // lo que `getClientStatus` ya hace sin ayuda.
        const chipDeLaFila: EstadoDelChip | null =
          m.type === "charge"
            ? pendienteDelFiado == null
              ? null
              : pendienteDelFiado <= 0.005
                ? "pagado"
                : getClientStatus({
                    balance: pendienteDelFiado,
                    daysSincePayment: diasSinPagar,
                    worstChargeAt: m.created_at,
                    worstChargePlazoDias: m.plazo_dias,
                    worstChargeDueAt:
                      vencimientoEfectivo({
                        createdAt: m.created_at,
                        plazoDias: m.plazo_dias,
                        cuotas: m.cuotas,
                        amount: Number(m.amount),
                        pendiente: pendienteDelFiado,
                      })?.toISOString() ?? null,
                  })
            : aFavor
              ? "a_favor"
              : null;

    return { fiadoDeLaFila, cifraPorCobrar, aFavor, chipDeLaFila };
  }


  // ═══════════════════════════════════════════════════════════════════════
  // CADA FILA ABRE SU PROPIA FICHA, INCLUIDO UN ABONO
  //
  // Encargo del dueño el 2026-10-23: *«Vamos a recuperar los detalles de los
  // abonos, al seleccionar un abono en el historial de transacciones abrirá
  // su propio detalle con toda la info registrada en el abono»*, con el frame
  // `1580:11668`.
  //
  // DESPLAZA LA REGLA DEL 2026-10-22, y las dos quedan escritas porque la
  // vieja tenía su motivo: entonces un abono abría la ficha de SU fiado con
  // `?abono=` para resaltar su tarjeta, porque la ficha del abono «no iba a
  // existir». Ahora existe y es la del frame — con su «Fiado relacionado»
  // dentro, que es el camino de vuelta que aquel atajo daba por la fuerza.
  //
  // Y SE LLEVA POR DELANTE EL `?abono=`: sin nadie que llegue al fiado desde
  // una fila de abono, no hay tarjeta que resaltar. El dueño lo pidió
  // explícitamente en el mismo mensaje.
  //
  // LO QUE ESTO ARREGLA DE PASO, y es el fallo que la regla vieja tenía
  // parcheado: un abono cuyo fiado se borró llevaba a
  // `/transacciones/<fiado borrado>` y de ahí a una pantalla en blanco (404
  // sin cuerpo), reportado con captura el 2026-10-23. Yendo siempre a su
  // propia ficha, ese caso desaparece en vez de necesitar la comprobación
  // contra `porId` que había aquí.
  const hrefDeLaFila = (m: Movement) => `/transacciones/${m.id}`;

  // ── UN REPARTO ES UNA FILA ──────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-30: un abono de USD 20 repartido en cuatro
  // fiados salía como cuatro transacciones. `groupPayments` las junta en una,
  // por el total, y la ficha enseña el reparto. La regla, y por qué la clave es
  // el código de transacción, está en `lib/history/group-payments.ts`: es la
  // MISMA que usa el historial del cliente.
  //
  // `porId`, arriba, sigue mirando las líneas sueltas: es para encontrar
  // fiados, y un fiado nunca se agrupa.
  const filas: Fila[] = [
    ...groupPayments(movements).map(
      ({ row: m }): Fila => ({ clase: "movimiento", fecha: m.created_at, m }),
    ),
    ...ventasDeContado.map((v): Fila => ({ clase: "contado", fecha: v.createdAt, v })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  // ── EL FILTRO POR CÓDIGO ──────────────────────────────────────────
  //
  // Va EL PRIMERO de la cadena y eso importa: es el más estrecho de los
  // cuatro —deja las filas de UNA transacción— así que lo que sobrevive a él
  // es lo poco que los demás tienen que recorrer, y el orden en que el
  // tendero los lee es el mismo en que se aplican.
  //
  // `includes` Y NO `===`: el código se lee de una captura o se escucha por
  // teléfono, así que media palabra tiene que servir mientras se teclea el
  // resto. Sin distinguir mayúsculas, porque el campo las pinta en
  // mayúsculas pero no transforma lo escrito.
  //
  // UNA FILA SIN CÓDIGO NO CASA NUNCA, y es correcto: es anterior a la
  // migración 147 y no hay código por el que buscarla. Hoy no existe
  // ninguna, ni en dev ni en producción.
  // ── QUÉ SE BUSCA CON EL BUSCADOR ──────────────────────────────────
  //
  // Encargo del dueño el 2026-10-23: *«el search buscar, debe permitir buscar
  // por código, monto o producto»*. Nació buscando solo el código.
  //
  // SE BUSCA LO QUE LA FILA DICE, y por eso el texto se arma con las MISMAS
  // piezas que la fila pinta: su código, su nombre —los productos de la venta
  // o lo que el tendero escribió— y sus importes. Un buscador que mire
  // columnas que la pantalla no enseña devuelve filas que, a la vista, no
  // tienen nada que ver con lo buscado.
  //
  // LOS IMPORTES VAN EN LAS DOS FORMAS, cruda y formateada, a propósito: el
  // tendero teclea lo que recuerda («112.84») o lo que copia de la pantalla
  // («Bs. 100.001,87»), y las dos tienen que encontrar la misma fila. Es más
  // barato meter las dos cadenas que adivinar en cuál está pensando.
  //
  // Y LOS BOLÍVARES TECLEADOS TAMBIÉN, cuando los hay: para un abono pagado
  // en bolívares, esa es la cifra que el cliente entregó y la que el tendero
  // tiene en la cabeza.
  const textoDeLaFila = (f: Fila) => {
    if (f.clase === "contado") {
      return [
        f.v.transactionCode ?? "",
        f.v.lineas.map((l) => l.name).join(" "),
        String(f.v.amount),
        formatPriceAmount(f.v.amount, (f.v.currency ?? "COP") as PriceCurrency),
      ].join(" ");
    }
    const m = f.m;
    const fiado = m.type === "charge" ? m : (porId.get(m.applies_to_movement_id ?? "") ?? null);
    const nombre =
      (fiado?.sale_id ? (productosPorVenta[fiado.sale_id] ?? []) : []).join(" ") ||
      fiado?.description ||
      m.description ||
      "";
    return [
      m.transaction_code ?? "",
      nombre,
      String(m.amount),
      formatPriceAmount(Number(m.amount), (m.currency ?? "COP") as PriceCurrency),
      m.entry_amount != null ? String(m.entry_amount) : "",
      m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : "",
    ].join(" ");
  };

  const buscado = codigo.trim().toLowerCase();
  const porCodigo =
    buscado === "" ? filas : filas.filter((f) => textoDeLaFila(f).toLowerCase().includes(buscado));

  const porTipo =
    tipo === "todos"
      ? porCodigo
      : porCodigo.filter((f) =>
          tipo === "cash" ? f.clase === "contado" : f.clase === "movimiento" && f.m.type === tipo,
        );

  // EL FILTRO POR ESTADO MIRA EL CHIP QUE SE DIBUJA, no una regla paralela:
  // los dos salen de `pieDeLaFila`. Una venta de contado no tiene chip, así
  // que ningún estado la selecciona — y es correcto: no deja nada debiendo.
  const porMoneda =
    moneda === "todas"
      ? porTipo
      : porTipo.filter((f) =>
          f.clase === "movimiento" ? f.m.currency === moneda : f.v.currency === moneda,
        );

  const visibles =
    estado === "todos"
      ? porMoneda
      : porMoneda.filter(
          (f) => f.clase === "movimiento" && pieDeLaFila(f.m).chipDeLaFila === estado,
        );

  // LOS LIBROS QUE ESTE NEGOCIO LLEVA, para el filtro de moneda. De `ledger`
  // y no de las filas: un negocio venezolano lleva dólares y euros aunque
  // este cliente solo tenga movimientos en uno, y el filtro tiene que ser el
  // mismo en todas las fichas. Vacío en uno colombiano, donde no se dibuja.
  const monedasDelNegocio: readonly PriceCurrency[] = ledger ? (["USD", "EUR"] as const) : [];

  // LA PÁGINA VUELVE A LA 1 AL CAMBIAR DE FILTRO, y esto no es cosmético.
  // Sin ello, quien esté en la página 3 de «Todas» y toque «De contado» ve una
  // lista vacía con el paginador diciendo «Página 1 de 1» -- porque `safePage`
  // la acota al pintar pero `page` sigue valiendo 3, así que al volver a
  // «Todas» salta a la 3 sin que nadie lo haya pedido. Es el mismo estado
  // sirviendo a dos preguntas distintas.
  //
  // SE HACE EN EL SETTER Y NO EN UN EFECTO. La primera versión fue un
  // `useEffect(..., [tipo])` y `eslint` lo rechazó con
  // `react-hooks/set-state-in-effect` -- con razón: pinta la página vieja,
  // luego la corrige, y son dos renders donde cabe uno.
  //
  // Y era además el fallo que `PL-4` describe entrando por la puerta que esa
  // ficha avisa: el lint lleva en rojo desde el 2026-09-20 por otra cosa, así
  // que un error nuevo se habría leído como «ya, es PL-4».
  //
  // El filtro es lo único que cambia `tipo`, así que las dos cosas se mueven
  // juntas aquí y no hay estado que sincronizar.
  function cambiarTipo(t: TipoFiltro) {
    setTipo(t);
    setPage(1);
  }

  // Por lo mismo que `cambiarTipo`, y conviene que estén pegadas: dos filtros
  // que reinicien la página de formas distintas es como se descubre que uno
  // de los dos no lo hacía.
  function cambiarEstado(e: EstadoFiltro) {
    setEstado(e);
    setPage(1);
  }

  function cambiarMoneda(c: MonedaFiltro) {
    setMoneda(c);
    setPage(1);
  }

  function cambiarCodigo(c: string) {
    setCodigo(c);
    setPage(1);
  }

  // LA CABECERA SE PINTA SIEMPRE, incluso sin un solo movimiento. Si
  // desapareciera con la lista, un filtro que no deja nada se llevaría por
  // delante el único control que sirve para deshacerlo.
  const cabecera = titulo ? (
    // EL TÍTULO ARRIBA Y LOS FILTROS DEBAJO, desde el 2026-10-23: *«bajemos
    // los filtros para abajo del título de la sección»*. Iban a su derecha,
    // en la misma línea, y con dos chips ya no caben a 375px sin partir el
    // título en dos renglones.
    <div className="flex flex-col gap-2">
      {titulo}
      {filas.length > 0 ? (
        <FiltrosDelHistorial
          tipo={tipo}
          setTipo={cambiarTipo}
          estado={estado}
          setEstado={cambiarEstado}
          moneda={moneda}
          setMoneda={cambiarMoneda}
          monedas={monedasDelNegocio}
          codigo={codigo}
          setCodigo={cambiarCodigo}
        />
      ) : null}
    </div>
  ) : null;

  // `filas` Y NO `movements.length`: un cliente cuyo único historial son
  // abonos ya no tiene nada que enseñar aquí, y contar los movimientos en
  // bruto le pintaría una lista vacía con cabecera en vez del hueco dibujado.
  if (filas.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        {/* EL HUECO SE DIBUJA, no se deja en blanco. Del mock del dueño del
            2026-10-18: una caja con la frase centrada y, debajo, qué hacer
            para llenarla. Un «Todavía no hay…» suelto a la izquierda se lee
            como un error de carga; esto se lee como una pantalla nueva.

            LOS DOS BOTONES QUE CITA SON LOS QUE ESTÁN JUSTO ENCIMA, y por eso
            se nombran con sus palabras exactas. El día que uno se renombre
            —«Agregar fiado» pasó a «Venta o fiado» ese mismo día— esta frase
            hay que cambiarla con él, o manda a buscar algo que no existe. */}
        <EmptyState
          title="Todavía no hay transacciones registradas"
          subtitle="Para registrar una transacción selecciona “Agregar abono” o “Venta o fiado”"
        />
      </div>
    );
  }

  // «No hay de ESO» no es «no hay ninguno», y la segunda frase sería falsa con
  // la lista entera a un toque de distancia. El título lo arma
  // `tituloDeListaVacia`, compartido con la pantalla del cliente para que las
  // dos digan lo mismo — y nombra los filtros puestos en vez de un genérico
  // «no coincide», que con tres chips obliga a mirarlos de vuelta.
  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <EmptyState subtitle={tituloDeListaVacia({ tipo, estado, moneda, codigo })} />
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagina = visibles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {cabecera}
      {/* ── UNA CARD POR TRANSACCIÓN, NO UNA LISTA CON DIVISORES ────────
          Frame `1548:11048`, encargo del dueño el 2026-10-22: *«El historial
          de transacciones lo dejaste como tabla, son cards, una card por
          transacción»*.

          Era un solo `ul` con borde y `divide-y`: las filas compartían caja y
          se separaban con una raya. El frame les da a cada una su borde, su
          radio y su hueco.

          NO ES SOLO ESTÉTICA, Y SE NOTA DESDE QUE LA FILA TIENE DOS PISOS: con
          divisores, la raya entre «Por cobrar» y la transacción siguiente se
          ve igual que la que separa los dos pisos DENTRO de una fila, así que
          no hay forma de saber dónde acaba una transacción. El borde las
          cierra. */}
      <ul className="flex flex-col gap-2">
        {pagina.map((fila) => {
          // LA TARJETA LA DIBUJA `HistoryCard`, la misma del historial del
          // cliente — frames `1861:15468`, `1861:15490` y `1861:15513`,
          // 2026-10-30. Aquí solo se decide qué datos lleva y a dónde abre.
          if (fila.clase === "contado") {
            const v = fila.v;
            return (
              <HistoryCard
                key={`venta-${v.saleId}-${v.currency ?? "cop"}`}
                kind="contado"
                productos={v.lineas.map((l) => l.name)}
                createdAt={v.createdAt}
                amount={v.amount}
                currency={v.currency}
                ledger={ledger}
                href={
                  navegable
                    ? `/transacciones/venta/${v.saleId}/${(v.currency ?? "cop").toLowerCase()}`
                    : null
                }
              />
            );
          }
          const m = fila.m;
          const { cifraPorCobrar, chipDeLaFila } = pieDeLaFila(m);
          // CÓMO SE LLAMA UN FIADO: los productos de su venta, y lo que el
          // tendero escribió si no los hay. Las filas anteriores al 2026-10-22
          // llevan el nombre copiado en `description`, y es el único que tienen.
          const productos =
            m.type === "charge"
              ? m.sale_id && (productosPorVenta[m.sale_id] ?? []).length > 0
                ? productosPorVenta[m.sale_id]
                : m.description
                  ? [m.description]
                  : []
              : [];
          return (
            <HistoryCard
              key={m.id}
              kind={m.type === "charge" ? "fiado" : "abono"}
              productos={productos}
              createdAt={m.created_at}
              amount={Number(m.amount)}
              currency={m.currency}
              ledger={ledger}
              // Cada fila abre su propia ficha (2026-10-23). La de un reparto
              // abre la de su última línea, que enseña el reparto entero.
              href={navegable ? hrefDeLaFila(m) : null}
              porCobrar={cifraPorCobrar}
              chip={chipDeLaFila}
            />
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text="Anterior"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage > 1) setPage(safePage - 1);
                }}
                className={safePage <= 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm text-muted-foreground">
                Página {safePage} de {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                text="Siguiente"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage < pageCount) setPage(safePage + 1);
                }}
                className={safePage >= pageCount ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}

// Una fila del historial: o un movimiento, o una venta pagada entera.
type Fila =
  | { clase: "movimiento"; fecha: string; m: Movement }
  | { clase: "contado"; fecha: string; v: VentaDeContado };

// AQUÍ VIVÍAN `FilaEnvuelta` Y `FilaDeContado`, el dibujo de cada tarjeta.
// Se fueron el 2026-10-30 a `components/dashboard/history-card.tsx`, que
// comparten las dos vistas. Lo que decidían y sigue en pie —el verde
// `emerald-700` medido a 5,36:1, el «+» de una venta, el chevron que se va
// sin enlace— está escrito allí o lo cubre el token `money-in`.
