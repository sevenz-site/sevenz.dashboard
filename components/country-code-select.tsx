"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COUNTRIES,
  DEFAULT_COUNTRY_ISO2,
  SELECTABLE_COUNTRIES,
  countryFlagEmoji,
} from "@/lib/countries";

// Solo Colombia y Venezuela, que es donde opera Sevenz. La lista entera de 230
// países obligaba al tendero a buscar el suyo entre Afganistán y Zimbabue para
// elegir uno de dos, y con ella desaparece también el buscador de dentro: con
// dos opciones a la vista, un campo de búsqueda es un paso de más.
//
// LO QUE YA ESTÁ GUARDADO NO SE PIERDE. Si un número tiene un prefijo de fuera
// de esos dos —de antes de este cambio, o escrito a mano—, su país se resuelve
// igual contra la lista completa y se añade al final del menú. Que ya no se
// pueda elegir de nuevo no es razón para enseñar una bandera falsa encima de
// un número real, ni para dejar al dueño sin poder volver a marcarlo.

export function CountryCodeSelect({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (dialCode: string) => void;
  // Solo la bandera, sin "+57" ni chevron: 44px en vez de 112. Existe para la
  // tabla de importar, donde el selector entero dejaba al número 22px de
  // ancho — dos dígitos de diez. Fuera de una tabla no se usa: el prefijo
  // escrito es información que merece su sitio cuando hay sitio.
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // El país guardado se busca en la lista COMPLETA, no en la de dos: si el
  // número lleva +34, esto tiene que decir España.
  //
  // El respaldo es Colombia, el país por defecto de la app, y no `COUNTRIES[0]`
  // como antes — esa lista está ordenada alfabéticamente, así que un prefijo
  // desconocido enseñaba la bandera de Afganistán.
  const selected =
    COUNTRIES.find((c) => c.dialCode === value) ??
    COUNTRIES.find((c) => c.iso2 === DEFAULT_COUNTRY_ISO2)!;

  const esSeleccionable = SELECTABLE_COUNTRIES.some((c) => c.iso2 === selected.iso2);
  const opciones = esSeleccionable ? SELECTABLE_COUNTRIES : [...SELECTABLE_COUNTRIES, selected];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // En compacto el texto desaparece de la pantalla, así que el país y
          // su prefijo pasan al nombre accesible: quien navegue con lector de
          // pantalla oye lo mismo que antes leía.
          aria-label={compact ? `País del número: ${selected.name} +${selected.dialCode}` : undefined}
          className={cn(
            "shrink-0 justify-between px-2 font-normal",
            compact ? "w-11" : "w-28",
          )}
        >
          <span className="truncate">
            {countryFlagEmoji(selected.iso2)}
            {compact ? null : ` +${selected.dialCode}`}
          </span>
          {compact ? null : <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      {/* With the keyboard open, Radix often has to flip this above the
          trigger instead of below it — and without a size cap it renders at
          its natural height (CommandList's own max-h-72) regardless of
          whether that fits the shrunk space above, pushing the top of the
          list past the visible viewport. Bounding to what Radix reports as
          actually available and letting it scroll keeps the whole panel on
          screen. Same fix as the rate calculator popover in
          exchange-rate-strip.tsx. */}
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="max-h-[var(--radix-popover-content-available-height)] w-64 overflow-y-auto p-0"
      >
        <Command>
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {opciones.map((country) => (
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
