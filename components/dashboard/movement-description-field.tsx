import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// «DESCRIPCIÓN (OPCIONAL)» OF A MONEY FORM: a sale or fiado payment, an abono to one fiado, an
// abono split across several, and the old debt of a new client. Not the product's description,
// which is `description-field.tsx`, with its formats and its preview for the customer.
//
// ONE COMPONENT SINCE 2026-11-22, when the owner asked for the field on the split abono, which
// was the only money form without it. There were three hand-written copies by then and they had
// drifted: one with the «Descripción» placeholder and one without, `h-[120px]` against
// `min-h-[120px]`, `gap-1` against `gap-2`. CLAUDE.md's rule: a visual value in two screens is
// born in a component. The look kept is the sale's payment sheet, the one the owner circled as
// the model.
//
// CONTROLLED OR NOT. The new client's form posts a `FormData` and reads the field by `name`;
// the others hold it in state. `maxLength` only where a screen already had one (500 on the new
// client's old debt): adding a limit elsewhere would cut what a shopkeeper can write today.
export function MovementDescriptionField({
  id,
  name,
  value,
  onChange,
  maxLength,
}: {
  id: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Descripción (opcional)</Label>
      <Textarea
        id={id}
        name={name}
        className="h-[120px]"
        placeholder="Descripción"
        maxLength={maxLength}
        {...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : {})}
      />
    </div>
  );
}
