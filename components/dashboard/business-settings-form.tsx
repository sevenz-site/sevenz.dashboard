"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { WhatsappInput } from "@/components/whatsapp-input";
import { LogoUploader } from "@/components/dashboard/logo-uploader";
import { FormattedTextarea } from "@/components/dashboard/formatted-textarea";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { updateBusinessSettings, type ProfileState } from "@/app/(app)/profile/actions";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import type { Owner } from "@/lib/types";

const initialState: ProfileState = { error: null, success: false };

export function BusinessSettingsForm({
  owner,
  logoUrl,
}: {
  owner: Owner;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [logoPath, setLogoPath] = useState<string | null>(owner.logo_path);
  // País and the exchange-rate mode aren't user-editable — see the note
  // by the "País" field below — so these never change after mount.
  const country = owner.country;
  const { setDirty, guard } = useUnsavedChangesGuard();
  const [isDirty, setIsDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared by both save paths: the button's own submit and "Guardar y salir"
  // from the unsaved-changes dialog. Calls the server action directly (not
  // through useActionState) so both callers can await the same result.
  async function saveNow(): Promise<boolean> {
    if (!formRef.current) return false;
    const formData = new FormData(formRef.current);
    const result = await updateBusinessSettings(initialState, formData);
    if (result.error) {
      setError(result.error);
      toast.error(result.error);
      return false;
    }
    setError(null);
    toast.success("Cambios guardados");
    setIsDirty(false);
    setDirty(false);
    router.refresh();
    return true;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    await saveNow();
    setPending(false);
  }

  function markDirty() {
    if (isDirty) return;
    setIsDirty(true);
    setDirty(true, saveNow);
  }

  // Real browser exits (refresh, close tab, typing a new URL) — Next's
  // client-side router navigation never fires this, so it doesn't overlap
  // with the sidebar/logout guard above.
  useEffect(() => {
    if (!isDirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Browser Back/Forward inside the app: Next never fully unloads the page
  // for these, so beforeunload can't catch them. Trap the back navigation
  // with a sentinel history entry, then run it through the same guard.
  useEffect(() => {
    if (!isDirty) return;
    history.pushState(null, "", location.href);
    function onPopState() {
      history.pushState(null, "", location.href);
      guard(() => {
        window.removeEventListener("popstate", onPopState);
        history.back();
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isDirty, guard]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={markDirty} className="flex max-w-lg flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Datos del negocio</h2>

        <div className="flex flex-col gap-2">
          <Label>Logo del negocio (opcional)</Label>
          <LogoUploader
            ownerId={owner.id}
            initialPreviewUrl={logoUrl}
            value={logoPath}
            onChange={setLogoPath}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="business_name">Nombre del negocio</Label>
          <Input id="business_name" name="business_name" defaultValue={owner.business_name} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="first_name">Nombre</Label>
            <Input id="first_name" name="first_name" defaultValue={owner.first_name ?? ""} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="last_name">Apellido</Label>
            <Input id="last_name" name="last_name" defaultValue={owner.last_name ?? ""} required />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <WhatsappInput id="whatsapp" name="whatsapp" defaultValue={owner.whatsapp} />
        </div>

        <div className="flex flex-col gap-2">
          <Label>País</Label>
          <Select disabled value={country}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CO">Colombia (COP)</SelectItem>
              <SelectItem value="VE">Venezuela (Bs)</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="country" value={country} readOnly />
          <p className="text-xs text-muted-foreground">
            Para cambiar el país de tu negocio, contáctanos.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="address">Dirección del negocio (opcional)</Label>
          <Input id="address" name="address" defaultValue={owner.address ?? ""} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="tax_id">NIT/RUT (opcional)</Label>
          <Input id="tax_id" name="tax_id" defaultValue={owner.tax_id ?? ""} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="payment_info">Método de pago (opcional)</Label>
          <FormattedTextarea
            id="payment_info"
            name="payment_info"
            defaultValue={owner.payment_info}
            placeholder="Ej: **Nequi:** 300 123 4567"
          />
          <p className="text-xs text-muted-foreground">Se muestra a tus clientes en su saldo.</p>
        </div>
      </section>

      {country === "VE" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Tasa de cambio</h2>

          <div className="flex flex-col gap-2">
            <Label>Tasa de cambio</Label>
            {/* Locked to BCV_AUTO — owners can't set their own rate right
                now, so both options render disabled instead of hiding the
                choice entirely. */}
            <RadioGroup disabled value="BCV_AUTO">
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

          <ExchangeRateLegalDisclaimer />
        </section>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}
