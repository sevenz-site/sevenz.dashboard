import { Badge } from "@/components/ui/badge";
import { formatBs } from "@/lib/exchange-rate/format";

// Must appear, with this exact text, on every screen that calculates or
// shows a converted amount while rate_mode = 'CUSTOM' — both the owner's
// side (movement form, dashboard) and the client's public balance screen.
// Not optional and never hideable: this is what keeps the transparency
// bidireccional that Sevenz promises. currentBcvUsd is the live official
// rate, shown purely as the "not this" comparison point.
export function CustomRateBadge({ currentBcvUsd }: { currentBcvUsd: number | null }) {
  return (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400"
    >
      ⚠️ Tasa personalizada del negocio — no es la tasa oficial BCV
      {currentBcvUsd ? ` (${formatBs(currentBcvUsd)} hoy)` : ""}
    </Badge>
  );
}
