"use client";

import Link from "next/link";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AbonoAcciones } from "@/components/dashboard/abono-acciones";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import type { EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { CLASE_TARJETA } from "@/components/dashboard/tarjeta-de-fiado";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

// UN ABONO, COMO TARJETA. El reflejo de `TarjetaDeFiado`.
//
// Encargo del dueño el 2026-10-20: *«Detalle de los fiados también deben
// mostrar la lista de lo que se ha abonado (mismo patrón como abono muestra
// los fiados)»*. Desde el 2026-10-19 el detalle de un abono enseña la tarjeta
// del fiado que pagó; esto es la misma relación leída al revés.
//
// COMPARTE LA FORMA Y NO EL COMPONENTE, y conviene saber por qué se decidió
// así en vez de añadirle un modo a `TarjetaDeFiado`: las dos tarjetas dicen
// cosas distintas en los mismos huecos —una lleva «Debe $X» debajo de la fecha
// y la otra no lleva nada ahí; una suma en rojo y la otra resta en azul— y un
// solo componente con un `if` por cada hueco acaba siendo más difícil de leer
// que dos de veinte líneas. Lo que NO se duplica es la cadena de clases, que
// viene de `CLASE_TARJETA`: es lo único que tiene que seguir siendo idéntico
// para que las dos se vean como la misma cosa.
export type AbonoDirigido = {
  movementId: string;
  fecha: string;
  currency: PriceCurrency | null;
  amount: number;
  descripcion: string | null;
  // LA TASA QUE ESTE ABONO SELLÓ, para los bolívares «al día del abono».
  // `null` en un negocio colombiano y en todo lo anterior al sellado.
  tasaSellada?: number | null;
  // EN QUÉ MONEDA SE TECLEÓ Y CUÁNTO, para el diálogo de editar: se edita en
  // la misma moneda que se usó, no en la del libro. Un abono escrito como
  // «Bs. 900» guardó 900 aquí y $1,08 en `amount`; dejar editar solo el dólar
  // convertiría ese respaldo en mentira.
  entryCurrency?: "VES" | PriceCurrency | null;
  entryAmount?: number | null;
  // Lo máximo que admite su fiado contando este abono, para el tope del
  // diálogo. `null` en un abono sin dirigir.
  techo?: number | null;
};

export function TarjetaDeAbono({
  abono,
  href,
  estado,
}: {
  abono: AbonoDirigido;
  // Siempre navega. A diferencia de la del fiado, esta tarjeta no tiene el uso
  // de «elegir uno» dentro de un flujo, así que no necesita `onClick`.
  href: string;
  // EL ESTADO DE LA CUOTA QUE ESTE ABONO CUBRIÓ — frame `1489:10209`, y es la
  // respuesta del dueño del 2026-10-20 a qué mide el chip. `undefined` cuando
  // el fiado no tiene plazo: no hay fecha contra la que juzgar y no se dibuja.
  estado?: EstadoDelPlazo;
}) {
  // «Bs. … AL DÍA DEL ABONO», con la tasa SELLADA en el movimiento y no la de
  // hoy — frame `1489:10209`, nodo `1489:10240`.
  //
  // LLEVABA LA TASA DE HOY hasta el 2026-10-20, copiando la tarjeta del fiado,
  // y ahí la pregunta sí es «cuánto es esto hoy». Aquí es otra: ese dinero ya
  // cambió de manos. Decirle al tendero que su abono de hace dos meses «son»
  // los bolívares de hoy es contarle una conversión que nunca ocurrió.
  //
  // Sale de la tasa que el propio abono tiene guardada. Sin ella no se dibuja
  // la línea: inventar una conversión es peor que no darla, y un movimiento
  // anterior a que existiera el sellado no la tiene.
  const enBs =
    abono.tasaSellada != null ? abono.amount * abono.tasaSellada : null;

  return (
    // EL «⋮» VA FUERA DEL ENLACE, no dentro. Un `<button>` dentro de un `<a>`
    // es HTML inválido y el navegador decide solo qué pasa al tocarlo; la
    // tarjeta pasa a ser un contenedor con el enlace y el botón como hermanos.
    // El borde y el fondo se quedan en el contenedor para que la pastilla siga
    // siendo una sola cosa a la vista.
    <div className={`${CLASE_TARJETA} gap-2`}>
      <Link href={href} className="flex min-w-0 flex-1 items-center justify-between gap-3">
      {/* LA FECHA ARRIBA Y EL CHIP DEBAJO, sin título — frame `1489:10209`,
          nodos `1489:10233` y el `chip_info` de al lado.

          LLEVABA «Abono · descripción» y la fecha pequeña debajo, copiando la
          fila del historial. El frame no lo pide: dentro de la ficha de su
          fiado ya se sabe que son abonos, así que repetir la palabra en cada
          tarjeta no distingue ninguna de otra. Lo que las distingue es cuándo
          se pagaron y si llegaron a tiempo. */}
      {/* `shrink-0` Y LA FECHA SIN PARTIR. Medido a 375px el 2026-10-20: con
          `min-w-0` la columna cedía y «20 de oct de 2026» caía en dos líneas,
          que es lo que identifica cada tarjeta de la lista. Lo que cede ahora
          es la línea de bolívares de la derecha, que es la que sobra. */}
      <div className="flex shrink-0 flex-col gap-1">
        <span className="whitespace-nowrap text-sm leading-5">{formatDate(abono.fecha)}</span>
        {estado ? <ChipDeEstado estado={estado} /> : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-col items-end">
          {/* AZUL Y CON «+» — frame `1479:9456`, nodos `1479:9641` y
              `1479:9700`: `+$00.00` en `#0062fb`.

              LLEVABA «−» Y ERA MÍO. El razonamiento parecía bueno —un abono
              resta de la deuda— pero el frame dibuja «+» en las dos tarjetas,
              igual que la del fiado dentro de un abono (`1465:18552`, en
              rojo). El signo aquí no es el del saldo: es el de la cifra que se
              suma a lo abonado. Lo que distingue a las dos tarjetas es el
              color, no el signo. */}
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
            {abono.currency ? (
              <CurrencyFlagIcon currency={abono.currency} className="size-3.5 shrink-0" />
            ) : null}
            +{formatPriceAmount(abono.amount, abono.currency ?? "COP")}
          </span>
          {enBs != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatBs(enBs)} al día del abono
            </span>
          ) : null}
        </div>
      </div>
      </Link>
      {/* EL «⋮» SUSTITUYE AL CHEVRON del frame viejo. Los dos vivían en el
          mismo sitio y los dos dicen «aquí hay más»; el chevron lo decía de la
          navegación, que ya la tiene el enlace de al lado, y el menú lo dice
          de las dos acciones que el dueño pidió el 2026-10-20. */}
      <AbonoAcciones
        movementId={abono.movementId}
        montoTecleado={abono.entryAmount ?? abono.amount}
        monedaTecleada={abono.entryCurrency ?? abono.currency}
        techo={abono.techo ?? null}
        monedaDelLibro={abono.currency}
      />
    </div>
  );
}
