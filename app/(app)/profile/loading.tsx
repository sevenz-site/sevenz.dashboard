import { FormSkeleton, ScreenLoading, TitleRowSkeleton } from "@/components/dashboard/screen-loading";

// Skeleton only, from this page's own layout. NO FIGMA FRAME YET: it needs one (and its
// Drive document) before it goes to production. Why loading.tsx exists at all, and what
// it must not add (no app header), is in components/dashboard/screen-loading.tsx.
export default function Loading() {
  return (
    <ScreenLoading className="gap-6">
      <TitleRowSkeleton />
      <FormSkeleton fields={5} />
    </ScreenLoading>
  );
}
