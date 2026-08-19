import { Fragment, type ReactNode } from "react";

// Very small markdown-lite: only **bold**, *italic*, and line breaks. Backs
// a single short field (owners.payment_info) where an owner might type
// something like "**Nequi:** 300 123 4567" or "*pagos antes de las 6pm*" —
// not a general-purpose markdown renderer.
export function renderFormattedText(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {renderInline(line)}
    </Fragment>
  ));
}

function renderInline(line: string): ReactNode[] {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{line.slice(lastIndex, match.index)}</Fragment>);
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      nodes.push(<em key={key++}>{match[2]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) {
    nodes.push(<Fragment key={key++}>{line.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}
