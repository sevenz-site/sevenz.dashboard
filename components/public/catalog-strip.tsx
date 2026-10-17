"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, ImageOff } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

export type CatalogStripProduct = {
  id: string;
  name: string;
  photo_path: string | null;
  price: number;
  base_currency: PriceCurrency;
  tier: "retail" | "wholesale";
};

// WHAT THE CLIENT SEES OF THE SHOP'S CATALOGUE WITHOUT LEAVING THEIR BALANCE.
//
// Frame `1378:7916`, owner's commission of 2026-10-17. A row of 120px cards
// that scrolls sideways, above the movement history.
//
// EVERY CARD GOES TO THE CATALOGUE INDEX, NOT TO THAT PRODUCT'S PAGE. That
// reads wrong at first and it is what both the frame and the owner asked for:
// the connector in the frame points from "Ver todo" AND from the cards to the
// same screen, and his words were «al seleccionar cualquier producto o el
// botón "Ver todo" se debe abrir el catálogo». The strip is an invitation to
// the catalogue, not a shortcut into one product -- and a client who meant to
// browse would otherwise land on a single item with no way back into the rest.
//
// IT IS A CLIENT COMPONENT ONLY FOR THE TAP, not for the data. Everything
// rendered here arrives already resolved from the server; the one thing the
// server cannot do is notice a tap (see `/api/share-catalog`).
export function CatalogStrip({
  shareToken,
  catalogToken,
  products,
}: {
  // The CLIENT's token, the one in the address bar. It is what the event
  // route uses to find out which business to file the event under; it is
  // never used to build the catalogue link.
  shareToken: string;
  catalogToken: string;
  products: CatalogStripProduct[];
}) {
  if (products.length === 0) return null;

  // `?desde=saldo` ENCIENDE LA FLECHA DE VOLVER del catálogo, y nada más. No
  // lleva el token del cliente a propósito: ese abre su saldo, y el catálogo
  // es justo la pantalla que alguien reenviaría. Ver
  // `components/public/back-to-balance.tsx`.
  const href = `/c/${catalogToken}?desde=saldo`;

  // THE TAP IS RECORDED BY THE SERVER, AND THE NAVIGATION DOES NOT WAIT FOR
  // IT. `keepalive` is what makes that safe: the request survives the page
  // unloading underneath it, so the count holds up without putting a hop in
  // front of a client on a phone. Same trade, and the same reasoning, as the
  // WhatsApp button next to it -- see `/api/share-contact`.
  //
  // IT FAILS SILENTLY ON PURPOSE. An analytics call that can break a link is
  // worse than a missing number, so every outcome here is swallowed.
  const registrar = () => {
    try {
      void fetch("/api/share-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: shareToken }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Nothing. See above.
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {/* `mt-1 text-xl font-semibold`, que es el ÚNICO estilo de título que
            `DESIGN-SYSTEM.md` admite — «un solo estilo, en todas partes; no
            existe una variante de rótulo pequeño». Nació incumpliéndolo el
            2026-10-17 y lo corrigió el dueño el mismo día, mirando la
            pantalla: «Pendiente», «Productos» e «Historial» se leían como
            tres jerarquías distintas en una columna donde son lo mismo. */}
        <h2 className="mt-1 text-xl font-semibold">Productos</h2>
        <Link
          href={href}
          onClick={registrar}
          className="flex items-center gap-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Ver todo
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {/* THE NEGATIVE MARGINS PUT THE SCROLL ON THE PAGE'S EDGE, not inside
          its 16px inset. Without them the last card stops short of the edge
          and the strip stops reading as "there is more over there" -- which
          is the only thing telling a client to swipe. `px-4` puts the inset
          back on the cards themselves so the first one still lines up with
          the headings above it.

          `scrollbar-none` is not available here, so the bar is left alone: on
          a phone it is an overlay that fades, which is where this is read. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {products.map((p) => {
          const foto = p.photo_path ? getPublicProductPhotoUrl(p.photo_path) : null;
          return (
            <Link
              key={p.id}
              href={href}
              onClick={registrar}
              aria-label={`${p.name} — ver el catálogo`}
              className="relative flex size-30 shrink-0 flex-col justify-end gap-1 overflow-hidden rounded-lg bg-muted p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {foto ? (
                <>
                  <Image
                    src={foto}
                    alt=""
                    fill
                    unoptimized
                    sizes="120px"
                    className="absolute inset-0 object-cover"
                  />
                  {/* The gradient is what makes the name readable over a
                      photo nobody vetted: a pale bag of rice and white text
                      is an invisible label. Transparent until a quarter of
                      the way down, solid brand black by 65%, as the frame
                      specifies. */}
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent from-25% to-brand-primary to-65%" />
                </>
              ) : (
                /* `pb-12` Y NO UN CENTRADO A SECAS. Centrado en la tarjeta
                   entera, el icono queda justo donde empieza el texto, y una
                   tarjeta de tres líneas —nombre, precio y «al mayor»— se le
                   monta encima. Se vio en dev el 2026-10-17 con un producto
                   publicado solo al mayor; con dos líneas no pasaba, que es
                   por lo que casi se escapa. El relleno inferior deja el
                   icono centrado en la parte de arriba, que es donde iría la
                   foto si la hubiera. */
                <div className="absolute inset-0 flex items-center justify-center bg-brand-primary/90 pb-12">
                  <ImageOff className="size-6 text-brand-muted" aria-hidden="true" />
                </div>
              )}

              <p className="relative truncate text-sm text-brand-secondary">{p.name}</p>
              <div className="relative flex items-center gap-1">
                <CurrencyFlagIcon currency={p.base_currency} className="size-4 shrink-0" />
                <span className="truncate text-xs text-brand-secondary">
                  {formatPriceAmount(p.price, p.base_currency)}
                </span>
              </div>
              {/* ONLY WHEN IT IS THE WHOLESALE PRICE, and the frame does not
                  draw it because its mock products are all retail. A product
                  published only at wholesale shows its wholesale figure here,
                  and a bare number would read as the price of one unit. The
                  catalogue card already says "precio al mayor" underneath for
                  this exact reason; leaving it out of the strip is the only
                  version of this screen that can mislead about money. */}
              {p.tier === "wholesale" ? (
                <span className="relative text-[10px] leading-none text-brand-muted">al mayor</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

