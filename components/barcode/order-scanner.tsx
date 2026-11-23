"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { CameraOverlay } from "@/components/barcode/camera-overlay";
import { scanFeedback } from "@/components/barcode/camera-feed";
import { useBarcodeScanner } from "@/components/barcode/scanner-provider";
import { productoPorCodigo } from "@/app/(app)/productos/actions";
import { productoParaVentaPorId } from "@/app/(app)/ventas/actions";
import { agregarAlBloque, type LineaDelPedidoParaEditar } from "@/lib/orders/editar-linea";
import { escalonParaCantidad, precioEnMoneda } from "@/lib/products/public-pricing";
import { track } from "@/lib/mixpanel";
import { currencyName, type PriceCurrency } from "@/lib/products/price";

const QuickProductSheet = dynamic(
  () => import("@/components/dashboard/quick-product-sheet").then((m) => m.QuickProductSheet),
  { ssr: false },
);

// SCANNING INTO AN ORDER (CT-182) -- «Detalle del pedido», step 1/3 of registering a
// catalogue order. Owner's request of 2026-11-23, «debe estar el botón flotante de
// escanear para poder agregar más productos al pedido», and his choice the same day:
// «Como en la venta». So:
//   · each read adds one unit to the order, through `agregarAlBloque`, the same door as
//     «Agregar producto» (a product already on a card of this block adds to that card);
//   · in the ORDER'S currency only, like «Agregar producto» (`monedaFija`): a product with
//     no price in it is refused with that reason, never added at another price;
//   · an unknown code opens the quick sheet with the code, priced in that currency, and
//     comes back with the product added;
//   · the gun does the same while this screen is mounted, on the web too.
//
// THE CAMERA IS THE FULL-SCREEN VIEWER, KEPT OPEN: this screen has no cart strip to put a
// small one in (frame 10 is the sale's). It shows what each read added and closes with X.
export function OrderScanner({
  pedidoId,
  moneda,
  ownerId,
  lineasDelBloque,
  lineasDelPedido,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  ownerId: string;
  lineasDelBloque: { id: string; productId: string | null; cantidadPedida: number }[];
  lineasDelPedido: LineaDelPedidoParaEditar[];
}) {
  const { enabled, registerSaleHandler } = useBarcodeScanner();
  const [camera, setCamera] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [creando, setCreando] = useState<string | null>(null);
  const cameraRef = useRef(false);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  async function agregar(productId: string, cantidad: number): Promise<string | null> {
    const r = await productoParaVentaPorId(productId);
    const p = r.productos[0];
    if (!p) return "No pudimos leer ese producto. Intenta de nuevo.";
    const bloque = escalonParaCantidad(p.producto, cantidad) === "wholesale" ? p.producto.wholesale : p.producto.retail;
    if (precioEnMoneda(bloque ?? null, moneda, r.rates) == null) {
      return `${p.name} no tiene precio en ${currencyName(moneda)}, la moneda de este pedido.`;
    }
    agregarAlBloque({
      pedidoId,
      moneda,
      productId: p.id,
      nombre: p.name,
      quantity: cantidad,
      producto: p.producto,
      rates: r.rates,
      lineasDelBloque,
      lineasDelPedido,
    });
    // Over the camera while it is open; a toast otherwise (the gun, the quick sheet).
    const texto = `${p.name} · agregado al pedido`;
    if (cameraRef.current) setAviso(texto);
    else toast.success(texto);
    return null;
  }

  async function leer(code: string, source: "camera" | "gun") {
    const r = await productoPorCodigo(code);
    track("Barcode Scanned", { source, surface: "order", result: r.status });
    if (r.status === "not_found") {
      setCamera(false);
      setCreando(code);
      return;
    }
    if (r.status === "trashed") {
      toast.error(`${r.name} está en la papelera. Restáuralo desde la papelera para agregarlo.`);
      return;
    }
    if (r.status !== "found") {
      toast.error(r.status === "invalid" ? "Ese código no es válido." : "No pudimos buscar el código. Intenta de nuevo.");
      return;
    }
    const error = await agregar(r.productId, 1);
    if (error) toast.error(error);
  }

  const leerRef = useRef(leer);
  useEffect(() => {
    leerRef.current = leer;
  });
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
      {/* Above the two stacked buttons of this screen («Confirmar y continuar», «Agregar
          producto»), on the right. Phone only: on the web the gun scans (owner's decision
          of 2026-11-23). */}
      <button
        type="button"
        aria-label="Escanear productos"
        onClick={() => {
          setAviso(null);
          setCamera(true);
        }}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors active:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none md:hidden"
      >
        <ScanBarcode className="size-6" aria-hidden="true" />
      </button>

      {camera ? (
        <CameraOverlay
          aviso={aviso}
          onClose={() => setCamera(false)}
          onCode={(code) => void leer(code, "camera")}
        />
      ) : null}

      {creando ? (
        <QuickProductSheet
          open
          onOpenChange={(o: boolean) => !o && setCreando(null)}
          ownerId={ownerId}
          monedas={[moneda]}
          codigos={[creando]}
          textoBoton="Guardar y agregar"
          onCreado={async (productId, cantidad) => {
            setCreando(null);
            const error = await agregar(productId, cantidad).catch(() => "No pudimos agregarlo al pedido.");
            if (error) toast.error(`Guardamos el producto, pero no lo agregamos: ${error}`);
          }}
        />
      ) : null}
    </>
  );
}
