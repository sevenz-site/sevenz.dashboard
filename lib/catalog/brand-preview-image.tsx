import { ImageResponse } from "next/og";
import { CATALOG_PREVIEW_SIZE } from "@/lib/catalog/preview-image";

// THE BRAND CARD OF A SHARED LINK, drawn ONCE for the two links that show it: the
// catalogue (`/c/<token>/vista-previa`) and, from 2026-11-26, the client's balance
// (`/s/<token>/vista-previa`). Owner's request that day: the balance link's preview
// shows the business logo «mismo patrón/componente del preview al compartir el
// catálogo con el powered by Sevenz». Kept in one place so the two cards cannot drift.
// The image carries the logo and nothing else of the account: no amount, no name.
//
// ═══════════════════════════════════════════════════════════════════════
// THE IMAGE OF THE CATALOGUE'S LINK PREVIEW (the card WhatsApp draws)
//
// Owner's request of 2026-11-25, frame `2276:20283`: when the business uploaded its
// logo, the card's image is that logo, and the card says «Powered by» with the Sevenz
// logo. Until then every catalogue shared the generic `/og.png`.
//
// «POWERED BY» LIVES INSIDE THE IMAGE, NOT UNDER THE TEXT. The frame draws it below
// the description, but that part of the card is drawn by WhatsApp and only takes plain
// text: no logo can go there. Asked the same day, the owner chose «Dentro de la
// imagen», the only place the Sevenz logo can actually appear.
//
// ───────────────────────────────────────────────────────────────────────
// WHY THIS ONE IS GENERATED WHEN THE PRODUCT PREVIEW STOPPED BEING
//
// `lib/supabase/storage.ts` tells how a generated product preview failed on
// 2026-10-27: `ImageResponse` only emits PNG, a photo across 1200x630 weighed 1.4-1.6 MB,
// and WhatsApp dropped it. That is the risk here too, and it is handled by size, not
// by hope:
//
//   · the canvas is 600x315: the 1.91:1 that gets WhatsApp's large card, and the
//     smallest size that still reads sharp on a phone. MEASURED on 2026-11-25 with the
//     frame's own logo («Mini Abasto», a busy full-colour illustration, close to the
//     worst case): 800x420 weighed 359 KB, 640x336 231 KB, 600x315 202 KB. The
//     product preview WhatsApp accepts is 114 KB; the one it dropped, 1.6 MB.
//   · the logo is fetched already shrunk by Supabase (`render/image`), so a 5 MB upload
//     is never what gets drawn;
//   · the logo fills the full height, fitted without cropping: the frame draws it
//     full-bleed. An earlier try inset it on white (194 KB at 800x420) and a logo with
//     its own background colour came out as a visible box inside the card. White fills
//     only what is left at the sides. The pill sits over the logo's corner, as the
//     frame's attribution sits over the card.
//
// No logo, a bad token, or any failure: the route redirects to `/og.png`, the same
// card the catalogue showed until today. A preview with no image reads as a broken
// link; the brand card does not.
//
// PUBLIC ROUTE, ERRORS MASKED (CLAUDE.md): anybody with the link can call it, so the
// real error goes to `console.error` and the answer is always an image.
// ═══════════════════════════════════════════════════════════════════════

const { width: ANCHO, height: ALTO } = CATALOG_PREVIEW_SIZE;
// The «Powered by» pill was drawn at 800 wide; this scales it to the canvas.
const K = ANCHO / 800;

// Cached by WhatsApp and the CDN for a day: the logo rarely changes, and a crawler
// that re-renders this on every share is a render per message for nothing.
const CACHE = "public, max-age=86400, s-maxage=86400";

/**
 * The card for a business with `logoPath`, or a redirect to the generic `/og.png` card
 * when there is no logo or anything fails. `tag` names the caller in the server log.
 */
export async function brandPreviewResponse(request: Request, logoPath: string | null, tag: string): Promise<Response> {
  const generic = Response.redirect(new URL("/og.png", request.url), 302);
  if (!logoPath) return generic;

  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
    // `format=origin`: without it Supabase may answer WebP, which the renderer
    // behind `ImageResponse` cannot draw. Logos are JPEG or PNG (the `logos` bucket
    // accepts only those), and both are drawable.
    const logoUrl =
      `${base}/storage/v1/render/image/public/logos/${logoPath}` +
      `?width=${ANCHO}&height=${ALTO}&resize=contain&format=origin&quality=80`;
    // The Sevenz logo in its secondary colours (#DADADA and the brand orange), the one
    // the frame draws on the dark strip. Fetched from this same deployment so the
    // file is the one in `public/`, not a copy that drifts.
    const sevenzSvg = await fetch(new URL("/logo-secundary.svg", request.url)).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`logo-secundary.svg ${r.status}`)),
    );
    const sevenzSrc = `data:image/svg+xml;base64,${Buffer.from(sevenzSvg).toString("base64")}`;

    const image = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
            position: "relative",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} width={ANCHO} height={ALTO} style={{ objectFit: "contain" }} alt="" />
          {/* «Powered by» + the Sevenz logo, the frame's attribution row: Geist 14/20
              regular in `--subtle` (#9a9a9a), 6px gap, logo 44x16. Here on a dark
              pill in `--primary` (#272727), the colour of the card's text area in the
              frame, because over a logo of any colour the secondary logo needs a ground
              of its own. Drawn bigger than the frame's 14px (16px on a 600px canvas)
              because WhatsApp shrinks the image to a phone's width. */}
          <div
            style={{
              position: "absolute",
              right: Math.round(18 * K),
              bottom: Math.round(18 * K),
              display: "flex",
              alignItems: "center",
              gap: Math.round(9 * K),
              padding: `${Math.round(8 * K)}px ${Math.round(14 * K)}px`,
              borderRadius: 999,
              background: "#272727",
              color: "#9a9a9a",
              fontSize: 16,
            }}
          >
            Powered by
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sevenzSrc} width={Math.round(66 * K)} height={Math.round(24 * K)} alt="" />
          </div>
        </div>
      ),
      { width: ANCHO, height: ALTO, headers: { "Cache-Control": CACHE } },
    );
    // Render now, inside the try: `ImageResponse` is lazy, and a logo that fails to
    // load would otherwise surface as a broken stream after this function returned.
    const bytes = await image.arrayBuffer();
    return new Response(bytes, {
      headers: { "Content-Type": "image/png", "Cache-Control": CACHE },
    });
  } catch (error) {
    console.error(`[${tag}] render:`, error instanceof Error ? error.message : error);
    return generic;
  }
}
