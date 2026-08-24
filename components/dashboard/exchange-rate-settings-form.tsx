"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  updateExchangeSettings,
  type ExchangeSettingsState,
} from "@/app/(app)/profile/exchange-rate-actions";
import type { DisplayCurrency, ExchangeRateMode, OwnerExchangeSettings } from "@/lib/types";

const initialState: ExchangeSettingsState = { error: null, success: false };

export function ExchangeRateSettingsForm({
  settings,
  currentBcvUsd,
  currentBcvEur,
}: {
  settings: OwnerExchangeSettings | null;
  currentBcvUsd: number | null;
  currentBcvEur: number | null;
}) {
  const router = useRouter();
  const [rateMode, setRateMode] = useState<ExchangeRateMode>(settings?.rate_mode ?? "BCV_AUTO");
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(
    settings?.display_currency ?? "USD",
  );
  const [state, formAction, pending] = useActionState(updateExchangeSettings, initialState);

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success("Configuración de tasa guardada");
      router.refresh();
    }
  }, [state, pending, router]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Tasa de cambio</Label>
        <RadioGroup name="rate_mode" value={rateMode} onValueChange={(v) => setRateMode(v as ExchangeRateMode)}>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="BCV_AUTO" />
            Tasa BCV automática
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="CUSTOM" />
            Mi propia tasa
          </label>
        </RadioGroup>
      </div>

      {rateMode === "CUSTOM" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="custom_rate_usd">Tu tasa USD</Label>
            <Input
              id="custom_rate_usd"
              name="custom_rate_usd"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.custom_rate_usd ?? ""}
              required
            />
            <p className="text-xs text-muted-foreground">
              BCV hoy: {currentBcvUsd ? formatBs(currentBcvUsd) : "—"}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="custom_rate_eur">Tu tasa EUR</Label>
            <Input
              id="custom_rate_eur"
              name="custom_rate_eur"
              type="number"
              min="0"
              step="0.01"
              defaultValue={settings?.custom_rate_eur ?? ""}
              required
            />
            <p className="text-xs text-muted-foreground">
              BCV hoy: {currentBcvEur ? formatBs(currentBcvEur) : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label>Moneda principal del saldo</Label>
        <Select
          name="display_currency"
          value={displayCurrency}
          onValueChange={(v) => setDisplayCurrency(v as DisplayCurrency)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          El Bolívar siempre aparece como complemento, nunca como moneda principal.
        </p>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Guardando..." : "Guardar cambios"}
      </Button>

      <ExchangeRateLegalDisclaimer />
    </form>
  );
}
