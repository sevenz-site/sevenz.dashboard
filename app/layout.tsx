import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITULO = "Sevenz — ¡Cuentas claras, mueven el negocio!";
const DESCRIPCION = "Saldo compartido en tiempo real entre el negocio y sus clientes.";

export const metadata: Metadata = {
  // Sin esto, Next emite rutas relativas en og:image y WhatsApp no las
  // resuelve. La URL va escrita porque el enlace compartido se arma en el
  // navegador con window.location.origin y no existe una constante que
  // reutilizar.
  metadataBase: new URL("https://app.sevenz.site"),
  title: TITULO,
  description: DESCRIPCION,
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Sin openGraph, WhatsApp caía al favicon y mostraba un cuadradito en vez de
  // una tarjeta. Hasta el 2026-09-11 ese favicon era el de Vercel.
  openGraph: {
    title: TITULO,
    description: DESCRIPCION,
    siteName: "Sevenz",
    locale: "es_VE",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sevenz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRIPCION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
  // Without this, Chrome and Brave on Android default to "resizes-visual":
  // the on-screen keyboard is painted OVER the page and the layout viewport
  // keeps its full height. Anything anchored with `fixed bottom-0` is then
  // anchored behind the keyboard, and every `vh` still measures the whole
  // screen — so the rate calculator's bottom drawer (max-h-[80vh]) was taller
  // than the strip left visible and its top was pushed off the top edge. The
  // only way out was to dismiss the keyboard and refocus the input, which made
  // the browser reposition it.
  //
  // "resizes-content" makes the keyboard shrink the layout viewport instead,
  // so vh units, fixed positioning and bottom-0 all follow the space actually
  // on screen. It applies to every dialog and drawer with an input in it, not
  // just this one.
  interactiveWidget: "resizes-content",
};

const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster />
        <ServiceWorkerRegister />
        {CLARITY_PROJECT_ID ? (
          <Script id="clarity-analytics" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
          </Script>
        ) : null}
      </body>
    </html>
  );
}
