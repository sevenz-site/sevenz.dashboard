"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

// The phone's way into the sidebar, since the bottom bar no longer carries
// "Menú". Deliberately not SidebarTrigger: that one is hardcoded to the
// panel-left glyph, which reads as "collapse this rail" — right for the
// desktop sidebar it toggles, wrong for a sheet that slides in over a phone,
// where a hamburger is what the owner is looking for.
export function SidebarMenuTrigger({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button variant="ghost" size="icon-sm" className={className} onClick={toggleSidebar}>
      <Menu />
      <span className="sr-only">Abrir menú</span>
    </Button>
  );
}
