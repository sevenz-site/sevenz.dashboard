// The size of the catalogue's link-preview image (`app/c/[token]/vista-previa`).
//
// One constant for the two places that must agree: the route that draws the image and
// the page whose `og:image:width/height` announce it. A preview whose declared size is
// not its real size is one more reason for a chat app to fall back to a small
// thumbnail. Why 600x315 (weight measured against WhatsApp's limits) is in the route.
export const CATALOG_PREVIEW_SIZE = { width: 600, height: 315 } as const;
