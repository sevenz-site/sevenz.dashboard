import { PASOS_IMPORTAR } from "@/lib/config";
import { cn } from "@/lib/utils";

// Los tres pasos de importar, pintados igual en la hoja de Cartera y en la
// cabecera de /import. Un solo componente para que las dos no se separen.
//
// Sin "use client": es marcado estático, así que lo puede montar tanto la hoja
// (cliente) como la página /import (servidor).
//
// REENVÍA EL RESTO DE PROPS AL <ol>, y no es opcional. En la hoja se monta con
// `<SheetDescription asChild>`, y ahí Radix le pasa al hijo el `id` con el que
// luego apunta el `aria-describedby` del diálogo. Una primera versión solo
// aceptaba `className`: el id se perdía por el camino y el diálogo quedaba
// describiéndose contra un elemento inexistente — un lector de pantalla abría
// "Importar cartera" y no leía ninguno de los tres pasos. No se ve en pantalla
// y el typecheck no dice nada; se detecta comprobando que
// document.getElementById(aria-describedby) existe.
export function PasosImportar({
  className,
  ...props
}: React.ComponentProps<"ol">) {
  return (
    <ol
      className={cn(
        "list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:font-medium marker:text-foreground",
        className,
      )}
      {...props}
    >
      {PASOS_IMPORTAR.map((paso) => (
        <li key={paso}>{paso}</li>
      ))}
    </ol>
  );
}
