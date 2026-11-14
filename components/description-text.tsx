import { cn } from "@/lib/utils";
import { parseDescription, type DescriptionSpan } from "@/lib/products/description";

// THE ONE WAY A PRODUCT DESCRIPTION IS DRAWN, on every screen that shows it: the form's
// preview, step 4/4, the shopkeeper's product page and the customer's (CT-171, frames
// `2119:21556`, `2119:21680`, `2119:21783` and `2119:21828`). It builds React elements
// from parsed data -- never HTML -- so nothing typed into a description can run as code
// on the public page. See `lib/products/description.ts`.
//
// LINE BREAKS ARE KEPT. Until 2026-11-12 the description sat in one <p>, so the
// customer's page joined every line into one paragraph; a bullet list typed by the
// shopkeeper would have reached the customer as a single run-on sentence.
//
// `overflow-wrap: anywhere`, NOT `break-words`. Found by the v0.6.0 checklist on 2026-11-13
// with a pasted link and a 200-character word: `break-word` breaks the text where it is drawn
// but leaves the element's MINIMUM width at the whole word, so the flex column around it grew
// and the shopkeeper's product page measured 1536 px in a 1280 px window. `anywhere` also
// shrinks that minimum, which is the only thing a flex parent listens to.
export function DescriptionText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const blocks = parseDescription(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "gap") return <div key={i} aria-hidden="true" className="h-1" />;
        if (block.kind === "line") return <p key={i}>{renderSpans(block.spans)}</p>;
        return (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{renderSpans(item)}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function renderSpans(spans: DescriptionSpan[]) {
  return spans.map((span, i) => {
    let node: React.ReactNode = span.text;
    if (span.italic) node = <em>{node}</em>;
    if (span.bold) node = <strong className="font-semibold">{node}</strong>;
    return <span key={i}>{node}</span>;
  });
}
