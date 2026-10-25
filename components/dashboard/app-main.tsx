"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";

// Wraps <main> purely so the bottom padding can follow whether MobileNav
// actually renders. That reservation is unconditional by design — the bar
// unmounts while a dialog or the keyboard is open, and a padding that came
// and went with it would make the page jump underneath the owner. But
// MobileNav renders nothing at all on a client's own screen, so there the
// reserved strip is permanent dead air below the content.
//
// Same predicate as MobileNav's, trailing slash included: /clients (the list)
// keeps its bar, only /clients/<id> loses it. If one changes the other has to.
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Revisando una libreta la barra no está, así que su franja reservada sería
  // aire muerto — y aquí sí puede seguir al estado sin que la página salte
  // debajo del dueño: entrar y salir de la revisión ya cambia la pantalla
  // entera, no es el parpadeo de un diálogo abriéndose.
  const { revisando } = useRevisionEnCurso();

  // EL ASISTENTE DE VENTA TAMPOCO LLEVA BARRA, y hasta el 2026-10-18 esto no
  // lo sabía: `MobileNav` devuelve `null` en `/ventas/nueva` desde que la
  // pantalla existe, y aquí se seguían reservando el alto de una barra que no
  // se dibuja. El resultado eran 80px de aire muerto debajo del botón de cada
  // paso — justo la clase de hueco que este comentario lleva avisando desde
  // que se escribió, y que nadie mide porque un hueco de más no rompe nada.
  //
  // El resumen (`/ventas/<id>`) SÍ la lleva: ver `mobile-nav.tsx`.
  // El flujo del abono se comporta igual que el de venta: sin barra, y su
  // propio aire abajo. Anadido el 2026-10-19 con `/abonos/nuevo`.
  //
  // Y EL FLUJO DEL PRODUCTO, desde el 2026-10-20: sus cuatro pasos tampoco
  // llevan barra de navegación. Sin esta línea, `hasBar` seguía en `true` y
  // `main` reservaba los 104px de la barra que ya no se dibuja, así que los
  // botones quedaban con un hueco blanco debajo. Lo reportó el dueño con la
  // captura del 1/4 y la del 4/4.
  //
  // BOTH LISTS IN THIS FILE ARE NEEDED, AND THAT IS WHAT COST ME TWO TRIES.
  // First I put the routes only in `conBarraDeBotones`, and the gap stayed
  // exactly as it was: that list never touches `hasBar`, so `main` kept
  // reserving the 104px of a bar that is not drawn. Then only here, and it
  // dropped to 16px: `hasBar` was `false` by then, but a route missing from
  // `conBarraDeBotones` falls through to the last branch of the `cn`, the
  // `+1rem` one.
  //
  // SO: this list removes the nav bar's height; the other removes the 16px of
  // air every ordinary screen carries underneath. A screen with
  // `StickyActions` needs both, because that bar brings its own 40px and sits
  // flush against the edge.
  // EL FLUJO DE REGISTRAR UN PEDIDO TAMPOCO LLEVA BARRA, desde el 2026-10-25.
  // Lo dicen los propios frames: el `Resumen V2` dibuja «Inicio · Reportes ·
  // Catálogo · Clientes · Menú» y NINGUNA de las cuatro pantallas del flujo lo
  // hace. Y hace falta además porque el paso 2/4 monta `StickyActions`: con la
  // barra dibujada, esa barra de botones se queda DEBAJO de ella, que es el
  // defecto que `CT-148` midió en otra pantalla.
  // Y EL DETALLE DE UN PEDIDO, desde el 2026-10-25, por la misma petición
  // del dueño: ni barra ni su altura reservada. La LISTA sí la conserva, de
  // ahí el `[^/]+` y no un `startsWith`.
  const enRegistroDePedido = /^\/productos\/ordenes\/[^/]+(\/|$)/.test(pathname);
  const enAsistenteDeVenta =
    enRegistroDePedido ||
    pathname.startsWith("/ventas/nueva") ||
    pathname.startsWith("/abonos/nuevo") ||
    pathname === "/productos/nuevo" ||
    /^\/productos\/[^/]+\/editar$/.test(pathname);
  const hasBar = !pathname.startsWith("/clients/") && !enAsistenteDeVenta && !revisando;

  // ── CUÁNTO AIRE DEBAJO DEL ÚLTIMO BOTÓN ────────────────────────────
  //
  // 40px en todo el flujo de registrar, a petición del dueño el 2026-10-18:
  // «para que los botones no queden tan pegados a la parte inferior del
  // teléfono ni el widget». Son 2,5rem, y se miden hasta lo que haya debajo —
  // el filo de la pantalla donde no hay barra, la barra donde la hay.
  //
  // POR QUÉ ES UNA EXCEPCIÓN Y NO EL NUEVO VALOR DE TODA LA APP: en una
  // pantalla de lista los 16px de siempre son correctos, porque lo último no
  // es un botón sino una fila más y el aire de sobra se lee como «se acabó».
  // Aquí lo último SÍ es el botón que cierra la venta, y es el único sitio
  // donde el pulgar tiene que acertar a la primera.
  // LAS CUATRO CLASES VAN ESCRITAS ENTERAS, Y NO ES VERBOSIDAD: Tailwind
  // genera CSS leyendo el texto del fichero, así que una clase compuesta —
  // `pb-[calc(…+${aire})]` — no existe en la hoja de estilos y el padding
  // simplemente no se aplica. No da error de compilación ni de tipos: la
  // pantalla sale con los botones pegados abajo y parece que el cambio no se
  // hizo.
  // LAS DOS PANTALLAS QUE LLEVAN `StickyActions` NO ENTRAN: su barra de
  // botones trae su propio aire de 40px, y sumarle el de aqui lo doblaria a
  // 80 -- la barra se quedaria flotando a media altura al final del scroll.
  //
  // El resumen de la venta (`/ventas/<id>`) si entra: sus botones no estan en
  // una barra, y su «Compartir» es la ultima cosa de una pagina que se
  // desplaza.
  // LA BARRA PEGADA ABAJO TRAE SU PROPIO AIRE DE 40px, asi que estas rutas no
  // pueden recibir el de aqui: serian 56 y la barra se quedaria flotando a
  // media altura al final del scroll. Es el descuadre que el comentario de
  // arriba cuenta medido en pantalla.
  //
  // LA BARRA INCLINADA DE `/abonos/nuevo/` IMPORTA: el paso 1/3 —la lista de
  // fiados, en `/abonos/nuevo` a secas— NO lleva barra de botones; se elige
  // tocando una tarjeta. La llevan los pasos siguientes, que viven bajo esa
  // ruta con el id del fiado. Sin la barra inclinada, la lista se comeria 40px
  // que nadie pone.
  //
  // AND THE PRODUCT FLOW'S FOUR STEPS, since 2026-10-20: the owner asked for
  // the buttons «pegados a la parte inferior de la pantalla», and without this
  // line they sat 16px off the edge. All four screens mount the SAME
  // `StickyActions` — one instance, only the body changes — so no single step
  // behaves differently.
  const conBarraDeBotones =
    // El paso 2/4 del registro de un pedido: su «Confirmar y continuar» va en
    // `StickyActions`, que trae sus propios 40px.
    /^\/productos\/ordenes\/[^/]+\/registrar\/confirmar$/.test(pathname) ||
    pathname.startsWith("/ventas/nueva") ||
    pathname === "/clients/nuevo" ||
    pathname.startsWith("/abonos/nuevo/") ||
    pathname === "/productos/nuevo" ||
    /^\/productos\/[^/]+\/editar$/.test(pathname) ||
    // EL DETALLE DE UNA TRANSACCIÓN, desde el 2026-10-21: sus botones
    // «Compartir» y «Pagar» pasaron a `StickyActions` por instrucción del
    // dueño —*«siempre visibles en la parte inferior»*— y esa barra trae sus
    // propios 40px. Sin esta línea `main` le suma los 16 de toda pantalla
    // normal y la barra se queda flotando al final del scroll.
    //
    // NO ES `startsWith("/transacciones/")`: la ruta de una venta de contado
    // (`/transacciones/venta/<id>/<moneda>`) no monta esos botones, así que
    // quitarle el aire la dejaría pegada al filo sin nada que lo ocupe.
    /^\/transacciones\/[^/]+$/.test(pathname);
  // ═══════════════════════════════════════════════════════════════════════
  // LAS PANTALLAS DE «SALIÓ BIEN» QUE ADEMÁS LLEVAN EL BOTÓN FLOTANTE
  //
  // Son las que terminan un flujo con sus acciones al final del contenido y
  // el flotante encima. Necesitan el aire grande de abajo, o el botón se les
  // sienta en la última acción.
  //
  // `/abonos/[id]` SE AÑADE EL 2026-10-22, reportado por el dueño con una
  // captura: el flotante encima de «Ver cuenta de…». Medido antes de tocarlo,
  // a 375px: el flotante ocupaba 652-708 y ese botón 628-668, o sea 16px
  // montados. La del resumen de venta ya estaba aquí desde el 2026-10-18 y por
  // eso no fallaba; esta nació después y nadie la apuntó.
  //
  // `(?!nuevo$)` NO SOBRA: `/abonos/nuevo` encaja en `[^/]+` y es el paso 1/2
  // del flujo, que lleva su propia barra pegada abajo y ya sale de aquí por
  // `conBarraDeBotones`. Darle además este `pb` le pondría 88px de hueco
  // muerto bajo su propia barra.
  //
  // SE MIDIERON LAS CINCO el mismo día antes de cambiar nada, y solo esta
  // estaba rota: venta (botones a 746, libre), `/transacciones` y el detalle
  // de un pedido (no dibujan flotante) y el catálogo (su última fila cae muy
  // por debajo). Lo que se arregla es una, no un patrón.
  const enFlujoDeRegistrar =
    (pathname.startsWith("/ventas/") || /^\/abonos\/(?!nuevo$)[^/]+$/.test(pathname)) &&
    !conBarraDeBotones;

  // EL CATÁLOGO NECESITA EL MISMO AIRE QUE EL RESUMEN, y este comentario es la
  // continuación del de abajo, que dejó escrito «si algún día estorba allí
  // también, la cuenta está aquí». Llegó ese día: un dueño lo reportó desde
  // producción el 2026-10-21, con la captura y el círculo en rojo.
  //
  // LO QUE CAMBIA NO ES EL SOLAPE SINO LO QUE HAY DEBAJO. En una lista normal
  // el flotante muerde la última fila, que es texto, y se leía igual. En el
  // catálogo la última tarjeta lleva el interruptor «Publicar», o sea un
  // control que se toca — y uno que decide si ese producto lo ven los clientes
  // del negocio. Tapar texto molesta; tapar ese interruptor impide usarlo, y
  // además con el dedo encima no se ve si quedó encendido o apagado.
  //
  // `/productos` A SECAS, sin sus hijos: `/productos/nuevo` y `/productos/
  // <id>/editar` ya entran por `enAsistenteDeVenta` y llevan su propia barra
  // pegada abajo, así que sumarles esto les daría 5,5rem de aire muerto.
  const conFilaQueSeToca = pathname === "/productos";

  return (
    <main
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:pb-4",
        // 5.5rem Y NO 2.5 EN EL RESUMEN, desde que recupero el boton flotante
        // el 2026-10-18: ese boton mide 56px y flota a 1rem por encima de la
        // barra, asi que con los 40 de antes se comia «Compartir» -- la unica
        // accion de esa pantalla. 1rem + 56px + un hueco = 5,5rem.
        //
        // El resto de pantallas con flotante conviven con ese solape sobre la
        // ultima fila de una lista, que molesta mucho menos que tapar un
        // boton. Si algun dia estorba alli tambien, la cuenta esta aqui.
        //
        // QUEDAN 2,75px DE SOLAPE y se quedan. Decision del dueno el
        // 2026-10-19: «dejalo como esta».
        //
        // Medido el 2026-10-18 en un resumen CORTO —una sola linea de producto,
        // sin deuda antigua, a 375px— donde la pagina no llega a desplazarse:
        // ahi el boton flotante muerde 2,75px del borde superior de
        // «Compartir». Con cualquier resumen mas largo no pasa, porque la
        // pagina se desplaza y el `pb` hace su trabajo.
        //
        // POR QUE NO SE PERSIGUE: cerrarlo pide que el `pb` sepa si la pagina
        // se desplaza o no, que es un calculo en tiempo de ejecucion, con su
        // observador y su reflow, para 2,75px que no tapan ni el texto ni el
        // area tocable del boton. Si alguna vez un tendero reporta que no
        // puede darle a «Compartir», el numero a subir es este 5.5rem.
        hasBar && (enFlujoDeRegistrar || conFilaQueSeToca) &&
          "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+5.5rem)]",
        hasBar && !enFlujoDeRegistrar && !conFilaQueSeToca &&
          "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+1rem)]",
        // ── 40px DEBAJO DEL ÚLTIMO BOTÓN, TAMBIÉN EN EL PEDIDO ───────
        //
        // El dueño lo ha pedido DOS veces: el 2026-10-18 para el flujo de
        // registrar una venta —«para que los botones no queden tan pegados a
        // la parte inferior del teléfono ni el widget»— y el 2026-10-25 para
        // el de registrar un pedido, que nació con los 16px de cualquier
        // pantalla porque cae en la última rama de este `cn`.
        //
        // LA SEGUNDA VEZ NO FUE UN DESCUIDO DE ESTE ARCHIVO: era que la regla
        // vivía SOLO en comentarios de aquí y de `StickyActions`, y una
        // pantalla que no monta esa barra no abre ninguno de los dos. Por eso
        // ahora está en `DESIGN-SYSTEM.md`, que sí se lee antes de escribir
        // UI.
        !hasBar &&
          (enFlujoDeRegistrar || enRegistroDePedido) &&
          !conBarraDeBotones &&
          "pb-[calc(env(safe-area-inset-bottom)+2.5rem)]",
        // CON BARRA DE BOTONES, NI UN PIXEL DE MAS. Solo el area segura del
        // iPhone, porque la barra se pega al borde y su propio `pb` ya pone
        // los 40. Con el `1rem` de la rama de abajo el hueco salia de 56, que
        // es lo que se midio en pantalla antes de poner esta linea.
        !hasBar && conBarraDeBotones && "pb-[env(safe-area-inset-bottom)]",
        // Y ESTA RAMA TIENE QUE EXCLUIR EL PEDIDO, o las dos se aplican y
        // `cn` deja ganar a la última: 16px donde acaban de pedirse 40.
        !hasBar && !enFlujoDeRegistrar && !enRegistroDePedido && !conBarraDeBotones &&
          "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
    >
      {children}
    </main>
  );
}
