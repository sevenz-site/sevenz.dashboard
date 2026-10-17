import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";

// THE SHORTCUT TO PEDIDOS, in the two places the owner asked for it:
// Catálogo (frame `1360:6518`, 2026-10-16) and Inicio (frame `1360:6592`, the
// same day, "entre montos por cobrar y la calculadora").
//
// ONE COMPONENT AND NOT TWO, although the two frames differ. What they share
// is the part that is easy to get wrong and expensive to get wrong twice: the
// gradient built from two theme tokens, the 10px radius, the border and the
// shadow, and the "Ver todo + count + chevron" group on the right. What they
// do not share is only the left-hand side, and that is this file's one
// branch.
//
// WHY THE GRADIENT IS A STYLE ATTRIBUTE and not a utility class: it carries
// `--accent` and `--background`. Written as literal colours it would be a
// white card painted over a dark background the day the dark theme is
// switched on.
//
// THE ICON'S GREEN IS `#7EC070`, which is `--brand-whatsapp`. That token's own
// note in `globals.css` says it measures 2,17:1 on white and "works on the
// dark header and nowhere light" -- and both of these cards are light. The
// exception is deliberate and bounded: the icon is decoration next to text
// that carries the whole meaning on its own, so a reader who cannot make the
// green out loses nothing. It is not a precedent for a green that has to be
// READ on a light surface; that still needs its own darker value, the way
// `--money-due` solves it for the orange.

function VerTodo({ unattended }: { unattended: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span className="text-xs leading-4">Ver todo</span>
      {unattended > 0 ? (
        // 16px round, as drawn. `min-w-4` and not `size-4`: the frame shows a
        // single digit, and a fixed circle would clip the second the day a
        // shopkeeper has twelve orders waiting.
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-primary-foreground bg-destructive px-1 text-xs leading-4 text-primary-foreground">
          {unattended}
        </span>
      ) : null}
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function OrdersCard({
  unattended,
  place,
}: {
  unattended: number;
  // "catalogo": the card carries its own "Pedidos" title and a subtitle.
  // "inicio": the title is the section heading above it, so the card holds
  // only the count — 52px tall, as the frame draws it.
  place: "catalogo" | "inicio";
}) {
  return (
    <Link
      href="/productos/ordenes"
      className={
        place === "inicio"
          ? "flex h-[52px] items-center justify-between gap-3 rounded-[10px] border px-4 drop-shadow-[0px_2px_1px_rgba(0,0,0,0.02)]"
          : "flex items-center justify-between gap-3 rounded-[10px] border p-3 drop-shadow-[0px_2px_1px_rgba(0,0,0,0.02)]"
      }
      style={{
        backgroundImage: "linear-gradient(82.76deg, var(--accent) 0%, var(--background) 100%)",
      }}
    >
      <span
        className={
          place === "inicio"
            ? "flex min-w-0 flex-1 items-center gap-1"
            : "flex min-w-0 flex-1 items-center gap-3"
        }
      >
        <Image
          src="/icon-pedidos.svg"
          alt=""
          width={32}
          height={32}
          className="shrink-0"
          aria-hidden="true"
        />
        {place === "inicio" ? (
          <span className="truncate text-xs leading-4 text-primary">
            {unattended > 0 ? `${unattended} sin atender` : "Lo que te piden desde tu enlace"}
          </span>
        ) : (
          <span className="flex min-w-0 flex-col justify-center">
            <span className="font-medium">Pedidos</span>
            <span className="text-xs leading-4 text-primary">
              {unattended > 0 ? `${unattended} sin atender` : "Lo que te piden desde tu enlace"}
            </span>
          </span>
        )}
      </span>
      <VerTodo unattended={unattended} />
    </Link>
  );
}
