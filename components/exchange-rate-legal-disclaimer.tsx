// Required, verbatim, in four places: the client's public balance screen
// footer, the owner's dashboard footer, the calculator (strip drawer/
// popover), and the Ajustes → Tasa de cambio screen. Same pattern used by
// Al Cambio / Cambio Fácil — protects the project legally/reputationally
// and reinforces transparency as a product principle, not filler legal
// text. No longer mentions a business-adjusted/custom rate — that option
// is hidden in the UI (see business-settings-form.tsx).
// `incluyeUsdt` solo lo pone la calculadora, que es el único sitio donde se
// enseña un precio que NO viene del BCV.
//
// Sin esto, el aviso quedaba diciendo que todas las tasas de Sevenz salen del
// Banco Central mientras arriba se enseñaba un precio de Binance. Es el mismo
// error que ya se evitó en el sello del número —no decir "Tasa BCV" sobre un
// precio P2P— y dejarlo aquí lo habría reintroducido por la puerta de atrás,
// justo en el párrafo que existe para ser exacto.
export function ExchangeRateLegalDisclaimer({ incluyeUsdt = false }: { incluyeUsdt?: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      Las tasas de cambio mostradas en Sevenz provienen de fuentes públicas (Banco Central de
      Venezuela, vía proveedores externos)
      {incluyeUsdt ? (
        <>
          , salvo el precio del USDT, que es el del mercado P2P de Binance y no una tasa oficial
        </>
      ) : null}
      . Sevenz no está afiliado a ninguna entidad gubernamental ni fija tasas oficiales.
    </p>
  );
}
