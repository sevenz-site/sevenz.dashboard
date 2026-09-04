"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";

// The same "← Cartera" contextual bar used on Malas pagas and a client's
// screen is a plain Link there, since neither has anything to lose. "Mi
// negocio" does — BusinessSettingsForm registers dirty state with
// UnsavedChangesProvider so the sidebar and bottom nav already ask before
// leaving with unsaved edits. A plain Link here would be a second exit that
// silently doesn't, so this one goes through the same guard() instead.
export function CarteraBackButton() {
  const router = useRouter();
  const { guard } = useUnsavedChangesGuard();

  return (
    <Button variant="ghost" size="icon" asChild className="-ml-2">
      <Link
        href="/dashboard"
        aria-label="Volver a Cartera"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          guard(() => router.replace("/dashboard"));
        }}
      >
        <ChevronLeft className="size-5" />
      </Link>
    </Button>
  );
}
