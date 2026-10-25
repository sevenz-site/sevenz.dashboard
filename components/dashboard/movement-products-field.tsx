"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buscarProductos, type ProductoBuscado } from "@/app/(app)/productos/actions";
import { totalDeLineas, type LineaDeProducto } from "@/lib/sale-lines";
import { formatAmountForInput, parseTypedAmount } from "@/lib/products/price";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";

// QUÉ SE LLEVÓ EL CLIENTE, dentro del formulario de fiado. Paso 8 del orden
// acordado, entregable `E` / `CT-51`.
//
// ===========================================================================
// IT LIVES IN ITS OWN FILE AND THAT IS THE POINT. The plan's worst-case 4 says
// it plainly: the movement dialog is the most fragile screen in the product --
// 743 lines and 18 states today -- and it already shipped a currency bug
// (`openForPayment`, 2026-08-28). Everything this field needs to know lives
// here; the dialog gets one value and one callback.
//
// ===========================================================================
// THE OWNER'S DECISIONS THIS IMPLEMENTS, taken 2026-10-17:
//
//   · The amount is COMPUTED AND OVERRIDABLE. Picking 3 knives at $5 fills in
//     $15; he may still leave it at $14 because he rounded. So this field
//     reports its total and the dialog decides what to do with it -- it never
//     writes the amount itself.
//   · CHARGES ONLY. A payment is money coming in. The dialog does not mount
//     this on an abono, and migration `122` refuses it with a trigger.
//   · QUICK-CREATE IS TWO FIELDS, name and price, and the product is born
//     CREATED, not pending (his decision 11 of 2026-10-09). Anything with a
//     camera opens as its own screen and is not this.
//
// ===========================================================================
// NOTHING HERE CAN BLOCK A MOVEMENT. If the search fails, the list comes back
// empty and the shopkeeper writes the fiado as he always has. That is the
// plan's hard rule: breaking the fiado record -- the one thing that works for
// 24 businesses -- for a new feature is the worst outcome available.

export function MovementProductsField({
  value,
  onValueChange,
  moneda,
}: {
  value: LineaDeProducto[];
  onValueChange: (lineas: LineaDeProducto[]) => void;
  // Cómo se escribe una cifra en la moneda del movimiento. La pasa el
  // formulario, que es el único que sabe en qué libro se está escribiendo.
  moneda: (monto: number) => string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<ProductoBuscado[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  // LA BÚSQUEDA SE CANCELA SOLA. Sin esto, teclear "arroz" dispara cinco
  // búsquedas y la que conteste la última gana, que no es siempre la del
  // texto que está en pantalla.
  const peticion = useRef(0);

  const buscar = useCallback(async (texto: string) => {
    const mia = ++peticion.current;
    setBuscando(true);
    const r = await buscarProductos(texto);
    if (peticion.current !== mia) return;
    setResultados(r);
    setBuscando(false);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const t = setTimeout(() => void buscar(query), 220);
    return () => clearTimeout(t);
  }, [abierto, query, buscar]);

  function añadir(p: ProductoBuscado) {
    // Si ya está, sube la cantidad en vez de repetir la línea: dos filas del
    // mismo producto son dos formas de decir lo mismo y suman igual, pero la
    // segunda obliga a leer dos veces.
    const i = value.findIndex((l) => l.productId === p.id);
    if (i >= 0) {
      const copia = [...value];
      copia[i] = { ...copia[i], quantity: copia[i].quantity + 1 };
      onValueChange(copia);
    } else {
      cambiarLineas([
        ...value,
        { productId: p.id, name: p.name, quantity: 1, unitPrice: p.priceRetail ?? 0 },
      ]);
    }
    setQuery("");
    setAbierto(false);
  }

  function añadirNuevo(nombre: string, precio: number) {
    cambiarLineas([...value, { productId: null, name: nombre, quantity: 1, unitPrice: precio }]);
    setQuery("");
    setAbierto(false);
  }

  // ── EL PRECIO SE TECLEA AGRUPADO, Y POR ESO HAY UN ESPEJO DE TEXTO ────
  //
  // Pedido por el dueño el 2026-10-24 para toda la app. Y aquí cuesta un
  // estado de más, que conviene explicar: las líneas guardan NÚMEROS
  // (`LineaDeProducto.unitPrice`), y un número no puede recordar cómo se
  // escribió. `1.500` tecleado y vuelto a pintar desde el número da `1500`
  // otra vez en la siguiente tecla, así que la agrupación se perdería sola.
  //
  // El espejo se BORRA ENTERO al añadir o quitar una línea. Está indexado por
  // posición, y al quitar una fila las de debajo se corren: sin el borrado, el
  // texto de la fila 3 pasaría a pintarse sobre la 2 — un precio que el
  // tendero no escribió, encima de un producto que no es el suyo. Vaciarlo no
  // pierde nada: cada campo vuelve a formatear su propio número guardado.
  const [textosPrecio, setTextosPrecio] = useState<Record<number, string>>({});

  function cambiar(i: number, campo: "quantity" | "unitPrice", bruto: string) {
    // `parseTypedAmount` y no `Number(...)`: el campo del precio agrupa los
    // miles, así que lo que llega es «1.500». `Number` lo lee como NaN y la
    // guarda anterior devolvía sin tocar nada — el precio se quedaba congelado
    // en cuanto pasaba de 999.
    const n = campo === "unitPrice" ? parseTypedAmount(bruto) : Number(bruto.replace(",", "."));
    if (n == null || !Number.isFinite(n) || n < 0) return;
    const copia = [...value];
    copia[i] = { ...copia[i], [campo]: n };
    onValueChange(copia);
  }

  function cambiarLineas(lineas: LineaDeProducto[]) {
    setTextosPrecio({});
    onValueChange(lineas);
  }

  const total = totalDeLineas(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Productos (opcional)</Label>
        {value.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">{moneda(total)}</span>
        ) : null}
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {value.map((l, i) => (
            <li key={`${l.productId ?? "nuevo"}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
              <Input
                type="number"
                inputMode="decimal"
                aria-label={`Cantidad de ${l.name}`}
                className="w-16 text-right"
                value={String(l.quantity)}
                onChange={(e) => cambiar(i, "quantity", e.target.value)}
              />
              <span className="text-xs text-muted-foreground">×</span>
              <CampoDePrecio
                etiqueta={`Precio de ${l.name}`}
                texto={textosPrecio[i] ?? formatAmountForInput(l.unitPrice, { miles: true })}
                onTexto={(t) => {
                  setTextosPrecio((prev) => ({ ...prev, [i]: t }));
                  cambiar(i, "unitPrice", t);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${l.name}`}
                onClick={() => cambiarLineas(value.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {abierto ? (
        <Buscador
          query={query}
          onQueryChange={setQuery}
          resultados={resultados}
          buscando={buscando}
          onElegir={añadir}
          onCrear={añadirNuevo}
          onCerrar={() => {
            setAbierto(false);
            setQuery("");
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAbierto(true)}
        >
          <Plus className="size-4" />
          Agregar producto
        </Button>
      )}

      {/* LO QUE VIAJA AL SERVIDOR, en un solo campo. El servidor no tiene que
          saber nada de este componente, igual que con las cuotas y el plazo. */}
      <input type="hidden" name="productos" value={JSON.stringify(value)} />
    </div>
  );
}

// EL CAMPO DEL PRECIO DE UNA LÍNEA, EN SU PROPIO COMPONENTE.
//
// No es una preferencia de estilo: `useGroupedAmount` es un hook, y un hook no
// puede llamarse dentro del `.map` de una lista cuyo largo cambia — React
// exige que el orden de los hooks sea el mismo en cada pintado, y quitar una
// línea lo rompería. Una fila, un componente, un hook.
function CampoDePrecio({
  etiqueta,
  texto,
  onTexto,
  placeholder,
}: {
  etiqueta: string;
  texto: string;
  onTexto: (texto: string) => void;
  placeholder?: string;
}) {
  const { ref: refPrecio, onChange: alTeclearPrecio } = useGroupedAmount(texto, onTexto);
  return (
    <Input
      // `type="text"` y no `type="number"`: un campo numérico se niega a
      // sostener «1.500.000» y lo deja vacío. `inputMode` conserva el teclado
      // numérico del teléfono, que es lo único que `number` aportaba.
      type="text"
      inputMode="decimal"
      aria-label={etiqueta}
      placeholder={placeholder}
      // `w-24` y no `w-20`: con los miles agrupados, un precio colombiano de
      // seis cifras ya no cabía en 20 y se leía recortado.
      className="w-24 text-right"
      value={texto}
      ref={refPrecio}
      onChange={alTeclearPrecio}
    />
  );
}

function Buscador({
  query,
  onQueryChange,
  resultados,
  buscando,
  onElegir,
  onCrear,
  onCerrar,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  resultados: ProductoBuscado[] | null;
  buscando: boolean;
  onElegir: (p: ProductoBuscado) => void;
  onCrear: (nombre: string, precio: number) => void;
  onCerrar: () => void;
}) {
  const [precio, setPrecio] = useState("");
  const nombre = query.trim();
  // EL ALTA RÁPIDA SOLO APARECE CUANDO NO HAY NADA QUE ELEGIR con ese nombre
  // exacto. Ofrecerla siempre invita a crear un duplicado de algo que ya está
  // tres líneas más arriba.
  const yaExiste = (resultados ?? []).some(
    (p) => p.name.trim().toLowerCase() === nombre.toLowerCase(),
  );
  const puedeCrear = nombre !== "" && !yaExiste;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          placeholder="Buscar producto"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onCerrar}>
          <X className="size-4" />
        </Button>
      </div>

      {buscando && resultados === null ? (
        <p className="px-1 text-xs text-muted-foreground">Buscando…</p>
      ) : null}

      {resultados && resultados.length > 0 ? (
        <ul className="flex flex-col">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => onElegir(p)}
              >
                <span className="min-w-0 truncate">{p.name}</span>
                {p.priceRetail != null ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {p.priceRetail}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {resultados && resultados.length === 0 && nombre === "" ? (
        <p className="px-1 text-xs text-muted-foreground">
          Todavía no tienes productos. Escribe un nombre para crear uno.
        </p>
      ) : null}

      {puedeCrear ? (
        // EL ALTA MÍNIMA DEL DUEÑO: nombre y precio, y nace CREADO. Su decisión
        // 11 del 2026-10-09 -- volver a pedir que lo carguen después sería
        // fricción por nada.
        <div className="flex items-center gap-2 border-t pt-2">
          <span className="min-w-0 flex-1 truncate text-sm">{nombre}</span>
          <CampoDePrecio
            etiqueta={`Precio de ${nombre}`}
            texto={precio}
            onTexto={setPrecio}
            placeholder="Precio"
          />
          <Button
            type="button"
            size="sm"
            disabled={precio.trim() === ""}
            onClick={() => {
              // `parseTypedAmount`: el campo agrupa los miles, así que aquí
              // llega «1.500» y `Number` lo leía como NaN — el botón «Crear»
              // no hacía nada, en silencio, para cualquier precio de cuatro
              // cifras o más.
              const n = parseTypedAmount(precio);
              if (n == null || !Number.isFinite(n) || n < 0) return;
              onCrear(nombre, n);
              setPrecio("");
            }}
          >
            Crear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
