import { STATUS_LABEL, type PromotionStatus } from "@/lib/promotions/rules";

// A promotion's state (CT-184, frames 2 and 9 of `2300:21627`), in the list and the detail: one
// component so the two cannot disagree. The decision of WHICH state is `promotionStatus` in
// lib/promotions/rules.ts.
const TONE: Record<PromotionStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  scheduled: "bg-blue-50 text-blue-700",
  extended: "bg-orange-50 text-orange-700",
  ended: "bg-muted text-muted-foreground",
};

export function PromotionStatusChip({ status }: { status: PromotionStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs leading-4 font-medium ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
