"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { ClientResultList, CLIENT_RESULT_LIMIT } from "@/components/dashboard/client-result-list";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { cn } from "@/lib/utils";
import type { LendingPeriod } from "@/lib/lending-charts";

// THE TWO CONTROLS OF /reportes, and both of them live in the URL.
//
// Not in React state: the series are bucketed on the server, so a change has to
// reach it anyway. Carrying them as `?periodo=` and `?cliente=` means the back
// button steps through what the owner looked at, a reload shows the same thing,
// and no movement row is ever shipped to the browser just so it can be filtered
// there.
//
// The cost, said out loud: every change is a round trip. On this screen that is
// a chart redrawing, not a form losing what you typed.

function useParamPush() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // `replace` and not `push` for the period: flipping between 7 and 30 days
  // half a dozen times should not bury the previous screen under six history
  // entries. Picking a client DOES push, because backing out of it is the
  // natural way to say "show me everyone again".
  const set = (key: string, value: string | null, mode: "push" | "replace") => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router[mode](qs ? `/reportes?${qs}` : "/reportes");
    });
  };

  return { set, isPending };
}

const PERIODS: { value: LendingPeriod; label: string }[] = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

export function ReportesPeriodChips({ period }: { period: LendingPeriod }) {
  const { set, isPending } = useParamPush();

  return (
    <div className="flex gap-2">
      {PERIODS.map((p) => {
        const active = p.value === period;
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={active}
            disabled={isPending}
            onClick={() => set("periodo", p.value, "replace")}
            // Same shape as the filter chips on the other three screens, and the
            // same border: `--brand-field-border` at 1px. The spec drew those in
            // #525252, which is 1,91:1 against this header — a chip has no fill,
            // so without a visible edge it is a word floating on a dark block.
            className={cn(
              "h-[38px] shrink-0 rounded-[10px] border px-4 text-sm transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              active
                ? "border-white font-medium text-white"
                : "border-brand-field-border text-brand-muted hover:bg-white/10 hover:text-white",
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function ReportesClientSearch({
  clients,
  selectedName,
}: {
  clients: { id: string; name: string; document_id: string | null; document_type: string | null }[];
  // Null when no client is picked. When it is set the field stops being a
  // search box and becomes a label with a way out — typing again would suggest
  // you can stack two clients, and you cannot.
  selectedName: string | null;
}) {
  const { set } = useParamPush();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const q = query.trim().toLowerCase();
  const results =
    q === ""
      ? []
      : clients
          .filter((c) => c.name.toLowerCase().includes(q) || (c.document_id ?? "").includes(q))
          .slice(0, CLIENT_RESULT_LIMIT)
          .map((c) => ({
            id: c.id,
            name: c.name,
            documentId: c.document_id,
            documentType: c.document_type ?? null,
          }));

  if (selectedName) {
    return (
      <div className="flex h-[50px] w-full items-center justify-between gap-2 rounded-[10px] border-2 border-brand-field-border bg-brand-field pr-3 pl-4">
        <span className="truncate text-[17px] text-brand-secondary">{selectedName}</span>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            set("cliente", null, "push");
          }}
          aria-label="Quitar el filtro de cliente"
          className="shrink-0 rounded text-brand-secondary outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <X className="size-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* `SearchField`, el mismo de Clientes, desde el 2026-10-16. Este campo
          ya tenía exactamente su aspecto —50px, el relleno, el borde de 2px—
          porque era una copia suya, pero le faltaba la rama del aspa, así que
          la única forma de vaciarlo era borrar letra por letra. */}
      <SearchField
        tone="dark"
        value={query}
        onChange={setQuery}
        placeholder="Buscar cliente"
        onFocus={() => setFocused(true)}
        // The same delay as the other screens, and for the same reason: tapping
        // a result blurs the field, and unmounting the list in that instant
        // means the tap lands on whatever moved into its place.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />

      {focused && q !== "" ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 bg-popover shadow-md">
          <ClientResultList
            results={results}
            onSelect={(id) => {
              setQuery("");
              set("cliente", id, "push");
            }}
          />
          {results.length === 0 ? (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              Sin resultados para &quot;{query.trim()}&quot;.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
