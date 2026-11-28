"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StepProgress } from "@/components/dashboard/step-progress";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { createClient } from "@/lib/supabase/client";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { fileToResizedBlob } from "@/lib/image";
import { formatPriceAmount } from "@/lib/products/price";
import { applyPromotion } from "@/lib/promotions/pricing";
import { checkPromotion, countOf, dayLabel, groupLine, type PromotionInput } from "@/lib/promotions/rules";
import type { PromoProduct, PromotionRow } from "@/lib/promotions/load";
import { savePromotion } from "@/app/(app)/productos/promociones/actions";

// «CREAR PROMOCIÓN» IN FOUR STEPS (CT-184), frames 3 to 8, 3b and 17 of section
// `2300:21627`, approved by the owner on 2026-11-27. Read with the frames' own copy.
//
//   1/3 Datos: name, banner (optional), start and close (the business's days), and the
//       optional extension («Extender la promoción»).
//   2/3 Descuentos: one % per group of products; a product is in one group only. Adjusted by
//       the owner on 2026-11-28 (frames 4 and 17 re-approved that day):
//       - the % discounts the retail AND the wholesale price; the checkbox «Aplicar descuento
//         diferente a precios al mayor» opens a second % for the wholesale price, empty meaning
//         the same one (migration 230). It replaced 228's per-promotion switch «Rebajar también
//         el precio al mayor», off by default, which made 6 sacks dearer than 5.
//       - «Todos los productos» is a checkbox (it was a two-way selector); unticked, the group
//         shows «+ Agregar productos» and, once it has products, «Cambiar productos» as well --
//         both, as the owner drew them («Los dos, como dibujé»).
//   (3/4 Código was here until 2026-11-28: the owner took the discount code out of this
//   release -- «omitamos el código de descuento, eliminalo de este lanzamiento, más adelante
//   lo retomamos». Its decisions, to resume from, are in lib/promotions/rules.ts.)
//   3/3 Resumen, with the warning of products below their cost: a warning, never a block
//       (owner's decision: «el dueño decide»). And, since 2026-11-28, a second warning when a
//       product's discounted wholesale price ends up dearer than its discounted retail: also
//       only a warning («Solo avisa»), the customer then pays the wholesale price.
//
// The header is the app's own -- back row, `ScreenTitle`, `StepProgress` -- like «Nueva venta»
// (frames adjusted by the owner on 2026-11-28: «los headers no corresponden al resto del app»).
//
// Nothing is saved until the last step: the whole promotion goes in one call
// (`savePromotion` -> `save_promotion`), so a half-made one never reaches the catalogue.
//
// BELOW COST is only judged when the cost is in the price's currency: converting would need a
// rate, and a warning built on today's rate about a price the owner typed is a guess. Said in
// the report as a known gap.

type GroupState = {
  key: string;
  percent: string;
  // «Aplicar descuento diferente a precios al mayor» and its %; empty = the same as `percent`.
  differentWholesale: boolean;
  wholesalePercent: string;
  allProducts: boolean;
  productIds: string[];
};

// Three steps since 2026-11-28: the discount code (step «Código») left this release by the
// owner's decision -- see the note on the code in lib/promotions/rules.ts.
const STEP_LABEL = ["Datos", "Descuentos", "Resumen"];
const STEPS = STEP_LABEL.length;

type Props = {
  ownerId: string;
  today: string;
  initial: PromotionRow | null;
  products: PromoProduct[];
  categories: { id: string; name: string }[];
};

let keySeq = 0;
const newKey = () => `g${++keySeq}`;

export function PromotionWizard({ ownerId, today, initial, products, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);

  // 1/4
  const [name, setName] = useState(initial?.name ?? "");
  const [bannerPath, setBannerPath] = useState<string | null>(initial?.bannerPath ?? null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(initial?.bannerPath ? getPublicLogoUrl(initial.bannerPath) : null);
  const [uploading, setUploading] = useState(false);
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? today);
  const [extend, setExtend] = useState(Boolean(initial?.extendedUntil));
  const [extendedUntil, setExtendedUntil] = useState(initial?.extendedUntil ?? "");
  // 2/4
  const [groups, setGroups] = useState<GroupState[]>(
    initial?.groups.length
      ? initial.groups.map((g) => ({
          key: newKey(),
          percent: String(g.percent),
          differentWholesale: g.wholesalePercent != null && g.wholesalePercent !== g.percent,
          wholesalePercent: g.wholesalePercent != null && g.wholesalePercent !== g.percent ? String(g.wholesalePercent) : "",
          allProducts: g.allProducts,
          productIds: g.productIds,
        }))
      : [{ key: newKey(), percent: "", differentWholesale: false, wholesalePercent: "", allProducts: true, productIds: [] }],
  );
  const [picker, setPicker] = useState<{ key: string } | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const num = (s: string) => {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  // The wholesale % sent to the server: null when the box is unticked or left empty, which
  // means «el mismo que al detal» (owner's decision of 2026-11-28).
  const wholesaleOf = (g: GroupState): number | null =>
    g.differentWholesale && g.wholesalePercent.trim() !== "" ? num(g.wholesalePercent) : null;
  // The % the wholesale price really gets, for the warnings below.
  const wholesalePct = (g: GroupState): number => wholesaleOf(g) ?? num(g.percent);

  const input: PromotionInput = {
    id: initial?.id ?? null,
    name,
    bannerPath,
    startsOn,
    endsOn,
    extendedUntil: extend ? extendedUntil || "" : null,
    groups: groups.map((g) => ({ percent: num(g.percent), wholesalePercent: wholesaleOf(g), allProducts: g.allProducts, productIds: g.productIds })),
  };

  // Which products each group really covers: a chosen group its list; «all» every published
  // product not chosen in another group, minus its exclusions.
  const chosenElsewhere = (key: string) =>
    new Set(groups.filter((g) => g.key !== key && !g.allProducts).flatMap((g) => g.productIds));
  const covered = (g: GroupState) =>
    g.allProducts
      ? products.filter((p) => !chosenElsewhere(g.key).has(p.id) && !g.productIds.includes(p.id))
      : g.productIds.map((id) => byId.get(id)).filter((p): p is PromoProduct => Boolean(p));

  // BELOW COST, for each price the promotion touches: retail with the group's %, wholesale with
  // its own (since 230 the wholesale price is discounted too, so it can fall below cost too).
  const belowCost = groups.flatMap((g) => {
    const pct = num(g.percent);
    const wpct = wholesalePct(g);
    return covered(g).flatMap((p) => {
      const out: { p: PromoProduct; pct: number; price: number; currency: NonNullable<PromoProduct["currency"]>; tier: "detal" | "mayor" }[] = [];
      if (p.cost == null) return out;
      if (pct > 0 && p.retailPrice != null && p.retailCurrency && p.costCurrency === p.retailCurrency) {
        const price = applyPromotion(p.retailPrice, pct, p.retailCurrency);
        if (price < p.cost) out.push({ p, pct, price, currency: p.retailCurrency, tier: "detal" });
      }
      if (wpct > 0 && p.wholesalePrice != null && p.wholesaleCurrency && p.costCurrency === p.wholesaleCurrency) {
        const price = applyPromotion(p.wholesalePrice, wpct, p.wholesaleCurrency);
        if (price < p.cost) out.push({ p, pct: wpct, price, currency: p.wholesaleCurrency, tier: "mayor" });
      }
      return out;
    });
  });

  // WHOLESALE DEARER THAN RETAIL after the discounts (frame 8, «Solo avisa», 2026-11-28): the
  // customer who takes enough to reach the wholesale minimum would pay more per unit. Only
  // compared when both prices are in the same currency -- across currencies it would need a
  // rate, and a warning built on today's rate about prices the owner typed is a guess.
  const dearerWholesale = groups.flatMap((g) => {
    const pct = num(g.percent);
    const wpct = wholesalePct(g);
    if (!(pct > 0)) return [];
    return covered(g)
      .filter((p) => p.retailPrice != null && p.wholesalePrice != null && p.retailCurrency && p.retailCurrency === p.wholesaleCurrency)
      .map((p) => ({
        p,
        pct,
        wpct,
        retail: applyPromotion(p.retailPrice!, pct, p.retailCurrency!),
        wholesale: applyPromotion(p.wholesalePrice!, wpct, p.retailCurrency!),
      }))
      .filter((x) => x.wholesale > x.retail);
  });
  const belowCostProducts = new Set(belowCost.map((x) => x.p.id)).size;
  const dearerSentence = (list: typeof dearerWholesale): string => {
    const byPair = new Map<string, typeof dearerWholesale>();
    for (const x of list) byPair.set(`${x.pct}|${x.wpct}`, [...(byPair.get(`${x.pct}|${x.wpct}`) ?? []), x]);
    let shown = 0;
    const parts: string[] = [];
    for (const items of byPair.values()) {
      const take = items.slice(0, Math.max(0, 3 - shown));
      if (take.length === 0) break;
      shown += take.length;
      const money = (x: (typeof items)[number]) => [formatPriceAmount(x.retail, x.p.retailCurrency!), formatPriceAmount(x.wholesale, x.p.retailCurrency!)];
      const [first, ...rest] = take;
      const [r0, w0] = money(first);
      const tail = rest.map((x) => { const [r, w] = money(x); return `, ${x.p.name} a ${r} y ${w}`; }).join("");
      parts.push(`Con el ${first.pct}% al detal y el ${first.wpct}% al mayor, ${first.p.name} sale a ${r0} al detal y a ${w0} al mayor${tail}`);
    }
    const more = list.length - shown;
    return parts.join("; ") + (more > 0 ? ` y ${more} más` : "");
  };

  const stepOf: Record<string, number> = { name: 1, dates: 1, extended: 1, banner: 1, groups: 2 };
  function validate(upTo: number): boolean {
    const c = checkPromotion(input);
    if (!c.ok && (stepOf[c.field] ?? STEPS) <= upTo) {
      setError({ field: c.field, text: c.error });
      return false;
    }
    setError(null);
    return true;
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
      const path = `${ownerId}/promo-${Date.now()}.jpg`;
      const { error: upError } = await createClient().storage.from("logos").upload(path, blob, { contentType: "image/jpeg" });
      if (upError) throw upError;
      if (bannerPath && bannerPath !== initial?.bannerPath) void createClient().storage.from("logos").remove([bannerPath]);
      setBannerPath(path);
      setBannerPreview(URL.createObjectURL(blob));
    } catch (e) {
      console.error("[promociones] banner upload", e);
      toast.error("No pudimos subir el banner. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    if (!validate(STEPS)) return;
    startTransition(async () => {
      const r = await savePromotion(input);
      if (!r.ok) {
        setError({ field: r.field, text: r.error });
        if (r.field && stepOf[r.field]) setStep(stepOf[r.field]);
        return;
      }
      toast.success(initial ? "Promoción guardada." : startsOn > today ? "Promoción programada." : "Promoción activada.");
      router.push(`/productos/promociones/${r.id}`);
    });
  }

  const next = () => {
    if (validate(step)) setStep((s) => Math.min(STEPS, s + 1));
  };
  const back = () => (step > 1 ? setStep(step - 1) : router.push(initial ? `/productos/promociones/${initial.id}` : "/productos/promociones"));

  const errorFor = (fields: string[]) =>
    error && error.field && fields.includes(error.field) ? <p className="text-xs leading-[17px] text-destructive">{error.text}</p> : null;

  const pickerGroup = picker ? groups.find((g) => g.key === picker.key) ?? null : null;
  const pickerList = products.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const toggleIn = (key: string, id: string) =>
    setGroups((gs) =>
      gs.map((g) => (g.key !== key ? g : { ...g, productIds: g.productIds.includes(id) ? g.productIds.filter((x) => x !== id) : [...g.productIds, id] })),
    );

  const saveLabel = initial ? "Guardar cambios" : startsOn > today ? "Programar promoción" : "Activar promoción";
  const fieldClass =
    "h-10 w-full rounded-[10px] border bg-background px-3 text-base leading-[22px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-[15px]";

  return (
    <div className="flex min-h-full flex-col">
      <ScreenBackRow onClick={back} label={step > 1 ? "Paso anterior" : "Volver a Promociones"} soloEnTelefono={false} />
      <div className="flex flex-col pt-4 md:max-w-[560px]">
        <ScreenTitle>{initial ? "Editar promoción" : "Crear promoción"}</ScreenTitle>
        <StepProgress step={step} total={STEPS} label={STEP_LABEL[step - 1]} />
      </div>

      <div className="flex flex-col gap-6 pb-4 md:max-w-[560px]">
        {step === 1 ? (
          <>
            <div className="flex flex-col gap-2">
              <label htmlFor="promo-name" className="text-sm leading-5 font-medium">Nombre</label>
              <input id="promo-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={70} placeholder="Ej. Black Friday" aria-invalid={error?.field === "name"} className={fieldClass} />
              {errorFor(["name"])}
              <p className="text-xs leading-[17px] text-muted-foreground">Lo ven tus clientes en el banner.</p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm leading-5 font-medium">Banner (opcional)</span>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
              {bannerPreview ? (
                <div className="flex flex-col gap-2">
                  <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[10px] border bg-muted">
                    <Image src={bannerPreview} alt="Banner de la promoción" fill unoptimized sizes="560px" className="object-cover" />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? "Subiendo…" : "Cambiar banner"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => { setBannerPath(null); setBannerPreview(null); }}>
                      Quitar banner
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center rounded-[10px] border border-dashed border-neutral-300 bg-neutral-50 px-4 py-7 text-sm leading-5 font-medium transition-colors hover:bg-muted disabled:opacity-60">
                  {uploading ? "Subiendo…" : "Subir banner"}
                </button>
              )}
              {errorFor(["banner"])}
              <p className="text-xs leading-[17px] text-muted-foreground">Imagen horizontal, de 1200 × 400 px o más. JPG o PNG. Sale arriba de tus productos mientras dure la promoción.</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm leading-5 font-medium">
                  Fecha de inicio
                  <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-invalid={error?.field === "dates"} className={fieldClass} />
                </label>
                <label className="flex flex-col gap-2 text-sm leading-5 font-medium">
                  Fecha de cierre
                  <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={error?.field === "dates"} className={fieldClass} />
                </label>
              </div>
              {errorFor(["dates"])}
              <p className="text-xs leading-[17px] text-muted-foreground">Empieza a las 12:00 a. m. del día de inicio y termina a las 11:59 p. m. del día de cierre, en la hora de tu país.</p>
            </div>

            <div className="flex flex-col gap-3 rounded-[10px] border p-3.5">
              <label className="flex items-center justify-between gap-3 text-sm leading-5 font-medium">
                Extender la promoción
                <Switch checked={extend} onCheckedChange={setExtend} />
              </label>
              <p className="text-xs leading-[17px] text-muted-foreground">Al llegar el cierre, la promoción sigue hasta la fecha extendida y tu catálogo dice «¡Extendida!».</p>
              {extend ? (
                <label className="flex flex-col gap-2 text-sm leading-5 font-medium">
                  Fecha extendida
                  <input type="date" value={extendedUntil} min={endsOn} onChange={(e) => setExtendedUntil(e.target.value)} aria-invalid={error?.field === "extended"} className={fieldClass} />
                </label>
              ) : null}
              {errorFor(["extended"])}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="text-sm leading-5 text-muted-foreground">Cada porcentaje va con su grupo de productos. Un producto solo puede estar en un grupo.</p>
            {groups.map((g) => {
              const lista = covered(g);
              const otherAll = groups.some((o) => o.key !== g.key && o.allProducts);
              return (
                <div key={g.key} className="flex flex-col gap-3 rounded-[10px] border p-3.5">
                  <div className="flex items-center gap-2">
                    <label className="flex h-10 w-[88px] items-center gap-1 rounded-[10px] border px-3">
                      <input value={g.percent} inputMode="decimal" onChange={(e) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, percent: e.target.value } : x)))} aria-label="Porcentaje de descuento" className="w-full min-w-0 bg-transparent text-base font-medium outline-none md:text-[15px]" placeholder="0" />
                      <span className="text-muted-foreground">%</span>
                    </label>
                    <span className="flex-1 text-sm text-muted-foreground">de descuento</span>
                    {groups.length > 1 ? (
                      <button type="button" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))} className="text-[13px] text-muted-foreground hover:underline">Quitar</button>
                    ) : null}
                  </div>
                  {/* «Aplicar descuento diferente a precios al mayor» (frames 4 and 17, 2026-11-28). */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-2 text-sm leading-5">
                      <Checkbox
                        className="mt-0.5"
                        checked={g.differentWholesale}
                        onCheckedChange={(v) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, differentWholesale: v === true } : x)))}
                      />
                      Aplicar descuento diferente a precios al mayor
                    </label>
                    {g.differentWholesale ? (
                      <div className="flex items-center gap-2">
                        <label className="flex h-10 w-[88px] items-center gap-1 rounded-[10px] border px-3">
                          <input value={g.wholesalePercent} inputMode="decimal" onChange={(e) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, wholesalePercent: e.target.value } : x)))} aria-label="Porcentaje de descuento al mayor" className="w-full min-w-0 bg-transparent text-base font-medium outline-none md:text-[15px]" placeholder={g.percent || "0"} />
                          <span className="text-muted-foreground">%</span>
                        </label>
                        <span className="flex-1 text-sm text-muted-foreground">al mayor</span>
                      </div>
                    ) : null}
                    <p className="text-xs leading-[17px] text-muted-foreground">
                      {num(g.percent) > 0
                        ? wholesaleOf(g) == null
                          ? `El precio al mayor también baja ${num(g.percent)}%.`
                          : `El precio al detal baja ${num(g.percent)}% y el precio al mayor, ${wholesaleOf(g)}%.`
                        : "El precio al mayor baja lo mismo que el detal."}
                    </p>
                  </div>
                  {/* «Todos los productos» as a checkbox (owner's capture of 2026-11-28). Only one
                      group may have it, so the others show it disabled while one does. */}
                  <label className={`flex items-center gap-2 text-sm leading-5 ${otherAll && !g.allProducts ? "opacity-40" : ""}`}>
                    <Checkbox
                      checked={g.allProducts}
                      disabled={otherAll && !g.allProducts}
                      onCheckedChange={(v) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, allProducts: v === true, productIds: [] } : x)))}
                    />
                    Todos los productos
                  </label>
                  {g.allProducts ? (
                    <>
                      <p className="text-[13px] leading-[19px] text-muted-foreground">
                        {countOf(lista.length, "producto", "productos")}: todos los que no están en otro grupo.
                        {g.productIds.length > 0
                          ? ` ${countOf(g.productIds.length, "excluido", "excluidos")}: ${g.productIds.slice(0, 3).map((id) => byId.get(id)?.name ?? "").join(", ")}${g.productIds.length > 3 ? ` y ${g.productIds.length - 3} más` : ""}.`
                          : ""}
                      </p>
                      <button type="button" onClick={() => { setSearch(""); setCategory(null); setPicker({ key: g.key }); }} className="self-start text-[13px] font-medium underline underline-offset-2">Excluir productos</button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="outline" className="h-10" onClick={() => { setSearch(""); setCategory(null); setPicker({ key: g.key }); }}>
                        + Agregar productos
                      </Button>
                      <p className="text-[13px] leading-[19px] text-muted-foreground">
                        {lista.length === 0
                          ? "Todavía no elegiste productos."
                          : `${countOf(lista.length, "producto", "productos")}: ${lista.slice(0, 3).map((p) => p.name).join(", ")}${lista.length > 3 ? ` y ${lista.length - 3} más` : ""}.`}
                      </p>
                      {lista.length ? (
                        <button type="button" onClick={() => { setSearch(""); setCategory(null); setPicker({ key: g.key }); }} className="self-start text-[13px] font-medium underline underline-offset-2">Cambiar productos</button>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
            {errorFor(["groups"])}
            <Button type="button" variant="outline" className="h-10" onClick={() => setGroups((gs) => [...gs, { key: newKey(), percent: "", differentWholesale: false, wholesalePercent: "", allProducts: false, productIds: [] }])}>
              + Agregar otro porcentaje
            </Button>
          </>
        ) : null}

        {step === 3 ? (
          <>
            {bannerPreview ? (
              <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[10px] bg-muted">
                <Image src={bannerPreview} alt="" fill unoptimized sizes="560px" className="object-cover" />
              </div>
            ) : null}
            <dl className="flex flex-col gap-3 rounded-[10px] border p-3.5">
              {[
                ["Nombre", name.trim()],
                ["Fechas", `${dayLabel(startsOn)} – ${dayLabel(endsOn, true)}.${extend && extendedUntil ? ` Se extiende hasta el ${dayLabel(extendedUntil)}.` : ""}`],
                ["Descuentos", groups.map((g) => groupLine({ percent: num(g.percent), wholesalePercent: wholesaleOf(g), allProducts: g.allProducts, productIds: g.productIds }, covered(g).length)).join("\n")],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-xs leading-[17px] text-muted-foreground">{k}</dt>
                  <dd className="text-sm leading-5 font-medium whitespace-pre-line">{v}</dd>
                </div>
              ))}
            </dl>
            {belowCost.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                <p className="text-sm leading-5 font-semibold">
                  {/* Products, not prices: one product can fall below cost at both prices. */}
                  {belowCostProducts === 1 ? "1 producto queda" : `${belowCostProducts} productos quedan`} por debajo de su costo
                </p>
                <p className="text-[13px] leading-[19px]">
                  {belowCost.slice(0, 4).map((x) => `${x.p.name}${x.tier === "mayor" ? " al mayor" : ""} (${formatPriceAmount(x.price, x.currency)}, costo ${formatPriceAmount(x.p.cost as number, x.currency)}) con el ${x.pct}%`).join("; ")}
                  {belowCost.length > 4 ? ` y ${belowCost.length - 4} más` : ""}. Puedes seguir igual.
                </p>
                <button type="button" onClick={() => setStep(2)} className="self-start text-[13px] font-medium underline underline-offset-2">Revisar el {belowCost[0].pct}%</button>
              </div>
            ) : null}
            {dearerWholesale.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                <p className="text-sm leading-5 font-semibold">
                  {dearerWholesale.length === 1 ? "1 producto queda más caro" : `${dearerWholesale.length} productos quedan más caros`} al mayor que al detal
                </p>
                <p className="text-[13px] leading-[19px]">
                  {/* Frame 8's sentence for one product; with several, the «Con el X% … Y%» is
                      said once per pair of % instead of before every product. */}
                  {dearerSentence(dearerWholesale)}: quien compre al mayor paga más. Puedes seguir igual.
                </p>
                <button type="button" onClick={() => setStep(2)} className="self-start text-[13px] font-medium underline underline-offset-2">Revisar el {dearerWholesale[0].pct}%</button>
              </div>
            ) : null}
            {error && (!error.field || !stepOf[error.field]) ? <p className="text-sm text-destructive">{error.text}</p> : null}
          </>
        ) : null}
      </div>

      <StickyActions>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-end">
          {step < STEPS ? (
            <Button type="button" className="h-10 w-full md:w-[160px]" disabled={uploading} onClick={next}>Siguiente</Button>
          ) : (
            <Button type="button" className="h-10 w-full md:w-[200px]" disabled={pending || uploading} onClick={save}>
              {pending ? "Guardando…" : saveLabel}
            </Button>
          )}
          {step > 1 ? (
            <Button type="button" variant="outline" className="h-10 w-full md:w-[120px]" onClick={() => setStep(step - 1)}>Atrás</Button>
          ) : null}
        </div>
      </StickyActions>

      <Sheet open={picker != null} onOpenChange={(o) => !o && setPicker(null)}>
        <SheetContent side="bottom" className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-3xl p-0">
          {pickerGroup ? (
            <>
              <SheetTitle className="px-4 pt-4 pb-2 text-base font-medium">
                {pickerGroup.allProducts ? `Excluir del ${num(pickerGroup.percent) || "…"}%` : `Productos al ${num(pickerGroup.percent) || "…"}%`}
              </SheetTitle>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {pickerGroup.allProducts ? <p className="text-sm text-muted-foreground">Marca los que NO llevan el {num(pickerGroup.percent) || "…"}%. Quedan a su precio de siempre.</p> : null}
                <label className="flex h-10 items-center gap-2 rounded-[10px] border px-3">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto" className="w-full min-w-0 bg-transparent text-base outline-none md:text-[15px]" />
                  <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                </label>
                {categories.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto">
                    {[{ id: null as string | null, name: `Todas (${products.length})` }, ...categories.map((c) => ({ id: c.id as string | null, name: `${c.name} (${products.filter((p) => p.categoryId === c.id).length})` }))].map((c) => (
                      <button key={c.id ?? "all"} type="button" onClick={() => setCategory(c.id)} className={`shrink-0 rounded-full border px-3 py-2 text-[13px] ${category === c.id ? "border-transparent bg-[#272727] text-white" : ""}`}>{c.name}</button>
                    ))}
                  </div>
                ) : null}
                {!pickerGroup.allProducts ? (
                  <label className="flex items-center gap-3 text-sm font-medium">
                    <Checkbox
                      checked={pickerList.length > 0 && pickerList.every((p) => pickerGroup.productIds.includes(p.id) || chosenElsewhere(pickerGroup.key).has(p.id))}
                      onCheckedChange={(v) => {
                        const blocked = chosenElsewhere(pickerGroup.key);
                        const ids = pickerList.map((p) => p.id).filter((id) => !blocked.has(id));
                        setGroups((gs) => gs.map((x) => x.key !== pickerGroup.key ? x : { ...x, productIds: v === true ? [...new Set([...x.productIds, ...ids])] : x.productIds.filter((id) => !ids.includes(id)) }));
                      }}
                    />
                    Seleccionar los {pickerList.length} de la lista
                  </label>
                ) : null}
                <ul className="flex flex-col">
                  {pickerList.map((p) => {
                    const elsewhere = chosenElsewhere(pickerGroup.key).has(p.id);
                    const on = pickerGroup.productIds.includes(p.id);
                    const pct = num(pickerGroup.percent);
                    const disabled = elsewhere;
                    const sub = elsewhere
                      ? "Ya está en otro grupo"
                      : p.price != null && p.currency
                        ? pickerGroup.allProducts
                          ? on ? `Excluido · ${formatPriceAmount(p.price, p.currency)}` : pct > 0 ? `${formatPriceAmount(p.price, p.currency)} → ${formatPriceAmount(applyPromotion(p.price, pct, p.currency), p.currency)}` : formatPriceAmount(p.price, p.currency)
                          : pct > 0 ? `${formatPriceAmount(p.price, p.currency)} → ${formatPriceAmount(applyPromotion(p.price, pct, p.currency), p.currency)}` : formatPriceAmount(p.price, p.currency)
                        : "";
                    return (
                      <li key={p.id}>
                        <label className={`flex items-center gap-3 border-b py-2.5 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
                          <Checkbox checked={on} disabled={disabled} onCheckedChange={() => toggleIn(pickerGroup.key, p.id)} />
                          <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {p.photoPath ? <ProductThumbnail path={p.photoPath} alt="" fill sizes="40px" /> : null}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium">{p.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs leading-[17px] text-muted-foreground">Un producto que ya está en otro grupo no se puede elegir. Para pasarlo aquí, quítalo antes de su grupo.</p>
              </div>
              <div className="sticky bottom-0 border-t bg-background px-4 pt-3 pb-6">
                <Button type="button" className="h-10 w-full" onClick={() => setPicker(null)}>
                  {pickerGroup.allProducts ? `Listo · ${countOf(pickerGroup.productIds.length, "excluido", "excluidos")}` : `Listo · ${countOf(pickerGroup.productIds.length, "producto", "productos")}`}
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
