// Required, verbatim, in four places: the client's public balance screen
// footer, the owner's dashboard footer, the calculator (strip drawer/
// popover), and the Ajustes → Tasa de cambio screen. Same pattern used by
// Al Cambio / Cambio Fácil — protects the project legally/reputationally
// and reinforces transparency as a product principle, not filler legal
// text. No longer mentions a business-adjusted/custom rate — that option
// is hidden in the UI (see business-settings-form.tsx).
export function ExchangeRateLegalDisclaimer() {
  return (
    <p className="text-xs text-muted-foreground">
      Las tasas de cambio mostradas en Sevenz provienen de fuentes públicas (Banco Central de
      Venezuela, vía proveedores externos). Sevenz no está afiliado a ninguna entidad
      gubernamental ni fija tasas oficiales.
    </p>
  );
}
