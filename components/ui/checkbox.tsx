"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// WHITE, WITH A BORDER YOU CAN SEE — since 2026-11-09.
//
// It was `border-input` with no fill: oklch 0.922 on white is about 1.25:1,
// and on the grey `bg-accent` the WhatsApp consent row used, the box all but
// vanished. Shopkeepers reported they could not find the checkbox (the owner,
// with a screenshot of «Nuevo cliente»). WCAG asks 3:1 for a control's edge:
// `border-muted-foreground` is about 4.7:1 on white and 4.5:1 on `bg-accent`,
// and `bg-background` keeps the box white on any surface it lands on.
//
// FIXED HERE AND NOT IN THAT ONE SCREEN, because every checkbox in the app
// had the same edge — fourteen files mount this component.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-muted-foreground bg-background shadow-xs outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
