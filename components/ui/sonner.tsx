"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// WHY theme IS PINNED, and not read from next-themes.
//
// This component used to call useTheme() and pass the result straight to
// Sonner. next-themes' ThemeProvider is mounted NOWHERE in this app — grep it
// and this file is the only hit — so useTheme() returned undefined and the
// default landed on "system". Sonner then resolved "system" ITSELF, from
// prefers-color-scheme, and stamped data-sonner-theme="dark" whenever the
// phone was in dark mode.
//
// The app, meanwhile, is light-only: nothing ever puts `.dark` on <html>, so
// every token below stayed light. The two disagreed, and one element paid for
// it. Measured 2026-09-08 in the running app:
//
//   toast background  #ffffff   (ours, from --popover)
//   title             #0a0a0a   19.80:1   — reads --normal-text, so it followed us
//   icon              #0a0a0a   19.80:1   — currentColor, same
//   description       #e8e8e8    1.23:1   — sonner's own dark literal
//
// The description is the ONLY element in sonner's stylesheet painted with a
// hardcoded colour keyed on its own theme attribute; everything else routes
// through the --normal-* variables this file overrides. That is the whole
// explanation for a toast whose title is crisp and whose second line is
// invisible, which is what a shopkeeper on a dark-mode phone has been seeing.
//
// WCAG 2.2 SC 1.4.3 (Contrast, Minimum, AA) requires 4.5:1 for text this size.
// 1.23:1 is not a near miss.
//
// Pinning removes the divergence at the source: one theme, decided here, not
// two resolved independently. If this app ever grows a real theme switcher,
// mount ThemeProvider and pass its resolved value — but the description colour
// is now token-derived in globals.css too, so that day cannot reintroduce this.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
