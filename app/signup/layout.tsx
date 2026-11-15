import type { Metadata } from "next";

// Search-result title and description for /signup (SEO pass of 2026-11-15).
// This page is a client component, so its metadata has to live in a layout.
//
// It stays indexable by the owner's decision of 2026-11-15 (see the
// X-Robots-Tag rule in next.config.ts), and until now Google listed it with
// the app's tagline and, as its snippet, the small print under the form.
//
// ONLY `title` AND `description`, ON PURPOSE. `openGraph` and `twitter` are
// inherited from the root layout untouched, so a signup link shared by
// WhatsApp still shows the card the owner chose on 2026-10-23 (the phrase
// painted inside public/og.png). Setting them here would change that card.
//
// No trial length in the copy: the web says «3 meses gratis», but the app
// decides the trial in the database, and a claim in a search result is not
// checked against it by anything.
export const metadata: Metadata = {
  title: "Crea tu cuenta en Sevenz — Ventas, fiado e inventario",
  description:
    "Registra tu bodega o comercio en Sevenz y anota ventas, fiados y abonos en dólares, euros o pesos, con catálogo e inventario. Cuentas claras sin tanta vaina.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
