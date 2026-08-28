"use client"

import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPasswordCriteria } from "@/lib/password"

// Live pass/fail checklist shown under a "set a new password" field. Each
// row pairs an icon with real text (never color alone) and a visually
// hidden "cumplido/pendiente" word, so the state change is announced to
// screen readers via the aria-live region even though the icon itself is
// aria-hidden.
export function PasswordCriteriaChecklist({ password, id }: { password: string; id?: string }) {
  const criteria = getPasswordCriteria(password)

  return (
    <ul id={id} aria-live="polite" className="flex flex-col gap-1 text-xs">
      {criteria.map((criterion) => (
        <li
          key={criterion.id}
          className={cn(
            "flex items-center gap-1.5",
            criterion.met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          {criterion.met ? (
            <Check className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <X className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{criterion.label}</span>
          <span className="sr-only">{criterion.met ? "— cumplido" : "— pendiente"}</span>
        </li>
      ))}
    </ul>
  )
}
