// COMO SE ESCRIBE UNA CANTIDAD DE PRODUCTO.
//
// UNA CANTIDAD NO ES UN PRECIO, y pasarla por el formateador de precios daba
// «Disponible: 40.00». Dos decimales fijos tienen sentido en dinero y ninguno
// en unidades: nadie tiene cuarenta coma cero cero aceites. Se permiten hasta
// tres por si el negocio vende a peso, que es para lo que la columna es
// `numeric(14,3)`, pero no se fuerzan.
//
// VIVE AQUI Y NO DENTRO DE UNA PANTALLA porque desde el 2026-10-15 lo usan
// dos: la tarjeta del catalogo publico y el detalle del producto. Escrito dos
// veces, el dia que alguien ajuste uno el mismo inventario se lee distinto en
// las dos pantallas de la misma pagina — y es exactamente el fallo que este
// proyecto ya pago una vez con el mensaje de saldo (ver `lib/share-balance.ts`).
const CANTIDAD = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 });

export function formatCantidad(n: number): string {
  return CANTIDAD.format(n);
}
