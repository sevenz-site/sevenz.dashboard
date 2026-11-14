"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";

// A PRODUCT'S PHOTOS, SWIPED. One component for the shopkeeper's product page and the
// customer's (CT-171, frames `2119:21783`, `2119:21828` and `2119:21879`, approved by the
// owner on 2026-11-12), so the two cannot drift apart -- CLAUDE.md, «Un valor visual que
// sale en más de una pantalla NACE en un componente».
//
// NATIVE SCROLL WITH SNAP, NOT A CAROUSEL LIBRARY. The finger swipe is the browser's own,
// which is the one gesture iOS Safari never gets wrong, and it needs no dependency.
//
// ARROWS ONLY FROM `md` (768 px) AND ONLY WITH TWO PHOTOS OR MORE. Owner's decision of
// 2026-11-12 for web: «galería con flechas». On a phone the swipe is the gesture and two
// arrows would cover the photo. The dots show in both, again only with two or more: one
// dot says nothing.
export function ProductGallery({
  paths,
  alt,
  className,
  sizes,
  emptyIconClassName = "size-6",
  children,
}: {
  paths: string[];
  alt: string;
  // The box: its size and background. The gallery fills it.
  className?: string;
  sizes: string;
  // The two pages drew the «Sin foto» icon at different sizes before this component;
  // each keeps its own.
  emptyIconClassName?: string;
  // Whatever floats on top of the photo -- the back and share buttons.
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(0);
  const varias = paths.length > 1;

  function ir(i: number) {
    const el = ref.current;
    if (!el) return;
    const destino = Math.max(0, Math.min(paths.length - 1, i));
    el.scrollTo({ left: destino * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {paths.length === 0 ? (
        // The drawn gap instead of nothing: it says a photo fits here and this product
        // has none. A plain grey box reads as an image that failed to load.
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <ImageOff className={emptyIconClassName} aria-hidden="true" />
          <span className="text-xs">Sin foto</span>
        </div>
      ) : (
        <div
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.clientWidth > 0) setActual(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-roledescription={varias ? "carrusel" : undefined}
        >
          {paths.map((path, i) => (
            <div key={path} className="relative h-full w-full shrink-0 snap-center">
              {/* `unoptimized`: a Supabase public URL of a photo already resized on the
                  device. Only the first loads eagerly; the rest wait for the swipe. */}
              <Image
                src={getPublicProductPhotoUrl(path)}
                alt={varias ? `${alt}, foto ${i + 1} de ${paths.length}` : alt}
                fill
                unoptimized
                priority={i === 0}
                loading={i === 0 ? undefined : "lazy"}
                sizes={sizes}
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      {varias ? (
        <>
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-2 py-1">
            {paths.map((path, i) => (
              <span
                key={path}
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", i === actual ? "bg-white" : "bg-white/50")}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Foto anterior"
            onClick={() => ir(actual - 1)}
            disabled={actual === 0}
            className="absolute top-1/2 left-4 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur disabled:opacity-0 md:flex"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Foto siguiente"
            onClick={() => ir(actual + 1)}
            disabled={actual === paths.length - 1}
            className="absolute top-1/2 right-4 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur disabled:opacity-0 md:flex"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {children}
    </div>
  );
}
