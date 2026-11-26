// THE BARCODE READER FOR THE CAMERA (CT-182).
//
// Owner's choice of 2026-11-23: the browser's own `BarcodeDetector` where it exists
// (Chrome on Android, fast), and `barcode-detector` -- ZXing compiled to WASM -- where it
// does not (every iPhone: Safari has no BarcodeDetector, checked on MDN that day). Risk
// review of the same day, and what it asked for:
//   * pinned to 3.2.3 (no `^`), a version more than two weeks old when installed;
//   * the .wasm served from OUR origin, never from jsDelivr, which the package uses by
//     default: a CDN that is slow or filtered would leave the scanner black, silently;
//   * loaded only when the scanner opens, never with the app (~250 KB of JS + ~950 KB).
//
// TWO ENGINES BEHAVE DIFFERENTLY on damaged or blurred codes: a package that reads on a
// Samsung may not on an iPhone. Accepted with the choice; the manual entry is the way out.

/** The zxing-wasm version whose reader is copied to public/wasm/. `qa:zxing-wasm` checks it. */
export const ZXING_WASM_VERSION_SERVED = "3.1.6";

// Retail and shop-label formats only. Fewer formats is faster and misreads less: a QR on
// the same package would otherwise win over its barcode.
export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] as const;

export type DetectedCode = { rawValue: string; boundingBox?: { x: number; y: number; width: number; height: number } };
export type Detector = { detect(source: CanvasImageSource): Promise<DetectedCode[]> };

type DetectorClass = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

let loading: Promise<Detector> | null = null;

export function loadDetector(): Promise<Detector> {
  if (!loading) {
    loading = create().catch((e) => {
      // A failed load must be retryable: the next opening tries again.
      loading = null;
      throw e;
    });
  }
  return loading;
}

async function create(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native?.getSupportedFormats) {
    const supported = await native.getSupportedFormats().catch(() => [] as string[]);
    const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
    if (formats.includes("ean_13")) return new native({ formats });
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? `/wasm/zxing_reader-${ZXING_WASM_VERSION_SERVED}.wasm` : prefix + path,
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: [...SCAN_FORMATS] }) as unknown as Detector;
}
