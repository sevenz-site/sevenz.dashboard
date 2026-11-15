import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// THE PIECES EVERY `loading.tsx` OF THE OWNER'S APP IS BUILT FROM (2026-11-15).
//
// WHY THESE FILES EXIST. Per Next's docs, a dynamic route without loading.tsx
// is not prefetched, so a tap on the bottom bar showed nothing new until the
// server had finished the whole page — seconds on Venezuelan mobile data, which
// reads as «the app did not hear me». With loading.tsx the skeleton is
// prefetched and appears the instant the tap lands.
//
// NO FIGMA FRAME YET. These shapes were drawn from each page's own layout
// (dark ScreenHeader, cards, list), not from a frame. Under the repo's rule
// «Toda decisión de interfaz queda en Figma, Drive y Trello, o no se lanza»,
// each skeleton needs its frame before it goes to production.
//
// Shared on purpose («Un valor visual que sale en más de una pantalla NACE en
// un componente»): nine screens draw the same grey, and a copy per screen would
// drift. A loading.tsx renders inside the app layout like the page does, so
// none of this adds a header: the dark block below stands in for the page's
// OWN ScreenHeader / HomeHeader, which the app header already makes room for.

// Grey bars for a dark surface: bg-muted would read as a light patch there.
const ON_DARK = "bg-white/10";

// Announces the wait once to a screen reader; the grey shapes stay silent.
export function ScreenLoading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-1 flex-col gap-4", className)}>
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  );
}

// Stand-in for ScreenHeader / HomeHeader: same bleed (-mx-4 -mt-4 cancels
// AppMain's p-4) and the same background, so the swap to the real page does not
// jump. Title, optional subtitle, optional search field and filter chips.
export function DarkHeaderSkeleton({
  subtitle = true,
  search = true,
  filters = false,
}: {
  subtitle?: boolean;
  search?: boolean;
  filters?: boolean;
}) {
  return (
    <div aria-hidden className="-mx-4 -mt-4 flex flex-col gap-3 bg-brand-primary px-4 pt-6 pb-4">
      <Skeleton className={cn("h-7 w-40", ON_DARK)} />
      {subtitle ? <Skeleton className={cn("h-4 w-64 max-w-full", ON_DARK)} /> : null}
      {search ? <Skeleton className={cn("mt-1 h-10 w-full rounded-lg", ON_DARK)} /> : null}
      {filters ? (
        <div className="flex gap-2 overflow-hidden">
          <Skeleton className={cn("h-8 w-20 shrink-0 rounded-full", ON_DARK)} />
          <Skeleton className={cn("h-8 w-24 shrink-0 rounded-full", ON_DARK)} />
          <Skeleton className={cn("h-8 w-20 shrink-0 rounded-full", ON_DARK)} />
        </div>
      ) : null}
    </div>
  );
}

// Back arrow + screen title, for the pages drawn on the light background
// (Mi negocio, Notificaciones).
export function TitleRowSkeleton({ subtitle = false }: { subtitle?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <Skeleton className="h-6 w-6" />
      <Skeleton className="h-8 w-48" />
      {subtitle ? <Skeleton className="h-4 w-64 max-w-full" /> : null}
    </div>
  );
}

// A section label followed by list rows (clients, products, notices).
export function ListSkeleton({ rows = 5, label = true }: { rows?: number; label?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {label ? <Skeleton className="h-5 w-24" /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

// A card-sized block (balance card, report card, orders card).
export function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton aria-hidden className={cn("h-24 w-full rounded-[10px]", className)} />;
}

// Label + field pairs, for forms (Mi negocio).
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
