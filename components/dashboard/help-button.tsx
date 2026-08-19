"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "@/components/dashboard/tour-context";

export function HelpButton() {
  const tour = useTour();

  return (
    <Button variant="ghost" size="sm" onClick={tour.restart}>
      <CircleHelp className="size-4" />
      Ayuda
    </Button>
  );
}
