"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  Check,
  ChevronRight,
  ImageOff,
  Minus,
  Percent,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { QuickProductSheet } from "@/components/dashboard/quick-product-sheet";
import { ProductSheet } from "@/components/dashboard/product-sheet";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { CurrencySheet } from "@/components/dashboard/currency-sheet";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import {
  CONSENT_FIELD,
  CONSENT_SHOWN_FIELD,
  textoPermisoDeclarado,
} from "@/lib/whatsapp-opt-in";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CuotasSelect } from "@/components/dashboard/cuotas-select";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  buscarProductosParaVenta,
  registrarVenta,
  resolverMostrador,
  saldoAnteriorDelCliente,
  type ProductoParaVenta,
  type ProductosParaVenta,
} from "@/app/(app)/ventas/actions";
// LA MISMA ACCIÓN QUE USA `/clients/nuevo`, y no una copia: el alta del paso 4
// y la pantalla de cliente nuevo crean la misma fila con las mismas
// comprobaciones —duplicados incluidos— y dos caminos se separan.
import { registrarCliente } from "@/app/(app)/clients/nuevo/actions";
import {
  cantidadMinima,
  escalonParaCantidad,
  monedasDelBloque,
  precioEnMoneda,
  type ProductoPublico,
} from "@/lib/products/public-pricing";
import {
  formatAmountForInput,
  formatPriceAmount,
  parseAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatDate } from "@/lib/format";
import { DEFAULT_PLAZO_PAGO, type OwnerCountry } from "@/lib/types";

// EL ASISTENTE DE UNA VENTA — sitemap `1269:6051`, encargo del dueño del
// 2026-10-17.
//
// Cuatro pasos: cliente, producto, carrito y pago.
//
// LO QUE EL PASO 4 NO TIENE TODAVÍA es la foto del comprobante. La acción del
// servidor ya acepta `photoPath`, así que conectarla es una línea — pero el
// componente que sube la foto y devuelve su ruta vive dentro del diálogo de
// movimientos y no está extraído. Se deja fuera a propósito en vez de dejar un
// control que no sube nada: es la lección de `CT-92`.
//
// ===========================================================================
// EL PRECIO SALE DE LAS MISMAS FUNCIONES QUE VE EL CLIENTE
//
// `escalonParaCantidad`, `monedasDelBloque` y `precioEnMoneda` son las tres
// que usa el catálogo público en `/c/[token]`. No es comodidad: el precio que
// el tendero cobra en el mostrador y el que su cliente leyó en el catálogo
// tienen que salir del mismo sitio. Con dos caminos, el día que uno cambie
// —un escalón, un precio fijado a mano, una moneda desactivada— los dos
// empiezan a decir cifras distintas y nadie se entera hasta que un cliente lo
// reclama.
//
// Y de ahí sale gratis `CT-101`: cambiar la moneda de una línea RECALCULA el
// precio en vez de cambiarle la etiqueta. Si solo cambiara la etiqueta, se
// vendería 51,34 € a precio de 51,34 $ — un 8 % de diferencia, perfectamente
// creíble y sin un solo error en ninguna parte.

type LineaVenta = {
  productId: string;
  name: string;
  unit: string | null;
  photoPath: string | null;
  // La ficha entera del producto viaja con la línea para poder recalcular:
  // subir la cantidad puede cruzar el mínimo del mayoreo y cambiar el precio,
  // y cambiar la moneda lo cambia también.
  producto: ProductoPublico;
  quantity: number;
  currency: PriceCurrency;
};

type Cliente = { id: string; name: string };
// El cliente elegido, con la única cosa que la pantalla necesita saber además
// de su nombre: si es el comodín, porque al mostrador no se le puede fiar.
type Elegido = Cliente & { esMostrador: boolean };

export function NuevaVenta({
  clientes,
  inicial,
  ownerId,
  ownerCountry,
}: {
  // La lista del buscador del paso 3, sin el mostrador: se elige con su propio
  // botón y no buscándolo por nombre.
  clientes: Cliente[];
  // YA RESUELTO cuando se entra con `?cliente=` — desde la ficha de alguien, o
  // desde «Continuar con venta» de la pantalla de cliente nuevo. `null` = se
  // entró por «Fiado o venta» de la hoja de Registrar, y entonces NO se
  // pregunta todavía: ver el comentario de los tres pasos, abajo.
  inicial: Elegido | null;
  ownerId: string;
  // Decide las letras del documento (V/E/J o CC/CE/NIT) y el prefijo del
  // WhatsApp en el paso 4.
  ownerCountry: OwnerCountry | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);

  // ── CUÁNTOS PASOS TIENE ESTA VENTA ──────────────────────────────────
  //
  // Tres o cuatro, y lo decide POR DÓNDE SE ENTRÓ. Regla del dueño,
  // 2026-10-18:
  //
  //   · Entrando con el cliente ya puesto —«Continuar con venta» del alta, o
  //     el botón de la ficha de alguien— son TRES y el botón dice «Finalizar»:
  //     la venta ya sabe a nombre de quién queda.
  //   · Entrando por «Fiado o venta» de la hoja de Registrar son CUATRO: el
  //     tercero dice «Continuar» y el cuarto capta al cliente.
  //
  // SE FIJA CON `inicial` Y NO CON `cliente`, que cambia. Si dependiera del
  // estado, elegir a alguien en el paso 4 convertiría el total en 3 y la
  // pantalla diría «4/3».
  const pasos = inicial ? 3 : 4;
  const [cliente, setCliente] = useState<Elegido | null>(inicial);
  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [catalogo, setCatalogo] = useState<ProductosParaVenta | null>(null);

  const total = useMemo(() => totalesPorMoneda(lineas, catalogo?.rates ?? null), [lineas, catalogo]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rates = catalogo?.rates ?? null;
  const [registros, setRegistros] = useState<Partial<Record<PriceCurrency, Registro>>>({});
  // LO QUE EL CLIENTE YA DEBÍA ANTES DE ESTA VENTA, para la fila «Deuda
  // antigua» del frame `1389:8504`. Vacío mientras no haya cliente: hasta
  // entonces no hay saldo que leer, y un «0,00» ahí afirmaría que no debe
  // nada, que es una afirmación y no una ausencia.
  //
  // SE GUARDA JUNTO AL ID DEL CLIENTE AL QUE PERTENECE, y eso hace dos cosas
  // a la vez. La obvia: cambiando de cliente, el saldo del anterior deja de
  // enseñarse en cuanto el id no coincide, sin esperar a que llegue la
  // consulta nueva — enseñar la deuda de Pedro bajo el nombre de Ana aunque
  // sea medio segundo es decirle al tendero algo falso sobre dinero.
  //
  // La menos obvia: sin él haría falta limpiar el estado en el cuerpo del
  // efecto cuando no hay cliente, y `react-hooks/set-state-in-effect` lo
  // prohíbe con razón.
  const [saldoAnterior, setSaldoAnterior] = useState<{
    clienteId: string;
    saldo: Partial<Record<PriceCurrency, number>>;
  } | null>(null);

  // SE PIDE AL CAMBIAR DE CLIENTE, no en cada render. La dependencia es
  // `cliente?.id` y no el objeto: `SelectorDeCliente` entrega uno nuevo cada
  // vez que se repinta, y con el objeto esto consultaría en bucle.
  const clienteId = cliente?.id ?? null;
  useEffect(() => {
    if (!clienteId) return;
    let vivo = true;
    void saldoAnteriorDelCliente(clienteId).then((saldo) => {
      if (vivo) setSaldoAnterior({ clienteId, saldo });
    });
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  const saldoDelElegido =
    clienteId && saldoAnterior?.clienteId === clienteId ? saldoAnterior.saldo : {};

  // LO COBRADO, LO FIADO Y LO QUE QUEDA SUELTO, por moneda. Se calcula en el
  // render y no se guarda aparte: un total derivado que vive por su cuenta es
  // un total que algún día se queda viejo.
  const cuentas = total.map((t) => {
    const r = registros[t.currency] ?? null;
    const cobrado = r?.amount ?? 0;
    return {
      ...t,
      registro: r,
      cobrado,
      // LO QUE QUEDA DEBIENDO, calculado. Sin registro es la venta entera: una
      // moneda que el tendero no toca queda fiada completa, que es lo que el
      // paso 3 dice con «Finalizar».
      debe: Math.round((t.amount - cobrado) * 100) / 100,
    };
  });

  const hayDeuda = cuentas.some((c) => c.registro != null && c.debe > 0.005);

  // ── NO SE TERMINA UNA VENTA A MEDIO REGISTRAR ──────────────────────
  //
  // Regla del dueño, 2026-10-18: «el botón Finalizar debe poder seleccionarse
  // solo cuando se han pagado todos los saldos en las respectivas monedas,
  // bien sean pagos de contado o fiados».
  //
  // Antes, una moneda que el tendero no tocara se iba como fiado completo al
  // pulsar «Finalizar». Era una decisión tomada por la app sobre el dinero de
  // alguien, en silencio y por omisión — exactamente lo contrario de lo que
  // debería hacer la pantalla donde se cobra.
  const sinRegistrar = cuentas.filter((c) => c.registro == null);

  // `destinoForzado` LLEGA DEL PASO 4 cuando acaba de crear al cliente. Sin
  // él, `guardar` leería `cliente` del cierre del render anterior —todavía
  // nulo— y la venta se iría al mostrador justo después de registrar a alguien.
  async function guardar(destinoForzado?: Elegido) {
    setError(null);
    setGuardando(true);

    // ── A NOMBRE DE QUIÉN QUEDA ESTA VENTA ──────────────────────────
    //
    // `sales.client_id` es `not null` y la RLS de `movements` deriva el dueño
    // ENTERAMENTE a través del cliente, así que no hay venta sin uno. Lo que
    // sí hay es una venta sin cliente CON NOMBRE: el mostrador existe para
    // eso, y se resuelve AL GUARDAR y no al entrar — crear la fila al abrir la
    // pantalla le pondría un «Mostrador» en la lista a cualquiera que solo
    // mire el catálogo.
    let destino = destinoForzado ?? cliente;
    if (!destino) {
      const r = await resolverMostrador();
      if ("error" in r) {
        setError(r.error);
        setGuardando(false);
        return;
      }
      destino = { ...r, esMostrador: true };
      setCliente(destino);
    }

    const resultado = await registrarVenta({
      clientId: destino.id,
      lineas: lineas.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        currency: l.currency,
      })),
      pagos: cuentas
        .filter((c) => c.cobrado > 0)
        .map((c) => ({
          currency: c.currency,
          amount: c.cobrado,
          entryCurrency: c.registro?.entryCurrency ?? c.currency,
          entryAmount: c.registro?.entryAmount ?? null,
          photoPath: c.registro?.photoPath ?? null,
          description: c.registro?.description ?? "",
        })),
      // EL CRÉDITO VA POR MONEDA Y NO POR REGISTRO: el servidor calcula el
      // resto él mismo —total menos pagos— y de aquí solo toma los TÉRMINOS.
      // Por eso lo pactado y lo que quedó suelto se mandan en una sola fila:
      // son la misma deuda.
      credito: cuentas
        .filter((c) => c.debe > 0.005)
        .map((c) => {
          const k = c.registro;
          const plazo = k?.plazo ?? "";
          return {
            currency: c.currency,
            // «Sin especificar» es una respuesta válida y viaja como null: el
            // fiado manual la admite desde siempre.
            plazoDias:
              plazo && plazo !== "sin_especificar" && Number.isFinite(Number(plazo))
                ? Number(plazo)
                : null,
            // Una sola cuota va como null: es lo mismo, y el `check` de la
            // migración `118` empieza en 2.
            cuotas: Number(k?.cuotas ?? "1") > 1 ? Number(k?.cuotas) : null,
            usarPrevista: k?.usarPrevista === true,
            photoPath: k?.photoPath ?? null,
            description: k?.description ?? "",
          };
        }),
    });

    if (!resultado.ok) {
      setError(resultado.error);
      setGuardando(false);
      return;
    }

    // A LA FICHA DEL CLIENTE, que es donde el fiado se ve y se cobra. Para una
    // venta de mostrador no hay ficha que valga —el comodín no se visita— así
    // que vuelve al panel.
    router.push(destino.esMostrador ? "/dashboard" : `/clients/${destino.id}`);
  }


  // CREAR AL CLIENTE Y GUARDAR SON UN SOLO GESTO para el tendero, y dos
  // escrituras para la base. El orden importa: si el alta falla, la venta no
  // se escribe y el formulario sigue en pantalla con lo tecleado. Al revés
  // —guardar primero— habría que decidir qué hacer con una venta ya cerrada a
  // nombre del mostrador cuando el cliente que iba a llevarla no se pudo
  // crear.
  async function finalizar(form: HTMLFormElement | null) {
    if (!form) {
      void guardar();
      return;
    }
    setError(null);
    setGuardando(true);
    const r = await registrarCliente(new FormData(form));
    if (!r.ok) {
      setError(r.error);
      setGuardando(false);
      return;
    }
    const nuevo = { id: r.clientId, name: String(new FormData(form).get("name") ?? "").trim(), esMostrador: false };
    setCliente(nuevo);
    await guardar(nuevo);
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Volver"
          onClick={() => (paso === 1 ? router.back() : setPaso((p) => (p - 1) as 1 | 2 | 3))}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
      </div>

      {/* ── TRES PASOS, Y EL CLIENTE NO ES UNO DE ELLOS ──────────────────
          Frame `1389:8329`, que dice «1/3 Producto». Hasta esta mañana eran
          cuatro y el primero preguntaba a quién se le vende.

          POR QUÉ SE CAE ESE PASO, decisión del dueño del 2026-10-18: **una
          venta de contado no necesita cliente**. Preguntarlo de entrada le
          cobraba un toque a todo el mundo para un dato que la mayoría de las
          ventas no usa. Ahora se pregunta en el paso 3, y SOLO si algo queda
          fiado — que es el único caso en que hace falta saber a quién cobrarle
          después.

          Quien entra con `?cliente=` —desde la ficha de alguien, o desde
          «Continuar con venta» de la pantalla de cliente nuevo— ya lo trae
          puesto y no ve la pregunta en ningún momento. */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-normal">Nueva venta</h1>
        <p className="text-sm text-muted-foreground">
          {paso}/{pasos} {["Producto", "Carrito", "Pago", "Información del cliente"][paso - 1]}
        </p>
        {/* `aria-hidden` porque la línea de arriba ya dice «1/3 Producto» con
            palabras: repetirlo en el lector de pantalla sería ruido, no
            accesibilidad. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${(paso / pasos) * 100}%` }}
          />
        </div>
      </div>

      {paso === 1 ? (
        <PasoProducto
          catalogo={catalogo}
          onCatalogo={setCatalogo}
          lineas={lineas}
          onAgregar={(l) => setLineas((xs) => agregar(xs, l))}
          onIrAlCarrito={() => setPaso(2)}
          ownerId={ownerId}
        />
      ) : null}

      {paso === 2 ? (
        <PasoCarrito
          lineas={lineas}
          rates={catalogo?.rates ?? null}
          monedasDelLibro={catalogo?.monedasDelLibro ?? []}
          onCambiar={setLineas}
          onSeguirComprando={() => setPaso(1)}
          onIrAPago={() => setPaso(3)}
        />
      ) : null}

      {paso === 3 ? (
        <PasoPago
          conCliente={inicial != null}
          registros={registros}
          setRegistros={setRegistros}
          saldoDelElegido={saldoDelElegido}
          sinRegistrar={sinRegistrar.map((c) => c.currency)}
          cuentas={cuentas}
          guardando={guardando}
          error={error}
          rates={rates}
          prevista={catalogo?.prevista ?? null}
          ownerId={ownerId}
          onContinuar={() => setPaso(4)}
          guardar={() => void guardar()}
        />
      ) : null}

      {paso === 4 ? (
        <PasoCliente
          clientes={clientes}
          cliente={cliente}
          onElegirCliente={setCliente}
          // OBLIGATORIO SOLO SI QUEDÓ DEUDA: «si se registra al menos 1 pago
          // como parcial, el registro del cliente es obligatorio; cuando se
          // registran de contado, es opcional» — el dueño, 2026-10-18.
          obligatorio={hayDeuda}
          ownerCountry={ownerCountry}
          guardando={guardando}
          error={error}
          onFinalizar={(form) => void finalizar(form)}
        />
      ) : null}
    </div>
  );
}

// ── 1/4 ────────────────────────────────────────────────────────────────
// ── 2/4 ────────────────────────────────────────────────────────────────
function PasoProducto({
  catalogo,
  onCatalogo,
  lineas,
  onAgregar,
  onIrAlCarrito,
  ownerId,
}: {
  catalogo: ProductosParaVenta | null;
  onCatalogo: (c: ProductosParaVenta) => void;
  lineas: LineaVenta[];
  onAgregar: (l: LineaVenta) => void;
  onIrAlCarrito: () => void;
  // Para el diálogo de alta de producto, que lo pide.
  ownerId: string;
}) {
  const [query, setQuery] = useState("");
  const [cargando, setCargando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [creando, setCreando] = useState(false);
  // El producto abierto, si hay uno. Es una VISTA DENTRO del paso y no una
  // ruta: el carrito del asistente vive en memoria, así que navegar a
  // `/c/<token>/<id>` —que es donde vive ese detalle para el cliente— lo
  // perdería entero.
  const [detalle, setDetalle] = useState<ProductoParaVenta | null>(null);
  // El producto que la hoja acaba de crear y que entra al carrito en cuanto la
  // cuadrícula vuelva con él (ver `onCreado`).
  //
  // UNA REF Y NO ESTADO: nadie lo pinta, así que guardarlo en `useState`
  // provocaría un render de más por cada producto creado y encima obligaría a
  // leerlo desde dentro de su propio actualizador para no quedarse con el
  // valor del render anterior.
  const pendiente = useRef<{ productId: string; cantidad: number } | null>(null);
  // Se incrementa al guardar un producto nuevo, y el efecto de abajo lo mira:
  // es lo que hace que la cuadrícula se vuelva a pedir sin tocar `query`, para
  // que el recién creado aparezca donde el tendero lo está esperando.
  const [recarga, setRecarga] = useState(0);

  // SE BUSCA AL ESCRIBIR, con el mismo retardo que el resto de los buscadores
  // de la app. La primera carga trae los doce primeros por orden alfabético
  // para que la pantalla no empiece vacía: el tendero suele vender lo mismo.
  //
  // `useEffect` Y NO `useMemo`. La primera versión de esto usaba `useMemo`
  // devolviendo una función de limpieza, y `useMemo` NO LAS EJECUTA: cada
  // tecla dejaba vivo su `setTimeout` y su petición, así que la respuesta más
  // lenta podía pisar a la más reciente y la lista acababa enseñando lo que
  // se buscó hace tres letras.
  //
  // Y `setCargando` VA DENTRO DEL TEMPORIZADOR, no en el cuerpo del efecto:
  // `react-hooks/set-state-in-effect` lo prohíbe con razón, y encima mejora
  // lo que se ve — encender «cargando» en cada tecla hacía parpadear la lista
  // durante los 250 ms de espera, cuando todavía no se había pedido nada.
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setCargando(true);
      const r = await buscarProductosParaVenta(query);
      if (!vivo) return;
      onCatalogo(r);
      setCargando(false);
      setBuscado(true);

      // EL PRODUCTO RECIÉN CREADO ENTRA AL CARRITO AQUÍ, cuando la lista ya
      // trae su ficha completa.
      //
      // PUEDE NO VENIR, y por eso se comprueba: la búsqueda devuelve doce por
      // orden alfabético, así que un producto nuevo que caiga más allá del
      // doce no está en esta respuesta. En ese caso se deja como está —el
      // tendero lo busca por su nombre— en vez de meter al carrito una línea
      // armada a mano que se comportaría distinto de las demás.
      const p = pendiente.current;
      // SE LIMPIA SIEMPRE, entre o no entre: dejarlo puesto haría que la
      // siguiente búsqueda —una letra más en el buscador— volviera a meterlo.
      pendiente.current = null;
      if (p) {
        const nuevo = r.productos.find((x) => x.id === p.productId);
        const minimo = nuevo ? cantidadMinima(nuevo.producto) : 0;
        const cantidad = Math.max(p.cantidad, minimo);
        const escalon = nuevo ? escalonParaCantidad(nuevo.producto, cantidad) : null;
        const bloque = escalon === "wholesale" ? nuevo!.producto.wholesale : nuevo?.producto.retail;
        const moneda = monedasDelBloque(bloque ?? null, r.rates).filter((c) =>
          r.monedasDelLibro.includes(c),
        )[0];
        if (nuevo && moneda) {
          onAgregar({
            productId: nuevo.id,
            name: nuevo.name,
            unit: nuevo.unit,
            photoPath: nuevo.photoPath,
            producto: nuevo.producto,
            quantity: cantidad,
            currency: moneda,
          });
        }
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recarga]);

  const enElCarrito = lineas.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LOS DOS CONTROLES VAN A 8px ENTRE SÍ y no a los 16 del resto: en el
          frame forman un bloque —buscar o crear— frente a la cuadrícula de
          abajo, y esa distinta separación es lo que los agrupa. */}
      <div className="flex flex-col gap-2">
        <SearchField value={query} onChange={setQuery} placeholder="Buscar producto" />

      {/* «AGREGAR PRODUCTO» ABRE EL DIÁLOGO AQUÍ MISMO, no lleva al catálogo.
          Irse a `/productos?nuevo=1` habría sido una línea, y habría tirado el
          carrito: el asistente guarda sus líneas en memoria, así que salir de
          la pantalla pierde todo lo que el tendero llevara metido. Es el mismo
          diálogo del catálogo, montado aquí. */}
      <Button type="button" variant="outline" className="h-10 w-full" onClick={() => setCreando(true)}>
        <Plus className="size-5" aria-hidden="true" />
        Agregar producto
      </Button>
      </div>

      {catalogo && catalogo.productos.length === 0 && buscado && !cargando ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {query.trim() === ""
              ? "Todavía no tienes productos en tu catálogo."
              : `No encontramos nada con «${query.trim()}».`}
          </p>
        </div>
      ) : null}

      {/* DOS COLUMNAS FIJAS, como el frame. `grid` y no `flex-wrap`: con
          envoltura, una fila con una sola tarjeta la deja a media anchura o
          estirada según el `flex`, y la cuadrícula del frame es regular pase lo
          que pase. `minmax(0,1fr)` y no `1fr` a secas — un hijo de grid tiene
          `min-width:auto` por defecto y un nombre largo lo ensancharía más allá
          de su columna, que es el desbordamiento horizontal que costó seis
          contenedores el 2026-10-17. */}
      <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
        {(catalogo?.productos ?? []).map((p) => (
          <TarjetaDeProducto
            key={p.id}
            producto={p}
            rates={catalogo?.rates ?? null}
            monedasDelLibro={catalogo?.monedasDelLibro ?? []}
            onAbrir={setDetalle}
          />
        ))}
      </ul>

      <div className="flex-1" />
      {enElCarrito > 0 ? (
        <Button type="button" className="h-12 w-full" onClick={onIrAlCarrito}>
          Ver carrito ({formatCantidad(enElCarrito)})
        </Button>
      ) : null}

      {/* LA HOJA DEL PRODUCTO — frame `1389:8949`. Es una HOJA y no una vista
          que reemplace la cuadrícula: así, al cerrarla el tendero sigue donde
          estaba, con su scroll y su búsqueda escrita. Quien vende abre tres o
          cuatro productos seguidos antes de cobrar.

          `key` CON EL ID: sin ella, abrir un segundo producto reutilizaría los
          `useState` del primero —la cantidad y la moneda elegidas— y el
          tendero vería «12» en un producto que acaba de abrir. Es la misma
          trampa que `catalog-table.tsx` documenta para su ficha. */}
      {detalle ? (
        <ProductSheet
          key={detalle.id}
          open
          onOpenChange={(abierto: boolean) => !abierto && setDetalle(null)}
          producto={detalle}
          rates={catalogo?.rates ?? null}
          monedasPermitidas={catalogo?.monedasDelLibro ?? []}
          onAgregar={({ quantity, currency }) => {
            onAgregar({
              productId: detalle.id,
              name: detalle.name,
              unit: detalle.unit,
              photoPath: detalle.photoPath,
              producto: detalle.producto,
              quantity,
              currency,
            });
            setDetalle(null);
          }}
        />
      ) : null}

      {/* MONTADA SOLO MIENTRAS SE USA. Radix deja el nodo en el DOM al
          cerrarse, y esta hoja trae dentro un formulario entero con sus
          propios `useState`: dejarla montada haría que la segunda vez abriera
          con lo que se escribió la primera. */}
      {creando ? (
        <QuickProductSheet
          open
          onOpenChange={(next: boolean) => !next && setCreando(false)}
          ownerId={ownerId}
          monedas={catalogo?.monedasDelLibro ?? []}
          onCreado={(productId, cantidad) => {
            setCreando(false);
            // SE PIDE EL PRODUCTO RECIÉN CREADO ANTES DE METERLO AL CARRITO, y
            // no se arma aquí con lo que se acaba de teclear: el carrito
            // necesita la ficha ENTERA —escalones, monedas activas, precios
            // fijados— para recalcular el precio al cambiar de moneda o al
            // cruzar el mínimo de mayoreo. Montarla a mano daría una línea que
            // se comporta distinto de las demás hasta recargar la pantalla.
            pendiente.current = { productId, cantidad };
            setRecarga((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

// UNA TARJETA, NO UNA FILA — frame `1389:8329`, 2026-10-18.
//
// La foto ocupa la tarjeta entera y el texto va encima, sobre un degradado que
// baja a `#272727`. Eso NO es decoración: el nombre y el precio van en blanco y
// una foto clara los dejaría ilegibles. El degradado es lo que garantiza el
// contraste pase lo que pase en la imagen, que es la razón de que esté en el
// frame y de que no se pueda quitar «porque se ve mejor sin él».
//
// SIN FOTO, FONDO OSCURO PLANO y el mismo texto encima. La alternativa —una
// tarjeta clara con texto oscuro cuando no hay imagen— daría dos tarjetas que
// se leen distinto en la misma cuadrícula.
function TarjetaDeProducto({
  producto,
  rates,
  monedasDelLibro,
  onAbrir,
}: {
  producto: ProductoParaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  // ABRE EL DETALLE, no mete al carrito. Lo pidió el dueño el 2026-10-18: «al
  // seleccionar el producto redirigirás al mismo detalle del producto que se
  // muestra en el catálogo». Tocando la tarjeta se añadía una unidad al precio
  // de detal y ya — sin poder elegir cantidad ni moneda, que es justo lo que
  // esa pantalla sirve para decidir.
  onAbrir: (p: ProductoParaVenta) => void;
}) {
  const minimo = cantidadMinima(producto.producto);
  const escalon = escalonParaCantidad(producto.producto, minimo);
  const bloque = escalon === "wholesale" ? producto.producto.wholesale : producto.producto.retail;
  // SOLO LAS MONEDAS QUE EL LIBRO SABE GUARDAR. `monedasDelBloque` devuelve
  // también bolívares y USDT para un negocio venezolano; ninguna de las dos
  // es un libro (ver `buscarProductosParaVenta`).
  const monedas = monedasDelBloque(bloque, rates).filter((c) => monedasDelLibro.includes(c));
  const moneda = monedas[0] ?? null;
  const precio = moneda ? precioEnMoneda(bloque, moneda, rates) : null;
  const foto = producto.photoPath ? getPublicProductPhotoUrl(producto.photoPath) : null;
  const sinPrecio = precio == null || moneda == null;

  return (
    <li className="min-w-0">
      <button
        type="button"
        // SIN PRECIO NO SE PUEDE VENDER, y la tarjeta lo dice apagándose en vez
        // de dejar meter al carrito una línea que luego no se puede cobrar.
        disabled={sinPrecio}
        aria-label={`Ver ${producto.name}`}
        onClick={() => !sinPrecio && onAbrir(producto)}
        className="relative flex h-[180px] w-full flex-col justify-end overflow-hidden rounded-lg bg-brand-primary p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {foto ? (
          <Image src={foto} alt="" fill unoptimized sizes="(max-width: 448px) 50vw, 161px" className="object-cover" />
        ) : (
          <span className="absolute right-2.5 top-2.5">
            <ImageOff className="size-4 text-white/40" aria-hidden="true" />
          </span>
        )}
        {/* EL DEGRADADO SOLO CUANDO HAY FOTO: sobre el fondo plano no añade
            nada y oscurecería de más la mitad de abajo. */}
        {foto ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-transparent from-25% to-[#272727] to-[65%]"
          />
        ) : null}

        <span className="relative flex flex-col gap-1 pr-10">
          {/* DOS LÍNEAS COMO MUCHO. El frame enseña «Nombre del producto»
              partido en dos; con tres, el precio se saldría de la tarjeta. */}
          <span className="line-clamp-2 text-base font-semibold text-brand-secondary">
            {producto.name}
          </span>
          <span className="flex items-center gap-1 text-xs text-brand-secondary">
            {moneda ? <CurrencyFlagIcon currency={moneda} className="size-3.5" /> : null}
            {precio != null && moneda ? formatPriceAmount(precio, moneda) : "Sin precio"}
            {escalon === "wholesale" ? " · al mayor" : ""}
          </span>
        </span>

        {/* EL CUADRO DEL «+» es parte de la tarjeta y no un botón aparte: toda
            la tarjeta agrega, y esto le dice al ojo qué pasa al tocarla. Un
            segundo botón dentro de un botón no es maquetable y además daría dos
            blancos para la misma acción. */}
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-sm bg-brand-primary"
        >
          <Plus className="size-6 text-brand-secondary" />
        </span>
      </button>
    </li>
  );
}

// ── 3/4 ────────────────────────────────────────────────────────────────
function PasoCarrito({
  lineas,
  rates,
  monedasDelLibro,
  onCambiar,
  onSeguirComprando,
  onIrAPago,
}: {
  lineas: LineaVenta[];
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  onCambiar: (l: LineaVenta[]) => void;
  onSeguirComprando: () => void;
  onIrAPago: () => void;
}) {
  if (lineas.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Todavía no has agregado nada.
          </p>
        </div>
        <div className="flex-1" />
        <Button type="button" variant="outline" className="h-10 w-full" onClick={onSeguirComprando}>
          Elegir productos
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {lineas.map((l, i) => (
        <TarjetaDeLinea
          key={`${l.productId}-${l.currency}`}
          linea={l}
          rates={rates}
          monedasDelLibro={monedasDelLibro}
          onCantidad={(q) => onCambiar(lineas.map((x, j) => (j === i ? { ...x, quantity: q } : x)))}
          onMoneda={(c) => onCambiar(lineas.map((x, j) => (j === i ? { ...x, currency: c } : x)))}
          onQuitar={() => onCambiar(lineas.filter((_, j) => j !== i))}
        />
      ))}

      <div className="flex-1" />

      {/* EL TOTAL NO SALE EN EL FRAME, y no se añade: cada línea ya enseña su
          subtotal con su bandera, y la pantalla de pago abre con una tarjeta
          por moneda y su total. Ponerlo aquí además sería la misma cifra dicha
          dos veces, y la primera —sin el contexto del cobro— no decide nada. */}
      <Button type="button" className="h-10 w-full" onClick={onIrAPago}>
        <Banknote className="size-6" aria-hidden="true" />
        Ir a pago
      </Button>
    </div>
  );
}

// UNA LÍNEA DEL CARRITO — frame `1389:8379`.
function TarjetaDeLinea({
  linea,
  rates,
  monedasDelLibro,
  onCantidad,
  onMoneda,
  onQuitar,
}: {
  linea: LineaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  onCantidad: (q: number) => void;
  onMoneda: (c: PriceCurrency) => void;
  onQuitar: () => void;
}) {
  const [eligiendoMoneda, setEligiendoMoneda] = useState(false);

  // EL ESCALÓN SE DECIDE POR LA CANTIDAD, en cada render. Subir de 5 a 6
  // unidades puede cruzar el mínimo del mayoreo y bajar el precio unitario: si
  // esto se calculara una vez al agregar, el carrito cobraría el precio de
  // detal por una cantidad de mayoreo.
  const escalon = escalonParaCantidad(linea.producto, linea.quantity);
  const bloque = escalon === "wholesale" ? linea.producto.wholesale : linea.producto.retail;
  const minimo = cantidadMinima(linea.producto);
  const foto = linea.photoPath ? getPublicProductPhotoUrl(linea.photoPath) : null;
  const unitario = precioEnMoneda(bloque, linea.currency, rates);

  // LAS MONEDAS CON SU SUBTOTAL, que es lo que la hoja enseña. Cada cifra sale
  // de `precioEnMoneda` para SU moneda y no de convertir la primera, y eso es
  // lo que respeta un precio fijado a mano: un producto con 10 $ y 9 € escritos
  // por el tendero tiene que enseñar 9 €, no los 9,20 que daría la tasa.
  const opciones = monedasDelBloque(bloque, rates)
    .filter((c) => monedasDelLibro.includes(c))
    .map((c) => ({ currency: c, precio: precioEnMoneda(bloque, c, rates) }))
    .filter((o): o is { currency: PriceCurrency; precio: number } => o.precio != null)
    .map((o) => ({
      currency: o.currency,
      subtotal: Math.round(o.precio * linea.quantity * 100) / 100,
    }));

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border p-2.5">
      <div className="flex items-center gap-2">
        <span className="relative size-12 shrink-0 overflow-hidden bg-muted">
          {foto ? (
            <Image src={foto} alt="" fill unoptimized sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center">
              <ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base leading-6 font-semibold">{linea.name}</span>
          {escalon === "wholesale" ? (
            <span className="text-xs text-muted-foreground">precio al mayor</span>
          ) : null}
        </span>

        {/* EL «−» EN EL MÍNIMO QUITA LA LÍNEA, y es la única salida del carrito:
            el frame no dibuja papelera, y sin una, un producto tocado por error
            se queda dentro para siempre. Bajar de uno es, en la cabeza del
            tendero, quitarlo — así que el icono cambia a una papelera para que
            nadie lo pulse creyendo que resta. */}
        <span className="flex shrink-0 items-start gap-1">
          {/* EL MISMO BOTÓN CAMBIA DE PAPEL EN EL MÍNIMO: resta mientras hay
              de sobra, y quita la línea cuando ya no. Desde el 2026-10-18
              también cambia de COLOR —`destructive` en vez de `outline`— a
              petición del dueño: el icono solo avisa a quien lo mire, y en el
              mínimo este botón deja de ser reversible de un toque. */}
          <Button
            type="button"
            variant={linea.quantity <= minimo ? "destructive" : "outline"}
            size="icon"
            className="size-10 rounded-xl"
            aria-label={linea.quantity <= minimo ? `Quitar ${linea.name}` : "Quitar uno"}
            onClick={() => (linea.quantity <= minimo ? onQuitar() : onCantidad(linea.quantity - 1))}
          >
            {linea.quantity <= minimo ? (
              <Trash2 className="size-4" aria-hidden="true" />
            ) : (
              <Minus className="size-4" aria-hidden="true" />
            )}
          </Button>
          <span className="flex size-10 items-center justify-center rounded-xl border text-base font-semibold tabular-nums">
            {formatCantidad(linea.quantity)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 rounded-xl"
            aria-label="Agregar uno"
            onClick={() => onCantidad(linea.quantity + 1)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 p-2">
        <span className="text-sm">Subtotal</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm tabular-nums">
            {unitario != null ? formatPriceAmount(unitario * linea.quantity, linea.currency) : "—"}
          </span>
          <CurrencyFlagIcon currency={linea.currency} className="size-4 shrink-0" />
        </span>
        {/* «CAMBIAR» ABRE LA HOJA CON LAS EQUIVALENCIAS, que es lo que el dueño
            pidió el 2026-10-18: la pregunta real no es «¿dólares o euros?», es
            «¿cuánto le cobro en cada uno?». Antes esto era un `select` nativo
            que solo listaba nombres.

            NO SE PINTA CON UNA SOLA MONEDA: un control que abre una hoja con
            una única opción ya marcada no cambia nada y hace dudar de si faltan
            precios. Pasa de verdad en un negocio colombiano, donde el libro es
            pesos y nada más. */}
        {opciones.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            className="h-auto shrink-0 px-1 py-1.5 text-sm font-normal"
            onClick={() => setEligiendoMoneda(true)}
          >
            Cambiar
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {eligiendoMoneda ? (
        <CurrencySheet
          open
          onOpenChange={(abierto: boolean) => !abierto && setEligiendoMoneda(false)}
          opciones={opciones}
          seleccionada={linea.currency}
          onSeleccionar={onMoneda}
        />
      ) : null}
    </div>
  );
}

// ── 3/3 ────────────────────────────────────────────────────────────────
//
// EL COBRO, UNA TARJETA POR MONEDA — frame `1389:8451`.
//
// Cada moneda enseña su total y un botón que abre la hoja de registrar pago.
// Lo que no se cobre ni se pacte queda fiado al «Finalizar». El tendero no
// clasifica la venta de antemano: cobra lo que le den y lo que sobre se fía.
function PasoPago({
  conCliente,
  registros,
  setRegistros,
  saldoDelElegido,
  sinRegistrar,
  cuentas,
  guardando,
  error,
  rates,
  prevista,
  ownerId,
  onContinuar,
  guardar,
}: {
  // POR DÓNDE SE ENTRÓ, no si hay cliente ahora. Decide si el botón dice
  // «Finalizar» o «Continuar».
  conCliente: boolean;
  registros: Partial<Record<PriceCurrency, Registro>>;
  setRegistros: Dispatch<SetStateAction<Partial<Record<PriceCurrency, Registro>>>>;
  saldoDelElegido: Partial<Record<PriceCurrency, number>>;
  // LAS MONEDAS QUE TODAVÍA NO SE HAN REGISTRADO. Se calcula arriba, donde
  // vive `cuentas`, para que el paso 4 pueda leerlo también sin recalcularlo.
  sinRegistrar: PriceCurrency[];
  cuentas: {
    currency: PriceCurrency;
    amount: number;
    registro: Registro | null;
    cobrado: number;
    debe: number;
  }[];
  guardando: boolean;
  error: string | null;
  onContinuar: () => void;
  guardar: () => void;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  ownerId: string;
}) {
  const [cobrando, setCobrando] = useState<PriceCurrency | null>(null);
  // El aviso de «te falta registrar…». Se limpia solo al registrar algo, en el
  // `onGuardar` de la hoja: dejarlo puesto después de arreglar lo que señalaba
  // convierte un aviso útil en ruido que se aprende a ignorar.
  const [faltan, setFaltan] = useState<string | null>(null);

  // EL TOTAL EN BOLÍVARES es la primera tarjeta del frame, y SOLO existe
  // teniendo tasa — o sea, en un negocio venezolano.
  //
  // SUMA MONEDAS DISTINTAS, y conviene decir por qué aquí sí: lo que esta app
  // nunca suma son los SALDOS de un cliente, porque cinco dólares y tres euros
  // son dos deudas independientes que se cobran por separado. Esto es otra
  // cosa — lo que cuesta esta cesta, hoy, si se pagara entera — y es una
  // referencia para quien está cobrando. No se escribe en ninguna parte.
  const totalEnBolivares = rates
    ? cuentas.reduce((acc, c) => acc + c.amount * (c.currency === "EUR" ? rates.eur : rates.usd), 0)
    : null;


  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* TOTAL EN BOLÍVARES — la primera tarjeta del frame. Sin botón: no se
          cobra en bolívares como libro propio, se cobra en dólares o en euros y
          se anota lo que de verdad entregaron. Esta cifra es para que el
          tendero sepa qué pedir. */}
      {totalEnBolivares != null ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border px-4 py-2">
          <span className="text-sm">Total en Bolívares</span>
          <span className="flex items-center gap-1">
            <CurrencyFlagIcon currency="VES" className="size-4" />
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(totalEnBolivares, "VES")}
            </span>
          </span>
        </div>
      ) : null}

      {cuentas.map((c) => {
        const bs = rates ? c.amount * (c.currency === "EUR" ? rates.eur : rates.usd) : null;
        // LA DEUDA QUE DEJA ESTA VENTA: lo pactado a crédito más lo que quedó
        // suelto. Las dos cosas acaban en el mismo cargo — el servidor calcula
        // el resto él mismo y de la pantalla solo toma los términos.
        const registrado = c.registro != null;
        // LA DEUDA SOLO EXISTE SI SE REGISTRÓ ALGO. El frame `1389:8476`
        // dibuja la tarjeta por defecto con el total y «Pagar», y nada más.
        //
        // LO TENÍA MAL Y SE VEÍA EN LA PANTALLA: trataba «sin registrar» como
        // «debe todo», así que una venta recién abierta ya enseñaba «Debe
        // (esta venta)» y «Deuda total» por el importe entero — afirmando una
        // deuda que el tendero no ha pactado y que puede acabar siendo un
        // cobro de contado.
        const debeEstaVenta = registrado ? Math.max(0, c.debe) : 0;
        const antigua = saldoDelElegido[c.currency] ?? null;

        return (
          <div
            key={c.currency}
            className="flex flex-col justify-center rounded-[10px] border px-4 py-2"
          >
            {/* ── LA CABECERA, IGUAL EN LOS TRES ESTADOS ──────────────── */}
            <div className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                <span className="text-sm">Total en {NOMBRE[c.currency] ?? c.currency}</span>
                <span className="flex items-center gap-1">
                  <CurrencyFlagIcon currency={c.currency} className="size-4 shrink-0" />
                  <span className="text-base font-semibold tabular-nums">
                    {formatPriceAmount(c.amount, c.currency)}
                  </span>
                </span>
                {bs != null ? (
                  <span className="pl-5 text-xs tabular-nums text-muted-foreground">
                    {formatPriceAmount(bs, "VES")}
                  </span>
                ) : null}
              </div>

              {/* SIN NADA REGISTRADO, UN BOTÓN; CON ALGO, UNA FLECHA. Es lo que
                  dibuja el frame y dice la verdad: el botón invita a empezar, y
                  una vez hay cifras debajo lo que se ofrece es volver a
                  abrirlas. Dejar «Pagar» sobre una tarjeta que ya enseña un
                  cobro haría dudar de si se va a cobrar dos veces. */}
              {registrado ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0"
                  aria-label={`Cambiar el pago en ${NOMBRE[c.currency] ?? c.currency}`}
                  onClick={() => setCobrando(c.currency)}
                >
                  <ChevronRight className="size-5" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0"
                  onClick={() => setCobrando(c.currency)}
                >
                  Pagar
                </Button>
              )}
            </div>

            {/* ── LO COBRADO ─────────────────────────────────────────────
                «Pago de contado» cuando la venta queda saldada, «Abonó en X»
                cuando además queda debiendo. No es adorno: la primera cierra
                la cuenta y la segunda es un abono a una deuda que sigue viva,
                y el tendero necesita saber cuál de las dos acaba de registrar. */}
            {c.cobrado > 0 ? (
              <div className="flex items-center justify-end gap-1 border-t py-3">
                <span className="text-xs">
                  {debeEstaVenta > 0.005
                    ? `Abonó en ${NOMBRE[c.currency] ?? c.currency}`
                    : "Pago de contado"}
                </span>
                <span className="flex-1 text-right text-xs tabular-nums">
                  {formatPriceAmount(c.cobrado, c.currency)}
                </span>
              </div>
            ) : null}

            {/* ── LO QUE QUEDA DEBIENDO ──────────────────────────────── */}
            {debeEstaVenta > 0.005 ? (
              <div className="flex flex-col gap-2 border-t pt-3 pb-1">
                <div className="flex items-center justify-end gap-1">
                  <span className="text-xs">Debe (esta venta)</span>
                  <span className="flex-1 text-right text-xs tabular-nums">
                    {formatPriceAmount(debeEstaVenta, c.currency)}
                  </span>
                </div>

                {/* «DEUDA ANTIGUA» SOLO CUANDO SE SABE DE QUIÉN. Hasta que el
                    cliente no está elegido no hay saldo que leer, y poner un
                    «0,00» ahí diría que no debe nada — que es una afirmación,
                    no una ausencia. La fila aparece al elegirlo. */}
                {antigua != null ? (
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-xs">Deuda antigua</span>
                    <span className="flex-1 text-right text-xs tabular-nums">
                      {formatPriceAmount(antigua, c.currency)}
                    </span>
                  </div>
                ) : null}

                <div className="flex items-start gap-1">
                  <span className="text-base font-semibold">Deuda total</span>
                  <span className="flex flex-1 flex-col items-end gap-1">
                    <span className="text-base font-semibold tabular-nums">
                      {formatPriceAmount(debeEstaVenta + (antigua ?? 0), c.currency)}
                    </span>
                    {rates ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatPriceAmount(
                          (debeEstaVenta + (antigua ?? 0)) *
                            (c.currency === "EUR" ? rates.eur : rates.usd),
                          "VES",
                        )}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex-1" />
      {/* ── «FINALIZAR» O «CONTINUAR», y lo decide por dónde se entró ─────
          Regla del dueño, 2026-10-18:

            · Con el cliente ya puesto —«Continuar con venta» del alta, o el
              botón de la ficha de alguien— el botón dice «Finalizar» y guarda:
              la venta ya sabe a nombre de quién queda.
            · Sin cliente, dice «Continuar» y lleva a un paso más para captarlo.

          Lo decide `conCliente`, que es por dónde se ENTRÓ, y no si hay
          cliente ahora mismo: en el paso 4 se elige uno, y con la otra regla
          el botón cambiaría de palabra a mitad del recorrido. */}
      {/* EL AVISO VA PEGADO AL BOTÓN, debajo, que es donde el tendero está
          mirando cuando lo pulsa. Arriba del todo se lo perdería: a 375px las
          tarjetas ya ocupan la pantalla. */}
      {faltan ? <p className="text-sm text-destructive">{faltan}</p> : null}

      {/* NO SE DESHABILITA, SE EXPLICA. Un botón apagado significa que
          pulsarlo no hace nada, y lo que hace falta aquí es que DIGA por qué
          no se puede — es el mismo criterio que `TipoButtons` ya aplica al
          abono imposible en el diálogo de movimientos. */}
      <Button
        type="button"
        className="h-10 w-full"
        disabled={guardando}
        onClick={() => {
          if (sinRegistrar.length > 0) {
            setFaltan(textoFaltaRegistrar(sinRegistrar));
            return;
          }
          setFaltan(null);
          if (conCliente) void guardar();
          else onContinuar();
        }}
      >
        {guardando ? "Guardando…" : conCliente ? "Finalizar" : "Continuar"}
      </Button>

      {cobrando ? (
        <PagoSheet
          key={cobrando}
          open
          onOpenChange={(abierto: boolean) => !abierto && setCobrando(null)}
          moneda={cobrando}
          ownerId={ownerId}
          total={cuentas.find((c) => c.currency === cobrando)?.amount ?? 0}
          rates={rates}
          prevista={prevista}
          inicial={registros[cobrando] ?? null}
          onGuardar={(r) => {
            setRegistros((xs) => ({ ...xs, [cobrando]: r }));
            setFaltan(null);
            setCobrando(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ── EL ÚLTIMO PASO: A QUIÉN SE LE REGISTRA ESTA VENTA ──────────────────
//
// Frame `1393:11611`. Es una pantalla COMBINADA: el buscador arriba para
// quien ya existe, y debajo el alta entera para quien no. No son dos
// caminos que el tendero elija de antemano — escribe el nombre, y si sale en
// la lista lo toca, y si no, sigue rellenando.
//
// Solo existe entrando por «Fiado o venta» de la hoja de Registrar, que es la
// única puerta que no trae cliente. Reglas del dueño, 2026-10-18:
//
//   · Si quedó algo debiendo, elegir o registrar cliente es OBLIGATORIO: un
//     fiado sin dueño no se puede cobrar después, y la base lo rechaza igual
//     (`sales.client_id` es `not null`, y la RLS de `movements` deriva el
//     dueño a través del cliente).
//   · Si todo se cobró de contado es OPCIONAL: la venta se va al mostrador.
//
// EL RÓTULO DEL BOTÓN DICE LA CONSECUENCIA, elegido por el dueño el
// 2026-10-18 entre tres propuestas: «Finalizar sin cliente» con todo vacío,
// «Finalizar» en cuanto hay un nombre escrito, y «Finalizar · Nombre» con uno
// elegido. Lo que gana sobre un «Finalizar» fijo es que un nombre a medio
// escribir ya no se puede descartar sin querer: en cuanto hay algo en el
// campo, el botón deja de ofrecer saltarlo.
function PasoCliente({
  clientes,
  cliente,
  onElegirCliente,
  obligatorio,
  ownerCountry,
  guardando,
  error,
  onFinalizar,
}: {
  clientes: Cliente[];
  cliente: Elegido | null;
  onElegirCliente: (c: Elegido | null) => void;
  obligatorio: boolean;
  ownerCountry: OwnerCountry | null;
  guardando: boolean;
  error: string | null;
  onFinalizar: (form: HTMLFormElement | null) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const [nombre, setNombre] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [acepta, setAcepta] = useState(false);

  // SE FILTRA EN EL NAVEGADOR y no con una consulta por cada letra: la lista
  // llega entera con la pantalla, y es la misma que alimenta el buscador de
  // «agregar movimiento» de Inicio.
  //
  // CON EL CAMPO VACÍO NO SE LISTA A NADIE, al revés que en el paso 1 de
  // antes: aquí debajo hay un formulario entero, y veinte filas de clientes
  // empujándolo fuera de la pantalla convertirían el alta en algo que hay que
  // buscar. Las coincidencias aparecen al escribir.
  const texto = query.trim().toLowerCase();
  const encontrados = texto === "" ? [] : clientes.filter((c) => c.name.toLowerCase().includes(texto));

  // ── YA ELEGIDO ──────────────────────────────────────────────────────
  if (cliente) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        {/* LA PAPELERA VA DENTRO DE LA TARJETA, a petición del dueño el
            2026-10-18, en lugar del «Es para otra persona» que había debajo.
            Dentro, el control pertenece a lo que quita y se lee sin leerlo;
            fuera, era una frase que había que interpretar.

            `destructive` y no `ghost`: quitar al cliente de una venta que ya
            puede llevar un fiado registrado no es una acción neutra, y el
            color es lo que lo dice antes de pulsarlo. */}
        <div className="flex items-center gap-3 rounded-xl border p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-xs text-muted-foreground">Le vendes a</p>
            <p className="truncate text-lg font-semibold">{cliente.name}</p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="size-10 shrink-0"
            aria-label={`Quitar a ${cliente.name} de esta venta`}
            onClick={() => onElegirCliente(null)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex-1" />
        <Button
          type="button"
          className="h-10 w-full"
          disabled={guardando}
          onClick={() => onFinalizar(null)}
        >
          {guardando ? "Guardando…" : `Finalizar · ${cliente.name}`}
        </Button>
      </div>
    );
  }

  const hayNombre = nombre.trim() !== "";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />

      {encontrados.length > 0 ? (
        <div className="flex flex-col overflow-hidden rounded-xl border">
          {encontrados.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onElegirCliente({ ...c, esMostrador: false })}
              className={`flex items-center justify-between gap-3 p-4 text-left ${i > 0 ? "border-t" : ""}`}
            >
              <span className="truncate text-sm font-medium">{c.name}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {/* EL ALTA, DEBAJO DEL BUSCADOR Y SIEMPRE A LA VISTA. Es el mismo
          formulario de `/clients/nuevo` y los mismos campos — pero NO se
          reutiliza aquel componente, porque aquel navega a la ficha del
          cliente al guardar y aquí lo que sigue es cobrar la venta. Lo que sí
          se comparte es lo que importa: los campos mandan los mismos nombres y
          los recibe `registrarCliente`, la misma acción. */}
      <form ref={formRef} className="flex flex-col gap-4">
        <input type="hidden" name={CONSENT_SHOWN_FIELD} value="1" />
        {acepta ? <input type="hidden" name={CONSENT_FIELD} value="1" /> : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor="venta-nombre">Nombre del cliente</Label>
          <Input
            id="venta-nombre"
            name="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Escribe nombres y apellidos"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="venta-documento">Documento</Label>
          <DocumentIdInput
            id="venta-documento"
            country={ownerCountry}
            value={documentId}
            onChange={setDocumentId}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="venta-whatsapp">WhatsApp (opcional)</Label>
          {/* EL PREFIJO ARRANCA EN EL PAÍS DEL NEGOCIO. Sin esto el selector se
              queda en su primera opción —Colombia, +57— y un tendero
              venezolano guarda a todos sus clientes con un prefijo que no es el
              suyo; pasó en la pantalla de alta y lo vio el dueño. */}
          <WhatsappInput
            id="venta-whatsapp"
            name="whatsapp"
            preferredDialCode={ownerCountry ? OWNER_COUNTRY_DIAL_CODE[ownerCountry] : undefined}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="venta-direccion">Dirección (opcional)</Label>
          <Input
            id="venta-direccion"
            name="address"
            placeholder="Escribe dirección"
            autoComplete="off"
          />
        </div>

        {/* EL PERMISO DE WHATSAPP (MS-34). La frase se genera con
            `textoPermisoDeclarado`, LA MISMA función con la que el servidor la
            guarda: esa cadena es la evidencia ante Meta, y dos textos distintos
            —uno en pantalla y otro en la base— la convertirían en una
            reconstrucción en vez de una prueba. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-accent p-2.5">
          <Checkbox
            checked={acepta}
            onCheckedChange={(v) => setAcepta(v === true)}
            className="mt-0.5"
          />
          <span className="text-xs leading-4">{textoPermisoDeclarado(nombre)}</span>
        </label>
      </form>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex-1" />
      <Button
        type="button"
        className="h-10 w-full"
        disabled={guardando || (obligatorio && !hayNombre)}
        onClick={() => onFinalizar(hayNombre ? formRef.current : null)}
      >
        {guardando
          ? "Guardando…"
          : hayNombre
            ? "Finalizar"
            : obligatorio
              ? "Escribe o elige un cliente"
              : "Finalizar sin cliente"}
      </Button>
    </div>
  );
}

// ── «PAGAR» ────────────────────────────────────────────────────────────
//
// UN FORMULARIO CON DOS RAMAS — frames `1389:9222` (contado) y `1389:9296`
// (fiado o crédito). «Ambos es el mismo formulario, lo que cambia son los
// campos según si selecciona "de contado" o "fiado o crédito"» — el dueño,
// 2026-10-18.
//
// ===========================================================================
// POR QUÉ UNA MONEDA PUEDE LLEVAR LAS DOS COSAS
//
// La hoja se abre desde la tarjeta de una moneda y registra UNA de las dos, la
// que diga el chip. Pero la misma moneda admite las dos a la vez, y ese es el
// caso que el dueño describió con sus palabras el 2026-10-17: «una compra por
// 10 USD puede abonar 5 y quedar debiendo 5». Se abre la hoja dos veces —una
// de contado por 5, otra a crédito por 5— y la tarjeta enseña las dos.
//
// Por eso `PasoPago` guarda DOS huecos por moneda y no uno. Con un solo hueco,
// registrar el fiado borraría el abono que acaba de entrar en la caja.
//
// ===========================================================================
// «MONTO» Y «EQUIVALENCIA» SON LAS DOS CARAS DEL MISMO DINERO
//
// Lo que el cliente entrega y lo que entra en el libro. En un negocio
// venezolano suelen ser distintas —paga en bolívares, el libro es en dólares—
// y las dos se guardan: `entry_amount` con su moneda es lo que de verdad pasó
// de mano a mano, y es el registro más defendible en una disputa (migración
// `022`); `amount` es lo que descuenta de la venta.
//
// LA EQUIVALENCIA SE PUEDE CORREGIR A MANO, y no es un descuido del frame:
// el tendero puede aceptar unos bolívares de menos y dar la cuenta por
// cerrada. El servidor sella la tasa pero NO divide una cifra por la otra —
// hacerlo convertía una venta pagada completa en un fiado de un céntimo.
// LO QUE SE REGISTRA EN UNA MONEDA: UNA COSA, no dos.
//
// Lo tuve dos días como dos huecos —un cobro y un fiado por separado— y el
// dueño lo corrigió el 2026-10-18 con una regla que los une: «al seleccionar
// "De contado" en el input de monto se pone el monto total; si el monto se
// edita a un monto diferente al total, entonces debe seleccionarse el chip
// "Fiado o crédito"».
//
// O sea que EL CHIP NO ES UN CAMPO, ES UNA CONSECUENCIA: paga todo o no paga
// todo. `amount` es lo que entrega hoy y el resto —total menos eso— es la
// deuda, calculada, nunca tecleada aparte. Con dos huecos se podía registrar
// 5,84 de cobro y 2,03 de fiado sobre una venta de 5,84; con uno, eso es
// inexpresable.
type Registro = {
  // Lo que entra HOY en el libro de esta moneda.
  amount: number;
  // Lo que de verdad entregaron, y en qué. `null` = en la moneda del libro.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  // Solo valen si `amount` no cubre el total. Si lo cubre, no hay fiado que
  // pactar y el servidor los ignora porque no escribe ningún cargo.
  plazo: string;
  cuotas: string;
  usarPrevista: boolean;
  // El comprobante. Va a `sale_payments.photo_path` si hubo cobro, y a
  // `movements.photo_path` del cargo si quedó deuda.
  photoPath: string | null;
  description: string;
};

// LAS CUOTAS, TAL COMO LAS CALCULA LA BASE. Migración `118`: «el vencimiento
// de la cuota i es created_at + plazo_dias * i / cuotas». Aquí se repite para
// ENSEÑARLAS antes de guardar, que es lo que el frame pide — no para decidir
// nada, porque quien decide es el `check` de la migración.
//
// Se reparte en partes iguales y el resto se le suma a la ÚLTIMA: tres cuotas
// de 10 son 3,33 · 3,33 · 3,34, no tres de 3,33 que suman 9,99. Ese céntimo
// perdido es el que hace que un cliente que pagó todo siga debiendo.
function calendarioDeCuotas(
  monto: number,
  plazoDias: number | null,
  cuotas: number,
): { numero: number; vence: string | null; monto: number }[] {
  const n = Math.max(1, cuotas);
  const base = Math.floor((monto / n) * 100) / 100;
  const hoy = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    vence:
      plazoDias == null
        ? null
        : new Date(hoy + (plazoDias * (i + 1) * 86400000) / n).toISOString(),
    monto: i === n - 1 ? Math.round((monto - base * (n - 1)) * 100) / 100 : base,
  }));
}

function PagoSheet({
  open,
  onOpenChange,
  moneda,
  ownerId,
  total,
  rates,
  prevista,
  inicial,
  onGuardar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moneda: PriceCurrency;
  // Para el subidor de la foto, que escribe en el bucket de este negocio.
  ownerId: string;
  // Lo que suma la venta en esta moneda, para la tarjeta de arriba.
  total: number;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  inicial: Registro | null;
  onGuardar: (r: Registro) => void;
}) {
  const tasa = rates ? (moneda === "EUR" ? rates.eur : rates.usd) : null;

  // ── EN QUÉ MONEDA LE ENTREGAN ───────────────────────────────────────
  //
  // BOLÍVARES POR DEFECTO, por decisión del dueño el 2026-10-18: «la moneda
  // por defecto en el monto a pagar debe ser Bolívares».
  //
  // Y no es una preferencia de pantalla, es cómo se cobra de verdad en
  // Venezuela: el libro está en dólares o en euros, pero lo que pasa de mano a
  // mano son bolívares. Arrancar en la moneda del libro le pedía al tendero
  // cambiar el selector en casi todos los cobros.
  //
  // Sin tasa —un negocio colombiano— no hay bolívares que ofrecer: cae en la
  // moneda del libro y el selector no se pinta.
  const entregaInicial: "VES" | PriceCurrency = inicial
    ? inicial.entryCurrency === "VES"
      ? "VES"
      : moneda
    : tasa
      ? "VES"
      : moneda;

  // EL MONTO ARRANCA EXPRESADO EN LA MONEDA DE ENTREGA, y esto no sobra: con
  // bolívares por defecto, sembrarlo con lo que falta EN EL LIBRO abriría la
  // hoja enseñando «5,84» con la etiqueta «Bolívares» — una cifra mil veces
  // más pequeña de la que el tendero va a recibir, y perfectamente creíble.
  //
  // Y ARRANCA CON EL TOTAL, no con cero: «al seleccionar "De contado" en el
  // input de monto se pone el monto total de pago» (el dueño, 2026-10-18). Le
  // pagan todo en la mayoría de las ventas, así que el caso corriente es cero
  // teclas.
  const enEntrega = (enElLibro: number) =>
    formatAmountForInput(entregaInicial === "VES" && tasa ? enElLibro * tasa : enElLibro);

  const [monedaEntrega, setMonedaEntrega] = useState<"VES" | PriceCurrency>(entregaInicial);
  const [monto, setMonto] = useState(() =>
    inicial?.entryAmount != null
      ? formatAmountForInput(inicial.entryAmount)
      : enEntrega(inicial?.amount ?? total),
  );
  const [usarPrevista, setUsarPrevista] = useState(inicial?.usarPrevista ?? false);
  const [photoPath, setPhotoPath] = useState<string | null>(inicial?.photoPath ?? null);
  const [plazo, setPlazo] = useState(inicial?.plazo ?? DEFAULT_PLAZO_PAGO);
  const [cuotas, setCuotas] = useState(inicial?.cuotas ?? "1");
  const [descripcion, setDescripcion] = useState(inicial?.description ?? "");

  // LAS DOS CIFRAS SON DOS HECHOS DISTINTOS, y la segunda se CALCULA:
  //
  //   «Monto»        lo que el cliente puso en la mano, en la moneda en que lo
  //                  puso. Va a `entry_amount` / `entry_currency`, que es el
  //                  registro más defendible en una disputa (migración `022`).
  //   «Equivalencia» lo que eso vale en el libro. Va a `amount`, y es lo que
  //                  descuenta de la venta.
  //
  // EN EL FRAME ES UNA CIFRA, NO UNA CASILLA — cambió así el 2026-10-18,
  // después de que yo la hubiera hecho editable. La versión editable permitía
  // expresar un descuento («recibo 10 y doy la cuenta por cerrada en 9,50»),
  // pero abría la puerta a que el libro y lo entregado contaran historias
  // distintas sin que nada chille. Se sigue el frame.
  const entregaEnOtraMoneda = monedaEntrega === "VES";
  const entregado = parseAmount(monto) ?? 0;

  // EL CÉNTIMO QUE CONVIERTE UNA VENTA PAGADA EN UN FIADO, y por qué hay un
  // ajuste aquí: 5.756,66 Bs a 985,73 son 5,8399… que redondea a 5,84 y
  // cuadra. Pero no siempre cae así — con otras cifras la división deja 19,99
  // sobre un total de 20, y la venta nace con un fiado de 0,01 que nadie
  // entiende y nadie cobra.
  //
  // Siendo la equivalencia una cifra calculada, el tendero ya no puede
  // corregirla a mano, así que el ajuste tiene que estar aquí: si lo convertido
  // queda a un céntimo de lo que falta, se usa lo que falta. Un céntimo de
  // holgura sobre una conversión no inventa dinero; un fiado fantasma sí
  // ensucia el saldo de alguien para siempre.
  const convertido = entregaEnOtraMoneda && tasa ? entregado / tasa : entregado;

  // EL CÉNTIMO QUE CONVIERTE UNA VENTA PAGADA EN UN FIADO. 5.756,66 Bs a
  // 985,73 dan 5,8399… que redondea bien, pero con otras cifras la división
  // deja 19,99 sobre un total de 20 y la venta nace con un fiado de 0,01 que
  // nadie entiende y nadie cobra. Siendo la equivalencia calculada, el tendero
  // no puede corregirla, así que el ajuste está aquí.
  const enElLibro =
    total > 0 && Math.abs(convertido - total) <= 0.01
      ? total
      : Math.round(convertido * 100) / 100;

  // ── EL CHIP NO SE ELIGE: SE DEDUCE DEL MONTO ──────────────────────
  //
  // Regla del dueño, 2026-10-18: «al seleccionar "De contado" en el input de
  // monto se pone el monto total de pago; si el monto se edita a un monto
  // diferente al total, entonces debe seleccionarse el chip "Fiado o
  // crédito"».
  //
  // Así que no hay un estado `tipo` que pueda discrepar de la cifra: paga todo
  // o no paga todo, y el chip lo dice. Es lo que hace imposible el caso que el
  // dueño vio en una captura —«Cobrado €5,84 · Fiado €2,03» sobre una venta de
  // 5,84— porque ya no hay dos cifras que puedan sumarse de más.
  const esContado = Math.abs(enElLibro - total) <= 0.005;
  const deMas = enElLibro - total > 0.005;
  const listo = enElLibro > 0 && entregado > 0 && !deMas;

  const plazoDias =
    plazo && plazo !== "sin_especificar" && Number.isFinite(Number(plazo)) ? Number(plazo) : null;
  // LO QUE QUEDARÁ DEBIENDO, que es sobre lo que se reparten las cuotas.
  const debe = Math.round((total - enElLibro) * 100) / 100;
  const calendario = esContado
    ? []
    : calendarioDeCuotas(debe, plazoDias, Number(cuotas) || 1);

  // TOCAR UN CHIP ES ESCRIBIR EN EL MONTO, porque el chip es la consecuencia.
  //
  // «De contado» pone el total: es la regla del dueño, y el caso corriente.
  // «Fiado o crédito» VACÍA el campo para que escriba lo que de verdad le
  // dieron — dejarlo con el total sería un chip que dice «no paga todo» sobre
  // una cifra que es todo, y el propio chip saltaría de vuelta.
  function ponerTipo(siguiente: "contado" | "credito") {
    if (siguiente === "contado") {
      setMonto(enEntrega(total));
      return;
    }
    if (esContado) setMonto("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-xl font-medium">Registrar pago</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* LA TARJETA DEL TOTAL, la misma que la del paso 3. Sirve de
              recordatorio: la hoja tapa la pantalla entera en un teléfono. */}
          <div className="flex flex-col justify-center gap-1 rounded-[10px] border px-4 py-2">
            <span className="text-sm">Total en {NOMBRE[moneda] ?? moneda}</span>
            <span className="flex items-center gap-1">
              <CurrencyFlagIcon currency={moneda} className="size-4" />
              <span className="text-base font-semibold tabular-nums">
                {formatPriceAmount(total, moneda)}
              </span>
            </span>
            {tasa ? (
              <span className="pl-5 text-xs text-muted-foreground tabular-nums">
                {formatPriceAmount(total * tasa, "VES")}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-base font-semibold">Detalles de pago</p>

            <div className="flex flex-col gap-2 rounded-[10px] border p-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm">¿Cuánto paga?</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { valor: "contado" as const, texto: "De contado", Icono: Check },
                      { valor: "credito" as const, texto: "Fiado o crédito", Icono: Percent },
                    ]
                  ).map(({ valor, texto, Icono }) => {
                    const activo = (valor === "contado") === esContado;
                    return (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => ponerTipo(valor)}
                        aria-pressed={activo}
                        className="flex items-center gap-1 rounded-full border p-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                            activo ? "border-foreground" : "border-muted-foreground/40"
                          }`}
                        >
                          {activo ? <span className="size-2 rounded-full bg-foreground" /> : null}
                        </span>
                        {texto}
                        {/* EL GLIFO DE CADA CHIP, del frame: un visto para el
                            contado y un porcentaje para el crédito. En rojo el
                            segundo porque es el que deja deuda — el mismo
                            criterio con el que el resto de la app pinta un
                            cargo. */}
                        <Icono
                          className={`size-4 shrink-0 ${valor === "credito" ? "text-destructive" : "text-money-in"}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="pago-monto">Monto</Label>
                <div className="flex items-start gap-1">
                  <Input
                    id="pago-monto"
                    className="min-w-0 flex-1"
                    inputMode="decimal"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="00"
                  />
                  {/* EL SELECTOR SOLO CON TASA. Sin ella no hay bolívares que
                      ofrecer, y un desplegable de una sola opción no decide
                      nada. */}
                  {/* EN LAS DOS RAMAS. Lo tenía solo en el contado y los dos
                      frames lo dibujan igual: un fiado pactado en bolívares es
                      tan posible como un cobro en bolívares, y la deuda se
                      guarda convertida al libro exactamente igual. */}
                  {tasa ? (
                    <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2">
                      <CurrencyFlagIcon
                        currency={monedaEntrega === "VES" ? "VES" : moneda}
                        className="size-4"
                      />
                      <select
                        aria-label="Moneda que te entrega"
                        value={monedaEntrega}
                        onChange={(e) => {
                          const siguiente = e.target.value as "VES" | PriceCurrency;
                          if (siguiente === monedaEntrega || !tasa) return;
                          // SE REEXPRESA LA CIFRA AL CAMBIAR. Dejar 5.756,66
                          // rotulado «Dólares» no sería un fallo silencioso
                          // —el tope de la venta lo frena— pero sí un susto, y
                          // obliga a reteclear lo que la app ya sabe convertir.
                          const actual = parseAmount(monto) ?? 0;
                          setMonto(
                            formatAmountForInput(
                              siguiente === "VES" ? actual * tasa : actual / tasa,
                            ),
                          );
                          setMonedaEntrega(siguiente);
                        }}
                        className="bg-transparent text-base outline-none"
                      >
                        <option value={moneda}>{NOMBRE[moneda] ?? moneda}</option>
                        <option value="VES">Bolívares</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>

              {entregaEnOtraMoneda ? (
                <p className="text-xs leading-4 text-muted-foreground">
                  Un pago parcial queda guardado en {NOMBRE[moneda] ?? moneda} a la tasa
                  equivalente.
                </p>
              ) : null}

              {/* LA PREVISTA SOLO SI EXISTE, y solo si hay algo que convertir.
                  Es una CASILLA y no una cifra: el navegador no manda ningún
                  número, solo pide que se use la tasa que el servidor ya tiene
                  guardada. */}
              {prevista && entregaEnOtraMoneda ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={usarPrevista}
                    onCheckedChange={(v) => setUsarPrevista(v === true)}
                  />
                  Aplicar tasa BCV prevista para el {formatDate(prevista.fecha)}
                </label>
              ) : null}

              {/* LA EQUIVALENCIA, SIEMPRE VISIBLE Y SIEMPRE CALCULADA. Es lo
                  que va a quedar escrito en el libro, así que se enseña grande
                  y en verde —`money-in`, el token con el que esta app pinta el
                  dinero que entra; el frame la fija en #176349—. No se puede
                  teclear: ver el comentario de `enElLibro`. */}
              <div className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-col justify-center gap-[3px]">
                  <span className="text-xs font-medium">Equivalencia</span>
                  <span className="text-xl font-semibold tabular-nums text-money-in">
                    {formatPriceAmount(enElLibro, moneda)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs">
                  {NOMBRE[moneda] ?? moneda}
                  <CurrencyFlagIcon currency={moneda} className="size-4" />
                </span>
              </div>

              {deMas ? (
                <p className="text-xs text-destructive">
                  No puedes cobrar más de {formatPriceAmount(total, moneda)}.
                </p>
              ) : null}
            </div>
          </div>

          {/* ── LA RAMA DEL CRÉDITO ────────────────────────────────────── */}
          {!esContado ? (
            <>
              <PlazoPagoSelect
                value={plazo}
                onValueChange={(v) => {
                  setPlazo(v);
                  // Sin plazo no hay nada que repartir, así que las cuotas
                  // vuelven a pago único — el `check` de la `118` lo exige, y
                  // si no, el campo se esconde con un número dentro que nadie
                  // acaba de decidir.
                  if (v === "" || v === "sin_especificar") setCuotas("1");
                }}
              />
              <CuotasSelect value={cuotas} onValueChange={setCuotas} plazoDias={plazoDias} />

              {/* EL CALENDARIO, que es lo que convierte «3 cuotas en 30 días»
                  en algo que el tendero puede repetirle a su cliente. Se pinta
                  solo cuando hay plazo: sin fecha, una tabla de vencimientos
                  son tres rayas. */}
              {plazoDias != null && calendario.length > 1 ? (
                <div className="flex flex-col gap-2 rounded-[10px] border p-3">
                  <div className="flex gap-2 text-sm">
                    <span className="w-4">#</span>
                    <span className="flex-1">Vence</span>
                    <span className="flex-1 text-right">Monto</span>
                  </div>
                  {calendario.map((c) => (
                    <div key={c.numero} className="flex items-center gap-2 text-xs">
                      <span className="w-4 tabular-nums">{c.numero}</span>
                      <span className="min-w-0 flex-1">{c.vence ? formatDate(c.vence) : "—"}</span>
                      <span className="flex-1 text-right tabular-nums">
                        {formatPriceAmount(c.monto, moneda)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {/* FOTO (OPCIONAL) — está en los DOS frames y se me había quedado
              fuera entera; lo corrigió el dueño el 2026-10-18.

              `AttachmentUploader` es el mismo que usa el comprobante de un
              movimiento: ya resuelve subir desde la galería o abrir la cámara
              en un teléfono, y sube al bucket que la ficha del movimiento lee.
              Rehacerlo aquí habría sido copiar esa lógica para que un día una
              de las dos deje de abrir la cámara. */}
          <div className="flex flex-col gap-2">
            <Label>Foto (opcional)</Label>
            <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pago-nota">Descripción (opcional)</Label>
            <Textarea
              id="pago-nota"
              className="h-[120px]"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción"
            />
          </div>

          <Button
            type="button"
            className="h-10 w-full"
            disabled={!listo}
            onClick={() =>
              onGuardar({
                // LO QUE ENTRA HOY EN EL LIBRO. Lo que falte hasta el total es
                // la deuda, y la calcula el servidor: aquí no se teclea.
                amount: Math.round(enElLibro * 100) / 100,
                entryCurrency: entregaEnOtraMoneda ? "VES" : null,
                // LO ENTREGADO SE GUARDA SIEMPRE, no solo en bolívares. Con la
                // misma moneda coincide con `amount` salvo por el ajuste del
                // céntimo; en bolívares es la única constancia de cuántos
                // cambiaron de mano, que es para lo que existe `entry_amount`
                // desde la migración `022` — una tasa se revisa, un billete
                // contado no.
                entryAmount: entregado,
                // EL PLAZO Y LAS CUOTAS VIAJAN SIEMPRE y el servidor los ignora
                // cuando no hay deuda que pactar, porque entonces no escribe
                // ningún cargo. Limpiarlos aquí según el chip obligaría a
                // volver a elegirlos si el tendero baja el monto y lo sube.
                plazo,
                cuotas,
                usarPrevista,
                photoPath,
                description: descripcion.trim(),
              })
            }
          >
            Pagar
          </Button>

        </div>
      </SheetContent>
    </Sheet>
  );
}

// EL AVISO DE «TE FALTA REGISTRAR», propuesto el 2026-10-18 a petición del
// dueño: «al seleccionar el botón se debe mostrar mensaje de support texto de
// error mencionando que se deben pagar los saldos de las monedas
// correspondientes».
//
// NOMBRA LAS MONEDAS QUE FALTAN, no dice «faltan monedas»: la pantalla puede
// tener dos tarjetas y un aviso genérico obligaría a mirarlas una por una para
// descubrir cuál. Y dice QUÉ HACER —tocar «Pagar»— y que fiar también cuenta
// como registrar, porque la queja natural al leerlo es «pero si no me lo va a
// pagar hoy».
//
// Tono in-app: neutro y sin jerga. Es la pantalla del dinero.
function textoFaltaRegistrar(monedas: PriceCurrency[]): string {
  const nombres = monedas.map((c) => NOMBRE[c] ?? c);
  const lista =
    nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0];
  return nombres.length > 1
    ? `Falta registrar el pago en ${lista}. Toca «Pagar» en cada una y di si fue de contado o fiado.`
    : `Falta registrar el pago en ${lista}. Toca «Pagar» en esa tarjeta y di si fue de contado o fiado.`;
}

const NOMBRE: Partial<Record<PriceCurrency, string>> = {
  USD: "Dólares",
  EUR: "Euros",
  COP: "Pesos",
};

// UNA LÍNEA MÁS, O UNA UNIDAD MÁS DE LA MISMA. La identidad de una línea es
// el producto Y SU MONEDA: el mismo producto cobrado en dólares y en euros
// son dos líneas, que es justo lo que el carrito del sitemap dibuja con dos
// banderas distintas.
function agregar(lineas: LineaVenta[], nueva: LineaVenta): LineaVenta[] {
  const i = lineas.findIndex((l) => l.productId === nueva.productId && l.currency === nueva.currency);
  if (i === -1) return [...lineas, nueva];
  return lineas.map((l, j) => (j === i ? { ...l, quantity: l.quantity + nueva.quantity } : l));
}

// UN TOTAL POR MONEDA, nunca uno solo. Sumar dólares con euros exigiría una
// tasa, y el resultado sería un número que el tendero no puede cobrar: el
// cliente paga en cada moneda lo suyo. Es la misma forma que tiene la
// pantalla de Pago del sitemap.
function totalesPorMoneda(
  lineas: LineaVenta[],
  rates: BolivarRates | null,
): { currency: PriceCurrency; amount: number }[] {
  const porMoneda = new Map<PriceCurrency, number>();
  for (const l of lineas) {
    const escalon = escalonParaCantidad(l.producto, l.quantity);
    const bloque = escalon === "wholesale" ? l.producto.wholesale : l.producto.retail;
    const unitario = precioEnMoneda(bloque, l.currency, rates);
    if (unitario == null) continue;
    porMoneda.set(l.currency, (porMoneda.get(l.currency) ?? 0) + unitario * l.quantity);
  }
  return [...porMoneda.entries()].map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  }));
}
