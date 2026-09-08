import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// An Input with a decorative icon at its trailing edge.
//
// Positioned to match PasswordInput's show/hide toggle exactly — same pr-9 on
// the field, same w-9 box on the right — so a form that mixes the two lines its
// icons up instead of showing them a few pixels apart.
//
// Deliberately NOT a button. It is aria-hidden, so a screen reader reads the
// label and nothing else, and pointer-events-none, so a tap on the icon lands
// in the field rather than on dead space. An icon that decorates a field it
// does not act on should cost the keyboard user no tab stop.
function InputWithIcon({
  icon: Icon,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <Input className={cn("pr-9", className)} {...props} />
      <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </div>
  )
}

export { InputWithIcon }
