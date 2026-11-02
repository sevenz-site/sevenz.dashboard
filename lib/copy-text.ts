// ── COPIAR, CON RED DEBAJO ──────────────────────────────────────────────
//
// `navigator.clipboard` ES LO PRIMERO Y NO LO ÚNICO. La API moderna la puede
// denegar el navegador aunque el contexto sea seguro, haya gesto y la página
// tenga el foco: medido el 2026-10-24 en el panel del navegador de este
// entorno, que contesta `NotAllowedError: Write permission denied` sin
// preguntar nada. Un WebView dentro de otra app —que es por donde pasa buena
// parte del tráfico de este producto— se porta igual.
//
// EL RESPALDO ES `execCommand`, obsoleto y vivo en todas partes. Necesita un
// nodo con el texto seleccionado, así que se monta uno fuera de pantalla y se
// quita en el mismo tick.
//
// `position: fixed` Y `opacity: 0` EN VEZ DE `display: none`: un nodo oculto
// de verdad no se puede seleccionar, y entonces no hay nada que copiar. Y
// `fixed` para que añadirlo no desplace la página ni un píxel.
//
// Esto es la regla de `CLAUDE.md` sobre iOS aplicada a algo pequeño: si algo
// tiene que pasar, no se deja en manos de que el navegador coopere.
//
// Moved here from `boton-copiar-codigo.tsx` on 2026-11-02, when "Copiar" on a
// payment method needed the same net: the second caller is where a copy of
// this function would have started drifting from the first.
export function copyText(texto: string): Promise<boolean> {
  const respaldo = () => {
    try {
      const caja = document.createElement("textarea");
      caja.value = texto;
      caja.setAttribute("readonly", "");
      caja.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(caja);
      caja.select();
      const fue = document.execCommand("copy");
      document.body.removeChild(caja);
      return fue;
    } catch {
      return false;
    }
  };

  if (!navigator.clipboard) return Promise.resolve(respaldo());
  return navigator.clipboard
    .writeText(texto)
    .then(() => true)
    .catch(() => respaldo());
}
