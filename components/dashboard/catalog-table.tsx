"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCatalogFilters } from "@/components/dashboard/catalog-filters";
import { setProductPublished } from "@/app/(app)/productos/actions";
import { formatPriceAmount } from "@/lib/products/price";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination, PAGE_SIZE } from "@/components/dashboard/list-pagination";
import { marcarPantallaVacia } from "@/components/dashboard/pantalla-vacia";
import { ProductShareButton } from "@/components/dashboard/product-share-button";
import {
  isPublished,
  listPrice,
  type ProductRow,
} from "@/lib/products/catalog";

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
// OCHO PROPS MENOS DESDE EL 2026-10-20. `overrides`, `currencies`,
// `supplierSuggestions`, las dos monedas del último producto, `rates`,
// `defaultCurrency` y `ownerId` llegaban hasta aquí SOLO para alimentar los
// dos diálogos que esta lista montaba. Con el alta y la edición en sus
// propias rutas, cada una pide lo suyo al servidor y esta tabla vuelve a ser
// lo que su nombre dice: la rejilla.
export function CatalogTable({ loadFailed, businessName, catalogToken }: {
  // La consulta del catalogo fallo. NO es lo mismo que no tener productos, y
  // esa diferencia tiene su propia pantalla — ver la pagina.
  loadFailed: boolean;
  // Los dos bajan hasta el boton «Compartir» de cada tarjeta, y los dos vienen
  // del SERVIDOR por la misma razon que en `catalog-share.tsx`: con el token
  // ya en la mano no hay ningun `await` entre el toque y la hoja nativa, que
  // es lo que iOS Safari rechaza. Solo la primerisima vez hay espera.
  businessName: string;
  catalogToken: string | null;
}) {
  const router = useRouter();
  const { visible, total, query, sortBy, status, minAmount, maxAmount } = useCatalogFilters();
  // ── PAGINADO, LA MISMA REGLA QUE CLIENTES ────────────────────────────
  //
  // Encargo del dueño el 2026-10-20. Hasta hoy esta rejilla pintaba TODOS
  // los productos de un negocio: con ciento y pico, el teléfono renderiza
  // ciento y pico de tarjetas con su foto para enseñar seis.
  //
  // VUELVE A LA 1 AL FILTRAR O BUSCAR, por lo mismo que el historial: sin
  // ello, quien esté en la página 3 y escriba en el buscador ve una rejilla
  // vacía con el paginador diciendo «Página 1 de 1». Se hace con un efecto y
  // no en el setter porque el filtro vive en un contexto, no aquí.
  const [page, setPage] = useState(1);
  const paginas = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paginaSegura = Math.min(page, paginas);
  const pagina = visible.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE);

  // SE AJUSTA DURANTE EL RENDER, NO EN UN EFECTO. Un `useEffect` aquí pinta
  // la página vieja y la corrige después --dos renders donde cabe uno-- y
  // `eslint` lo rechaza con `react-hooks/set-state-in-effect`. Es el patrón
  // que React documenta para «ajustar estado cuando cambia una prop».
  //
  // LA CLAVE SON LOS FILTROS, NO `visible.length`. Parece lo mismo y no lo
  // es: borrar un producto también cambia esa longitud, y con ella en la
  // clave el tendero que borra algo desde la página 3 aterriza en la 1 sin
  // haber tocado ningún filtro.
  // LA BANDERA PARA LA BARRA DE ABAJO. Ver `catalogo-vacio.ts`: con el estado
  // vacío a la vista, su botón flotante de «Crear producto» sobra, porque esa
  // caja ya trae el suyo.
  //
  // `marcarPantallaVacia` NO es `setState`, así que este efecto no choca con
  // `react-hooks/set-state-in-effect`. Y la limpieza del `return` es lo que
  // evita que el flotante desaparezca del resto de la app al salir de aquí.
  const estadoVacioALaVista = total === 0 && !loadFailed;
  useEffect(() => {
    marcarPantallaVacia(estadoVacioALaVista);
    return () => marcarPantallaVacia(false);
  }, [estadoVacioALaVista]);

  const claveDeFiltros = `${query}|${sortBy}|${status}|${minAmount}|${maxAmount}`;
  const [claveprevia, setClavePrevia] = useState(claveDeFiltros);
  if (claveDeFiltros !== claveprevia) {
    setClavePrevia(claveDeFiltros);
    setPage(1);
  }
  // AQUÍ VIVÍA EL APARATO DE `?nuevo=1`: el estado del diálogo de alta, la
  // transición false -> true que lo abría en cada toque del flotante, y el
  // efecto que limpiaba el marcador de la dirección al cerrar. Las tres
  // piezas existían porque un diálogo comparte pantalla con lo que hay
  // detrás; con una ruta propia, el flotante NAVEGA y no hay nada que
  // sincronizar. El historial las guarda con los dos fallos que costaron.

  // AQUÍ VIVÍAN LOS DOS DIÁLOGOS --el de alta y el de edición-- hasta el
  // 2026-10-20. Ahora los dos son PANTALLAS: `/productos/nuevo` y
  // `/productos/<id>/editar`, frame `1465:18582`.
  //
  // Lo que se va con ellos es todo el aparato que un diálogo que no se
  // desmonta necesitaba: la `key` que limpiaba el formulario tras crear, el
  // `onSaved` para distinguir «guardó» de «cerró», y el efecto que borraba el
  // `?nuevo=1` de la dirección. Una pantalla se desmonta al salir, así que
  // vuelve a entrar vacía sin que nadie lo organice.

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
        {/* FRAME `1500:9705`. El subtítulo es MÁS CORTO que el que había: el
            frame se queda en «Los productos que agregues acá podrán verse
            reflejados en el catálogo» y suelta las dos frases que seguían
            --que los ven tus clientes, y que se agregan solos al fiar--. Se
            respeta: en una pantalla cuyo único trabajo es que pulses un
            botón, cuatro líneas de explicación compiten con él.

            Y EL BOTÓN SALE A TODAS LAS ANCHURAS, relleno y de ancho completo.
            Antes era `hidden md:inline-flex` porque en el teléfono lo hacía
            el flotante de la barra; ahora el flotante es el que se aparta
            --ver `catalogo-vacio.ts`--, que es lo que el dueño pidió. */}
        <EmptyState
          title="Todavía no tienes productos"
          subtitle="Los productos que agregues acá podrán verse reflejados en el catálogo."
        >
          <Button type="button" className="h-10 w-full text-base font-semibold" onClick={() => router.push("/productos/nuevo")}>
            <Plus className="size-5" /> Crear producto
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Solo escritorio: en telefono esta accion es el boton flotante de la
          barra de abajo, que navega a `?nuevo=1`. Dos disparadores visibles a
          la vez en el mismo tamaño serian dos puertas al mismo cajon. */}
      <div className="hidden md:flex md:justify-end">
        <Button type="button" onClick={() => router.push("/productos/nuevo")}>
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
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pagina.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                businessName={businessName}
                catalogToken={catalogToken}
                // ── A LA FICHA, NO AL EDITOR, DESDE EL 2026-10-26 ──────
                // La tarjeta abría `/productos/<id>/editar` directamente, y la
                // anotación del frame del catálogo (`1175:6069`) lo respalda:
                // «Al seleccionar el producto entra a editar».
                //
                // LA DESPLAZA UN CONECTOR MÁS NUEVO, de esta misma tarjeta
                // (`1175:5758`) a la foto de la ficha (`1730:14330`), y el
                // encargo del dueño de abrir «el detalle del producto desde el
                // lado del dueño» -- que no existiría si esto siguiera yendo al
                // editor. «Editar» vive ahora dentro de la ficha.
                onEdit={() => router.push(`/productos/${p.id}`)}
              />
            ))}
          </ul>
          <ListPagination page={paginaSegura} pageCount={paginas} onPage={setPage} />
        </>
      )}

    </div>
  );
}

function ProductCard({
  product,
  businessName,
  catalogToken,
  onEdit,
}: {
  product: ProductRow;
  // Los dos solo existen para el botón «Compartir», que arma el mensaje y la
  // URL del catálogo público. Ver `ProductShareButton`.
  businessName: string;
  catalogToken: string | null;
  onEdit: () => void;
}) {
  const router = useRouter();
  // Sin leer `pending`: era lo que deshabilitaba el interruptor 4,4 segundos.
  // La transición sigue haciendo falta para el `router.refresh()` de dentro.
  const [, startTransition] = useTransition();
  // Optimista: el interruptor se mueve en el acto y se revierte si el servidor
  // dice que no. Sin esto el gesto tarda un viaje de ida y vuelta, y en un
  // telefono barato eso se siente como que no respondio y se vuelve a tocar.
  // EL INTERRUPTOR SE DERIVA DE LOS DATOS, NO LOS SUPLANTA.
  //
  // Esto era `useState(isPublished(product))`, y `useState` solo mira su
  // argumento en el PRIMER render. Reportado por el dueño el 2026-10-10:
  // publicó «Alicate» desde su ficha, la base quedó en `true, true` — está
  // comprobado— y la tarjeta siguió enseñando el interruptor apagado.
  //
  // El motivo: guardar hace `router.refresh()`, llegan datos nuevos y la
  // tarjeta se vuelve a renderizar, pero NO se vuelve a montar — misma clave,
  // misma posición. Así que su estado se quedó con el valor del día que se
  // montó, y a partir de ahí la pantalla contradecía a la base.
  //
  // Lo que manda ahora es la prop. `optimista` solo existe durante el viaje de
  // ida y vuelta de un toque, y se descarta en cuanto el servidor contesta con
  // un valor distinto del que había — que es la señal de que ya no hace falta
  // adivinar.
  const real = isPublished(product);
  const [optimista, setOptimista] = useState<boolean | null>(null);
  const [realPrevio, setRealPrevio] = useState(real);
  if (real !== realPrevio) {
    setRealPrevio(real);
    setOptimista(null);
  }
  const published = optimista ?? real;
  const setPublished = setOptimista;

  // EL INTERRUPTOR DE LA TARJETA ES UNO Y LOS ESCALONES SON DOS, asi que
  // encender tiene que decidir cual. Encender pone DETAL, que es lo que la
  // ficha marca por defecto y el caso corriente; apagar quita los dos, porque
  // un interruptor que dice «Publicar» y deja el producto en el catalogo de
  // mayorista miente.
  //
  // Lo que esto arregla, encontrado mirando la pantalla el 2026-10-10: un
  // producto publicado SOLO al mayor se quedaba en «al detal» al apagarlo y
  // volverlo a encender aqui. Su lista de mayorista pasaba a estar a la vista
  // de cualquier cliente sin que nada lo dijera. Ahora se recuerda el par de
  // esta sesion y se restaura tal cual.
  //
  // Tras recargar la pagina no hay nada que recordar y vuelve a ser detal:
  // esto cubre el toque equivocado, que es el caso real, no una memoria
  // permanente que habria que guardar en algun sitio.
  const [ultimo, setUltimo] = useState<{ retail: boolean; wholesale: boolean }>({
    retail: product.published_retail,
    wholesale: product.published_wholesale,
  });

  const price = listPrice(product);

  return (
    <li className="relative flex flex-col overflow-hidden rounded-xl border bg-background">
      {/* ── «COMPARTIR», SOBRE LA FOTO — frame `1175:5758` ──────────────
          Encargo del dueño el 2026-10-27.

          VA AQUÍ, HERMANO DEL BOTÓN DE LA TARJETA, Y NO DENTRO. Lo primero
          que escribí fue meterlo dentro --queda sobre la foto, que es donde
          el frame lo dibuja-- y eso es un `<button>` dentro de otro
          `<button>`: HTML inválido, y React lo rechaza con un error de
          hidratación que repinta la lista entera. Lo cazó la consola del
          navegador en la primera pasada.

          Colgado del `<li>`, que ahora es `relative`, cae en el mismo sitio:
          la foto ocupa la parte de arriba de la tarjeta. Y su
          `stopPropagation` sigue haciendo falta, porque el toque burbujea
          hasta el botón de al lado. */}
      <ProductShareButton
        productId={product.id}
        productName={product.name}
        businessName={businessName}
        initialToken={catalogToken}
      />
      {/* «Abrir» Y NO «Editar» desde el 2026-10-26: la tarjeta lleva a la
          ficha, no al editor. Un lector de pantalla anunciaba «Editar QA
          Harina» y lo que se abría era una pantalla de leer -- era el único
          sitio de la app donde ese nombre seguía siendo el de antes. */}
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-col text-left transition-colors active:bg-accent"
        aria-label={`Abrir ${product.name}`}
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
          {/* DICE SIEMPRE DE QUE PRECIO SE TRATA, y desde el 2026-10-10 hace
              mas falta: la tarjeta ensena el MAS BAJO de los dos, asi que en
              un producto con los dos precios lo normal es que sea el de mayor.
              Un numero sin etiqueta al lado de otro que resulta ser el de
              mayor es exactamente como se canta el precio equivocado leyendo
              la propia pantalla.

              La unidad se queda detras en vez de desaparecer: antes se perdia
              en cuanto el escalon era "al mayor". */}
          <span className="truncate text-xs text-muted-foreground">
            {price.tier === "wholesale" ? "al mayor" : "al detal"}
            {product.unit ? ` · ${product.unit}` : ""}
          </span>
        </div>
      </button>

      {/* FUERA DEL BOTON, a proposito. Ver la cabecera del archivo. */}
      <label className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
        <span className="text-muted-foreground">Publicar</span>
        {/* SIN `disabled`, Y ESO ES EL ARREGLO. Medido el 2026-10-14 tras
            reportarlo el dueño: «se queda pegado cuando se apaga y hay que
            seleccionarlo varias veces para que se active de nuevo».

            Llevaba `disabled={pending}`, y `pending` no cubría solo la
            escritura: dentro de la misma transición va un `router.refresh()`
            que recarga la pantalla entera. Cronometrado en esta rejilla,
            **4,4 segundos** desde el toque hasta que el control volvía a
            aceptar otro. El interruptor se apagaba a los 0,28s, así que lo que
            el tendero ve es un control que ya cambió y no responde — y toca
            otra vez, y otra.

            No hace falta bloquearlo: `optimista` ya enseña el valor del último
            toque, un fallo del servidor lo revierte con su aviso, y dos toques
            seguidos mandan dos escrituras de las que gana la última, que es
            justo la que el tendero quiso. */}
        <Switch
          checked={published}
          aria-label={`Publicar ${product.name} en el catálogo`}
          onCheckedChange={(next) => {
            setPublished(next);
            const tiers = next
              ? ultimo.retail || ultimo.wholesale
                ? ultimo
                : { retail: true, wholesale: false }
              : { retail: false, wholesale: false };
            if (!next) setUltimo({ retail: product.published_retail, wholesale: product.published_wholesale });
            startTransition(async () => {
              const r = await setProductPublished(product.id, tiers);
              if (r.error) {
                setPublished(!next);
                if (avisarCuentaPausada(r.error)) return;
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
