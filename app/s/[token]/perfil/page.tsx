import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { SetupNotice } from "@/components/setup-notice";
import { ClientProfilePictureUploader } from "@/components/public/client-profile-picture-uploader";
import { formatDocumentId } from "@/lib/format";

type SharedClientProfile = {
  business_name: string;
  owner_logo_path: string | null;
  client_name: string;
  document_id: string | null;
  whatsapp: string | null;
  address: string | null;
  profile_picture_path: string | null;
};

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_client_profile", { p_token: token });

  if (error || !data) {
    notFound();
  }

  const profile = data as SharedClientProfile;
  const logoUrl = profile.owner_logo_path ? getPublicLogoUrl(profile.owner_logo_path) : "/icon.svg";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <Link
        href={`/s/${token}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Volver al saldo
      </Link>

      <div className="flex items-center gap-3">
        <Image
          src={logoUrl}
          alt=""
          width={32}
          height={32}
          unoptimized={Boolean(profile.owner_logo_path)}
          className="size-8 shrink-0 rounded-md object-cover"
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mi perfil</h1>
          <p className="text-sm text-muted-foreground">{profile.business_name}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <ClientProfilePictureUploader token={token} initialPath={profile.profile_picture_path} />

        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Nombre</dt>
            <dd className="font-medium">{profile.client_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cédula/documento</dt>
            <dd className="font-medium">{formatDocumentId(profile.document_id)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">WhatsApp</dt>
            <dd className="font-medium">{profile.whatsapp || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dirección</dt>
            <dd className="font-medium">{profile.address || "—"}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Estos datos los administra {profile.business_name} — solo puedes actualizar tu foto de
          perfil desde aquí.
        </p>
      </div>
    </div>
  );
}
