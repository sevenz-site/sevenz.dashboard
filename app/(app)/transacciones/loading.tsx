import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton, ScreenLoading } from "@/components/dashboard/screen-loading";

// Skeleton only, from this page's own layout. NO FIGMA FRAME YET: it needs one (and its
// Drive document) before it goes to production. Why loading.tsx exists at all, and what
// it must not add (no app header), is in components/dashboard/screen-loading.tsx.
//
// Covers both detail routes, /transacciones/[movementId] and
// /transacciones/venta/[saleId]/[moneda], which share this shape: the light top bar with
// the back arrow, the title, the transaction code and the detail groups.
export default function Loading() {
  return (
    <ScreenLoading>
      <div aria-hidden className="-mx-4 -mt-4 flex items-center border-b px-4 py-3">
        <Skeleton className="size-9" />
      </div>
      <Skeleton aria-hidden className="h-8 w-56 max-w-full" />
      <Skeleton aria-hidden className="h-5 w-32" />
      <CardSkeleton className="h-40" />
      <CardSkeleton className="h-24" />
    </ScreenLoading>
  );
}
