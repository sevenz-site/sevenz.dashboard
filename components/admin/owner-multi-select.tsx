"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// A Select cannot express "these three businesses". Radix's Select is
// single-value by design, so segmenting the platform — compare these shops
// against each other — meant running the report once per shop and adding it up
// by hand. This is the standard Popover + Command combobox instead: search,
// because the list grows with every signup, and a check per row so the current
// segment is readable without opening anything.

export type OwnerOption = { id: string; business_name: string; country: string };

export function OwnerMultiSelect({
  owners,
  selected,
  onChange,
}: {
  owners: OwnerOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const label =
    selected.length === 0
      ? "Todos"
      : selected.length === 1
        ? owners.find((o) => o.id === selected[0])?.business_name || "(sin nombre)"
        : `${selected.length} negocios`;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <Popover>
      {/* Matches SelectTrigger's classes rather than using Button, so this sits
          in the filter row at the same height and weight as its neighbours. */}
      <PopoverTrigger
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "dark:bg-input/30 dark:hover:bg-input/50",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar negocio…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {/* Not an item that selects everything — it clears the filter,
                  which is the same thing and cannot drift out of sync with the
                  list below when a new business signs up. */}
              <CommandItem value="__todos__" onSelect={() => onChange([])}>
                <CheckIcon
                  className={cn("size-4", selected.length === 0 ? "opacity-100" : "opacity-0")}
                />
                Todos
              </CommandItem>
              {owners.map((o) => (
                <CommandItem
                  key={o.id}
                  // Searched by name, not by uuid — cmdk filters on this value.
                  value={`${o.business_name} ${o.country}`}
                  onSelect={() => toggle(o.id)}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      selected.includes(o.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.business_name || "(sin nombre)"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{o.country}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
