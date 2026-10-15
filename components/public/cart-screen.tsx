"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ImageOff, Loader2, Minus, Plus, Trash2 } from "lucide-react";
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
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn, type BolivarRates } from "@/lib/products/price";
import { formatBs } from "@/lib/exchange-rate/format";
import { useCarrito } from "@/lib/cart/store";
import { precioUnitario, subtotales, type ProductoDelCarrito } from "@/lib/cart/cart";
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
  | { fase: "listo"; productos: Map<string, ProductoDelCarrito>; rates: BolivarRates | null }
  | { fase: "enviado"; orderId: string; mensaje: string };

export function CartScreen({
  token,
  businessName,
  ownerWhatsapp,
}: {
  token: string;
  businessName: string;
  ownerWhatsapp: string | null;
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
  const idsClave = lineas.map((l) => l.productId).sort().join(",");

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
        ownerWhatsapp={ownerWhatsapp}
      />
    );
  }

  const productos = estado.fase === "listo" ? estado.productos : new Map<string, ProductoDelCarrito>();
  const rates = estado.fase === "listo" ? estado.rates : null;
  const totales = subtotales(lineas, productos);
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
    estado.fase === "listo" && !cargando ? lineas.filter((l) => !productos.has(l.productId)) : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col">
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
              Todavía no has agregado nada. Vuelve al catálogo y elige lo que quieras pedir.
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
                const precio = p ? precioUnitario(p, l) : null;
                const bs =
                  precio && rates && precio.currency !== "VES"
                    ? priceIn("VES", { amount: precio.amount, currency: precio.currency }, rates)
                    : null;

                return (
                  <li key={l.productId} className="flex gap-3 rounded-xl border p-3">
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
                        <span className="text-sm font-medium">{p?.name ?? "Producto"}</span>
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
                          <p className="text-xs text-muted-foreground">Actualizando precio...</p>
                        ) : (
                          <p className="text-xs leading-relaxed text-destructive">
                            Ya no está disponible. Quítalo para poder enviar tu pedido.
                          </p>
                        )
                      ) : precio == null ? (
                        <p className="text-xs leading-relaxed text-destructive">
                          Este producto ya no tiene precio para esa cantidad. Cámbiala o quítalo.
                        </p>
                      ) : (
                        <>
                          <span className="text-sm tabular-nums">
                            {formatPriceAmount(precio.amount, precio.currency)}
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              c/u · {precio.tier === "wholesale" ? "al mayor" : "al detal"}
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
                        <p className="text-xs leading-relaxed text-muted-foreground">«{l.comment}»</p>
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
                  <div key={t.currency} className="flex items-baseline justify-between gap-3">
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
                    Son dos totales porque pediste en dos monedas. Cada uno se paga por separado.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
          Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. Pagos y abonos deben
          hacerse directamente con el dueño del comercio.
        </p>
      </div>

      {lineas.length > 0 ? (
        <div className="sticky bottom-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            className="h-12 w-full"
            disabled={cargando || estado.fase !== "listo" || huerfanas.length > 0}
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
        lineas={lineas}
        productos={productos}
        onEnviada={(orderId, mensaje) => {
          vaciar();
          setEstado({ fase: "enviado", orderId, mensaje });
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
  lineas,
  productos,
  onEnviada,
}: {
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  token: string;
  businessName: string;
  lineas: ReturnType<typeof useCarrito>["lineas"];
  productos: Map<string, ProductoDelCarrito>;
  onEnviada: (orderId: string, mensaje: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [quiereAvisos, setQuiereAvisos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();

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
          // EL TEXTO QUE SE GUARDA ES EL QUE ESTÁ EN PANTALLA, generado por la
          // misma constante que lo pinta. Esa cadena es la evidencia ante
          // Meta: dos textos distintos la convertirían en una reconstrucción.
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
      onAbierto(false);
      onEnviada(r.orderId, mensajeDeLaOrden(businessName, nombre, lineas, productos));
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={onAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>¿Quién hace el pedido?</DialogTitle>
          <DialogDescription>
            El negocio necesita estos datos para responderte y preparar lo que pediste.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="orden_nombre">Nombre y apellido</Label>
            <Input
              id="orden_nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
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
              maxLength={40}
              disabled={enviando}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="orden_whatsapp">WhatsApp</Label>
            <Input
              id="orden_whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              /* `inputMode="tel"` y no `type="tel"`: en iOS un `type="tel"`
                 con fuente menor de 16px hace zoom al enfocarse. El tamaño ya
                 está bien en este `Input`, pero el modo basta para sacar el
                 teclado numérico sin arriesgar el otro comportamiento. */
              inputMode="tel"
              autoComplete="tel"
              placeholder="+58 412 1234567"
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
            <span className="text-sm leading-relaxed">{TEXTO_PERMISO_ORDEN}</span>
          </label>

          {error ? (
            <p className="text-sm leading-relaxed text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="button" className="h-12" onClick={enviar} disabled={enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
            Enviar pedido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// «LISTO», Y EL BOTÓN DE WHATSAPP LO PULSA EL CLIENTE
//
// El pedido YA está guardado cuando se ve esta pantalla. Abrir WhatsApp solo
// después de un toque, y no automáticamente tras el `await`, es lo que evita
// que iOS lo bloquee por no venir de un gesto — y si aun así no se abre, el
// tendero tiene el pedido igual.
function Enviado({
  token,
  mensaje,
  ownerWhatsapp,
}: {
  token: string;
  mensaje: string;
  ownerWhatsapp: string | null;
}) {
  const digitos = ownerWhatsapp?.replace(/\D/g, "") ?? "";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <CheckCircle2 className="size-12 text-emerald-600" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Tu pedido quedó registrado</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        El negocio ya lo tiene. Mándaselo también por WhatsApp para que sepa que eres tú y pueda
        responderte.
      </p>

      {digitos !== "" ? (
        <a
          href={`https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background"
        >
          <WhatsappIcon className="size-5" /> Enviar por WhatsApp
        </a>
      ) : null}

      <Link
        href={`/c/${token}`}
        className="text-sm font-medium underline underline-offset-4"
      >
        Volver al catálogo
      </Link>
    </main>
  );
}
