"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  allPrices,
  currencyName,
  formatPercent,
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// LAS FILAS DE UNA FICHA DE PRODUCTO, EN UN SOLO SITIO
//
// Las dibujan DOS pantallas y por eso viven aquí y no en ninguna de las dos:
//
//   · `order-product-sheet.tsx` — la hoja que abre una línea de un pedido
//     (frames `1371:7229` y `1519:11100`), donde son «el catálogo de hoy».
//   · `product-detail.tsx` — la ficha del producto del lado del dueño
//     (frame `1730:14329`), encargo del 2026-10-27.
//
// COPIAR LAS CLASES EN LA SEGUNDA ERA LA OTRA OPCIÓN Y ES LA QUE YA COSTÓ UN
// FALLO: `StickyActions` se copió a mano en una pantalla el 2026-10-20, las
// clases salieron casi idénticas --`gap-3` contra `gap-4`-- y la copia no
// heredaba lo único que el original añade. `CLAUDE.md` lo dejó escrito como
// regla: se monta el componente, nunca se copian sus clases.
//
// Y AQUÍ EL RIESGO ES EL MISMO PERO PEOR DE VER: dos fichas del mismo producto
// que enseñan el mismo precio con dos redondeos distintos no se leen como un
// descuido de maquetación, se leen como que la app no sabe cuánto cuesta.
// ═══════════════════════════════════════════════════════════════════════

export function Fila({
  nombre,
  children,
  bandera,
}: {
  nombre: string;
  children: React.ReactNode;
  bandera?: PriceCurrency;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="min-w-0 flex-1 text-xs break-words text-muted-foreground">{nombre}</span>
      <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
        {children}
        {bandera ? <CurrencyFlagIcon currency={bandera} /> : null}
      </span>
    </div>
  );
}

// Los precios de un escalón en todas las monedas que el negocio maneja.
//
// SALE DE `allPrices`, la MISMA función que pinta el catálogo y la que valida
// la orden pública. Rehacer aquí la conversión sería una tercera opinión
// sobre el mismo número, y estas pantallas existen para comprobar un precio,
// no para discutirlo.
export function BloqueDePrecios({
  titulo,
  margenLabel,
  margen,
  base,
  rates,
  enTarjeta = false,
}: {
  titulo: string;
  margenLabel: string;
  margen: number | null;
  base: { amount: number; currency: PriceCurrency } | null;
  rates: BolivarRates | null;
  // La ficha del dueño dibuja cada escalón DENTRO de su propia tarjeta
  // --frame `1730:14329`, nodos `1730:14463` y `1730:14477`-- y la hoja del
  // pedido los dibuja sueltos, uno detrás de otro. Es lo único que cambia.
  enTarjeta?: boolean;
}) {
  // Sin precio en ese escalón no hay bloque: una lista de huecos no dice
  // "todavía no lo has puesto", dice "algo se rompió".
  if (base == null) return null;

  const precios = rates ? allPrices(base, rates) : [{ ...base, origin: "base" as const }];

  return (
    <div
      className={
        enTarjeta
          ? "flex flex-col gap-2 rounded-[10px] border px-3 py-3.5"
          : "flex flex-col gap-1 py-2"
      }
    >
      <span className="text-sm">{titulo}</span>
      <div className="flex flex-col">
        {margen != null ? <Fila nombre={margenLabel}>{formatPercent(margen)}</Fila> : null}
        {precios.map((p) =>
          // Bolívares no: es el equivalente de todo lo demás, y repetirlo en
          // cada escalón convierte la lista en aritmética.
          p.currency === "VES" ? null : (
            <Fila
              key={p.currency}
              // «Precio EN dólares», y el frame dice «Precio Dólar». Es la
              // misma etiqueta en español correcto: `currencyName` devuelve
              // el plural en minúscula porque está escrito para ir dentro de
              // una frase, y «Precio dólares» no es ninguna de las dos cosas.
              nombre={`Precio en ${currencyName(p.currency)}`}
              bandera={p.currency}
            >
              {p.amount == null ? "—" : formatPriceAmount(p.amount, p.currency)}
            </Fila>
          ),
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA TARJETA DE PUBLICACIÓN — un interruptor y dos casillas
//
// La dibujan el paso 4/4 del alta (frame `1465:20077`) y la ficha del producto
// (frame `1730:14329`, nodo `1730:14578`), y en las DOS es de LEER.
//
// READ-ONLY, Y ESA DECISIÓN YA ESTABA ESCRITA: la tomó el paso 4/4 --«editing
// it here would make this a fifth editing screen instead of the re-read it
// exists to be; «Editar» goes back to the step that owns it»-- y la ficha
// hereda exactamente el mismo razonamiento, porque su pie también es un
// «Editar» que lleva al sitio donde esto sí se cambia.
//
// SIN `disabled`, Y LA DIFERENCIA SE VE. `disabled` pone el interruptor en
// gris, y un interruptor gris se lee como «esta opción no está disponible» --lo
// contrario de lo que estas dos pantallas informan, que es que el dueño SÍ
// encendió la publicación. El frame lo dibuja en su estado normal encendido.
// Así que el control conserva sus colores y pierde solo que se pueda tocar o
// enfocar.
// ═══════════════════════════════════════════════════════════════════════

export function TarjetaDePublicacion({
  publicando,
  alMayor,
  alDetal,
  // LOS DOS FRAMES DIBUJAN ESTO DISTINTO Y NO ES UN DESCUIDE DE NINGUNO:
  //
  //   · El paso 4/4 (`1465:20077`) pone un interruptor y DOS CASILLAS, y las
  //     casillas aparecen solo si el interruptor está encendido -- porque ahí
  //     se está releyendo una decisión que se acaba de tomar en pasos.
  //   · La ficha (`1730:14329`, nodo `1730:14578`) pone TRES INTERRUPTORES
  //     siempre visibles, sin esconder nada: es la foto del estado actual del
  //     producto, y un escalón que no se publica dice más apagado que ausente.
  tresInterruptores = false,
}: {
  publicando: boolean;
  alMayor: boolean;
  alDetal: boolean;
  tresInterruptores?: boolean;
}) {
  if (tresInterruptores) {
    return (
      <div className="flex flex-col gap-5 rounded-[14px] border px-3 py-3.5">
        <FilaDeInterruptor marcado={publicando} etiqueta="Publicar producto en catálogo" />
        <FilaDeInterruptor marcado={alMayor} etiqueta="Incluir precio al mayor" />
        <FilaDeInterruptor marcado={alDetal} etiqueta="Incluir precio al detal" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-[14px] border px-3 py-3.5">
      <FilaDeInterruptor marcado={publicando} etiqueta="Publicar producto en catálogo" />
      {publicando ? (
        <div className="flex flex-col gap-4">
          <FilaDeControl marcado={alMayor} etiqueta="Incluir precio al mayor" />
          <FilaDeControl marcado={alDetal} etiqueta="Incluir precio al detal" />
        </div>
      ) : null}
    </div>
  );
}

function FilaDeInterruptor({ marcado, etiqueta }: { marcado: boolean; etiqueta: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 text-sm leading-5">{etiqueta}</span>
      <Switch
        checked={marcado}
        aria-readonly="true"
        tabIndex={-1}
        className="pointer-events-none"
      />
    </div>
  );
}

function FilaDeControl({ marcado, etiqueta }: { marcado: boolean; etiqueta: string }) {
  return (
    <div className="flex items-center gap-2">
      {/* Same reason as the switch above: not `disabled`, or a ticked box
          turns grey and stops reading as ticked. */}
      <Checkbox
        checked={marcado}
        aria-readonly="true"
        tabIndex={-1}
        className="pointer-events-none size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 text-xs leading-4">{etiqueta}</span>
    </div>
  );
}
