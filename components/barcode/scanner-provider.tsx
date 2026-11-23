"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Eye, Loader2, PackagePlus, Pencil, RotateCcw, ScanBarcode, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { CameraOverlay } from "@/components/barcode/camera-overlay";
import { useGunGuard } from "@/components/barcode/use-gun-guard";
import { QuickProductSheet } from "@/components/dashboard/quick-product-sheet";
import { productoPorCodigo, restoreProduct, type CodeLookup } from "@/app/(app)/productos/actions";
import { monedasDelNegocio, productoParaVentaPorId } from "@/app/(app)/ventas/actions";
import { gunOpensSheetsOn } from "@/lib/barcodes/routes";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatBsHoy } from "@/lib/exchange-rate/format";
import { formatPriceAmount, priceIn, type PriceCurrency } from "@/lib/products/price";
import { track } from "@/lib/mixpanel";

// THE SCANNER, FOR THE WHOLE APP (CT-182). Frames 3 to 9, 14 and 15 of «Propuesta · Escáner
// de códigos: el flujo completo», approved by the owner on 2026-11-23.
//
// Three things live here, and one of them does not depend on the switch:
//   1. THE GUN GUARD, always on (owner's decision of 2026-11-23). A burst never lands in a
//      field and its Enter never submits a form, whether the business works with codes or
//      not -- the worst case is a code saved as the amount of a payment.
//   2. THE CAMERA: the floating button and the product forms open it through `openCamera`.
//   3. THE SHEETS of a scan made outside a sale: found, new code, in the bin. On a phone a
//      bottom sheet, on a computer a dialog (frames 14 and 15), with the same content.
//
// A SALE IN PROGRESS TAKES ITS OWN SCANS: it registers a handler and every code goes into
// its cart (continuous mode), never to these sheets.

type SaleHandler = (code: string) => void;

type ScannerContext = {
  enabled: boolean;
  /** Opens the full-screen camera. With a callback, the code goes there (a form's field);
   *  without one, it goes to the sheets below. */
  openCamera: (onCode?: (code: string) => void) => void;
  /** A sale registers itself while mounted; returns the unregister function. */
  registerSaleHandler: (handler: SaleHandler) => () => void;
};

const Ctx = createContext<ScannerContext>({
  enabled: false,
  openCamera: () => undefined,
  registerSaleHandler: () => () => undefined,
});

export function useBarcodeScanner() {
  return useContext(Ctx);
}

type Found = {
  code: string;
  productId: string;
  name: string;
  photoPath: string | null;
  price: string | null;
  bs: string | null;
  inStock: boolean | null;
};

type Panel =
  | { kind: "loading"; code: string }
  | { kind: "found"; data: Found }
  | { kind: "new"; code: string }
  | { kind: "trashed"; code: string; productId: string; name: string };

export function BarcodeScannerProvider({
  enabled,
  ownerId,
  children,
}: {
  enabled: boolean;
  ownerId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [camera, setCamera] = useState<{ onCode?: (code: string) => void } | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [creating, setCreating] = useState<{ code: string; monedas: PriceCurrency[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const saleHandlers = useRef<SaleHandler[]>([]);

  const lookup = useCallback(async (code: string, source: "camera" | "gun") => {
    setPanel({ kind: "loading", code });
    const r: CodeLookup = await productoPorCodigo(code);
    // «¿El escáner encuentra lo que se escanea, o la mayoría son códigos nuevos?» -- CT-182,
    // 2026-11-23. Mostly new means catalogues are not getting codes and the field needs
    // more weight; mostly found means the scanner is doing its job. A browser event, so
    // a floor. Filed under the owner.
    track("Barcode Scanned", { source, surface: "home", result: r.status });
    if (r.status === "found") {
      const p = await productoParaVentaPorId(r.productId).catch(() => null);
      const producto = p?.productos[0];
      const retail = producto?.producto.retail ?? producto?.producto.wholesale ?? null;
      const bs =
        retail && p?.rates && retail.base !== "VES"
          ? priceIn("VES", { amount: retail.price, currency: retail.base }, p.rates).amount
          : null;
      setPanel({
        kind: "found",
        data: {
          code: r.code,
          productId: r.productId,
          name: producto?.name ?? r.name,
          photoPath: producto?.photoPath ?? null,
          price: retail ? formatPriceAmount(retail.price, retail.base) : null,
          bs: bs != null ? formatBsHoy(bs) : null,
          inStock: producto?.stock == null ? null : producto.stock > 0,
        },
      });
    } else if (r.status === "not_found") setPanel({ kind: "new", code: r.code });
    else if (r.status === "trashed") setPanel({ kind: "trashed", code: r.code, productId: r.productId, name: r.name });
    else {
      setPanel(null);
      toast.error(r.status === "invalid" ? "Ese código no es válido." : "No pudimos buscar el código. Intenta de nuevo.");
    }
  }, []);

  useGunGuard((code) => {
    const sale = saleHandlers.current.at(-1);
    if (sale) return sale(code);
    if (enabled && gunOpensSheetsOn(pathname) && !camera && !creating) void lookup(code, "gun");
  });

  const openCamera = useCallback((onCode?: (code: string) => void) => {
    setPanel(null);
    setCamera({ onCode });
  }, []);

  const registerSaleHandler = useCallback((handler: SaleHandler) => {
    saleHandlers.current.push(handler);
    return () => {
      saleHandlers.current = saleHandlers.current.filter((h) => h !== handler);
    };
  }, []);

  const value = useMemo(() => ({ enabled, openCamera, registerSaleHandler }), [enabled, openCamera, registerSaleHandler]);

  const go = (href: string) => {
    setPanel(null);
    router.push(href);
  };

  async function startCreating(code: string) {
    setBusy(true);
    const monedas = await monedasDelNegocio().catch(() => [] as PriceCurrency[]);
    setBusy(false);
    if (monedas.length === 0) {
      toast.error("No pudimos leer los datos de tu negocio. Intenta de nuevo.");
      return;
    }
    setPanel(null);
    setCreating({ code, monedas });
  }

  async function restoreAndSell(productId: string) {
    setBusy(true);
    const r = await restoreProduct(productId).catch(() => ({ error: "No pudimos restaurar el producto. Intenta de nuevo." }));
    setBusy(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    go(`/ventas/nueva?producto=${productId}`);
  }

  const content = panel ? (
    <PanelContent
      panel={panel}
      isMobile={isMobile}
      busy={busy}
      onClose={() => setPanel(null)}
      onSell={(id) => go(`/ventas/nueva?producto=${id}`)}
      onEdit={(id) => go(`/productos/${id}/editar`)}
      onView={(id) => go(`/productos/${id}`)}
      onScanAgain={() => openCamera()}
      onCreate={(code) => void startCreating(code)}
      onRestore={(id) => void restoreAndSell(id)}
    />
  ) : null;

  return (
    <Ctx.Provider value={value}>
      {children}

      {camera ? (
        <CameraOverlay
          onClose={() => setCamera(null)}
          onCode={(code) => {
            const target = camera.onCode;
            setCamera(null);
            if (target) target(code);
            else void lookup(code, "camera");
          }}
        />
      ) : null}

      {/* A phone gets a bottom sheet, a computer a dialog: the same content either way. */}
      {isMobile ? (
        <Sheet open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl" showCloseButton={false}>
            <SheetTitle className="sr-only">Resultado del escaneo</SheetTitle>
            {content}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
          <DialogContent className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">Resultado del escaneo</DialogTitle>
            {content}
          </DialogContent>
        </Dialog>
      )}

      {/* MOUNTED ONLY WHILE CREATING, like the sale's own: Radix keeps a closed sheet in the
          DOM, and its state would reopen with the previous code. */}
      {creating ? (
        <QuickProductSheet
          open
          onOpenChange={(o) => !o && setCreating(null)}
          ownerId={ownerId}
          monedas={creating.monedas}
          codigos={[creating.code]}
          textoBoton="Guardar y vender"
          onCreado={(productId, cantidad) => {
            setCreating(null);
            router.push(`/ventas/nueva?producto=${productId}&cantidad=${cantidad}`);
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function OptionRow({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-14 w-full items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-left outline-none transition-colors active:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {icon}
      <span className="text-base font-semibold">{label}</span>
    </button>
  );
}

function PanelContent({
  panel,
  isMobile,
  busy,
  onClose,
  onSell,
  onEdit,
  onView,
  onScanAgain,
  onCreate,
  onRestore,
}: {
  panel: Panel;
  isMobile: boolean;
  busy: boolean;
  onClose: () => void;
  onSell: (id: string) => void;
  onEdit: (id: string) => void;
  onView: (id: string) => void;
  onScanAgain: () => void;
  onCreate: (code: string) => void;
  onRestore: (id: string) => void;
}) {
  const title =
    panel.kind === "found"
      ? "Producto encontrado"
      : panel.kind === "new"
        ? "Código nuevo"
        : panel.kind === "trashed"
          ? "Está en la papelera"
          : "Buscando el código…";
  // On a computer «Escanear otro» is just scanning again with the gun (frames 14 and 15).
  const again = isMobile ? (
    <OptionRow icon={<ScanBarcode className="size-6" aria-hidden="true" />} label="Escanear otro" onClick={onScanAgain} />
  ) : (
    <p className="text-sm text-muted-foreground">Para otro producto, escanéalo con la pistola.</p>
  );

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:px-0 md:pt-0 md:pb-0">
      <div className="flex items-center justify-between">
        <span className={isMobile ? "text-lg" : "text-lg font-semibold"}>{title}</span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {panel.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Código {panel.code}
        </div>
      ) : null}

      {panel.kind === "found" ? (
        <>
          <p className="text-sm text-muted-foreground">Código {panel.data.code}</p>
          <div className="flex items-center gap-3 rounded-[10px] border p-2.5">
            {panel.data.photoPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getPublicProductPhotoUrl(panel.data.photoPath)} alt="" className="size-14 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="size-14 shrink-0 rounded-md bg-muted" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{panel.data.name}</span>
              {panel.data.price ? <span className="font-semibold">{panel.data.price}</span> : null}
              {panel.data.bs ? <span className="text-xs text-muted-foreground">{panel.data.bs}</span> : null}
            </div>
            {panel.data.inStock ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Disponible</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <OptionRow icon={<ArrowUpRight className="size-6" aria-hidden="true" />} label="Vender" onClick={() => onSell(panel.data.productId)} />
            <OptionRow icon={<Pencil className="size-6" aria-hidden="true" />} label="Editar producto" onClick={() => onEdit(panel.data.productId)} />
            <OptionRow icon={<Eye className="size-6" aria-hidden="true" />} label="Ver ficha" onClick={() => onView(panel.data.productId)} />
            {again}
          </div>
        </>
      ) : null}

      {panel.kind === "new" ? (
        <>
          <p className="text-base">
            El código {panel.code} no está en tus productos. Créalo y véndelo de una vez.
          </p>
          <OptionRow
            icon={busy ? <Loader2 className="size-6 animate-spin" aria-hidden="true" /> : <PackagePlus className="size-6" aria-hidden="true" />}
            label="Crear producto"
            disabled={busy}
            onClick={() => onCreate(panel.code)}
          />
          {again}
        </>
      ) : null}

      {panel.kind === "trashed" ? (
        <>
          <p className="text-base">{panel.name} tiene este código, pero lo mandaste a la papelera.</p>
          <Button type="button" className="h-10 w-full" disabled={busy} onClick={() => onRestore(panel.productId)}>
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-5" aria-hidden="true" />}
            Restaurar y vender
          </Button>
          {isMobile ? (
            <Button type="button" variant="outline" className="h-10 w-full" onClick={onScanAgain}>
              <ScanBarcode className="size-5" aria-hidden="true" />
              Escanear otro
            </Button>
          ) : (
            again
          )}
        </>
      ) : null}
    </div>
  );
}
