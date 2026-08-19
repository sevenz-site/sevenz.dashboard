"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { COUNTRIES, countryFlagEmoji } from "@/lib/countries";

export function CountryCodeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (dialCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = COUNTRIES.find((c) => c.dialCode === value) ?? COUNTRIES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-28 shrink-0 justify-between px-2 font-normal"
        >
          <span className="truncate">
            {countryFlagEmoji(selected.iso2)} +{selected.dialCode}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar país..." />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((country) => (
                <CommandItem
                  key={country.iso2}
                  value={`${country.name} +${country.dialCode}`}
                  onSelect={() => {
                    onChange(country.dialCode);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      country.dialCode === selected.dialCode ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span>{countryFlagEmoji(country.iso2)}</span>
                  <span className="flex-1 truncate">{country.name}</span>
                  <span className="text-muted-foreground">+{country.dialCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
