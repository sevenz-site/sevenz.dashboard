"use client";

import { useSearchParams } from "next/navigation";
import { Download, FileUser, PackageSearch, Truck } from "lucide-react";
import { track } from "@/lib/mixpanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aISO, rangoDe } from "@/lib/reports/rango";

// ═══════════════════════════════════════════════════════════════════════
// «DESCARGAR» — frames `1502:10291` (el botón) y `1667:19722` (el menú)
//
// Leídos los dos con el puente de escritorio el 2026-10-27. El botón es texto
// «Descargar» 14/20 en `#dadada` con el icono a la DERECHA, 5,5 de hueco; el
// menú mide 174×88, fondo blanco, radio 16, relleno 8, y dos filas de 36 con
// relleno 8/10 y 10 de hueco, texto `#272727`.
//
// ───────────────────────────────────────────────────────────────────────
// TRES DIFERENCIAS CON EL FRAME, DICHAS EN VOZ ALTA
//
// 1. EL FRAME ESCRIBE «Decargar» en las dos filas. Es una errata --el botón
//    de arriba, en el mismo frame, dice «Descargar»-- y se escribe bien.
// 2. EL FRAME OFRECE DOS FILAS, clientes e inventario, y hay TRES apartados.
//    Además el primero se llama **Facturación** desde que el dueño renombró
//    la pestaña, no «clientes».
// 3. **SOLO FACTURACIÓN DESCARGA ALGO EN ESTA FASE.** Inventario y
//    Proveedores no tienen pantalla todavía --sus apartados son estado
//    vacío--, así que sus filas NO SE DIBUJAN en vez de salir apagadas. Un
//    control muerto se lee como que la app está rota (`CT-58`), y dos de tres
//    apagadas se leen como una pantalla a medio cargar.
//
// ───────────────────────────────────────────────────────────────────────
// UN MENÚ ANCLADO, NO UNA HOJA DE ABAJO
//
// Y esto SE APARTA de lo que escribí en el plan de esta entrega, que decía
// hoja. La razón de aquel párrafo era la de `reportes-fecha.tsx`: un
// calendario de rango mide ~320px de alto y un popover anclado a la cabecera
// lo estrella contra el borde de un teléfono. **Aquí el contenido mide 88px**,
// así que esa razón no aplica -- y el frame dibuja un popover de 174×88, no
// una hoja. El precedente está en `order-more-menu.tsx`, que ya ancla un menú
// a la cabecera de una pantalla.
//
// ───────────────────────────────────────────────────────────────────────
// UN ENLACE DE VERDAD, NO UN `fetch` NI UNA ACCIÓN DE SERVIDOR
//
// La fila es un `<a href>` a una ruta que contesta con
// `Content-Disposition: attachment`, así que la hoja de descarga del sistema
// se encarga del fichero y la cookie de sesión viaja sola en la navegación.
//
// LO QUE SE EVITA, y es la mitad que importa: una acción de servidor
// devolvería texto, el navegador tendría que armar un `Blob` y disparar un
// `<a download>` sintético, y **en Safari de iPhone eso abre el CSV como una
// página de texto sin forma de guardarlo**. `CLAUDE.md` tiene escrito que
// este público es mayoritariamente de teléfono, y buena parte iPhone.
//
// Y de paso la URL es repetible: una cifra discutida se vuelve a generar
// pegando el enlace, en vez de reconstruir la pantalla que lo produjo.
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿DESCARGAN LOS INFORMES, Y CUÁL?
 *
 * Encargo del dueño el 2026-10-29, y es **el más caro de los cuatro** si se
 * contesta mal.
 *
 * QUÉ DECIDE: la parte B del plan --el `.xlsx`, el `.pdf` y el correo
 * semanal-- se construye sobre el supuesto de que el tendero quiere llevarse
 * estos datos. Son **tres dependencias nuevas**, cada una con su
 * `new-api-risk-review` obligatorio, más un proveedor de correo y un cron.
 *
 *   · Si se descarga poco o nada, ese trabajo no se justifica y lo honesto es
 *     quitarlo del plan, no construirlo y descubrirlo después.
 *   · Si se descarga mucho pero solo facturación, el `.xlsx` empieza por ahí
 *     y el inventario puede esperar.
 *   · Y si alguien descarga el mismo informe cada semana, eso ES la señal del
 *     correo semanal: ya está haciendo a mano lo que el cron haría solo.
 *
 * SE MANDA EN EL MISMO GESTO QUE ABRE LA RUTA y no en el servidor, aunque la
 * ruta sea de servidor y pudiera hacerlo: el `<a>` provoca una descarga, no
 * una navegación, así que el servidor ve la petición pero la PANTALLA no se
 * entera de nada. Medir en la ruta contaría también cualquier reintento del
 * navegador, que en una descarga no es raro.
 */
export function ReportesDescargar() {
  const params = useSearchParams();

  // EL RANGO QUE SE DESCARGA ES EL QUE ESTÁ PUESTO, siempre, y por eso se
  // resuelve aquí en vez de mandar los parámetros tal cual: la pantalla
  // interpreta un `?desde=` ausente como «los últimos 30 días», y un fichero
  // que trajera otro rango que el de la pantalla sería la clase de diferencia
  // que nadie detecta mirando.
  //
  // La ruta NO acepta un rango ausente -- ver su propio archivo: una pantalla
  // no puede quedarse en blanco, pero un fichero es una prueba, y uno con el
  // rango adivinado es peor que ninguno. Así que las dos fechas van explícitas.
  const rango = rangoDe({
    desde: params.get("desde") ?? undefined,
    hasta: params.get("hasta") ?? undefined,
    periodo: params.get("periodo") ?? undefined,
  });

  const query = new URLSearchParams({
    desde: aISO(rango.desde),
    hasta: aISO(rango.hasta),
  });
  // EL FILTRO DE CLIENTE TAMBIÉN VIAJA. El encargo del dueño dice «la descarga
  // se realiza con filtros aplicados», y con un cliente elegido la pantalla ya
  // avisa de que está enseñando solo a esa persona.
  const cliente = params.get("cliente");
  if (cliente) query.set("cliente", cliente);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // SIN FONDO NI BORDE, como el frame: es un botón de texto sobre la
          // cabecera oscura. `#dadada` es `--brand-secondary`, que ya existe.
          // El icono va DETRÁS del texto, que es el orden del frame.
          className="-mr-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-brand-secondary outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          Descargar
          <Download className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      {/* `rounded-2xl` = 16, `p-2` = 8 y filas de 36 (`h-9`) con 10 de hueco y
          10 de relleno: todo del frame.

          LO QUE NO SE COPIA ES EL ANCHO DE 174. Esa cifra la fija el rótulo
          más largo del frame --«Decargar inventario», 108px-- y el de aquí es
          «Descargar facturación», que no cabe: medido en pantalla, parte en
          dos líneas y se sale de la fila de 36. Un menú que se ajusta a su
          contenido dice lo mismo sin romperse; forzar los 174 habría sido
          copiar el número y perder la forma.

          ── `w-auto` NO ES UN RETOQUE: SIN ÉL EL MENÚ SALE CORTADO ──────
          El primitivo `DropdownMenuContent` trae
          `w-(--radix-dropdown-menu-trigger-width)`, o sea que se ajusta al
          ancho del DISPARADOR. Aquí el disparador es «Descargar ⬇», unos
          110px, así que el menú nacía de 110px con un rótulo de 170 y un
          `overflow-x-hidden` encima: en pantalla se leía «Descargar fa…».
          Lo reportó el dueño el 2026-10-29 con la captura.

          Es decir, el párrafo de arriba describía una intención que el
          primitivo no dejaba cumplir. Ahora sí se cumple. */}
      <DropdownMenuContent align="end" className="w-auto rounded-2xl p-2">
        <DropdownMenuItem asChild className="h-9 gap-2.5 px-2.5 whitespace-nowrap">
          {/* `prefetch={false}` no aplica: esto no es un `Link` de Next a
              propósito. Un `Link` haría navegación de cliente y la respuesta
              de descarga no es una página -- tiene que salir del navegador. */}
          <a
            href={`/api/reportes/movimientos?${query.toString()}`}
            onClick={() => track("Report Export Downloaded", { que: "facturacion" })}
          >
            <FileUser aria-hidden="true" />
            Descargar facturación
          </a>
        </DropdownMenuItem>
        {/* ── UNA OPCIÓN POR APARTADO — encargo del dueño el 2026-10-29 ──
            *«debe mostrar las opciones de cada tab»*.

            NACIERON HOY Y NO ANTES por una razón que caducó: hasta el
            2026-10-28 Inventario y Proveedores eran estado vacío, y una fila
            que descargara una pantalla sin construir habría entregado un
            fichero de ceros. `CT-58` dice que un control muerto se lee como
            que la app está rota; uno que entrega un fichero falso es peor.

            SALEN SIEMPRE, no solo en su pestaña: el tendero que está en
            Facturación y quiere el inventario no tiene por qué cambiar de
            apartado para pedirlo. Las tres respetan el rango puesto. */}
        <DropdownMenuItem asChild className="h-9 gap-2.5 px-2.5 whitespace-nowrap">
          <a
            href={`/api/reportes/catalogo?que=inventario&${query.toString()}`}
            onClick={() => track("Report Export Downloaded", { que: "inventario" })}
          >
            <PackageSearch aria-hidden="true" />
            Descargar inventario
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="h-9 gap-2.5 px-2.5 whitespace-nowrap">
          <a
            href={`/api/reportes/catalogo?que=proveedores&${query.toString()}`}
            onClick={() => track("Report Export Downloaded", { que: "proveedores" })}
          >
            <Truck aria-hidden="true" />
            Descargar proveedores
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
