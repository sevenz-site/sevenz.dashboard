"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NotificacionesAccordion } from "@/components/dashboard/notificaciones-accordion";
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
import { PaymentMethodsCard } from "@/components/dashboard/payment-methods-card";
import { ChangePasswordDialog } from "@/components/dashboard/change-password-dialog";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { updateBusinessSettings, type PaymentMethod, type ProfileState } from "@/app/(app)/profile/actions";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { useTrampaDeAtras } from "@/hooks/use-trampa-de-atras";
import type { Owner } from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required, whatsapp as whatsappRule } from "@/lib/form-validation";

const initialState: ProfileState = { error: null, success: false };

// The submit button lives in the sticky footer, outside the <form>, and
// reaches it through the `form` attribute.
const FORM_ID = "business-settings-form";

// "Mi negocio", frame `1928:24764` (2026-11-02).
//
// ONLY THE FIELDS ARE INSIDE THE <form>. Payment methods, notifications and
// the password card each save on their own, and React bubbles events through
// portals: a dialog rendered from inside the form marks it dirty on every
// keystroke (the form listens to onChange) and its submit reaches the form's
// own handler. Keeping them outside is what keeps the unsaved-changes guard
// meaning "the fields above".
export function BusinessSettingsForm({
  owner,
  logoUrl,
  paymentMethods,
}: {
  owner: Owner;
  logoUrl: string | null;
  paymentMethods: PaymentMethod[];
}) {
  const router = useRouter();
  const [formRef, setFormRef] = useFormRef();
  const [logoPath, setLogoPath] = useState<string | null>(owner.logo_path);
  // País and the exchange-rate mode aren't user-editable — see the note
  // by the "País" field below — so these never change after mount.
  const country = owner.country;
  const { setDirty, guard } = useUnsavedChangesGuard();
  const [isDirty, setIsDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, validate, recheck } = useFieldErrors({
    business_name: required,
    first_name: required,
    last_name: required,
    whatsapp: whatsappRule,
  });

  // Shared by both save paths: the button's own submit and "Guardar y salir"
  // from the unsaved-changes dialog. Calls the server action directly (not
  // through useActionState) so both callers can await the same result. The
  // validate() call here (rather than only in handleSubmit) is what makes
  // "Guardar y salir" from the unsaved-changes dialog check these same
  // fields too, instead of only the button's own click.
  async function saveNow(): Promise<boolean> {
    if (!formRef.current) return false;
    if (!validate(formRef.current)) return false;
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
    setDirty(true, saveNow, consumeSentinelIfAny);
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

  // La trampa del botón atrás vive ahora en useTrampaDeAtras: la necesita
  // también la revisión de una libreta importada, y el fallo del centinela
  // abandonado —el que documenta ese hook— no debe poder repetirse en dos
  // sitios por separado. Se sacó tal cual, sin cambiar la lógica.
  const consumeSentinelIfAny = useTrampaDeAtras(isDirty, guard);

  return (
    <div className="flex max-w-lg flex-1 flex-col gap-4">
      <form id={FORM_ID} ref={setFormRef} onSubmit={handleSubmit} onChange={markDirty} className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Datos del negocio</h2>

        <div className="flex flex-col gap-4">
          <Label>Logo del negocio (opcional)</Label>
          {/* A logo change is a pending change like any field's: it marks the
              form dirty and is applied by "Guardar cambios" (see LogoUploader).
              Deleting fires no change event, so the dirty mark is explicit. */}
          <LogoUploader
            ownerId={owner.id}
            savedPath={owner.logo_path}
            initialPreviewUrl={logoUrl}
            value={logoPath}
            onChange={(path) => {
              setLogoPath(path);
              markDirty();
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="business_name">Nombre del negocio</Label>
          <Input
            id="business_name"
            name="business_name"
            defaultValue={owner.business_name}
            required
            aria-invalid={Boolean(errors.business_name)}
            onChange={() => recheck("business_name", formRef.current)}
          />
          {errors.business_name ? (
            <p className="text-xs text-destructive">{errors.business_name}</p>
          ) : null}
        </div>

        {/* One under the other since 2026-11-02 (frame `1927:24236`/`24246`);
            side by side, two halves of 375px cut long surnames. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="first_name">Nombres del dueño</Label>
          <Input
            id="first_name"
            name="first_name"
            defaultValue={owner.first_name ?? ""}
            required
            aria-invalid={Boolean(errors.first_name)}
            onChange={() => recheck("first_name", formRef.current)}
          />
          {errors.first_name ? <p className="text-xs text-destructive">{errors.first_name}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="last_name">Apellidos del dueño</Label>
          <Input
            id="last_name"
            name="last_name"
            defaultValue={owner.last_name ?? ""}
            required
            aria-invalid={Boolean(errors.last_name)}
            onChange={() => recheck("last_name", formRef.current)}
          />
          {errors.last_name ? <p className="text-xs text-destructive">{errors.last_name}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <WhatsappInput
            id="whatsapp"
            name="whatsapp"
            defaultValue={owner.whatsapp}
            required
            preferredDialCode={OWNER_COUNTRY_DIAL_CODE[owner.country]}
            invalid={Boolean(errors.whatsapp)}
            onValueChange={() => recheck("whatsapp", formRef.current)}
          />
          {errors.whatsapp ? <p className="text-xs text-destructive">{errors.whatsapp}</p> : null}
        </div>

        {/* El correo con el que entra, en gris y sin poder tocarlo.
            Está por la misma razón que País: es un dato que el dueño necesita
            ver —saber con cuál de sus correos entró— y que no puede cambiar
            desde aquí. Cambiarlo mueve su forma de entrar y de recuperar la
            contraseña, así que pasa por soporte.

            Sin `name`, a propósito: un campo deshabilitado no se envía, y
            listarlo solo invitaría a que alguien intentara guardarlo. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Correo</Label>
          <Input id="email" type="email" value={owner.email} disabled readOnly />
          <p className="mt-2 text-sm text-muted-foreground">
            Es el correo con el que entras a Sevenz. Para cambiarlo, escríbenos.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>País</Label>
          <Select disabled value={country}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CO">Colombia (COP)</SelectItem>
              <SelectItem value="VE">Venezuela (Bs.)</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="country" value={country} readOnly />
          <p className="mt-2 text-sm text-muted-foreground">
            Para cambiar el país de tu negocio, contáctanos.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="address">Dirección de negocio (opcional)</Label>
          <Input id="address" name="address" defaultValue={owner.address ?? ""} placeholder="Escribe dirección" />
        </div>

        <div className="flex flex-col gap-2">
          {/* Lowercase "(opcional)" like every other optional field; the frame
              says "(Opcional)". Owner's decision, 2026-11-02. */}
          <Label htmlFor="tax_id">RIF/NIT (opcional)</Label>
          <Input id="tax_id" name="tax_id" defaultValue={owner.tax_id ?? ""} placeholder="Escribe RIF o NIT" />
        </div>
      </form>

      <PaymentMethodsCard initialMethods={paymentMethods} />

      {/* Not drawn in the frame, kept by the owner's decision on 2026-11-02
          («Mantenerla»): it can't be changed, but it is where a Venezuelan
          owner reads which rate the app uses and its legal note. */}
      {country === "VE" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Tasa de cambio</h2>

          <div className="flex flex-col gap-2">
            <Label>Tasa de cambio</Label>
            {/* Locked to BCV_AUTO — owners can't set their own rate right
                now. "Mi propia tasa" is hidden entirely rather than shown
                disabled, since offering a choice that can never be picked
                is more confusing than just not showing it. */}
            <RadioGroup disabled value="BCV_AUTO">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="BCV_AUTO" />
                Tasa BCV automática
              </label>
            </RadioGroup>
          </div>

          <ExchangeRateLegalDisclaimer />
        </section>
      ) : null}

      {/* Su interruptor guarda solo, por su cuenta, porque registra un
          consentimiento con su fecha y no puede reescribirse cada vez que el
          dueño corrija su dirección. */}
      <NotificacionesAccordion owner={owner} />

      <section className="flex items-start gap-2 rounded-[10px] border p-4">
        <p className="flex-1 text-sm">Contraseña</p>
        <ChangePasswordDialog />
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Pinned to the bottom (owner's choice, 2026-11-02): the screen runs
          about 1.500px and the button used to wait at the very end of it. */}
      <StickyActions>
        <Button type="submit" form={FORM_ID} disabled={pending} className="h-10 w-full text-base font-semibold">
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </StickyActions>
    </div>
  );
}
