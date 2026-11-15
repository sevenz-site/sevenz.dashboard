import type { Metadata } from "next";

// Search-result title and description for /login (SEO pass of 2026-11-15).
// This page is a client component, so its metadata has to live in a layout.
// It stays indexable by the owner's decision of 2026-11-15 (see the
// X-Robots-Tag rule in next.config.ts).
//
// This layout also wraps /login/codigo, the second-factor screen, which
// inherits this title. That page is noindex (the header rule excludes only
// the exact /login path), so the title only shows in its browser tab, where
// «Entrar a Sevenz» is still accurate.
//
// ONLY `title` AND `description`, ON PURPOSE: `openGraph` and `twitter` are
// inherited from the root layout, so the WhatsApp card the owner chose on
// 2026-10-23 does not change.
export const metadata: Metadata = {
  title: "Entrar a Sevenz",
  description:
    "Entra a tu cuenta de Sevenz para ver quién te debe, registrar ventas y abonos, y atender los pedidos de tu catálogo.",
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
