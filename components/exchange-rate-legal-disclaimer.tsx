// Required, verbatim, in three places: the client's public balance screen
// footer, the owner's dashboard footer, and the Ajustes → Tasa de cambio
// screen. Same pattern used by Al Cambio / Cambio Fácil — protects the
// project legally/reputationally and reinforces transparency as a product
// principle, not filler legal text.
export function ExchangeRateLegalDisclaimer() {
  return (
    <p className="text-xs text-muted-foreground">
      Las tasas de cambio mostradas en Sevenz provienen de fuentes públicas (Banco Central de
      Venezuela, vía proveedores externos) o son ajustadas manualmente por el negocio. Sevenz no
      está afiliado a ninguna entidad gubernamental ni fija tasas oficiales. Cuando un negocio usa
      una tasa personalizada, se indica de forma visible en cada cálculo.
    </p>
  );
}
