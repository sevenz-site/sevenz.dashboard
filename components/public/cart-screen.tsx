"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Share2,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { WhatsappInput } from "@/components/whatsapp-input";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  CatalogStrip,
  type CatalogStripProduct,
} from "@/components/public/catalog-strip";
import { useTokenDelSaldo } from "@/components/public/back-to-balance";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatCantidad } from "@/lib/products/cantidad";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
} from "@/lib/products/price";
import { formatBs } from "@/lib/exchange-rate/format";
import { telefonoLegible } from "@/lib/phone";
import { dibujarRecibo } from "@/lib/cart/recibo-imagen";
import { useCarrito } from "@/lib/cart/store";
import {
  precioUnitario,
  subtotales,
  resumenPorMoneda,
  type ProductoDelCarrito,
} from "@/lib/cart/cart";
import { productosDelCarrito, crearOrden } from "@/app/c/[token]/actions";
import { TEXTO_PERMISO_ORDEN, mensajeDeLaOrden } from "@/lib/cart/mensaje";

// «TU CARRITO», del frame `1190:5793`.
//
// ===========================================================================
// LOS PRECIOS SE PIDEN CADA VEZ, NO SE GUARDAN
//
// El carrito del navegador solo tiene `{ producto, cantidad, moneda,
// comentario }`. Todo lo que se ve aquí —nombre, foto, precio— sale de
// `get_shared_products` en cada visita.
//
// No es desconfianza del almacenamiento: es que **el escalón depende de la
// cantidad**, y la cantidad se edita en esta misma pantalla. Pulsar «+» hasta
// cruzar el mínimo al mayor tiene que cambiar el precio delante del cliente.
// Con un precio guardado no cambiaría, y la orden —que lo recalcula en el
// servidor— acabaría diciendo otra cosa.
//
// ===========================================================================
// SE GUARDA PRIMERO Y SE ABRE WHATSAPP DESPUÉS
//
// Decisión del dueño el 2026-10-14, y el orden es el punto entero: si el
// cliente nunca llega a pulsar enviar en WhatsApp —que en iOS pasa— el pedido
// existe igual, y el tendero lo ve en la app.
//
// Por eso WhatsApp no se abre solo al guardar: se enseña una pantalla de
// «listo» con un botón. Abrirlo automáticamente tras un `await` es
// exactamente lo que iOS Safari puede bloquear por no venir de un gesto, y
// entonces el cliente se queda mirando una pantalla que no hizo nada aunque su
// pedido sí se guardó.

type Estado =
  | { fase: "cargando" }
  | {
      fase: "listo";
      productos: Map<string, ProductoDelCarrito>;
      rates: BolivarRates | null;
    }
  | {
      fase: "enviado";
      mensaje: string;
      comprador: { nombre: string; documento: string; telefono: string };
      // LOS IDS DE LO COMPRADO, por la MISMA razón que el resumen: esta
      // pantalla se pinta después de vaciar el carrito, así que leerlos de él
      // daría una lista vacía y el carrusel de abajo volvería a ofrecer lo que
      // el comprador acaba de meter en la bolsa.
      comprados: string[];
      // LA FOTO DEL PEDIDO, no una referencia al carrito: esta pantalla se
      // pinta DESPUÉS de vaciarlo. Calcularla sobre el carrito daría un
      // resumen vacío justo donde el cliente espera ver lo que pidió.
      resumen: ReturnType<typeof resumenPorMoneda>;
      rates: BolivarRates | null;
    };

export function CartScreen({
  token,
  businessName,
  ownerWhatsapp,
  ownerCountry,
  relacionados = [],
}: {
  token: string;
  businessName: string;
  ownerWhatsapp: string | null;
  // El país del NEGOCIO, solo para que el selector de prefijo abra en el que
  // va a usar el 99 % de sus clientes. El cliente puede cambiarlo.
  ownerCountry: string | null;
  // EL CATÁLOGO DEL NEGOCIO, para el carrusel «Otros productos» del
  // comprobante. Por defecto
  // vacío: la pantalla de «enlace inválido» monta este componente sin datos,
  // y un carrusel sin productos no se pinta solo.
  relacionados?: CatalogStripProduct[];
}) {
  const { lineas, cambiar, quitar, vaciar } = useCarrito(token);
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  // `pending` ES ESTADO DE REACT, no uno nuestro, y por eso se usa para saber
  // si el carrito está cargando en vez de un `setEstado({fase:'cargando'})`
  // dentro del efecto: esa versión la rechaza `react-hooks/set-state-in-effect`
  // —encadena renders— y era además peor, porque al añadir un producto
  // volvía a enseñar el spinner sobre líneas que ya estaban pintadas.
  const [cargando, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);

  // Las claves de las líneas, como texto, para que el efecto no se dispare en
  // cada render por un array nuevo con el mismo contenido.
  const idsClave = lineas
    .map((l) => l.productId)
    .sort()
    .join(",");

  useEffect(() => {
    // Con el carrito vacío no hay nada que pedir, y tampoco nada que mostrar:
    // la pantalla pinta su estado vacío sin necesitar respuesta.
    if (idsClave === "") return;
    startTransition(async () => {
      const r = await productosDelCarrito(token, idsClave.split(","));
      setEstado({
        fase: "listo",
        productos: new Map(r.productos.map((p) => [p.id, p])),
        rates: r.rates,
      });
    });
  }, [token, idsClave]);

  if (estado.fase === "enviado") {
    return (
      <Enviado
        token={token}
        mensaje={estado.mensaje}
        businessName={businessName}
        comprador={estado.comprador}
        resumen={estado.resumen}
        rates={estado.rates}
        relacionados={relacionados}
        // LO QUE ACABA DE COMPRAR, para no ofrecérselo otra vez debajo del
        // recibo. `estado.lineas` es la orden recién enviada.
        yaComprados={estado.comprados}
      />
    );
  }

  const productos =
    estado.fase === "listo"
      ? estado.productos
      : new Map<string, ProductoDelCarrito>();
  const rates = estado.fase === "listo" ? estado.rates : null;
  const totales = subtotales(lineas, productos, rates);
  // Solo la PRIMERA carga tapa la lista. Las siguientes —al añadir algo desde
  // otra pestaña, por ejemplo— dejan lo que ya está pintado y lo refrescan
  // cuando llega; tapar una lista que ya se ve es peor que esperar un
  // instante a que un precio se ajuste.
  const primeraCarga = estado.fase === "cargando" && lineas.length > 0;

  // LAS LÍNEAS HUÉRFANAS. Un producto que el tendero despublicó o mandó a la
  // papelera mientras el cliente compraba no vuelve de `get_shared_products`.
  // No se borran solas: se marcan y el cliente las quita. Borrar algo del
  // carrito de alguien sin decírselo es peor que enseñar el problema.
  // Mientras se está pidiendo, una línea sin producto todavía no es huérfana:
  // es una que no ha llegado. Confundirlas enseñaría «ya no está disponible»
  // en cada carga.
  const huerfanas =
    estado.fase === "listo" && !cargando
      ? lineas.filter((l) => !productos.has(l.productId))
      : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-4">
        <Link
          href={`/c/${token}`}
          aria-label="Volver al catálogo"
          className="-m-2 rounded-md p-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-6" aria-hidden="true" />
        </Link>
        {lineas.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              vaciar();
              toast.success("Carrito vacío");
            }}
          >
            Vaciar
          </Button>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tu carrito</h1>

        {lineas.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Todavía no has agregado nada. Vuelve al catálogo y elige lo que
              quieras pedir.
            </p>
          </div>
        ) : primeraCarga ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Preparando tu carrito...
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {lineas.map((l) => {
                const p = productos.get(l.productId);
                const precio = p ? precioUnitario(p, l, rates) : null;
                const bs =
                  precio && rates && precio.currency !== "VES"
                    ? priceIn(
                        "VES",
                        { amount: precio.amount, currency: precio.currency },
                        rates,
                      )
                    : null;

                return (
                  <li
                    key={l.productId}
                    className="flex gap-3 rounded-xl border p-3"
                  >
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {p?.photo_path ? (
                        <Image
                          src={getPublicProductPhotoUrl(p.photo_path)}
                          alt=""
                          fill
                          unoptimized
                          sizes="64px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-5" aria-hidden="true" />
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">
                          {p?.name ?? "Producto"}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitar(l.productId)}
                          aria-label={`Quitar ${p?.name ?? "producto"}`}
                          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      {p == null ? (
                        cargando ? (
                          <p className="text-xs text-muted-foreground">
                            Actualizando precio...
                          </p>
                        ) : (
                          <p className="text-xs leading-relaxed text-destructive">
                            Ya no está disponible. Quítalo para poder enviar tu
                            pedido.
                          </p>
                        )
                      ) : precio == null ? (
                        <p className="text-xs leading-relaxed text-destructive">
                          Este producto ya no tiene precio para esa cantidad.
                          Cámbiala o quítalo.
                        </p>
                      ) : (
                        <>
                          <span className="text-sm tabular-nums">
                            {formatPriceAmount(precio.amount, precio.currency)}
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              c/u ·{" "}
                              {precio.tier === "wholesale"
                                ? "al mayor"
                                : "al detal"}
                            </span>
                          </span>
                          {bs?.amount != null ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatBs(bs.amount)} c/u
                            </span>
                          ) : null}
                        </>
                      )}

                      {l.comment ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          «{l.comment}»
                        </p>
                      ) : null}

                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-9"
                          aria-label={`Quitar uno de ${p?.name ?? "producto"}`}
                          onClick={() => cambiar(l.productId, l.quantity - 1)}
                        >
                          <Minus className="size-4" />
                        </Button>
                        <span className="min-w-8 text-center text-sm tabular-nums">
                          {formatCantidad(l.quantity)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-9"
                          aria-label={`Agregar uno de ${p?.name ?? "producto"}`}
                          onClick={() => cambiar(l.productId, l.quantity + 1)}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* SUBTOTALES POR MONEDA, NO UN TOTAL. Decisión del dueño el
                2026-10-14: no hay tasa de euro a dólar en ninguna parte del
                producto, solo del BCV a bolívares. Un «total» con monedas
                mezcladas obligaría a inventarse una conversión, y lo que el
                cliente va a pagar no es una conversión inventada. */}
            {totales.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-xl border p-3">
                {totales.map((t) => (
                  <div
                    key={t.currency}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-sm text-muted-foreground">
                      {totales.length > 1 ? `Total en ${t.currency}` : "Total"}
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {formatPriceAmount(t.amount, t.currency)}
                    </span>
                  </div>
                ))}
                {totales.length > 1 ? (
                  <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                    Son dos totales porque pediste en dos monedas. Cada uno se
                    paga por separado.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
          Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas.
          Pagos y abonos deben hacerse directamente con el dueño del comercio.
        </p>
      </div>

      {lineas.length > 0 ? (
        <div className="sticky bottom-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            className="h-12 w-full"
            disabled={
              cargando || estado.fase !== "listo" || huerfanas.length > 0
            }
            onClick={() => setAbierto(true)}
          >
            <WhatsappIcon className="size-5" /> Completar orden
          </Button>
          {huerfanas.length > 0 ? (
            <p className="pt-2 text-center text-xs leading-relaxed text-destructive">
              Quita lo que ya no está disponible para poder enviar tu pedido.
            </p>
          ) : null}
        </div>
      ) : null}

      <FormularioDeLaOrden
        abierto={abierto}
        onAbierto={setAbierto}
        token={token}
        businessName={businessName}
        ownerCountry={ownerCountry}
        ownerWhatsapp={ownerWhatsapp}
        lineas={lineas}
        productos={productos}
        rates={rates}
        onEnviada={(mensaje, comprador) => {
          // LA FOTO SE TOMA ANTES DE VACIAR, y el orden importa: `vaciar()`
          // borra las líneas, así que calcular el resumen después daría una
          // pantalla en blanco.
          setEstado({
            fase: "enviado",
            mensaje,
            comprador,
            resumen: resumenPorMoneda(lineas, productos, rates),
            comprados: lineas.map((l) => l.productId),
            rates,
          });
          vaciar();
        }}
      />
    </main>
  );
}

// ===========================================================================
// EL FORMULARIO, QUE SALE AL PULSAR «COMPLETAR ORDEN»
//
// Decisión del dueño el 2026-10-15: los tres datos se piden DESPUÉS de pulsar,
// no dentro del carrito. Nombre, documento y WhatsApp, los tres obligatorios —
// sin ellos el tendero recibe un pedido de un desconocido y no puede
// responderlo.
function FormularioDeLaOrden({
  abierto,
  onAbierto,
  token,
  businessName,
  ownerCountry,
  ownerWhatsapp,
  lineas,
  productos,
  rates,
  onEnviada,
}: {
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  token: string;
  businessName: string;
  ownerCountry: string | null;
  ownerWhatsapp: string | null;
  lineas: ReturnType<typeof useCarrito>["lineas"];
  productos: Map<string, ProductoDelCarrito>;
  // THE SAME RATE THE SCREEN HAS JUST SHOWN. It comes down as a prop instead
  // of being read here so the WhatsApp message cannot quote a figure different
  // from the one the customer saw: a second read could land on the other side
  // of the daily rate refresh.
  rates: BolivarRates | null;
  onEnviada: (
    mensaje: string,
    comprador: { nombre: string; documento: string; telefono: string },
  ) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  // DESMARCADA, aunque el frame la dibuje marcada. El porqué está en
  // `lib/cart/mensaje.ts`, junto al texto: Meta exige consentimiento
  // afirmativo, y una premarcada no es una elección.
  const [quiereAvisos, setQuiereAvisos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

  // El prefijo abre en el país del NEGOCIO, que es el de casi todos sus
  // clientes. `DIAL_POR_PAIS` solo cubre los dos donde Sevenz opera; para
  // cualquier otro, `WhatsappInput` cae en su propio valor por defecto.
  const prefijo =
    ownerCountry === "VE" ? "58" : ownerCountry === "CO" ? "57" : undefined;

  function enviar() {
    setError(null);
    startTransition(async () => {
      const r = await crearOrden(
        token,
        {
          nombre,
          documento,
          whatsapp,
          quiereAvisos,
          textoDelPermiso: quiereAvisos ? TEXTO_PERMISO_ORDEN : null,
        },
        lineas.map((l) => ({
          product_id: l.productId,
          quantity: l.quantity,
          currency: l.currency,
          comment: l.comment,
        })),
      );

      if (!r.ok) {
        setError(r.error);
        return;
      }

      const mensaje = mensajeDeLaOrden(
        businessName,
        nombre,
        lineas,
        productos,
        rates,
      );

      // «ENVIAR PEDIDO» MANDA LA FOTO DEL RECIBO, NO EL TEXTO.
      //
      // Decisión del dueño el 2026-10-15 —«para evitar que se edite el texto
      // del mensaje en whatsApp»— y REAFIRMADA por él el 2026-10-17, después
      // de que yo la invirtiera por error. Las tres versiones quedan escritas
      // porque el camino de ida y vuelta es justo lo que no hay que repetir:
      //
      //   1. `{ files, text }` -> WhatsApp adjuntaba el recibo Y debajo el
      //      mensaje entero: la misma compra contada dos veces. Él lo
      //      reportó.
      //   2. `wa.me` con el texto, sin foto -> lo que yo hice al leer «debería
      //      abrir el wa.me del negocio». Dejaba exactamente lo que él quería
      //      quitar, el texto editable, y tiraba lo que quería conservar.
      //   3. `{ files }` a secas, que es esto.
      //
      // ─────────────────────────────────────────────────────────────────────
      // Y POR QUÉ NO SE PUEDE TENER LAS DOS COSAS, que es el fondo del
      // malentendido y hay que dejarlo dicho para que nadie lo intente otra
      // vez creyendo que se nos olvidó:
      //
      //   - `wa.me/<numero>` va DIRECTO al negocio, sin preguntar a quién...
      //     pero SOLO ADMITE TEXTO. No existe ningún parámetro del formato
      //     para adjuntar un fichero — comprobado contra su documentación el
      //     2026-10-15.
      //   - `navigator.share({files})` SÍ lleva la imagen... pero la hoja
      //     nativa decide el destinatario, y la Web Share API no permite
      //     fijarlo.
      //
      // «Va solo al negocio» y «lleva la foto» son excluyentes en un toque, y
      // el dueño eligió la foto. Lo que cuesta: el comprador elige WhatsApp y
      // el contacto en la hoja. Lo que se gana: lo que llega no se puede
      // editar de camino, que era el problema original.
      //
      // EL `wa.me` SE QUEDA COMO RESERVA, abajo, para el aparato que no puede
      // compartir ficheros — un escritorio, básicamente. Ahí la elección no
      // existe: o texto, o nada.
      //
      // ESTO OCURRE DESPUÉS DE UN `await`, porque la orden se guarda primero,
      // y iOS bloquea tanto `window.open` como `navigator.share` cuando no
      // vienen de un toque directo. Así que ninguna de las dos está
      // garantizada aquí, y el camino fiable sigue siendo el botón
      // «Compartir» de la pantalla siguiente, que es un toque directo sin
      // nada esperando por delante. El pedido YA está guardado —decisión del
      // 2026-10-14— así que lo que falle aquí cuesta un toque más, no un
      // pedido.
      const recibo = dibujarRecibo({
        businessName,
        comprador: { nombre, documento, telefono: telefonoLegible(whatsapp) },
        resumen: resumenPorMoneda(lineas, productos, rates),
        rates,
      });
      const ficheroRecibo =
        recibo == null
          ? null
          : new File([recibo], "pedido-sevenz.png", { type: "image/png" });

      if (
        ficheroRecibo != null &&
        navigator.canShare?.({ files: [ficheroRecibo] })
      ) {
        // SIN `text`. Es la primera corrección del 2026-10-17 y sigue en pie:
        // la imagen va sola, no acompañada del mensaje escrito.
        void navigator.share({ files: [ficheroRecibo] }).catch(() => {});
      } else {
        // LA RESERVA. `mensaje` no sobra: es lo único que un `wa.me` admite, y
        // es también lo que recibe `onEnviada` para la pantalla siguiente.
        const digitos = ownerWhatsapp?.replace(/\D/g, "") ?? "";
        if (digitos !== "") {
          window.open(
            `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`,
            "_blank",
            "noopener,noreferrer",
          );
        }
      }

      onAbierto(false);
      onEnviada(mensaje, { nombre, documento, telefono: whatsapp });
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={onAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>¿Quién hace el pedido?</DialogTitle>
          <DialogDescription>
            El negocio necesita estos datos para poder responderte y preparar tu
            pedido.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="orden_nombre">Nombre y apellido</Label>
            <Input
              id="orden_nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Escribe nombre y apellido"
              maxLength={120}
              autoComplete="name"
              disabled={enviando}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="orden_documento">Documento</Label>
            <Input
              id="orden_documento"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="Escribe documento"
              maxLength={40}
              disabled={enviando}
            />
          </div>

          <div className="flex flex-col gap-2">
            {/* «WhatsApp o teléfono» y no «WhatsApp» a secas, del frame
                `1326:5755`: el cliente puede no tener WhatsApp y el número
                sigue sirviéndole al tendero para llamarlo.

                Se reutiliza `WhatsappInput`, el mismo del alta de clientes y
                del registro, en vez de un campo suelto. No es ahorro: ese
                componente ya resuelve partir y recomponer un número con su
                prefijo, y la migración 073 documenta lo que cuesta hacerlo a
                mano — «4149900094» se leía como Suiza. */}
            <Label htmlFor="orden_whatsapp">WhatsApp o teléfono</Label>
            <WhatsappInput
              id="orden_whatsapp"
              name="orden_whatsapp"
              preferredDialCode={prefijo}
              onValueChange={setWhatsapp}
              disabled={enviando}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2 pt-1">
            <input
              type="checkbox"
              checked={quiereAvisos}
              onChange={(e) => setQuiereAvisos(e.target.checked)}
              disabled={enviando}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
            <span className="text-sm leading-relaxed">
              {TEXTO_PERMISO_ORDEN}
            </span>
          </label>

          {error ? (
            <p
              className="text-sm leading-relaxed text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            className="h-12"
            onClick={enviar}
            disabled={enviando}
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <WhatsappIcon className="size-5" />
            )}
            Enviar pedido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// «TU PEDIDO QUEDÓ REGISTRADO», del frame `1326:5835`
//
// SIN EL BLOQUE DE DEUDAS QUE DIBUJA EL FRAME, y la razón vale la pena no
// perderla. El frame trae, por moneda, «Abonó», «Debe (esta venta)», «Deuda
// antigua» y «Deuda total». Se quitaron el 2026-10-15, decidido por el dueño
// tras ponerle delante lo que implicaban:
//
//   1. No hay paso de pago en el flujo, así que «Abonó» solo puede ser cero.
//   2. «Deuda antigua» ES el libro del dinero, y la decisión 7 del 2026-10-14
//      dice que la orden no lo toca.
//   3. Y la que decide: para saber esa deuda hay que emparejar al comprador
//      con un cliente de la bodega por el teléfono o el documento que ACABA
//      DE TECLEAR UN DESCONOCIDO. Cualquiera con el enlace escribiría el
//      número de su vecino, pediría una bolsa de arroz, y la pantalla le
//      contestaría con cuánto debe su vecino. El catálogo público se
//      convertiría en un consultor de saldos ajenos.
//
// Vuelven cuando exista el cruce con movimientos (entregable 1.2) y en una
// pantalla donde el comprador esté identificado de verdad.
//
// EL BOTÓN DE WHATSAPP ES EL PLAN B, no el camino principal: al enviar ya se
// intentó abrir. Está aquí porque ese intento ocurre tras un `await` y iOS
// puede bloquearlo — y entonces este toque sí sale de un gesto.
function Enviado({
  token,
  mensaje,
  businessName,
  comprador,
  resumen,
  rates,
  relacionados,
  yaComprados,
}: {
  token: string;
  mensaje: string;
  businessName: string;
  comprador: { nombre: string; documento: string; telefono: string };
  resumen: ReturnType<typeof resumenPorMoneda>;
  rates: BolivarRates | null;
  relacionados: CatalogStripProduct[];
  yaComprados: string[];
}) {
  // El enlace del saldo, si este comprador llegó desde el suyo. Decide si
  // «Ver saldo pendiente» existe — ver donde se pinta, abajo.
  const tokenDelSaldo = useTokenDelSaldo();

  // LA HOJA NATIVA DEL TELÉFONO, no un `wa.me`. A petición del dueño el
  // 2026-10-15, y es lo que dibuja el frame `1326:5835`.
  //
  // La diferencia no es de icono: `wa.me` manda al número del NEGOCIO y nada
  // más; la hoja nativa deja al comprador mandarse el resumen a sí mismo,
  // reenviarlo a quien le hizo el encargo, o guardárselo. Al enviar el pedido
  // ya se intentó abrir WhatsApp con el negocio, así que ese camino no se
  // pierde — este es el otro.
  //
  // ─────────────────────────────────────────────────────────────────────
  // Y LO QUE SE COMPARTE ES UNA IMAGEN, no el texto. Decisión del dueño el
  // 2026-10-15: «para evitar que se edite el texto del mensaje en whatsApp».
  //
  // SE LE DIJO LO QUE ESTO NO HACE, y queda escrito para que nadie lo
  // confunda después: una imagen no impide manipular nada. Se puede recortar
  // una captura, o no compartir y escribir otra cosa. Lo que gana es que el
  // camino honesto produzca algo que no se retoca sin querer al editar el
  // borrador de WhatsApp antes de mandarlo. La prueba de verdad es la orden
  // guardada en el servidor, que es la que el tendero abre.
  //
  // NO HAY NI UN `await` ANTES DE `navigator.share`, y es deliberado. iOS
  // bloquea la hoja cuando la llamada no viene de un gesto, y un `await`
  // rompe esa cadena — este mismo repo ya perdió así el `wa.me`. Por eso
  // `dibujarRecibo` es síncrona de principio a fin y esta función dejó de ser
  // `async`.
  //
  // TRES CAMINOS, EN ESTE ORDEN, y cada uno existe por un sitio real:
  //
  //   1. Hoja nativa con el fichero -> el teléfono, que es donde pasa esto.
  //   2. Descargar el PNG -> un escritorio sin `canShare({files})`, que es
  //      Firefox y buena parte de Chrome en Windows.
  //   3. El texto de siempre -> si el dibujo falla. Un canvas puede no estar
  //      disponible, y quedarse sin compartir nada por eso sería peor que
  //      compartir texto editable.
  function compartir() {
    const blob = dibujarRecibo({
      businessName,
      // EL TELÉFONO VA YA FORMATEADO, el mismo que la pantalla enseña. Si la
      // imagen lo escribiera en crudo, el comprador vería doce dígitos
      // seguidos en el recibo y su número separado arriba, y no sabría cuál
      // de los dos le mandaron al tendero.
      comprador: {
        ...comprador,
        telefono: telefonoLegible(comprador.telefono),
      },
      resumen,
      rates,
    });

    if (blob != null) {
      const fichero = new File([blob], "pedido-sevenz.png", {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [fichero] })) {
        // Cerrar la hoja la rechaza. Eso es el comprador decidiendo no
        // mandarlo, no un fallo, así que no lleva aviso.
        void navigator.share({ files: [fichero] }).catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "pedido-sevenz.png";
      enlace.click();
      // Revocar en el mismo tick cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Resumen descargado");
      return;
    }

    if (navigator.share) {
      void navigator.share({ text: mensaje }).catch(() => {});
      return;
    }
    void navigator.clipboard
      .writeText(mensaje)
      .then(() => toast.success("Resumen copiado"))
      .catch(() => toast.error("No pudimos copiar el resumen"));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <div className="flex flex-col items-center gap-3 pb-2 text-center">
        <CheckCircle2 className="size-14 text-emerald-600" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Tu pedido quedó registrado</h1>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Datos del comprador</h2>
          <User className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <Dato etiqueta="Nombre y apellido" valor={comprador.nombre} />
        <Dato etiqueta="Documento" valor={comprador.documento} />
        <Dato etiqueta="Teléfono" valor={telefonoLegible(comprador.telefono)} />
      </section>

      {resumen.map((bloque) => {
        const enBs =
          rates && bloque.currency !== "VES"
            ? priceIn(
                "VES",
                { amount: bloque.total, currency: bloque.currency },
                rates,
              )
            : null;
        return (
          <section
            key={bloque.currency}
            className="flex flex-col gap-3 rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                Resumen de compra en{" "}
                {NOMBRE_MONEDA[bloque.currency] ?? bloque.currency}
              </h2>
              <CurrencyFlagIcon currency={bloque.currency} />
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Producto</th>
                  <th className="pb-1 text-right font-normal">Cantidad</th>
                  <th className="pb-1 text-right font-normal">Por pagar</th>
                </tr>
              </thead>
              <tbody>
                {bloque.items.map((i, n) => (
                  <tr key={`${i.name}-${n}`}>
                    <td className="py-0.5 pr-2">{i.name}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {formatCantidad(i.quantity)}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">
                      {formatPriceAmount(i.total, bloque.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-baseline justify-between gap-3 border-t pt-3">
              <span className="text-sm font-semibold">
                Total en {NOMBRE_MONEDA[bloque.currency] ?? bloque.currency}
              </span>
              <span className="text-right">
                <span className="block text-base font-semibold tabular-nums">
                  {formatPriceAmount(bloque.total, bloque.currency)}
                </span>
                {enBs?.amount != null ? (
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatBs(enBs.amount)}
                  </span>
                ) : null}
              </span>
            </div>
          </section>
        );
      })}

      {/* EL LOGO Y LA DIRECCIÓN, del frame. A petición del dueño el
          2026-10-15, y van en la pantalla Y en la imagen por la misma razón:
          esta es la única pantalla del catálogo que el cliente guarda o
          reenvía, así que es donde el aviso de abajo necesita decir quién lo
          firma. Sin marca, un texto sobre dinero es una captura cualquiera.

          `priority` no, y `unoptimized` tampoco hace falta: es un SVG del
          propio dominio y Next lo sirve tal cual. */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Image
          src="/logo-primary.svg"
          alt="Sevenz"
          width={96}
          height={35}
          className="h-7 w-auto"
        />
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas.
          Pagos y abonos deben hacerse directamente con el dueño del comercio.
        </p>
        <p className="text-center text-xs font-medium text-muted-foreground">
          sevenz.site
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={compartir}
          className="flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Share2 className="size-5" aria-hidden="true" /> Compartir
        </button>

        {/* EL CARRUSEL, DEBAJO DE «COMPARTIR». Encargo del dueño el
            2026-10-17, y es el MISMO componente que la franja del saldo —no
            una copia— porque las dos enseñan lo mismo y el día que una
            cambie la otra tiene que cambiar con ella.

            SIN `shareToken`, a propósito: quien lee esto YA está dentro del
            catálogo, así que no hay ningún «abrió el catálogo desde el
            enlace» que contar. Mandar ese evento desde aquí inflaría el único
            número que existe para contestar esa pregunta.

            FUERA LO QUE ACABA DE COMPRAR. Un carrusel que debajo del recibo
            le ofrece otra vez lo que tiene en la bolsa no es una sugerencia,
            es un despiste — y en un producto sobre dinero, invitar a comprar
            dos veces lo mismo es exactamente lo que no conviene.

            EL RÓTULO DICE «OTROS PRODUCTOS» Y NO «PRODUCTOS RELACIONADOS».
            Nació con lo segundo y el dueño lo cambió el mismo día, al leer
            que el dato no lo sostenía: la ficha de un producto no tiene
            categoría, ni etiquetas, ni familia, así que lo único que une a
            estos con lo comprado es ser de la misma bodega.

            Con seis productos no se nota —«relacionados» y «los otros» son el
            mismo conjunto— pero el día que una bodega publique decenas, quien
            compró arroz vería tornillos bajo un título que le prometió otra
            cosa. «Otros productos» es verdad hoy y lo seguirá siendo cuando
            el catálogo crezca, que es la única clase de rótulo que no hay que
            volver a tocar. Cierra `CT-96`.

            Si algún día la ficha gana una categoría, el rótulo puede volver a
            prometer parentesco — pero entonces habrá con qué cumplirlo. */}
        <CatalogStrip
          catalogToken={token}
          titulo="Otros productos"
          products={relacionados.filter((p) => !yaComprados.includes(p.id))}
        />

        <Link
          href={`/c/${token}`}
          className="flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background"
        >
          <ArrowLeft className="size-5" aria-hidden="true" /> Volver al catálogo
        </Link>

        {/* «VER SALDO PENDIENTE», Y SOLO PARA QUIEN VINO DE SU SALDO.
            Decisión del dueño el 2026-10-17: «ese último botón aparecerá solo
            cuando el cliente accedió desde el link compartido, sino no debe
            aparecer».

            Tiene su razón: a quien llegó por el enlace del catálogo a secas
            no le corresponde ningún saldo —puede no ser cliente del negocio—
            y un botón que promete enseñarle una deuda que no existe es peor
            que ninguno.

            El mismo almacén que la flecha de volver, leído por el mismo hook.
            Si está bloqueado, no sale el botón: el comprobante queda como
            estaba y nadie pierde nada de lo que vino a ver. */}
        {tokenDelSaldo ? (
          <Link
            href={`/s/${tokenDelSaldo}`}
            className="flex h-12 items-center justify-center rounded-lg border text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver saldo pendiente
          </Link>
        ) : null}
      </div>
    </main>
  );
}

// Los nombres del frame. `MONEDAS_TECLEABLES` de `lib/types.ts` solo cubre las
// tres del libro del dinero, y aquí hacen falta las cinco del catálogo.
const NOMBRE_MONEDA: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  VES: "Bolívares",
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-sm text-muted-foreground">{etiqueta}</span>
      <span className="truncate text-right text-sm font-medium">{valor}</span>
    </div>
  );
}
