import { ETIQUETA_DEL_ESTADO, type EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { CLIENT_STATUS_BADGE_CLASS } from "@/lib/types";

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
export function ChipDeEstado({ estado }: { estado: EstadoDelPlazo }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-px text-xs leading-4 ${ESTILO[estado]}`}
    >
      {ETIQUETA_DEL_ESTADO[estado]}
    </span>
  );
}
