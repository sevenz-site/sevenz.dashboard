"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ImageOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CatalogProductDialog } from "@/components/dashboard/catalog-product-dialog";
import { useCatalogFilters } from "@/components/dashboard/catalog-filters";
import { setProductPublished } from "@/app/(app)/productos/actions";
import { formatPriceAmount, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { listPrice, overridesByTier, type ProductRow, type PriceOverrideRow } from "@/lib/products/catalog";

// LA REJILLA DEL CATALOGO, segun el frame 1175:5881.
//
// ─────────────────────────────────────────────────────────────────────────
// REJILLA Y NO LISTA, Y ESO SE APARTA DE UNA REGLA ESCRITA
//
// El DESIGN-SYSTEM dice: tarjetas por debajo de `md`, tabla desde `md`. Esa
// regla es para LISTAS DE REGISTROS —clientes, movimientos— donde cada fila es
// un puñado de campos y la tabla los alinea en columnas que se comparan.
//
// Un catalogo no es eso desde que lleva foto. La foto es el dato por el que un
// producto se reconoce, y una foto dentro de una celda de tabla es una foto
// pequeña al lado de texto: ni se compara ni se reconoce. Asi que esta
// pantalla es una rejilla en todos los tamaños, de 2 columnas en telefono a 4
// en escritorio.
//
// Apuntado en DESIGN-SYSTEM.md como excepcion con su alcance, no como permiso
// general: la siguiente lista de registros sigue siendo tarjetas y tabla.
//
// ─────────────────────────────────────────────────────────────────────────
// LA TARJETA NO ES UN BOTON, AUNQUE LA REGLA DIGA QUE LO SEA
//
// «La tarjeta entera es un botón» no se puede cumplir aqui: el frame pone un
// interruptor DENTRO de la tarjeta («Toggle publica u oculta el producto»), y
// un control dentro de un `<button>` es HTML invalido — el navegador lo
// reconstruye como quiera, y en la practica el toque del interruptor burbujea
// y abre tambien la ficha.
//
// Asi que la tarjeta es un `div`: la zona de la foto, el nombre y el precio es
// el boton que abre la ficha, y el interruptor vive FUERA de el, en su propia
// fila al pie. Los dos toques son inconfundibles y ninguno dispara el otro.
export function CatalogTable({
  overrides,
  rates,
  defaultCurrency,
  ownerId,
  autoOpen,
  loadFailed,
}: {
  overrides: PriceOverrideRow[];
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  ownerId: string;
  // `?nuevo=1`, que es lo que pone el boton flotante de la barra de abajo.
  autoOpen: boolean;
  // La consulta del catalogo fallo. NO es lo mismo que no tener productos, y
  // esa diferencia tiene su propia pantalla — ver la pagina.
  loadFailed: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { visible, total, query } = useCatalogFilters();
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [creating, setCreating] = useState(false);

  // SE ABRE EN CADA TRANSICION false -> true, no con un pestillo de una sola
  // vez. Es el mismo mecanismo que `ClientSearchDialog`, y los dos fallos que
  // documenta ya costaron una entrega:
  //
  //   - un pestillo solo dispara una vez, asi que el primer toque del boton
  //     flotante abria y los siguientes no hacian nada;
  //   - rearmarlo al cerrar tampoco sirve, porque el marcador sigue en la
  //     direccion en ese instante y el dialogo se reabre al cerrarse.
  //
  // Sembrado en `false` y nunca desde la prop: llegar aqui desde otra pantalla
  // monta este componente con `autoOpen` YA en true, asi que sembrar desde la
  // prop no deja transicion que observar y no abre nunca.
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (autoOpen !== prevAutoOpen) {
    setPrevAutoOpen(autoOpen);
    if (autoOpen) setCreating(true);
  }

  // Y SE LIMPIA EL MARCADOR AL CERRAR, por el router y no por
  // `history.replaceState`: eso ultimo mueve la barra de direcciones por
  // detras de Next, el router sigue creyendo que esta en `?nuevo=1`, y el
  // siguiente toque del flotante es una navegacion a la pagina en la que cree
  // estar — gira el spinner y no abre nada. Dejarlo sin limpiar es el otro
  // fallo: un refresco abre el dialogo solo.
  useEffect(() => {
    if (autoOpen && !creating) router.replace(pathname, { scroll: false });
  }, [autoOpen, creating, router, pathname]);

  const nuevo = (
    <CatalogProductDialog
      open={creating}
      onOpenChange={setCreating}
      product={null}
      rates={rates}
      defaultCurrency={defaultCurrency}
      overrides={{ retail: {}, wholesale: {} }}
      ownerId={ownerId}
    />
  );

  // Antes que el estado vacio, porque se parecen y no son lo mismo. Sin esto,
  // un tendero con cuarenta productos y una consulta caida lee «todavia no
  // tienes productos» y entiende que se le borro el catalogo.
  if (loadFailed) {
    return (
      <>
      {/* El dialogo se monta tambien aqui. Sin el, el boton flotante de la
          barra sigue a la vista, navega a `?nuevo=1` y no abre nada: un
          control muerto encima de una pantalla que ya esta diciendo que algo
          fallo. Crear no depende de la lectura que fallo, asi que si la
          creacion tambien esta rota, el tendero recibe el error de verdad en
          vez de un boton que no responde. */}
      <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-12 text-center">
        <p className="text-base font-medium">No pudimos cargar tu catálogo</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Tus productos siguen ahí. Vuelve a intentarlo en un momento.
        </p>
        <Button type="button" variant="outline" onClick={() => router.refresh()}>
          Reintentar
        </Button>
      </div>
      {nuevo}
      </>
    );
  }

  if (total === 0) {
    return (
      <>
        {/* EL ESTADO VACIO NO SE DISCULPA NI EMPUJA.
            Los dos tenderos entrevistados el 2026-10-09 no llevan inventario
            y uno ya tiene un sistema que le funciona: mirar. Si esto dijera
            «carga tus productos», ninguno de los dos pasaria de aqui.

            El texto es el del frame, con dos cambios: «Todavís» era un
            desliz, y se le añade la frase de que se llena solo — que es el
            hallazgo de campo y es lo que quita la sensacion de deberle dos
            horas de trabajo a la pantalla. */}
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-base font-medium">Todavía no tienes productos</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Los productos que agregues acá podrán verse reflejados en el catálogo de producto que
            ven tus clientes. No hace falta cargarlos ahora: se van agregando solos cuando fías o
            vendes algo que no esté en la lista.
          </p>
          {/* SOLO DESDE `md`, encontrado rindiendo la pantalla el 2026-10-10:
              por debajo de ahi el boton flotante de la barra ya dice «Crear
              producto» y hace lo mismo, asi que a 375px habia dos controles
              con la misma etiqueta en la misma pantalla. Es lo que el frame
              dibuja —su estado vacio no lleva boton— y lo que el
              DESIGN-SYSTEM pide. En escritorio no hay flotante, asi que aqui
              si hace falta. */}
          <Button
            type="button"
            className="hidden md:inline-flex"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" /> Crear producto
          </Button>
        </div>
        {nuevo}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Solo escritorio: en telefono esta accion es el boton flotante de la
          barra de abajo, que navega a `?nuevo=1`. Dos disparadores visibles a
          la vez en el mismo tamaño serian dos puertas al mismo cajon. */}
      <div className="hidden md:flex md:justify-end">
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Crear producto
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">
          {query.trim() === ""
            ? "Ningún producto cumple con esos filtros."
            : "Ningún producto se llama así."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => setEditing(p)}
            />
          ))}
        </ul>
      )}

      {nuevo}
      {editing ? (
        <CatalogProductDialog
          // La `key` fuerza una instancia nueva por producto. Sin ella, abrir
          // un segundo producto reutilizaria los `useState` del primero y la
          // ficha abriria con el nombre del anterior.
          key={editing.id}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          product={editing}
          rates={rates}
          defaultCurrency={defaultCurrency}
          overrides={overridesByTier(overrides, editing.id)}
          ownerId={ownerId}
        />
      ) : null}
    </div>
  );
}

function ProductCard({ product, onEdit }: { product: ProductRow; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimista: el interruptor se mueve en el acto y se revierte si el servidor
  // dice que no. Sin esto el gesto tarda un viaje de ida y vuelta, y en un
  // telefono barato eso se siente como que no respondio y se vuelve a tocar.
  const [published, setPublished] = useState(product.published);

  const price = listPrice(product);

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border bg-background">
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-col text-left transition-colors active:bg-accent"
        aria-label={`Editar ${product.name}`}
      >
        {/* Cuadrada y no de alto libre: en una rejilla de dos columnas, dos
            fotos de proporciones distintas dejan las tarjetas de alturas
            distintas y la rejilla deja de leerse como una rejilla. */}
        <div className="relative aspect-square w-full bg-muted">
          {product.photo_path ? (
            <Image
              src={getPublicProductPhotoUrl(product.photo_path)}
              alt=""
              fill
              unoptimized
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className="object-cover"
            />
          ) : (
            // Un hueco dicho, no un hueco gris. Sin esto, una tarjeta sin
            // foto parece una foto que no cargo.
            <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageOff className="size-6" aria-hidden="true" />
              <span className="text-[11px]">Sin foto</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-0.5 p-3">
          <span className="line-clamp-2 text-sm font-medium">{product.name}</span>
          <span className="text-sm tabular-nums">
            {formatPriceAmount(price.amount, product.base_currency)}
          </span>
          {/* DICE DE QUE PRECIO SE TRATA cuando no es el de detal. Un numero
              sin etiqueta al lado de otro que resulta ser el de mayor es
              exactamente como se canta el precio equivocado leyendo la propia
              pantalla. */}
          <span className="text-xs text-muted-foreground">
            {price.tier === "wholesale" ? "al mayor" : product.unit ? product.unit : "al detal"}
          </span>
        </div>
      </button>

      {/* FUERA DEL BOTON, a proposito. Ver la cabecera del archivo. */}
      <label className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
        <span className="text-muted-foreground">Publicar</span>
        <Switch
          checked={published}
          disabled={pending}
          aria-label={`Publicar ${product.name} en el catálogo`}
          onCheckedChange={(next) => {
            setPublished(next);
            startTransition(async () => {
              const r = await setProductPublished(product.id, next);
              if (r.error) {
                setPublished(!next);
                toast.error(r.error);
                return;
              }
              router.refresh();
            });
          }}
        />
      </label>
    </li>
  );
}
