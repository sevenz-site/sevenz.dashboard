import { CardSkeleton, DarkHeaderSkeleton, ListSkeleton, ScreenLoading } from "@/components/dashboard/screen-loading";

// Skeleton only, from this page's own layout. NO FIGMA FRAME YET: it needs one (and its
// Drive document) before it goes to production. Why loading.tsx exists at all, and what
// it must not add (no app header), is in components/dashboard/screen-loading.tsx.
//
// It also covers the catalogue's nested routes that have no loading.tsx of their own
// (/productos/[id], /productos/nuevo, the order flow): Next shows the nearest one up.
export default function Loading() {
  return (
    <ScreenLoading>
      <DarkHeaderSkeleton filters />
      <CardSkeleton className="h-16" />
      <ListSkeleton rows={5} label={false} />
    </ScreenLoading>
  );
}
