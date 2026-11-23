"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CameraFeed, scanFeedback, type CameraStatus } from "@/components/barcode/camera-feed";
import { useBarcodeScanner } from "@/components/barcode/scanner-provider";
import { productoPorCodigo } from "@/app/(app)/productos/actions";
import { monedasDelNegocio, productoParaVentaPorId } from "@/app/(app)/ventas/actions";
import type { LineaVenta } from "@/components/dashboard/paso-producto";
import { lineaParaProducto } from "@/lib/barcodes/sale-line";
import { track } from "@/lib/mixpanel";
import type { PriceCurrency } from "@/lib/products/price";

const QuickProductSheet = dynamic(
  () => import("@/components/dashboard/quick-product-sheet").then((m) => m.QuickProductSheet),
  { ssr: false },
);

// SCANNING INSIDE A SALE: THE CONTINUOUS MODE (CT-182). Frames 10, 11 and 12 of the scanner
// flow, approved by the owner on 2026-11-23, with his «Apruebo» to «cada escaneo suma una
// unidad al carrito, sin preguntar; un código desconocido abre la creación rápida y vuelve».
//
// TWO DOORS, ONE PATH. The camera strip (opened with «Escanear productos») and the gun
// (through the scanner provider, which hands every code to the sale while it is mounted)
// both end in `leer`.
//
// THE CART ONLY GROWS IN STEPS 1 AND 2. From the payment step on, the amounts per currency
// are already decided; a code read there would change a cart the shopkeeper already
// confirmed. So the gun is refused there with a sentence, never applied silently.
//
// A CODE ALREADY READ IN THIS SALE ANSWERS FROM MEMORY: the second Harina PAN adds a unit
// without going to the server, so a shop on a weak signal does not wait per unit. Only a
// code new to this sale costs a round trip. (Approved as «mapa de códigos cargado al abrir
// la venta»; built as a map filled while scanning, which removes the same waits without
// loading every code of the catalogue for a sale that may scan none.)
export function SaleScanner({
  cartOpen,
  lineas,
  ownerId,
  monedas,
  onLinea,
  onIrAlCarrito,
}: {
  // Steps 1 and 2: where a code may still change the cart.
  cartOpen: boolean;
  lineas: LineaVenta[];
  ownerId: string;
  monedas: PriceCurrency[];
  onLinea: (linea: LineaVenta) => void;
  onIrAlCarrito: () => void;
}) {
  const { enabled, registerSaleHandler } = useBarcodeScanner();
  const [camera, setCamera] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [creando, setCreando] = useState<string | null>(null);
  const known = useRef(new Map<string, string>());
  // The sale's currencies arrive with the product grid of step 1. A sale opened straight
  // on the cart (the scanner's «Vender») has not loaded it, so they are asked for once.
  const [monedasPropias, setMonedasPropias] = useState<PriceCurrency[]>([]);
  useEffect(() => {
    if (!enabled || monedas.length > 0) return;
    let vivo = true;
    monedasDelNegocio()
      .then((m) => vivo && setMonedasPropias(m))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [enabled, monedas.length]);
  const monedasDeLaHoja = monedas.length > 0 ? monedas : monedasPropias;
  const lineasRef = useRef(lineas);
  const cartOpenRef = useRef(cartOpen);
  useEffect(() => {
    lineasRef.current = lineas;
    cartOpenRef.current = cartOpen;
  });

  // The latest «Harina PAN 1 kg · ahora 3», cleared a moment later.
  useEffect(() => {
    if (!ultimo) return;
    const t = window.setTimeout(() => setUltimo(null), 2500);
    return () => window.clearTimeout(t);
  }, [ultimo]);

  async function leer(code: string, source: "camera" | "gun") {
    if (!cartOpenRef.current) {
      toast.error("Para agregar productos, vuelve al carrito.");
      return;
    }
    let productId = known.current.get(code);
    if (!productId) {
      const r = await productoPorCodigo(code);
      track("Barcode Scanned", { source, surface: "sale", result: r.status });
      if (r.status === "not_found") {
        setCamera(false);
        setCreando(code);
        return;
      }
      if (r.status === "trashed") {
        toast.error(`${r.name} está en la papelera. Restáuralo desde la papelera para venderlo.`);
        return;
      }
      if (r.status !== "found") {
        toast.error(r.status === "invalid" ? "Ese código no es válido." : "No pudimos buscar el código. Intenta de nuevo.");
        return;
      }
      productId = r.productId;
      known.current.set(code, productId);
    } else {
      track("Barcode Scanned", { source, surface: "sale", result: "found" });
    }

    // Already in the cart: one more unit, in the currency the line already has.
    const enCarrito = lineasRef.current.find((l) => l.productId === productId);
    if (enCarrito) {
      onLinea({ ...enCarrito, quantity: 1 });
      setUltimo(`${enCarrito.name} · ahora ${enCarrito.quantity + 1}`);
      onIrAlCarrito();
      return;
    }
    const linea = lineaParaProducto(await productoParaVentaPorId(productId), productId, 1);
    if (!linea) {
      toast.error("Ese producto no tiene precio en una moneda de tu negocio. Edítalo para venderlo.");
      return;
    }
    onLinea(linea);
    setUltimo(`${linea.name} · ahora ${linea.quantity}`);
    onIrAlCarrito();
  }

  const leerRef = useRef(leer);
  useEffect(() => {
    leerRef.current = leer;
  });
  // While the sale is mounted, every gun scan comes here instead of to Home's sheets.
  useEffect(() => {
    if (!enabled) return;
    return registerSaleHandler((code) => {
      scanFeedback();
      void leerRef.current(code, "gun");
    });
  }, [enabled, registerSaleHandler]);

  if (!enabled) return null;

  return (
    <>
      {cartOpen ? (
        camera ? (
          <div className="relative h-[200px] w-full overflow-hidden rounded-xl bg-neutral-900">
            {status === "denied" || status === "unavailable" || status === "failed" ? (
              <p className="flex h-full items-center justify-center px-6 text-center text-sm text-white">
                Sevenz no puede usar la cámara. Dale permiso en los ajustes de tu navegador.
              </p>
            ) : (
              <>
                <CameraFeed
                  onCode={(code) => {
                    scanFeedback();
                    void leer(code, "camera");
                  }}
                  onStatus={setStatus}
                  className="absolute inset-0 size-full object-cover"
                />
                <div className="pointer-events-none absolute top-1/2 left-1/2 h-[110px] w-[220px] -translate-x-1/2 -translate-y-1/2">
                  <span className="absolute top-0 left-0 size-6 rounded-tl-xl border-t-4 border-l-4 border-white" />
                  <span className="absolute top-0 right-0 size-6 rounded-tr-xl border-t-4 border-r-4 border-white" />
                  <span className="absolute bottom-0 left-0 size-6 rounded-bl-xl border-b-4 border-l-4 border-white" />
                  <span className="absolute right-0 bottom-0 size-6 rounded-br-xl border-r-4 border-b-4 border-white" />
                  <span className="absolute top-1/2 right-4 left-4 h-0.5 bg-red-500" />
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setCamera(false)}
              className="absolute top-2.5 right-2.5 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium text-white"
            >
              Cerrar cámara
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-10 w-full" onClick={() => setCamera(true)}>
            <ScanBarcode className="size-5" aria-hidden="true" />
            Escanear productos
          </Button>
        )
      ) : null}

      {ultimo ? (
        <div
          role="status"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg"
        >
          {ultimo}
        </div>
      ) : null}

      {creando ? (
        <QuickProductSheet
          open
          onOpenChange={(o: boolean) => !o && setCreando(null)}
          ownerId={ownerId}
          monedas={monedasDeLaHoja}
          codigos={[creando]}
          textoBoton="Guardar y agregar"
          onCreado={async (productId, cantidad, datos) => {
            known.current.set(creando, productId);
            setCreando(null);
            const linea = lineaParaProducto(await productoParaVentaPorId(productId), productId, cantidad, datos);
            if (!linea) {
              toast.error("Guardamos el producto, pero no pudimos agregarlo a la venta. Búscalo por su nombre y agrégalo.");
              return;
            }
            onLinea(linea);
            setUltimo(`${linea.name} · ahora ${linea.quantity}`);
            onIrAlCarrito();
          }}
        />
      ) : null}
    </>
  );
}
