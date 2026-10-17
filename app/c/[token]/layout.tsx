import { Suspense } from "react";
import { CartPill } from "@/components/public/cart-pill";
import { WidthProbe } from "@/components/public/width-probe";

// EL LAYOUT DEL CATALOGO PUBLICO, y existe por una sola razon: la pildora del
// carrito tiene que salir en la lista Y en el detalle.
//
// Ponerla en las dos paginas serian dos copias de un control, y el dia que
// alguien le cambie el contador a una, la otra se queda atras. En el layout
// hay una sola, y se esconde ella misma en la pantalla del carrito.
//
// NO LLEVA ESTADO. El carrito no vive aqui: vive en `localStorage` y lo leen
// los componentes que lo necesitan con `useCarrito`, que los mantiene en
// sincronia por suscripcion. Un proveedor de contexto aqui seria una pieza mas
// sin nada que aportar — y ademas obligaria a volver este layout cliente,
// perdiendo el renderizado en servidor de las dos paginas que envuelve.
export default async function CatalogoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <>
      {/* SONDA TEMPORAL, solo con `?diag=1`. Sin el parámetro devuelve `null`.
          Está aquí y no en una pantalla concreta porque el desbordamiento que
          busca puede aparecer en cualquiera de las cuatro. Se quita entera
          —archivo y esta línea— en cuanto el diagnóstico termine; ver el aviso
          de `width-probe.tsx`. */}
      <Suspense fallback={null}>
        <WidthProbe />
      </Suspense>
      {children}
      <CartPill token={token} />
    </>
  );
}
