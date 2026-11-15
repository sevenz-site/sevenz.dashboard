import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Los comprobantes de /admin viajan DENTRO del envio del formulario, y el
    // tope por defecto de una accion de servidor es 1 MB. Las imagenes se
    // reducen en el navegador antes de salir —unos 200 KB— asi que esto es
    // para los PDF, que no se pueden reducir. El bucket los limita a 5 MB;
    // este margen deja sitio al resto del formulario.
    //
    // Es un techo, no un valor por defecto: nada empieza a enviar mas datos
    // por subirlo. Y no toca las fotos del tendero, que suben directas a
    // Storage desde el navegador y no pasan por aqui.
    serverActions: { bodySizeLimit: "6mb" },
  },
  // SECURITY HEADERS ON EVERY RESPONSE -- finding 3 of the offensive audit of
  // 2026-11-02, fixed at the owner's request. Production sent only HSTS
  // (Vercel adds that one), so any site could load app.sevenz.site inside an
  // invisible frame and trick a logged-in shopkeeper into pressing «Eliminar»
  // or «Registrar» (clickjacking).
  //
  // DELIBERATELY NOT A FULL Content-Security-Policy: only `frame-ancestors`.
  // A script/style policy has to list Supabase, Mixpanel and Next's inline
  // bootstrap, and a wrong one blanks the app for everyone with no error a
  // shopkeeper can read. Framing is what was exploitable; the rest is a
  // separate piece of work. `X-Frame-Options` repeats it for old browsers.
  //
  // Nothing frames the app on purpose: checked in this repo and in Web/.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // EVERYTHING EXCEPT /login AND /signup STAYS OUT OF SEARCH ENGINES (SEO
      // pass of 2026-11-15). The public site is sevenz.site; the rest of this
      // host is a private app and the client links (/s, /c), which also carry
      // a noindex of their own because they show a real person's balance.
      //
      // /login and /signup stay indexable by the owner's decision of
      // 2026-11-15 («Dejar registro y entrada»), so someone who already knows
      // Sevenz and searches for how to sign in or sign up lands on the form.
      // It was first written as a noindex on the whole host; what that
      // displaced: those two pages compete with sevenz.site for «sevenz», and
      // the landing explains the product where the form does not. Each one
      // now has its own title and description (their `layout.tsx`) instead of
      // the app's tagline.
      //
      // `$` makes the exclusion exact: /login/codigo (second factor) and any
      // other subpath still get the noindex.
      //
      // A header and not a robots.txt `Disallow`: a blocked URL is never
      // fetched, so Google never reads the noindex and can still list it
      // bare, from links. Crawl stays allowed so the noindex is seen.
      // It applies to dev.sevenz.site and every Vercel preview too, which run
      // this same config. Link previews (WhatsApp, Facebook) ignore it.
      {
        source: "/((?!login$|signup$).*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
