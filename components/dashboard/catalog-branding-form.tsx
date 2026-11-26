"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CatalogBrandHeader } from "@/components/public/catalog-brand-header";
import { createClient } from "@/lib/supabase/client";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { fileToResizedBlob } from "@/lib/image";
import { BRAND_DEFAULT, normalizeHex } from "@/lib/catalog/brand-color";
import { DESCRIPTION_MAX, WELCOME_MAX, checkDescription, checkWelcome } from "@/lib/catalog/welcome";
import { saveCatalogBranding } from "@/app/(app)/productos/personalizar/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LinkKindIcon } from "@/components/icons/social";
import { CatalogContactButtons } from "@/components/public/catalog-contact-buttons";
import {
  LINK_KINDS,
  LINK_KIND_LABEL,
  LINK_KIND_PLACEHOLDER,
  LINK_MAX,
  catalogWhatsappHref,
  checkExtraLink,
  isLinkKind,
  type LinkKind,
} from "@/lib/catalog/extra-link";

// «PERSONALIZAR CATÁLOGO» (CT-170, phase 1). Frames, read with `get_design_context` on
// 2026-11-15 and approved by the owner on 2026-11-12: `2115:21868` (phone), `2115:21921`
// (phone, the colour adjusted and the notice) and `2115:21966` (web, 1280).
//
// Field by field, as drawn: «Color de tu marca», «Portada», «Mensaje de bienvenida»,
// «Dirección» and «Logo», then «Guardar cambios» and «Ver cómo queda». On the web the form
// is 560px wide and the two buttons sit in a row, «Ver cómo queda» first.
//
// NOT IN THE FRAMES, built and said in the report: the cover once uploaded (its preview
// with «Cambiar portada» and «Quitar portada»), a business with no address yet (the
// checkbox off and disabled), clearing the colour (emptying the field), and what «Ver cómo
// queda» opens -- a sheet with the catalogue's header drawn from what is in the form, saved
// or not (owner's choice of 2026-11-15, «Lo que estoy editando»).
//
// Entered from the ⋮ menu of Catálogo (owner's choice of 2026-11-15, «Dentro del menú ⋮»).
//
// REVISED THE SAME DAY with frame `2163:955`: «Portada, color (no se aplica), bienvenida,
// descripción de la marca (nuevo) y dirección». Two changes here:
//   - THE COLOUR IS STORED AS PICKED and paints nothing yet, so the «ajustamos tu color»
//     notice (node `2115:21880`) is gone: adjusting a colour nobody sees would only change
//     the owner's real brand colour. Its hint now says it does not change the catalogue.
//   - «Descripción de tu marca», new: «solo lo ve el dueño, no lo ve el cliente, servirá
//     para generación de creación de contenido de marketing». 500 characters, line breaks,
//     no links. Placed under the colour, the other private field; no frame draws it, so
//     its place and its two lines of copy are mine and said in the report.
//
// REVISED ON 2026-11-18, at the owner's request: «Debajo de la dirección agrega el check para
// mostrar dirección en catálogo y elimínala de la sección de personalizar el catálogo». The
// whole «Dirección» block left this screen, his choice that day («Quitar el bloque entero»):
// the address and its box live in Mi negocio now, which also links here. «Ver cómo queda»
// still shows the address when the saved box says so. And the back row became
// `ScreenBackRow`, icon only, the Notificaciones header (his words: «debe ser mismo estilo
// del header de notificaciones, solo icon y sin texto»), back to where the owner came from.

type Props = {
  ownerId: string;
  businessName: string;
  logoPath: string | null;
  address: string | null;
  brandColor: string | null;
  coverPath: string | null;
  welcome: string | null;
  description: string | null;
  // The SAVED value; it is set in Mi negocio since 2026-11-18. Only the preview reads it.
  showAddress: boolean;
  // Migration 225. `whatsapp` is the number in Mi negocio; the box needs one to turn on.
  whatsapp: string | null;
  showWhatsapp: boolean;
  linkKind: string | null;
  linkUrl: string | null;
  // Where the back arrow goes: Mi negocio when entered from there, Catálogo otherwise.
  backHref: string;
  backLabel: string;
};

// «MC» for «Mini abasto El Chino», as the frame draws a business with no logo yet: the
// first letter of the first and of the last word.
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function CatalogBrandingForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [colorText, setColorText] = useState(props.brandColor ?? "");
  const [coverPath, setCoverPath] = useState<string | null>(props.coverPath);
  const [coverPreview, setCoverPreview] = useState<string | null>(
    props.coverPath ? getPublicLogoUrl(props.coverPath) : null,
  );
  const [uploading, setUploading] = useState(false);
  const [welcome, setWelcome] = useState(props.welcome ?? "");
  const [description, setDescription] = useState(props.description ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showWhatsapp, setShowWhatsapp] = useState(props.showWhatsapp);
  const [linkKind, setLinkKind] = useState<LinkKind | null>(isLinkKind(props.linkKind) ? props.linkKind : null);
  const [linkUrl, setLinkUrl] = useState(props.linkUrl ?? "");
  // The link's error shows once the owner leaves the field (or taps a disabled «Guardar»,
  // which blurs it): «empieza con https://» under the first letter he types is noise.
  const [linkTouched, setLinkTouched] = useState(false);

  const chosen = normalizeHex(colorText);
  const colorInvalid = colorText.trim() !== "" && !chosen;
  const swatch = chosen ?? BRAND_DEFAULT;
  const welcomeCheck = checkWelcome(welcome);
  const welcomeLength = [...welcome].length;
  const descriptionCheck = checkDescription(description);
  const descriptionLength = [...description].length;
  const shownAddress = props.showAddress && props.address?.trim() ? props.address : null;
  const whatsappHref = catalogWhatsappHref(props.whatsapp);
  const linkCheck = checkExtraLink(linkKind, linkUrl);

  // An upload nobody saved, about to be replaced or dropped: nothing will ever point at it.
  // Best effort -- failing to remove it costs a few KB, and the nightly cleanup takes it.
  function discardPendingUpload() {
    if (coverPath && coverPath !== props.coverPath) {
      void createClient().storage.from("logos").remove([coverPath]);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
      const path = `${props.ownerId}/cover-${Date.now()}.jpg`;
      const { error } = await createClient()
        .storage.from("logos")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      discardPendingUpload();
      setCoverPath(path);
      setCoverPreview(URL.createObjectURL(blob));
    } catch (error) {
      console.error("[catalog-branding] cover upload", error);
      toast.error("No pudimos subir la portada. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeCover() {
    discardPendingUpload();
    setCoverPath(null);
    setCoverPreview(null);
  }

  function save() {
    if (colorInvalid || !welcomeCheck.ok || !descriptionCheck.ok || !linkCheck.ok) return;
    startTransition(async () => {
      const result = await saveCatalogBranding({
        brandColor: chosen,
        coverPath,
        welcome,
        description,
        showWhatsapp: showWhatsapp && Boolean(whatsappHref),
        linkKind,
        linkUrl,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.appliedColor) setColorText(result.appliedColor);
      // An emptied field saves «no link»; the selector follows so it does not keep a label.
      if (!linkUrl.trim()) setLinkKind(null);
      toast.success("Tu catálogo quedó actualizado.");
      router.refresh();
    });
  }

  const logoUrl = props.logoPath ? getPublicLogoUrl(props.logoPath) : null;

  return (
    <div className="flex min-h-full flex-col">
      {/* ── TÍTULO, nodes `2115:21826` / `2115:21924` ─────────────────────── */}
      <ScreenBackRow href={props.backHref} label={props.backLabel} soloEnTelefono={false} />
      <div className="flex flex-col gap-1 pt-4 pb-2">
        <h1 className="text-2xl leading-[35px] font-semibold">Personalizar catálogo</h1>
        <p className="text-sm leading-5 text-muted-foreground md:max-w-[560px]">
          Así te ven tus clientes cuando abren tu catálogo.
        </p>
      </div>

      <div className="flex flex-col gap-6 py-4 md:max-w-[560px]">
        {/* ── COLOR DE TU MARCA, nodes `2115:21835` / `2115:21888` ──────────── */}
        <div className="flex flex-col gap-2">
          <label htmlFor="brand-color-text" className="text-sm leading-5 font-medium">
            Color de tu marca
          </label>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3 rounded-[10px] border bg-background px-3 py-2">
              {/* The swatch IS the native colour picker: a transparent input on top of it,
                  so a tap opens the phone's own picker. */}
              <span className="relative size-7 shrink-0 overflow-hidden rounded-[6px]" style={{ backgroundColor: swatch }}>
                <input
                  type="color"
                  aria-label="Elegir el color de tu marca"
                  value={swatch.toLowerCase()}
                  onChange={(e) => setColorText(e.target.value.toUpperCase())}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </span>
              <input
                id="brand-color-text"
                value={colorText}
                onChange={(e) => setColorText(e.target.value)}
                placeholder={BRAND_DEFAULT}
                inputMode="text"
                autoCapitalize="characters"
                maxLength={7}
                className="min-w-0 flex-1 bg-transparent text-base leading-[22px] outline-none placeholder:text-muted-foreground md:text-[15px]"
              />
            </div>
            {colorInvalid ? (
              <p className="text-xs leading-[17px] text-destructive">Escribe el color como #RRGGBB, por ejemplo #043F01.</p>
            ) : null}
          </div>
          <p className="text-xs leading-[17px] text-muted-foreground">
            Lo guardamos como el color de tu marca. Por ahora no cambia cómo se ve tu catálogo.
          </p>
        </div>

        {/* ── DESCRIPCIÓN DE TU MARCA, private, not in any frame (see the header) ─ */}
        <div className="flex flex-col gap-2">
          <label htmlFor="brand-description" className="text-sm leading-5 font-medium">
            Descripción de tu marca
          </label>
          <div className="flex flex-col gap-1.5 rounded-[10px] border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring/50">
            <textarea
              id="brand-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={DESCRIPTION_MAX + 50}
              placeholder="Qué vendes, a quién y qué hace distinto a tu negocio"
              className="w-full resize-y bg-transparent text-base leading-[22px] outline-none placeholder:text-muted-foreground md:text-[15px]"
            />
            <span
              className={`text-right text-xs leading-[17px] ${descriptionLength > DESCRIPTION_MAX ? "text-destructive" : "text-muted-foreground"}`}
            >
              {descriptionLength}/{DESCRIPTION_MAX}
            </span>
          </div>
          {!descriptionCheck.ok ? <p className="text-xs leading-[17px] text-destructive">{descriptionCheck.error}</p> : null}
          <p className="text-xs leading-[17px] text-muted-foreground">Solo la ves tú. Tus clientes no la ven.</p>
        </div>

        {/* ── PORTADA, nodes `2115:21840` / `2115:21893` ───────────────────── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-5 font-medium">Portada</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          {coverPreview ? (
            <div className="flex flex-col gap-2">
              <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[10px] border bg-muted">
                <Image src={coverPreview} alt="Portada de tu catálogo" fill unoptimized sizes="560px" className="object-cover" />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? "Subiendo…" : "Cambiar portada"}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={removeCover}>
                  Quitar portada
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center rounded-[10px] border border-dashed border-neutral-300 bg-neutral-50 px-4 py-7 text-sm leading-5 font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              {uploading ? "Subiendo…" : "Subir portada"}
            </button>
          )}
          <p className="text-xs leading-[17px] text-muted-foreground">Imagen horizontal, de 1200 × 400 px o más. JPG o PNG.</p>
        </div>

        {/* ── MENSAJE DE BIENVENIDA, nodes `2115:21846` / `2115:21899` ───────── */}
        <div className="flex flex-col gap-2">
          <label htmlFor="catalog-welcome" className="text-sm leading-5 font-medium">
            Mensaje de bienvenida
          </label>
          <div className="flex flex-col gap-1.5 rounded-[10px] border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring/50">
            <textarea
              id="catalog-welcome"
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              rows={3}
              maxLength={WELCOME_MAX + 20}
              placeholder="Escribe un saludo para tus clientes"
              className="w-full resize-none bg-transparent text-base leading-[22px] outline-none placeholder:text-muted-foreground md:text-[15px]"
            />
            <span
              className={`text-right text-xs leading-[17px] ${welcomeLength > WELCOME_MAX ? "text-destructive" : "text-muted-foreground"}`}
            >
              {welcomeLength}/{WELCOME_MAX}
            </span>
          </div>
          {!welcomeCheck.ok ? <p className="text-xs leading-[17px] text-destructive">{welcomeCheck.error}</p> : null}
        </div>

        {/* ── BOTÓN DE WHATSAPP, migration 225, frames `2291:25171` to `2291:25293` ───
            OFF by default (owner's answer of 2026-11-26, «Sí apagada»). Disabled with no
            number in Mi negocio: a ticked box would publish a button that opens nothing. */}
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-5 font-medium">Botón de WhatsApp</span>
          <label className="flex items-start gap-2.5 rounded-[8px] border bg-background p-3 text-sm leading-5 has-[button:disabled]:opacity-60">
            <Checkbox
              className="mt-0.5"
              checked={showWhatsapp && Boolean(whatsappHref)}
              disabled={!whatsappHref}
              onCheckedChange={(v) => setShowWhatsapp(v === true)}
            />
            Mostrar «Contactar vía WhatsApp» en mi catálogo
          </label>
          {whatsappHref ? (
            <p className="text-xs leading-[17px] text-muted-foreground">
              Tus clientes te escriben al número de Mi negocio: {props.whatsapp}.
            </p>
          ) : (
            <p className="text-xs leading-[17px] text-muted-foreground">
              <Link href="/profile" className="underline underline-offset-2">
                Agrega tu número de WhatsApp en Mi negocio
              </Link>{" "}
              para mostrar el botón.
            </p>
          )}
        </div>

        {/* ── ENLACE ADICIONAL, migration 225, frames `2291:25171` to `2293:25491` ───
            The label is chosen, never typed (owner's answer of 2026-11-26); the rule that
            the link matches it is `lib/catalog/extra-link.ts`. Empty field = no button. */}
        <div className="flex flex-col gap-2">
          <label htmlFor="catalog-link-url" className="text-sm leading-5 font-medium">
            Enlace adicional
          </label>
          <Select value={linkKind ?? ""} onValueChange={(v) => setLinkKind(isLinkKind(v) ? v : null)}>
            <SelectTrigger
              aria-label="Qué enlace es"
              className="h-10 w-full rounded-[10px] bg-background px-3 text-base data-[size=default]:h-10 md:text-[15px] [&_svg:not([class*='size-'])]:size-[18px]"
            >
              <SelectValue placeholder="Elige qué enlace es" />
            </SelectTrigger>
            {/* `popper`: bounded under its trigger (DESIGN-SYSTEM.md, unbounded popovers). */}
            <SelectContent position="popper">
              {LINK_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  <LinkKindIcon kind={kind} className="size-[18px]" />
                  {LINK_KIND_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            id="catalog-link-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onBlur={() => setLinkTouched(true)}
            maxLength={LINK_MAX + 50}
            placeholder={linkKind ? LINK_KIND_PLACEHOLDER[linkKind] : "https://"}
            aria-invalid={linkTouched && !linkCheck.ok}
            className="h-10 w-full rounded-[10px] border bg-background px-3 text-base leading-[22px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-[15px]"
          />
          {linkTouched && !linkCheck.ok ? (
            <p className="text-xs leading-[17px] text-destructive">{linkCheck.error}</p>
          ) : null}
          <p className="text-xs leading-[17px] text-muted-foreground">
            Sale como un botón en tu catálogo, debajo de tu nombre, con el nombre y el icono que elijas. Opcional.
          </p>
        </div>

        {/* ── LOGO, nodes `2115:21861` / `2115:21914` ──────────────────────── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-5 font-medium">Logo</span>
          <div className="flex items-center gap-3">
            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-base leading-[23px] font-bold">
              {logoUrl ? (
                <Image src={logoUrl} alt="Logo de tu negocio" fill unoptimized sizes="48px" className="object-cover" />
              ) : (
                initials(props.businessName)
              )}
            </span>
            <Link href="/profile" className="text-[13px] leading-[19px] text-muted-foreground hover:underline">
              Se cambia en Mi negocio
            </Link>
          </div>
        </div>
      </div>

      {/* ── BOTONES, nodes `2115:21863` / `2115:21961` ─────────────────────── */}
      <StickyActions>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-end">
          <Button
            type="button"
            className="h-10 w-full md:w-[180px]"
            disabled={pending || uploading || colorInvalid || !welcomeCheck.ok || !descriptionCheck.ok || !linkCheck.ok}
            onClick={save}
          >
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full md:w-[160px]"
            disabled={colorInvalid}
            onClick={() => setPreviewOpen(true)}
          >
            Ver cómo queda
          </Button>
        </div>
      </StickyActions>

      {/* ── VER CÓMO QUEDA: the catalogue's own header, from the form ────────── */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-3xl p-0">
          <SheetTitle className="px-4 pt-4 pb-3 text-base font-medium">Así lo verán tus clientes</SheetTitle>
          <div>
            <CatalogBrandHeader
              logoUrl={logoUrl ?? "/fav-icon-primary.svg"}
              logoIsRemote={Boolean(logoUrl)}
              title={props.businessName || "Catálogo"}
              coverUrl={coverPreview}
              welcome={welcomeCheck.ok ? welcomeCheck.text : null}
              address={shownAddress}
              actions={
                <CatalogContactButtons
                  whatsappHref={showWhatsapp ? whatsappHref : null}
                  linkKind={linkKind}
                  linkUrl={linkCheck.ok ? linkCheck.url : null}
                  tone="light"
                />
              }
            />
          </div>
          <p className="px-4 py-4 text-xs leading-[17px] text-muted-foreground">
            Todavía no está guardado. Toca «Guardar cambios» para que tus clientes lo vean.
          </p>
        </SheetContent>
      </Sheet>
    </div>
  );
}
