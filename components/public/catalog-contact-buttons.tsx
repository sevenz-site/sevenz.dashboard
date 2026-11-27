import { cn } from "@/lib/utils";
import { LinkKindIcon } from "@/components/icons/social";
import { ContactWhatsappLink } from "@/components/public/contact-whatsapp-link";
import { PUBLIC_CONTACT_BUTTON, PUBLIC_CONTACT_TONE } from "@/components/public/contact-button-styles";
import { LINK_KIND_LABEL, checkExtraLink } from "@/lib/catalog/extra-link";

// THE CATALOGUE'S TWO CONTACT BUTTONS (migration 225), frames `2291:25034`: «Contactar vía
// WhatsApp» and the extra link, in the catalogue's header only (owner's answer of
// 2026-11-26, «Solo en la cabecera del catálogo»).
//
// ONE COMPONENT FOR BOTH HEADERS: the white one of a customised catalogue
// (`CatalogBrandHeader`, frames 1, 2 and 4) and the dark one of a catalogue nobody
// customised (`PublicHeader`, frame 3). Turning the box on does not count as customising:
// `hasCatalogBranding` is unchanged, so a business that only wants the button keeps the
// header it had. The owner's «Ver cómo queda» draws it too, from the form.
//
// Stacked on a phone, in a row from `md` inside the header's 560px text column (frame 4).
//
// THE LINK IS CHECKED AGAIN HERE, with the rule the owner's screen and the server action
// use: a row written before a rule tightened, or edited by hand, draws no button rather
// than a button whose label lies about where it goes.
//
// The label and the icon are the app's, from the kind the owner picked: he never types the
// text, so the button cannot be made to say «Paga aquí».
export function CatalogContactButtons({
  whatsappHref,
  linkKind,
  linkUrl,
  tone,
  catalogToken,
}: {
  // The public catalogue passes its token so a tap on «Contactar vía WhatsApp» is
  // measured (`catalog_whatsapp_tapped`). The owner's preview passes none: nothing is sent.
  catalogToken?: string;
  // Already decided by the caller: null when the box is off or there is no number.
  whatsappHref: string | null;
  linkKind: string | null | undefined;
  linkUrl: string | null | undefined;
  tone: "dark" | "light";
}) {
  const checked = linkUrl ? checkExtraLink(linkKind, linkUrl) : null;
  const link = checked?.ok && checked.kind && checked.url ? { kind: checked.kind, url: checked.url } : null;
  if (!whatsappHref && !link) return null;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2 md:flex-row md:gap-3">
      {whatsappHref ? (
        <ContactWhatsappLink href={whatsappHref} catalogToken={catalogToken} tone={tone} className="md:flex-1" />
      ) : null}
      {link ? (
        <a
          href={link.url}
          target="_blank"
          // `nofollow`: a link on Sevenz's domain is not Sevenz recommending the site.
          rel="noopener noreferrer nofollow"
          className={cn(
            PUBLIC_CONTACT_BUTTON,
            PUBLIC_CONTACT_TONE[tone],
            tone === "dark" ? "text-white" : "text-foreground",
            "md:flex-1",
          )}
        >
          {LINK_KIND_LABEL[link.kind]}
          {/* After the text, like the WhatsApp button beside it. */}
          <LinkKindIcon kind={link.kind} className="size-5 shrink-0" />
        </a>
      ) : null}
    </div>
  );
}
