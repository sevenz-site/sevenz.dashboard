import { ETIQUETA_DEL_ESTADO, type EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { CLIENT_STATUS_BADGE_CLASS, CLIENT_STATUS_LABEL } from "@/lib/types";

// EL CHIP DE «Dentro del plazo» / «Plazo vencido» / «Pagado».
//
// Frames `1487:9884`, `1488:10206` y `1489:10209`. Lo llevan tres sitios: la
// fila de un fiado en el historial, cada cuota en la columna «Estado», y cada
// abono dentro de la ficha de su fiado.
//
// ===========================================================================
// LA PALETA ES LA DE `CLIENT_STATUS_BADGE_CLASS`, NO LA DEL FRAME
//
// Reportado por el dueño el 2026-10-21 con la leyenda «Qué significa cada
// estado» delante: *«los colores de los estados de los fiados en el historial
// discrepan de los colores de las chips definidas originalmente»*.
//
// LA DIFERENCIA ERA UNA Y GRAVE: «Plazo vencido» salía en ROJO aquí y es
// ÁMBAR en esa leyenda, donde el rojo está reservado a «Crítico» —«debe hace
// más de 30 días sin abonar»—. Dos severidades distintas pintadas igual, y en
// la pantalla donde el tendero decide a quién cobrar primero: un fiado que se
// pasó un día del plazo se leía con la misma alarma que uno de mes y medio.
//
// EL FRAME DECÍA ROJO (`1488:10206`) y aquí se le lleva la contraria a
// propósito. Un frame dibuja UNA pantalla; esa leyenda define un SISTEMA que
// ya está en uso en la lista de clientes, en los filtros y en la cartera. Un
// color que significa dos cosas según la pantalla deja de significar nada.
//
// SE IMPORTAN LAS CLASES, NO SE COPIAN LOS VALORES: el día que esa paleta
// cambie, este chip cambia con ella. Copiarlos es exactamente cómo nació la
// discrepancia que esta nota viene a cerrar — aquí había tres hexadecimales
// escritos a mano con sus contrastes medidos al lado, todo correcto por
// separado y desalineado del resto de la app.
//
// «Pagado» NO EXISTE en `ClientStatus` —es un estado del fiado, no del
// cliente— así que toma el de `a_favor`, que en esa misma paleta es el verde
// de «ya no hay nada que cobrar».
const ESTILO: Record<EstadoDelPlazo, string> = {
  dentro: CLIENT_STATUS_BADGE_CLASS.dentro_del_plazo,
  vencido: CLIENT_STATUS_BADGE_CLASS.plazo_vencido,
  pagado: CLIENT_STATUS_BADGE_CLASS.a_favor,
};

// `whitespace-nowrap` NO ES OPCIONAL AQUÍ. Lo reportó el dueño el 2026-10-20
// con una captura: en la columna «Estado» de las cuotas, «Dentro del plazo»
// caía en dos líneas dentro de la pastilla y se leía como dos chips rotos.
// Una pastilla partida deja de parecer una etiqueta; quien la ve piensa que
// la pantalla se rompió, no que el texto es largo.
//
// Quien lo monte tiene que darle sitio. Es la regla al revés de lo normal --
// aquí NO cede el chip, cede la columna de al lado-- y es deliberada: el
// estado es la respuesta de esa fila.
// ── «A FAVOR» ENTRA AQUÍ, Y NO ES UN ESTADO DEL PLAZO ──────────────────
//
// Lo pidió el dueño el 2026-10-23, viendo un «Total por cobrar» en verde con
// un signo menos: *«si el motivo es porque el cliente tiene saldo a favor
// entonces pongámosle el chip "A favor"»*.
//
// NO SE AÑADE A `EstadoDelPlazo`, que describe cómo va un FIADO respecto de su
// plazo. Que un cliente tenga saldo a favor no es eso: es un estado de su
// CUENTA, y ya vive en `ClientStatus` con su etiqueta y su color.
//
// Y ENTRA EN ESTE COMPONENTE EN VEZ DE EN UNO NUEVO porque la pastilla —su
// forma, su borde, su `whitespace-nowrap`— ya está resuelta aquí, con las
// razones escritas arriba. Un segundo chip con las clases copiadas es
// exactamente cómo nació la discrepancia de colores que esta cabecera cuenta.
// ── «SIN PLAZO» ENTRA POR LA MISMA PUERTA, Y TAMPOCO ES UN ESTADO DEL PLAZO ─
//
// Un fiado al que nunca se le puso fecha no tiene estado de plazo: no hay
// nada que comparar, y por eso `estadoDelFiado` devuelve `null`. Pero la fila
// sí necesita decir algo, porque desde el 2026-10-23 el chip existe para que
// el tendero vea de un vistazo cuál es el fiado más crítico sin abrir ninguno
// —y un fiado sin fecha es justo uno que hay que ir a arreglar—. Dejarlo en
// blanco lo escondía.
//
// Decisión del dueño ese día, preguntado con las dos salidas delante. Toma
// la etiqueta y el color de `ClientStatus.sin_plazo`, que es donde ese estado
// ya vive: mismo ámbar que «Plazo vencido», porque en esa leyenda las dos son
// igual de graves.
export type EstadoDelChip = EstadoDelPlazo | "a_favor" | "sin_plazo";

const ESTILO_DE_CUENTA: Record<"a_favor" | "sin_plazo", string> = {
  a_favor: CLIENT_STATUS_BADGE_CLASS.a_favor,
  sin_plazo: CLIENT_STATUS_BADGE_CLASS.sin_plazo,
};

const ETIQUETA_DE_CUENTA: Record<"a_favor" | "sin_plazo", string> = {
  a_favor: CLIENT_STATUS_LABEL.a_favor,
  sin_plazo: CLIENT_STATUS_LABEL.sin_plazo,
};

export function ChipDeEstado({ estado }: { estado: EstadoDelChip }) {
  const deCuenta = estado === "a_favor" || estado === "sin_plazo";
  const clase = deCuenta ? ESTILO_DE_CUENTA[estado] : ESTILO[estado];
  const texto = deCuenta ? ETIQUETA_DE_CUENTA[estado] : ETIQUETA_DEL_ESTADO[estado];
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-px text-xs leading-4 ${clase}`}
    >
      {texto}
    </span>
  );
}
