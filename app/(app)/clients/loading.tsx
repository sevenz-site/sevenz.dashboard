import { DarkHeaderSkeleton, ListSkeleton, ScreenLoading } from "@/components/dashboard/screen-loading";

// Skeleton only, from this page's own layout. NO FIGMA FRAME YET: it needs one (and its
// Drive document) before it goes to production. Why loading.tsx exists at all, and what
// it must not add (no app header), is in components/dashboard/screen-loading.tsx.
//
// /clients/[id] has its own loading.tsx; /clients/nuevo has none and shows this one.
export default function Loading() {
  return (
    <ScreenLoading>
      <DarkHeaderSkeleton filters />
      <ListSkeleton rows={6} />
    </ScreenLoading>
  );
}
