"use client";

import { useEffect, useState, useTransition, type ComponentType, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartColumn, Home, Loader2, Menu, Package, Plus, Users } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTour } from "@/components/dashboard/tour-context";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";
import { RegisterSheet } from "@/components/dashboard/register-sheet";
import { cn } from "@/lib/utils";
import { isProductDetailRoute } from "@/lib/products/routes";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { useSearchFocus } from "@/components/dashboard/search-focus-context";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { usePantallaVacia } from "@/components/dashboard/pantalla-vacia";

// The four places the bar navigates to, in order, before Menú. Exact pathname
// matching, not startsWith: a client's own screen replaces this whole bar
// anyway (see onClientDetail below), so there is no case where a child route
// should light up its parent here.
//
// NOTIFICACIONES LEFT THIS BAR on 2026-10-03, with delivery 3 of the redesign.
// It is not gone: it moved to the Inicio header, where it sits with its own
// unread badge, and `/notificaciones` is still a page the sidebar reaches. What
// it stopped being is one of the things a thumb can reach without reading.
//
// Reportes took the slot. The trade is deliberate: a notification is something
// you are told about (the badge does that from the header), while a report is
// something you have to decide to go and look at, which is exactly what a
// navigation bar is for.
//
// ─────────────────────────────────────────────────────────────────────────
// A FIFTH SLOT, AND IT OVERRULES SOMETHING WRITTEN HERE
//
// Owner's decision, 2026-10-09, from Figma frame 1175:5881: Catálogo joins the
// bar, which goes from four slots to five.
//
// The displaced reason is kept because it was a real measurement, not a whim:
// the bar was held to four on the grounds that four is what a thumb reaches
// without reading, and on 2026-10-03 "Agregar" was moved OUT to a floating
// button partly to protect that budget. Five slots cost touch width — 75px
// each at 375px instead of 93px — and that number is the thing to look at
// again if anybody reports mistaps.
//
// What bought it: a catalogue is the screen the shopkeeper opens mid-sale, with
// a customer in front of them asking a price. The sidebar is two taps and a
// read; the bar is one tap. The entry was in the sidebar until today and comes
// OUT of it in the same change — two doors to the same drawer is the thing
// DESIGN-SYSTEM.md warns about, and it would have been the obvious shortcut.
//
// ───────────────────────────────────────────────────────────────────────────
// Y OCULTO OTRA VEZ, QUE NO ES LO MISMO QUE DESHECHO
//
// Decisión del dueño el 2026-10-12: el catálogo se esconde de la navegación
// mientras no se lance. La pantalla, sus migraciones y sus enlaces públicos
// siguen existiendo y `/productos` responde si se escribe la URL — es una
// función terminada esperando turno, no una revertida.
//
// Un interruptor y no borrar las líneas, a propósito: volver a enseñarlo es
// cambiar `false` por `true`, y borrarlas se habría llevado por delante el
// porqué de abajo, que es una medición y no una opinión.
//
// EFECTO LATERAL QUE CONVIENE SABER: la barra vuelve a cuatro huecos, así que
// cada uno recupera sus 93px a 375px en vez de 75px. O sea que el presupuesto
// de pulgar que la quinta ranura gastó vuelve a estar entero mientras dure
// esto, y si alguien había reportado toques fallidos, aquí dejan de ocurrir.
//
// El lateral NO hace falta tocarlo: su entrada ya salió el 2026-10-09, cuando
// el catálogo entró en la barra, para no tener dos puertas al mismo cajón.
//
// ───────────────────────────────────────────────────────────────────────────
// Y VISIBLE OTRA VEZ — 2026-10-14
//
// Decisión del dueño al retomar el catálogo con el frame 1192:4185: vuelve a
// la navegación, aquí Y en el menú lateral. Esto último desplaza la decisión
// del 2026-10-09 que lo sacó del lateral para no tener dos puertas al mismo
// cajón; la razón vieja se deja escrita arriba, entera, porque sigue siendo
// cierta como argumento y es lo que haría falta si algún día se revierte.
//
// Vuelve también el efecto de la quinta ranura: a 375px cada hueco de la barra
// pasa de 93px a 75px. La medida está en DESIGN-SYSTEM.md.
const CATALOGO_VISIBLE = true;

const DESTINATIONS = (
  [
    { href: "/dashboard", label: "Inicio", icon: Home },
    { href: "/reportes", label: "Reportes", icon: ChartColumn },
    { href: "/productos", label: "Catálogo", icon: Package },
    { href: "/clients", label: "Clientes", icon: Users },
  ] as const
).filter((d) => CATALOGO_VISIBLE || d.href !== "/productos");

// Shown only below md. Deliberately a CSS media query rather than the
// useIsMobile hook: the hook resolves after hydration, so the bar would pop in
// a beat after the page paints and shove the content up — on every load, and
// worst on the cheap phones this app is used from. CSS is applied before the
// first frame.
//
// An iPhone in landscape is 812px wide, so it crosses this breakpoint and gets
// the desktop layout. That is the existing behaviour of every other responsive
// piece in the app and was left alone on purpose; the tour is made resilient to
// the switch instead.
// LA FILA DE LOS CINCO, 64px. El ALTO TOTAL de la barra no sale de aqui: son
// estos 64 mas el `py-2` de `navClass` mas los 8 extra de abajo, y esa suma
// vive en `--nav-bar-h` (globals.css) porque la reserva de `AppMain` y el
// `bottom` del boton flotante tienen que cuadrar con ella al pixel.
const NAV_HEIGHT_CLASS = "h-16";

function useOverlayOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Must test data-state, not mere presence. Radix leaves the dialog node in
    // the DOM after closing and only flips data-state to "closed" — testing
    // presence alone means the bar hides at the first dialog and NEVER comes
    // back, stranding the owner with no navigation at all.
    const check = () =>
      setOpen(document.querySelector('[role="dialog"][data-state="open"]') !== null);
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    check();
    return () => observer.disconnect();
  }, []);

  return open;
}


// Only the three destinations can be marked — Menú opens a sheet and Agregar is
// an action, so "selected" has no meaning for either. Deliberately exact-match
// only: Malas pagas, Subir libreta and Mi negocio live in the sidebar rather
// than in this bar, and a highlight meaning "somewhere in this section" would
// apply inconsistently across them.
//
// THE MARK IS A PILL **AND** AN UNDERLINE, owner's call on 2026-10-04 when the
// Figma spec and the shipped code disagreed: the spec drew the grey #f5f5f5
// pill (which is `--muted`), delivery 3 had shipped an underline, and the
// answer was both. The pill carries the "you are here" at a glance and the
// underline survives the case the pill is weakest at — a cheap screen in
// sunlight, where a 4% grey against white is the first thing to disappear.
//
// The underline is ALWAYS in the DOM, transparent when inactive. Rendering it
// only for the active item would make every label jump 5px the moment it became
// active, which on a bar of four is four different heights during a single
// navigation. The pill can afford to come and go because it wraps the content
// instead of sitting under it.
// UN ELEMENTO DE LA BARRA — frame `1421:15026`, 2026-10-18.
//
// ===========================================================================
// EL SUBRAYADO ES DEL CHIP, NO UNA PASTILLA APARTE
//
// Hasta hoy el chip y su rayita eran dos cajas apiladas con un hueco entre
// ellas, y la rayita medía 24px fuera cual fuera el rótulo. El frame lo une:
// el chip lleva `border-b-4` y por tanto el subrayado mide lo que mide el
// chip, siempre.
//
// SE GANA ALGO QUE NO SE VE EN UNA CAPTURA: con dos cajas, el elemento sin
// seleccionar reservaba igualmente el alto de la rayita invisible. Si alguien
// la quitaba «porque no se ve», los cinco elementos se movían dos píxeles.
//
// ===========================================================================
// TRES ESTADOS, Y LOS TRES LOS PIDIÓ EL DUEÑO EL 2026-10-18
//
//   · SELECCIONADO: fondo `muted`, borde inferior de 4px y el rótulo en tinta.
//   · PULSADO: el chip se oscurece mientras el dedo está encima. No es adorno:
//     entre tocar y que llegue la pantalla no pasaba NADA visible, y en un
//     teléfono lento eso se lee como que el toque no entró. El `active:` de
//     CSS dispara con el dedo, sin JavaScript y sin esperar al enrutador.
//   · CARGANDO: el icono se cambia por un círculo girando. Es lo que ya había
//     y el dueño pidió conservarlo; lo pone `glyph()` más abajo, no esto.
//
// NO HAY `hover:`, a propósito: esta barra es `md:hidden`, así que solo existe
// donde no hay ratón. Un `hover` ahí se queda pegado después de tocar.
//
// ===========================================================================
// EL ICONO SELECCIONADO NO SE RELLENA. DECISIÓN DEL DUEÑO EL 2026-10-19
//
// El frame `1421:15026` dibuja el estado seleccionado con el icono RELLENO, y
// no está puesto. No es un olvido: con los iconos de este proyecto no se puede.
//
// LO QUE SE MIDIÓ, el 2026-10-18: lucide dibuja con `stroke` y las formas
// vienen abiertas, así que un `fill="currentColor"` no las rellena — las
// convierte en otra cosa. `Home` sale como un pentágono macizo y `Package`
// como un hexágono liso: dos siluetas que ya no se reconocen. No es que quede
// feo, es que deja de decir qué pantalla es.
//
// Rellenarlos de verdad exigía traer una segunda familia de iconos (Material
// Symbols, que publica cada glifo en relleno y en línea) y convivir con dos.
// Preguntado al dueño, decidió lo contrario: **«no extraigas Material Symbols,
// deja los íconos originales del design system que estamos usando»**.
//
// Así que el estado seleccionado se distingue por el fondo, el subrayado de
// 4px y la tinta del rótulo — tres señales, que es más de lo que el frame
// pedía. Si algún día se cambia de familia de iconos, esto se puede retomar;
// mientras la familia sea lucide, no hay nada que probar aquí.
function NavItem({
  active,
  children,
  className,
  ...props
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
} & Record<string, unknown>) {
  return (
    <div className={cn("flex flex-1 items-center justify-center", className)} {...props}>
      <div
        className={cn(
          // `w-14` son los 56px del frame y `border-b-4` los 4 del subrayado.
          // El borde se pinta TRANSPARENTE cuando no está seleccionado en vez
          // de no ponerse: así los cinco chips miden lo mismo y el rótulo no
          // sube cuatro píxeles al cambiar de pantalla.
          "flex w-14 flex-col items-center gap-0.5 rounded-[4px] border-b-4 py-1",
          "text-xs transition-colors",
          active
            ? "border-foreground bg-muted text-foreground"
            : "border-transparent text-muted-foreground active:bg-muted/60",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ── LA BARRA ────────────────────────────────────────────────────────────
//
// SE DESMONTA ENTERA cuando hay un diálogo encima (`return null`, más abajo).
// Por eso recibe `onRegistrar` en vez de abrir la hoja ella misma: ver el
// comentario de `MobileNav`, al final del archivo, que cuenta el cuelgue.
function MobileNavBar({ onRegistrar }: { onRegistrar: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { guard } = useUnsavedChangesGuard();
  const { toggleSidebar } = useSidebar();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();
  const { revisando } = useRevisionEnCurso();

  // Drives the spinner. useLinkStatus can't be used here: this link calls
  // preventDefault so the unsaved-changes guard runs first, and a link whose
  // default was prevented never reports a pending state.
  const [isPending, startTransition] = useTransition();
  const [goingTo, setGoingTo] = useState<string | null>(null);

  // The bar does not render at all on a client's own screen — see below.
  // Note the trailing slash: /clients (the list) keeps its bar, only
  // /clients/<id> loses it. Eso cubre tambien `/clients/nuevo`, que es un
  // flujo de pantalla completa y por tanto quiere lo mismo.
  const onClientDetail = pathname.startsWith("/clients/");

  // NI BARRA NI FLOTANTE EN EL ASISTENTE DE VENTA. El frame `1389:8329` dibuja
  // una pantalla limpia: flecha, titulo, progreso y la cuadricula, y nada mas.
  //
  // SE ESCAPO AL CONSTRUIRLA, y es exactamente el fallo del que avisa el
  // comentario de `app-header.tsx`: la barra de mas la pone OTRO componente, y
  // quien escribe la pantalla nueva no tiene ninguna razon para abrir este
  // archivo. Lo vio el dueno en una captura — «una interfaz muy distinta al
  // frame».
  //
  // Y ADEMAS ESTORBA DE VERDAD: el flotante dice «Registrar» y abre la hoja que
  // empieza una venta, flotando ENCIMA de la venta que el tendero ya esta
  // haciendo. Pulsarlo tiraria el carrito sin avisar.
  //
  // SOLO EL ASISTENTE, desde el 2026-10-18. El resumen de la venta
  // (`/ventas/<id>`, frame `1389:8595`) SÍ dibuja la barra, y con razón: el
  // asistente es un flujo a medias del que no se sale sin tirar el carrito, y
  // el resumen es el final — el tendero ya terminó y lo siguiente que hace es
  // irse a otro sitio. Quitarle la barra ahí lo dejaría sin salida, porque esa
  // pantalla tampoco lleva cabecera.
  // EL FLUJO DEL ABONO TAMPOCO LLEVA BARRA, desde el 2026-10-19: son tres
  // pasos con su propia barra de progreso, igual que el asistente de venta.
  // Y EL DEL PRODUCTO, desde el 2026-10-20: cuatro pasos con su barra de
  // progreso, igual que los otros dos. Sin esto, la barra y el flotante se
  // montan encima del «Continuar» --visto en la pantalla antes de arreglarlo--.
  //
  // `=== "/productos/nuevo"` y no `startsWith("/productos")`: el catálogo SÍ
  // lleva barra, y es la pantalla de la que se entra.
  // ESTA ES LA TERCERA LISTA, Y ES LA QUE DE VERDAD TAPA EL BOTÓN. Una
  // pantalla con barra pegada abajo hay que apuntarla en tres sitios: dos en
  // `app-main.tsx` --que le dan su aire-- y esta, que es la única que decide
  // si la barra de navegación se dibuja ENCIMA.
  //
  // Medido el 2026-10-21 en una pantalla que faltaba aquí: su botón ocupaba
  // 732-772 y esta barra 723-812, así que `elementFromPoint` en el centro del
  // botón devolvía un icono de la barra. No era un botón mal colocado: era un
  // botón que NO SE PODÍA PULSAR, y desde fuera eso se ve como «le di y no
  // hizo nada», que es lo último que a alguien se le ocurre mirar aquí.
  //
  // Esa pantalla ya no existe --era una propuesta y se retiró-- pero la
  // lección no depende de ella: el síntoma no se parece en nada a la causa.
  const enAsistenteDeVenta =
    pathname.startsWith("/ventas/nueva") ||
    pathname.startsWith("/abonos/nuevo") ||
    pathname === "/productos/nuevo" ||
    /^\/productos\/[^/]+\/editar$/.test(pathname) ||
    // Y LA FICHA DEL PRODUCTO, desde el 2026-10-26. Su fila «Editar» /
    // «Eliminar» cae dentro de la banda de esta barra, así que sin esta línea
    // el flotante «Agregar» se monta encima de «Eliminar» -- el fallo que el
    // comentario de arriba midió en otra pantalla, donde el síntoma era «le di
    // y no hizo nada».
    isProductDetailRoute(pathname);

  // EL RESUMEN SÍ LLEVA EL FLOTANTE, desde el 2026-10-18 y a petición del
  // dueño: «en la pantalla final de transacción exitosa se debe ver el botón
  // flotante Registrar, agrégalo».
  //
  // LO HABÍA QUITADO YO, razonando que «Registrar» abre la hoja que empieza
  // OTRA venta encima del resumen de la que se acaba de hacer. El razonamiento
  // describe bien lo que el botón hace y se equivoca en lo que significa: en
  // un mostrador, terminar una venta es exactamente el momento en que llega el
  // siguiente cliente. Queda escrito con su motivo porque si algún día se
  // vuelve a quitar, conviene saber que ya se quitó una vez y por qué volvió.

  // THE FLOATING BUTTON CHANGES WHAT IT DOES ON THE CATALOGUE.
  //
  // Frame 1175:5881 draws a floating "Crear producto" on that screen. It is
  // this same button rather than a second one, and that is what fixes a bug
  // found by running the screen on 2026-10-09: the catalogue had its own
  // "Agregar producto" while this one said "Agregar" and opened **Registrar
  // movimiento** — two controls, one word, two different drawers, and the
  // floating one is the big one.
  //
  // It stays in `MobileNav` and does not move into the page because all four
  // conditions above — a dialog is open, the keyboard is up, a libreta is
  // being reviewed, we are on a client's screen — apply to it exactly as they
  // apply to the bar. A page-owned button would have to copy all four, and the
  // day one of them changed it would survive a keyboard the bar correctly got
  // out of the way of.
  //
  // So it navigates to `?nuevo=1` and the catalogue opens its own dialog from
  // that marker, exactly as Inicio already did. The mechanism is proven,
  // including the two traps `ClientSearchDialog` documents: repeat taps, and
  // clearing the marker through the router rather than `replaceState`.
  //
  // ========================================================================
  // DESDE EL 2026-10-18 «REGISTRAR» ABRE UNA HOJA, NO UNA PANTALLA
  //
  // Decisión del dueño, el mismo día y en dos pasos: primero *«los cuatro
  // pasos se mostrarán al presionar el botón "Agregar"»*, y luego *«al
  // seleccionar el botón "Registrar" mostrarás sheet con opciones: Nuevo
  // cliente; Fiado o Venta; Abono»* (frame `1389:11227`).
  //
  // POR QUÉ CAMBIÓ DOS VECES EN UN DÍA, que es lo que conviene no perder: el
  // paso 8 rompe la suposición de que hay UNA acción por defecto. Mientras
  // Sevenz era solo un libro de fiados, «Agregar» podía significar «agregar un
  // movimiento» sin ambigüedad. Con la venta dentro ya no: el tendero que abre
  // la app para anotar un abono y el que viene de vender son el mismo número
  // de tenderos, y un botón que elija por ellos se equivoca con la mitad.
  //
  // Y por eso el rótulo también cambió: «Agregar» nombra lo que hace el botón,
  // «Registrar» nombra lo que el tendero viene a hacer.
  //
  // EL CATÁLOGO SIGUE SIENDO OTRA COSA: ahí este mismo botón crea un producto,
  // y desde el 2026-10-20 navega a `/productos/nuevo`, que es una RUTA de
  // verdad y no un marcador.
  //
  // IBA CON `replace` A `?nuevo=1`, y tenía que ir así: el marcador vivía en
  // la misma página, y con `push` quedaba en el historial y reabría el
  // diálogo al volver atrás. Con una ruta propia es al revés — `push` es lo
  // correcto, porque la flecha del paso 1/4 tiene que poder volver al
  // catálogo.
  const enCatalogo = pathname === "/productos";
  // EL FLOTANTE SE APARTA CUANDO EL CATÁLOGO ESTÁ VACÍO. Instrucción del
  // dueño el 2026-10-20: ese estado vacío estrena su propio botón «Crear
  // producto» de ancho completo (frame `1500:9705`), y los dos a la vez son
  // dos controles con la misma etiqueta a cinco centímetros en una pantalla
  // que solo pide que uses uno. Ver `pantalla-vacia.ts`.
  const pantallaVacia = usePantallaVacia();
  const agregarHref = "/productos/nuevo";
  const agregarLabel = enCatalogo ? "Crear producto" : "Registrar";

  // NADA DE "AGREGAR" EN EL FLUJO DE SUBIR LIBRETA. Decision del dueno el
  // 2026-10-14, con una captura de la pantalla de carga de la foto.
  //
  // `revisando`, mas abajo, ya escondia este boton Y la barra -- pero solo
  // desde que la libreta esta leida y esperando confirmacion. El flujo empieza
  // mucho antes: elegir la foto, verla procesar, abrir los resultados, entrar
  // al detalle de una persona. En todo ese tramo el boton seguia ahi.
  //
  // POR QUE ESTORBA, y no es cuestion de gusto: subir una libreta ES registrar
  // movimientos, veinte de una vez. Un boton que dice "Agregar" encima de esa
  // pantalla ofrece la version de uno en uno de lo que el tendero ya esta
  // haciendo en lote, y al tocarlo se SALE del flujo --con la libreta a medio
  // revisar detras-- hacia un dialogo que hace lo mismo peor.
  //
  // UNA RUTA BASTA. El flujo entero vive en /import, dentro de `ImportFlow`:
  // las tres pantallas que el dueno nombro --la foto, los movimientos y el
  // detalle del cliente-- son estados de ese componente y no rutas propias.
  // `startsWith` cubre ademas cualquier subruta que se anada despues.
  //
  // ESCONDE SOLO EL BOTON, NO LA BARRA. La barra sigue siendo la via de salida
  // y el dueno no pidio quitarla; por eso esto va aqui y no en el `return null`
  // de mas abajo, que se lleva las dos por delante.
  const enSubirLibreta = pathname.startsWith("/import");

  // NI EN «MI NEGOCIO». A peticion del dueno el 2026-10-15, y por un motivo
  // distinto al de /import aunque el efecto sea el mismo.
  //
  // En /import el boton ofrece la version de uno en uno de lo que el tendero
  // ya esta haciendo en lote. Aqui no ofrece nada que tenga que ver: /profile
  // es una pantalla de AJUSTES --el logo, el nombre, el telefono, el pais-- y
  // un boton flotante que dice «Agregar» encima de un formulario de datos
  // propios solo puede leerse como «agregar algo de esto», que no existe.
  //
  // Ademas tapa el campo de abajo del formulario, que es como se vio: en la
  // captura del dueno se come la mitad de «Pais».
  const enMiNegocio = pathname.startsWith("/profile");

  // NI EN PEDIDOS. A petición del dueño el 2026-10-16, con dos capturas: una
  // de la lista y otra de la ficha.
  //
  // Es el mismo motivo que /profile y uno más. El que comparte: Pedidos es
  // una pantalla de LECTURA — lo que pidió otra persona — y aquí el botón ni
  // siquiera dice «Crear producto», porque `enCatalogo` solo mira
  // `/productos` exacto: decía «Agregar» y abría Registrar movimiento, que no
  // tiene nada que ver con el pedido que el tendero está mirando.
  //
  // El que no comparte, y se ve en la captura: TAPA. En la lista se come la
  // esquina de la última tarjeta y en la ficha se pone encima de las líneas
  // del pedido y al lado del botón de atender, que es la única acción que esa
  // pantalla tiene.
  //
  // `startsWith` y no igualdad, porque cubre la ficha `/productos/ordenes/[id]`
  // con la misma línea.
  const enPedidos = pathname.startsWith("/productos/ordenes");

  // ══════════════════════════════════════════════════════════════════════
  // LAS DOS PANTALLAS DE «TRANSACCIÓN REGISTRADA»: NI BARRA NI FLOTANTE
  //
  // 2026-10-24, orden del dueño: *«quita la barra de esas dos pantallas»*.
  // Hasta ese día aquí ponía «NO DIBUJA EL FLOTANTE. LA BARRA SÍ», y el
  // flotante era lo único medido.
  //
  // LO QUE FALTABA MEDIR ERA LA BARRA, y es peor que un solape. A 375px ocupa
  // 723-812 y los botones caen dentro, así que `elementFromPoint` en el centro
  // de cada uno devuelve un icono de la barra:
  //
  //   · abono registrado · «Compartir» 722-762        → NO SE PUEDE PULSAR
  //   · abono registrado · «Ver cuenta de…» 778-818   → NO SE PUEDE PULSAR
  //   · venta de contado · «Ver ‹nombre›» 723-763     → NO SE PUEDE PULSAR
  //
  // POR QUÉ NADIE SE HABÍA ESTRELLADO: las dos páginas se desplazan, y al
  // bajar los botones quedan libres. El caso roto es el de reposo, que es
  // justo donde el tendero los encuentra al terminar de cobrar.
  //
  // Y POR QUÉ NO SE VIO ANTES, que es la lección: se midió el flotante porque
  // el dueño lo señaló, y la barra no, porque nadie la señaló. Dos cosas fijas
  // sobre el mismo borde y solo una comprobada.
  //
  // NO DEJA A NADIE ENCERRADO, comprobado en las dos: las dos llevan la
  // cabecera de la app con «Abrir menú», así que hay salida a Inicio y a
  // Clientes sin la barra. Importa sobre todo en la venta de MOSTRADOR, que no
  // tiene cliente y por tanto tampoco botón «Ver ‹nombre›».
  //
  // ── LO QUE DESPLAZA, que queda escrito porque era razonado ──────────
  //
  // El flotante en el resumen de una venta era petición suya del 2026-10-18:
  // «en la pantalla final de transacción exitosa se debe ver el botón flotante
  // Registrar». Se hizo sobre una pantalla que entonces no tapaba nada. Y yo
  // mismo lo había quitado antes razonando que «Registrar» abre OTRA venta
  // encima del resumen de la que se acaba de hacer; el dueño lo devolvió
  // porque en un mostrador terminar una venta es cuando llega el siguiente
  // cliente. Las dos razones siguen siendo buenas; lo que las vence es que
  // los botones de debajo no se podían pulsar.
  //
  // Decisión del dueño el 2026-10-22, elegida entre tres con el coste
  // delante. Lo reportó con una captura: «Registrar» sentado encima de «Ver
  // cuenta de…».
  //
  // MEDIDO a 375px antes de decidirlo: el flotante ocupa 652-708 y ese botón
  // 628-668. Dieciséis píxeles montados, y en reposo —sin desplazar— que es
  // donde el tendero lo encuentra.
  //
  // POR QUÉ NO SE ARREGLÓ CON MAQUETACIÓN, que fue lo primero que se intentó:
  // el flotante es fijo y el contenido de esta pantalla TERMINA dentro de su
  // banda. Un `pb` por debajo no sube contenido ya colocado, y un `mt-auto` no
  // reparte un espacio que no sobra. Las dos cosas se probaron y se midieron
  // el mismo día; están escritas en la propia pantalla.
  //
  // ── LA MEDICIÓN DEL FLOTANTE, QUE VINO PRIMERO ─────────────────────
  //
  //
  // HASTA HOY AQUÍ PONÍA QUE EN ESA PANTALLA NO HABÍA SOLAPE, «sus botones
  // caen en 746, muy por debajo de la banda». Era verdad de la venta que se
  // midió —una FIADA, con su tarjeta de deuda, que es la más larga— y falso
  // de las otras. Medido a 375px, en reposo, las tres formas:
  //
  //   · venta fiada      → «Compartir» 731-771   · limpio
  //   · venta mostrador  → «Compartir» 481-521   · limpio
  //   · venta DE CONTADO con comprador → 667-707 · SOLAPA la banda 652-708
  //
  // Es el caso de en medio: la ficha del comprador más una tarjeta de moneda
  // sin bloque de deuda deja los botones justo dentro. Más corto se salva y
  // más largo también, y por eso una sola medición dio «limpio» y se escribió
  // como si valiera para toda la pantalla.
  //
  // LA LECCIÓN, que vale más que el arreglo: una pantalla cuyo alto depende de
  // los datos NO se mide una vez. Se mide en su caso corto, el medio y el
  // largo, porque el que rompe es el que cae dentro de la banda, no el extremo.
  //
  // Y SE QUITA AUNQUE SU PRESENCIA FUERA PETICIÓN SUYA DEL 2026-10-18: esa
  // petición se hizo sobre una pantalla que entonces no tapaba nada. La de hoy
  // la sustituye, y las dos quedan escritas.
  //
  // `(?!nuevo)` NO SOBRA: `/abonos/nuevo` es el paso 1/2 del flujo y ya sale
  // por `enAsistenteDeVenta`, pero encaja en `[^/]+` y dejarlo fuera aquí
  // también hace la intención legible sin ir a buscar la otra bandera.
  const enAbonoRegistrado = /^\/abonos\/(?!nuevo$)[^/]+$/.test(pathname);

  // El resumen de una venta, por lo escrito justo arriba. `(?!nueva)` por la
  // misma razón que `(?!nuevo)` en la línea de al lado: `/ventas/nueva` ya
  // sale por `enAsistenteDeVenta`, y excluirlo aquí deja la intención legible
  // sin ir a buscar la otra bandera.
  const enVentaRegistrada = /^\/ventas\/(?!nueva$)[^/]+$/.test(pathname);

  // ── REPORTES SE QUEDA SIN FLOTANTE, DESDE EL 2026-10-29 ─────────────
  //
  // Decisión del dueño, puesta a elegir con la medición delante. El asistente
  // que estrenó esa pantalla termina en dos botones de 40px --«Poco» y
  // «Mucho»-- y el flotante cae justo encima: él ocupa `y 652-708` y los
  // pulgares `625-665`.
  //
  // LA MEDICIÓN QUE LO DECIDIÓ, porque mirarla no bastaba: el CENTRO de cada
  // pulgar sigue recibiendo su toque, así que el botón no está muerto. Lo que
  // queda debajo es la PALABRA --«Poco» y «Mucho» viven en `645-661`-- y
  // `elementFromPoint` sobre ellas devuelve «Registrar». Se apunta a la
  // palabra, no al hueco de encima.
  //
  // Y NO HABÍA ARREGLO DE MAQUETACIÓN. El flotante es fijo y la altura del
  // banner depende de lo largo que salga el resumen ese día, así que unos días
  // taparía y otros no: una lotería es peor que un fallo constante, porque el
  // constante se reporta.
  //
  // LA BARRA SE QUEDA. Reportes es una de las cuatro pestañas y quitarle la
  // navegación sería dejar al tendero sin salida. Por eso esto va aquí, en la
  // lista del flotante, y no en el `return null` de arriba, que se lleva las
  // dos cosas.
  //
  // PRECEDENTE EN LOS DOS SENTIDOS, y conviene saberlo si algún día se
  // reabre: el 2026-10-26 el flotante se quitó de la ficha del producto por
  // esto mismo, y el 2026-10-24 el dueño lo devolvió a las pantallas de éxito
  // sabiendo que allí tapa botones en reposo.
  const enReportes = pathname === "/reportes";

  // EL DETALLE DE UNA TRANSACCIÓN: NI BARRA NI BOTÓN.
  //
  // Decisión del dueño el 2026-10-20, con una captura y la barra rodeada en
  // rojo: *«El nav bar no se debe ver en los detalles de las transacciones»*.
  //
  // Y DESPLAZA UNA DECISIÓN DEL DÍA ANTERIOR, que queda escrita porque era
  // razonada y no un descuido: al montar la pantalla se quitó solo el botón
  // «+» —caía encima de la foto adjunta, que es el respaldo que se abre esta
  // ficha para mirar— y se dejó la barra «como en Pedidos, porque esto es una
  // hoja a la que se llega desde una lista, no un flujo a medias». El dueño
  // vio la pantalla montada y decidió lo contrario.
  //
  // La ficha tiene su propia flecha de volver arriba, que además vuelve al
  // cliente del que salió, así que quitar la barra no deja a nadie encerrado.
  const enTransaccion = pathname.startsWith("/transacciones");

  // Cuenta pausada: ni se navega. Sin esto el boton llevaria a Cartera para
  // que alli saliera el dialogo, y desde Clientes eso es un salto de pantalla
  // que nadie pidio.
  const guardia = useGuardiaDeCuentaPausada();

  // ¿Hay un buscador con el foco? Lo pone `SearchField` y, desde el
  // 2026-10-18, también el buscador oscuro del Inicio.
  const { focused: buscando } = useSearchFocus();

  // Mientras una libreta leída espera confirmación, la barra se va: son
  // cuatro salidas de un toque junto al pulgar con veintitantos movimientos
  // sin guardar detrás. Todas preguntan antes de salir —van por el mismo
  // guard—, pero un diálogo que salta cuatro veces por error es peor que no
  // tener el atajo. Queda una sola salida, el chevron, y esa sí pregunta.
  // ── Y MIENTRAS SE BUSCA, TAMPOCO ────────────────────────────────
  //
  // ESTO REVIERTE UNA DECISIÓN DEL 2026-09-20, y las dos quedan escritas
  // porque la nueva no invalida el razonamiento de la vieja: entonces se
  // decidió DEJAR la barra —«quitarla gana 64px más, pero deja al dueño sin
  // navegación justo cuando más probable es que quiera salir»— y se midió en
  // las dos versiones. Ver `search-focus-context.tsx`.
  //
  // LO QUE CAMBIÓ NO ES EL CRITERIO, ES EL PROBLEMA. Aquello pesaba sitio
  // para LEER; esto es que la barra y el botón flotante se ponen ENCIMA de la
  // lista de resultados y tapan el primero. El dueño lo reportó con una
  // captura el 2026-10-18: el desplegable sale debajo del campo y «Registrar»
  // flota justo sobre él. No es incomodidad, es un resultado que no se puede
  // tocar.
  //
  // `useKeyboardOpen` ya lo cubría en un teléfono de verdad; no cubre el caso
  // en que el campo tiene el foco sin teclado —un escritorio estrecho, un
  // teclado físico, un móvil que no cambia el viewport visual—, que es
  // exactamente la captura.
  if (overlayOpen || keyboardOpen || buscando || revisando) return null;

  // Mirrors the sidebar's own link behaviour exactly, including the guard.
  // Without it the bar walked straight out of "Mi negocio" with unsaved edits
  // and no warning — the sidebar asks, so the bar has to ask too, or which
  // control you happened to use decides whether your work survives.
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string, before?: () => void) {
    // Let modifier and middle clicks open a new tab as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    guard(() => {
      before?.();
      setGoingTo(href);
      startTransition(() => {
        // Replace, never push: for Inicio it keeps the home screen from
        // stacking behind wherever the owner came from (matching the sidebar),
        // and for a client's page it keeps the marked URL out of history, so
        // Back can't land on it and reopen the dialog.
        router.replace(href);
      });
    });
  }

  const glyph = (href: string, Icon: ComponentType<{ className?: string }>) =>
    isPending && goingTo === href ? (
      <Loader2 className="size-6 animate-spin" />
    ) : (
      <Icon className="size-6" />
    );

  // The bar's own classes. The layout reserves exactly this much space, and a
  // variant that measured differently would strand the last row of content.
  // EL ALTO VIVE EN `--nav-bar-h` (globals.css) y de aquí solo salen sus
  // partes: `py-2` son los 8px de aire de arriba y de abajo del frame, y el
  // `pb` los sustituye abajo por 16 — los 8 del frame más 8 para despegar la
  // barra de la raya del iPhone, que es lo que pidió el dueño el 2026-10-18.
  //
  // `env(safe-area-inset-bottom)` va ADEMÁS, no en vez de: en un iPhone el
  // sistema reserva 34px para su raya y esos 16 son el aire por encima. En un
  // Android o en un escritorio ese `env()` vale 0 y los 16 son todo lo que
  // separa el chip del filo — que es justo el caso que se veía pegado.
  const navClass = cn(
    "fixed inset-x-0 bottom-0 z-40 border-t bg-background touch-manipulation md:hidden",
    "py-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]",
  );

  // Nothing at all on a client's own screen — neither the bar nor the floating
  // button. The bar used to carry "Agregar abono" / "Agregar fiado" here, but a
  // phone's own browser chrome — the native notification and address bars —
  // sits in exactly that strip and covered them, so the two actions an owner
  // comes to this screen for could be unreachable. They now live in the page
  // itself, under "Marcar como mala paga", where nothing can overlap them. The
  // screen keeps its own back chevron at the top for getting out.
  // ── LAS PANTALLAS DE ÉXITO VUELVEN A LLEVAR BARRA — 2026-10-24 ──────
  //
  // Salieron de esta salida temprana el mismo día que entraron. Orden del
  // dueño: *«Regresa el navbar a todas las pantallas de registros exitosos de
  // transacciones del lado del dueño»*, y con ella una regla de
  // `DESIGN-SYSTEM.md`: abono, fiado y venta, las tres con barra.
  //
  // LAS DOS DECISIONES QUEDAN ESCRITAS, porque la de hoy desplaza a la de
  // esta misma mañana y la razón de aquella no era mala. Se quitó al medir
  // que la barra —723-812 a 375px— dejaba **tres botones sin poder pulsarse**
  // en reposo: `elementFromPoint` en su centro devolvía un icono de la barra.
  // Eso sigue siendo cierto y el dueño lo sabe; lo que pesa más para él es
  // que estas pantallas no son un flujo a medias, son el final, y el tendero
  // sale de ellas a otro sitio.
  //
  // LO QUE LO HACE VIVIBLE: `app-main.tsx` ya les reserva 5,5rem abajo, así
  // que **desplazadas hasta el final las acciones quedan despejadas**. El
  // caso incómodo es el de reposo, y la salida nunca falta — las tres llevan
  // cabecera con «Abrir menú».
  //
  // EL FLOTANTE NO VUELVE, y no es un descuido: lo quitó él ayer por la misma
  // medición, y hoy pidió la barra, no el botón. Sale por la condición de
  // abajo.
  // ── Y EL FLUJO DE REGISTRAR UN PEDIDO, desde el 2026-10-25 ─────────
  //
  // No es criterio mío: los frames del flujo nuevo (`1654:13565`) no dibujan
  // la barra en ninguno de sus cuatro pasos, y el `Resumen V2` al que
  // desembocan sí la dibuja. O sea que la barra vuelve justo donde el flujo
  // termina.
  //
  // NO ENCIERRA A NADIE: las cuatro pantallas llevan su propia fila de volver
  // (`ScreenBackRow` con `soloEnTelefono={false}`), y el paso 1/4 es el
  // detalle del pedido, que sí tiene barra.
  // EL DETALLE DE UN PEDIDO TAMBIÉN, desde el 2026-10-25. Petición del
  // dueño con la captura y el círculo en rojo: *«botón «Marcar como
  // atendido» y navbar no aparecen en esta pantalla de nuevo pedido»*. Y el
  // frame le da la razón: `1655:15864` termina en «Registrar pedido», sin
  // barra y sin segundo botón.
  //
  // `[^/]+` DESPUÉS DE `ordenes/` Y NO `startsWith`: la LISTA de pedidos
  // (`/productos/ordenes` a secas) conserva su barra, porque es una lista a
  // la que se llega desde el catálogo y de la que se sale navegando.
  const enPedidoConcreto = /^\/productos\/ordenes\/[^/]+(\/|$)/.test(pathname);
  if (onClientDetail || enAsistenteDeVenta || enTransaccion || enPedidoConcreto)
    return null;

  return (
    <>
      {/* AGREGAR, FLOATING ABOVE THE BAR since 2026-10-03.

          It lives inside this component and not in its own file on purpose:
          every condition above — a dialog is open, the keyboard is up, a
          libreta is being reviewed, we are on a client's screen — applies to it
          exactly as it applies to the bar. A second component would have to
          copy all four, and the day one of them changed, the button would
          survive a keyboard that the bar correctly got out of the way of.

          Why it left the bar: it was the fourth of four equal-looking slots,
          three of which navigate. The only thing on this screen that WRITES
          looked like the three that only move you. Floating, it is the one
          control that is obviously not a destination.

          Y no sale en /import, ni en /profile, ni en Pedidos: ver
          `enSubirLibreta`, `enMiNegocio` y `enPedidos` arriba. */}
      {/* `enTransaccion` NO entra aquí: esa pantalla se va entera por el
          `return null` de arriba, así que nombrarla otra vez sería una
          condición que no se puede dar. */}
      {/* `pantallaVacia` se suma a la lista: con el estado vacío del catálogo
          a la vista, su propio botón «Crear producto» hace este sobrar. Ver
          `pantalla-vacia.ts`, y el comentario de `pantallaVacia` arriba. */}
      {!enSubirLibreta && !enMiNegocio && !enPedidos && !pantallaVacia && !enAbonoRegistrado && !enVentaRegistrada && !enReportes && (
      <button
        type="button"
        // Its own marker, not the one the page CTA uses. The tour finds its
        // target with querySelector, which returns whichever matches first in
        // the DOM — two elements sharing a marker means it can highlight the
        // wrong one, or one that isn't on screen.
        // The tour marker only on the movement variant. The tour finds its
        // target with querySelector, which returns whichever matches first in
        // the DOM; a marker on a button that opens a different dialog is a
        // tour that explains the wrong thing.
        data-tour={enCatalogo ? undefined : "new-client-button-mobile"}
        aria-label={enCatalogo ? "Crear producto" : "Registrar"}
        onClick={() => {
          if (guardia()) return;
          guard(() => {
            // Step 1's tooltip only renders on the dashboard. This code is
            // unreachable from a client's page now that this returns null
            // there, but the guard stays cheap and correct if that changes.
            if (tour.step === 1) tour.advance();
            // FUERA DEL CATÁLOGO NO NAVEGA: abre la hoja aquí mismo. Es lo que
            // quita el parpadeo de ir a otra pantalla para elegir entre tres
            // cosas, y lo que deja que el botón funcione igual desde Clientes
            // o Malas pagas sin mandar al tendero a Inicio primero.
            if (!enCatalogo) {
              onRegistrar();
              return;
            }
            setGoingTo(agregarHref);
            // `push` y no `replace`: desde el 2026-10-20 es una RUTA, no un
            // marcador, y la flecha del paso 1/4 tiene que poder volver aquí.
            // Ver el comentario de `agregarHref`.
            startTransition(() => router.push(agregarHref));
          });
        }}
        // Sits one gap above the bar, inside the strip `AppMain` already
        // reserves — so it never covers the last row of a list.
        // Figma spec, 2026-10-04: 56px tall, pill radius, 16 of padding on the
        // label side and 8 on the glyph side — the plus sits in a 40px box of
        // its own, so the smaller padding keeps it optically centred instead of
        // pushed against the edge.
        className={cn(
          "fixed right-4 z-40 flex h-14 items-center gap-1 rounded-full bg-primary py-2 pr-2 pl-4",
          "text-[17px] font-medium text-primary-foreground shadow-lg transition-colors",
          "active:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none md:hidden",
          "bottom-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+1rem)]",
        )}
      >
        {/* Label first, glyph second, from the spec. It reads as a sentence
            that way — "Agregar +" — where the other order reads as an icon
            button that happens to have a word stuck to it. */}
        {agregarLabel}
        <span className="flex size-10 items-center justify-center">
          {isPending && goingTo === agregarHref ? (
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-6" aria-hidden="true" />
          )}
        </span>
      </button>
      )}

      {/* z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The
          bar also unmounts while one is open, so this is belt and braces.
          touch-action: manipulation drops the browser's wait for a possible
          double-tap-to-zoom, which otherwise delays every single tap. */}
      <nav className={navClass} aria-label="Navegación principal">
        <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
          {/* The three destinations, then Menú. All three are anchors rather
              than buttons: Next prefetches a Link's href while it is on screen,
              and this bar always is, so each destination is preloaded before
              the owner ever taps. */}
          {DESTINATIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => navigate(e, item.href)}
              className="flex flex-1"
            >
              <NavItem active={pathname === item.href} className="w-full">
                {glyph(item.href, item.icon)}
                {item.label}
              </NavItem>
            </Link>
          ))}

          {/* Menú. A button and not a link, because it opens the sidebar sheet
              rather than going anywhere — and never marked, for the same
              reason. It is also why it cannot look "active": the sheet is a
              Radix dialog, so opening it unmounts this whole bar.

              THIS IS WHAT LETS THE INICIO HEADER DROP ITS HAMBURGER on a phone.
              The header kept one through delivery 2 precisely because this slot
              did not exist yet; the two must not both ship. */}
          <button
            type="button"
            onClick={() => guard(() => toggleSidebar())}
            className="flex flex-1"
            aria-label="Abrir menú"
          >
            <NavItem active={false} className="w-full">
              <Menu className="size-6" />
              Menú
            </NavItem>
          </button>
        </div>
      </nav>
    </>
  );
}

// ── LA BARRA Y LA HOJA, HERMANAS ────────────────────────────────────────
//
// LA HOJA NO PUEDE VIVIR DENTRO DE LA BARRA, y no es una cuestión de orden:
// colgaba la app entera. Se midió el 2026-10-18, el mismo día que se
// construyó, y el bucle es éste:
//
//   1. El botón flotante abre la hoja.
//   2. Radix monta `[role="dialog"][data-state="open"]`.
//   3. El `MutationObserver` de `useOverlayOpen` lo ve → `overlayOpen` pasa a
//      true.
//   4. `MobileNavBar` hace `return null` — esconderse cuando hay un diálogo
//      encima es justo su trabajo— y con ella se DESMONTA la hoja.
//   5. El observer ve que ya no hay diálogo abierto → `overlayOpen` vuelve a
//      false.
//   6. La barra se vuelve a montar, el estado «abierta» sigue siendo true, la
//      hoja se abre otra vez → paso 2.
//
// A velocidad de `MutationObserver`, que es cada microtarea: el navegador se
// queda sin hilo y no responde. No se parece a un bucle de render normal
// —React no avisa de «máximo de actualizaciones»— porque el ciclo pasa por el
// DOM y por un observer, no por un `setState` dentro de un render.
//
// LA REGLA QUE SE SACA DE AQUÍ: un componente que se desmonta solo bajo cierta
// condición no puede ser el padre de algo que PROVOCA esa condición. El
// `return null` de la barra y la hoja que lo dispara tienen que estar en
// niveles distintos, y por eso el estado vive aquí arriba.
export function MobileNav() {
  const [registrar, setRegistrar] = useState(false);
  return (
    <>
      <MobileNavBar onRegistrar={() => setRegistrar(true)} />
      <RegisterSheet open={registrar} onOpenChange={setRegistrar} />
    </>
  );
}
