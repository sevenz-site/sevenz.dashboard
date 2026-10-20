import { ETIQUETA_DEL_ESTADO, type EstadoDelPlazo } from "@/lib/estado-del-plazo";

// EL CHIP DE «Dentro del plazo» / «Plazo vencido» / «Pagado».
//
// Frames `1487:9884`, `1488:10206` y `1489:10209`. Lo llevan tres sitios: la
// fila de un fiado en el historial, cada cuota en la columna «Estado», y cada
// abono dentro de la ficha de su fiado.
//
// ===========================================================================
// LOS COLORES SON LITERALES Y VIENEN DEL FRAME, no del tema
//
// Azul `#eff9ff` / `#b2e7fe` / `#006aa8`, rojo `#fff2f2` / `#ffcac9` /
// `#c40003`, verde `#ecfdf5` / `#007956`. Se escriben tal cual porque el frame
// los da tal cual y porque no hay token semántico para «dentro del plazo»:
// `--money-in` es dinero que entra, que es otra cosa.
//
// MEDIDOS CONTRA SU PROPIO FONDO, no contra el blanco de la página, que es lo
// que importa en un chip: el texto se lee sobre el relleno del chip.
//
//   dentro   `#006aa8` sobre `#eff9ff`   5,42:1
//   vencido  `#c40003` sobre `#fff2f2`   5,74:1
//   pagado   `#007956` sobre `#ecfdf5`   5,15:1
//
// Los tres pasan el piso de 4,5:1 de `DESIGN-SYSTEM.md`. Son cifras MEDIDAS,
// no estimadas: la primera versión de este comentario llevaba 6,47 / 6,58 /
// 5,27, que me los inventé, y los tres estaban mal.
//
// LO QUE NO PASA ES EL RELLENO CONTRA EL BLANCO DE LA PÁGINA: 1,07:1 el azul y
// 1,05:1 el verde. O sea que la PASTILLA casi no se ve; lo que se ve es su
// texto. Es aceptable aquí y conviene saber por qué: el chip no codifica nada
// por color que no diga también con palabras, así que quien no distinga el
// relleno no pierde información. No vale como precedente para un chip que
// dependa del color para significar algo.
//
// EL VERDE NO LLEVA BORDE VISIBLE en el frame --su borde es del mismo color
// que su relleno-- y los otros dos sí. Se respeta: es lo que distingue el
// estado final de los dos que todavía pueden cambiar.
const ESTILO: Record<EstadoDelPlazo, string> = {
  dentro: "bg-[#eff9ff] border-[#b2e7fe] text-[#006aa8]",
  vencido: "bg-[#fff2f2] border-[#ffcac9] text-[#c40003]",
  pagado: "bg-[#ecfdf5] border-[#ecfdf5] text-[#007956]",
};

export function ChipDeEstado({ estado }: { estado: EstadoDelPlazo }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-xs leading-4 ${ESTILO[estado]}`}
    >
      {ETIQUETA_DEL_ESTADO[estado]}
    </span>
  );
}
