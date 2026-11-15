"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";

// WHAT THE OWNER SEES WHEN A SCREEN FAILS TO LOAD (2026-11-15).
//
// Until this file there was no error.tsx anywhere, so a page whose server render
// threw — most often a request that died on weak mobile data — fell through to
// Next's bare default error page, with no way back into the app but closing it.
// This boundary sits under the app layout, so the sidebar and the bottom bar
// stay usable and only the broken screen is replaced.
//
// WHAT IT DOES NOT CATCH: an error in app/(app)/layout.tsx itself. Per Next's
// docs an error.tsx does not wrap the layout of its own segment; that would need
// app/global-error.tsx, which is not part of this change.
//
// `retry`, not `reset`: in this Next version (16.3) `retry` re-fetches and
// re-renders the segment, which is what a dropped connection needs; `reset`
// only re-renders what the client already has and would fail the same way.
//
// NO FIGMA FRAME YET: the look reuses EmptyState (frame 1499:9618) as-is, but
// this screen needs its own frame and Drive document before it goes to
// production. The message never shows `error.message`: in production Next
// replaces server errors with a generic text plus a digest, and the digest is
// for our logs, not for a shopkeeper.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <EmptyState
        title="No pudimos cargar esta pantalla"
        subtitle="Revisa tu conexión."
      >
        <Button type="button" className="h-10 w-full text-base font-semibold" onClick={() => retry()}>
          <RotateCw className="size-5" /> Reintentar
        </Button>
      </EmptyState>
    </div>
  );
}
