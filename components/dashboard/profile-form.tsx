"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WhatsappInput } from "@/components/whatsapp-input";
import { LogoUploader } from "@/components/dashboard/logo-uploader";
import { FormattedTextarea } from "@/components/dashboard/formatted-textarea";
import { updateProfile, type ProfileState } from "@/app/(app)/profile/actions";
import type { Owner } from "@/lib/types";

const initialState: ProfileState = { error: null, success: false };

export function ProfileForm({ owner, logoUrl }: { owner: Owner; logoUrl: string | null }) {
  const router = useRouter();
  const [logoPath, setLogoPath] = useState<string | null>(owner.logo_path);
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success("Perfil actualizado");
      router.refresh();
    }
  }, [state, pending, router]);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
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

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}
