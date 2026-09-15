"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLAZO_PAGO_OPTIONS, PLAZO_PAGO_OTRO } from "@/lib/types";

// El plazo, con una salida para los que no están en la lista.
//
// "Otro plazo…" al final del desplegable abre un campo de días debajo. El caso
// normal —7 días— sigue siendo un toque, y quien acordó 45 los escribe. Se
// eligió frente a un desplegable donde además se pueda teclear, porque un
// control que hace dos cosas a la vez se descubre tarde: mucha gente nunca
// prueba a escribir dentro de una lista.
//
// El valor que viaja al servidor es siempre `plazo_dias`, y es el mismo campo
// de siempre: con la opción normal va "7", y con la personalizada va el número
// tecleado. Al servidor no le cambia nada.
export function PlazoPagoSelect({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  // Si lo elegido no es ninguna de las opciones fijas, es un plazo propio — así
  // el campo sigue abierto al reabrir el diálogo con un valor ya puesto.
  const esFijo = PLAZO_PAGO_OPTIONS.some((o) => o.value === value);
  const [otro, setOtro] = useState(!esFijo);
  const dias = esFijo ? "" : value;

  return (
    <div className="flex flex-col gap-2">
      <Label>Plazo de pago</Label>
      <Select
        value={otro ? PLAZO_PAGO_OTRO : value}
        onValueChange={(v) => {
          if (v === PLAZO_PAGO_OTRO) {
            setOtro(true);
            // No se envía un plazo a medias: hasta que escriba un número, el
            // movimiento se guarda sin plazo. Mandar el "7" que estaba antes
            // sería anotar un acuerdo que nadie hizo.
            onValueChange("");
            return;
          }
          setOtro(false);
          onValueChange(v);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Elige un plazo" />
        </SelectTrigger>
        <SelectContent>
          {PLAZO_PAGO_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
          <SelectItem value={PLAZO_PAGO_OTRO}>Otro plazo…</SelectItem>
        </SelectContent>
      </Select>

      {otro ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="1"
            max="365"
            inputMode="numeric"
            placeholder="Días"
            value={dias}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-28"
            aria-label="Días de plazo"
            autoFocus
          />
          <span className="text-sm text-muted-foreground">días</span>
        </div>
      ) : null}

      {/* El valor viaja en un hidden y no en el Select: con "Otro plazo…"
          elegido, lo que el servidor necesita es el número tecleado, no la
          palabra "otro". Un solo campo, un solo nombre, mande lo que mande. */}
      <input type="hidden" name="plazo_dias" value={value} />
    </div>
  );
}
