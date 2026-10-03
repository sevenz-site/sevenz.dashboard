"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bell, Store } from "lucide-react";
import { NotificationsButton } from "@/components/dashboard/notifications-button";
import { SidebarMenuTrigger } from "@/components/dashboard/sidebar-menu-trigger";
import { useUnreadNotifications } from "@/components/dashboard/unread-notifications-context";
import { useSearchResultsOpen } from "@/components/dashboard/client-filter-context";
import { BADGE_MAX } from "@/lib/types";

// LA CABECERA DEL INICIO — Entrega 2 del rediseño del 2026-10-03
//
// Un solo bloque oscuro que se come a la barra de la app en esta pantalla:
// marca, notificaciones, saludo, negocio, última conexión y buscador. En
// `/dashboard` la `AppHeader` del layout se esconde a propósito (ver su propia
// nota), porque dos barras pegadas en un teléfono son ~110px de los 667 que hay.
//
// ─────────────────────────────────────────────────────────────────────────
// NI UN TOKEN SEMÁNTICO EN TODO EL ARCHIVO, y no es purismo
//
// El fondo es `--brand-primary`, que vale lo mismo en claro y en oscuro. Sobre
// una superficie que NO se invierte, un color que SÍ lo hace es exactamente lo
// que rompe el contraste sin que nadie se entere: `text-muted-foreground` sobre
// este gris es gris sobre gris en tema claro. De ahí `white/70` y
// `--brand-secondary` en lugar de tokens. Es la regla de las dos capas de
// `DESIGN-SYSTEM.md`, y las cifras están en `npm run qa:contraste`.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ ES UN SOLO ELEMENTO `sticky` Y NO TRES
//
// La primera versión hacía `sticky` la fila de la marca y el buscador por
// separado, dejando que el saludo se fuera solo entre las dos: cero JavaScript
// y cero salto. No funciona, y el motivo es fácil de no ver: **un elemento
// `sticky` solo se pega dentro de su bloque contenedor**. Si ese bloque es el
// div oscuro —168px de alto—, al pasar de 168px de scroll las dos filas se
// despegan y se van con él. La cabecera se quedaría pegada exactamente hasta
// que empieza a hacer falta.
//
// Pegando el bloque ENTERO, su contenedor es la columna de la pantalla, que
// llega hasta el final — así que se mantiene arriba toda la página. El precio
// es que el saludo tiene que esconderse con estado, que es lo de abajo.
const COLLAPSE_AT = 64; // bajando: a partir de aquí se va el saludo
const EXPAND_AT = 24; // subiendo: y no vuelve hasta casi arriba del todo

// La histéresis (64 contra 24) no es afinado fino, es lo que impide el
// parpadeo. Con un solo umbral, el salto que produce el propio colapso puede
// devolver el scroll justo por debajo de él, que vuelve a expandir, que vuelve
// a saltar.
//
// Y el otro guardia, el de verdad: SOLO COLLAPSE_AT SI LA PANTALLA TIENE HACIA
// DÓNDE BAJAR. Al esconder el saludo el documento se acorta ~56px; en la
// cartera de un dueño con dos clientes eso basta para que el navegador recorte
// el scroll por debajo de EXPAND_AT y la cabecera se abra sola acto seguido. Si
// lo que sobra de página no da para el colapso, no hay nada que ganar
// colapsando.
const MIN_SCROLL_ROOM = 160;

export function HomeHeader({
  firstName,
  businessName,
  lastSignIn,
  children,
}: {
  firstName: string | null;
  businessName: string;
  // Ya formateada en el servidor, con la zona horaria del país del dueño:
  // Vercel corre en UTC y formatear aquí le enseñaría a un colombiano las 12:15
  // p. m. de un inicio de sesión de las 7:15 a. m.
  lastSignIn: string | null;
  // El buscador. Llega como hijo y no importado aquí porque necesita el estado
  // de `ClientFilterProvider`, que lo monta la pantalla: la lista de
  // coincidencias y la cartera del final tienen que filtrar por lo mismo.
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // El mismo `focused` que decide si se pinta el desplegable. MIENTRAS SE
  // ESCRIBE, EL SCROLL NO CUENTA: en iOS, abrir el teclado redimensiona la
  // ventana y desplaza la página para traer el campo a la vista — es decir,
  // dispara un scroll que el dueño no ha hecho. Sin este congelado, tocar el
  // buscador colapsaría la cabecera y movería el campo justo cuando el dedo
  // acaba de aterrizar en él.
  const { focused } = useSearchResultsOpen();

  useEffect(() => {
    if (focused) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        setCollapsed((prev) => {
          if (room < MIN_SCROLL_ROOM) return false;
          return prev ? y > EXPAND_AT : y > COLLAPSE_AT;
        });
      });
    };

    // Una vez al montar: se entra en Inicio desde una ficha de cliente con la
    // página ya desplazada más veces de las que parece.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focused]);

  return (
    // `-mx-4 -mt-4` contra el `p-4` de `AppMain`: la cabecera va de borde a
    // borde. Es el mismo recurso que usan las barras contextuales de las otras
    // pantallas. `z-20` la pone sobre la página y por debajo de diálogos y
    // hojas, que viven en z-50 — igual que la `AppHeader` a la que sustituye.
    <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-3 bg-brand-primary px-4 pt-3 pb-4">
      <div className="flex items-center gap-2">
        {/* SIGUE AQUÍ A PROPÓSITO, aunque el diseño no lo dibuje. La barra de
            abajo no lleva "Menú" todavía —eso es la Entrega 3— y la `AppHeader`
            que lo traía está escondida en esta pantalla: sin este botón, el
            dueño se queda en Inicio sin ninguna forma de abrir el menú. Se
            quita cuando "Menú" llegue a la barra, no prev.

            Es la hamburguesa en las dos anchuras, también en escritorio, donde
            la app usa el glifo de panel. Un solo glifo en una sola superficie
            pesa menos que dos iconos distintos para la misma acción, y el rail
            de escritorio conserva su propio control en todas las demás
            pantallas. */}
        <SidebarMenuTrigger className="-ml-2 shrink-0 text-white hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40" />
        {/* La variante secundaria del logo: #DADADA y el naranja de la marca.
            Está en `public/` desde la Entrega 1 esperando exactamente esto — la
            primaria es gris oscuro y sobre #272727 no se vería. */}
        <Image
          src="/logo-secundary.svg"
          alt="Sevenz"
          width={111}
          height={40}
          className="h-7 w-auto"
          priority
        />
        <div className="ml-auto shrink-0">
          {/* Escritorio: el popover de siempre, con su lista dentro. Teléfono:
              un enlace a /notificaciones, porque un popover de 320px anclado a
              la esquina de una pantalla de 375 no tiene dónde caer. Es el mismo
              reparto que ya hacía la app, solo que ahora el teléfono también
              tiene una puerta en la cabecera y no solo en la barra de abajo. */}
          <div className="hidden md:block">
            <NotificationsButton className="text-white hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40" />
          </div>
          <Link
            href="/notificaciones"
            className="relative flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 md:hidden"
          >
            <Bell className="size-4 shrink-0" aria-hidden="true" />
            Notificaciones
            <UnreadBadge />
          </Link>
        </div>
      </div>

      {/* Lo que se va al bajar. Desaparece de golpe, sin animar: animar la
          salida desplaza la pantalla mientras el dueño ya está leyendo, y en un
          teléfono barato se ve a trompicones. Mismo criterio que
          `HideWhileSearching`.

          El salto de ~56px al colapsar es inherente a cualquier cabecera que se
          encoja, y es el precio de que el buscador se quede arriba. Los dos
          guardias de más arriba son para que ocurra UNA vez y no en bucle. */}
      {collapsed ? null : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {/* `first_name` lo exige el registro y "Mi negocio", en el navegador
                y en el servidor, así que se da por presente. El guardia es solo
                para una fila anterior a esa regla: pintar "¡Hola !" sería peor
                que soltar el nombre. */}
            <p className="text-2xl font-semibold text-white">
              ¡Hola{firstName ? ` ${firstName}` : ""}!
            </p>
            {/* En las dos anchuras ahora. Antes era `md:hidden` porque la barra
                de la app llevaba el nombre del negocio de md hacia arriba y
                repetirlo se leía como un error; en esta pantalla esa barra ya no
                está, así que este es el único sitio donde el dueño ve en qué
                negocio está. */}
            <p className="flex items-center gap-1.5 text-sm text-white/70">
              <Store className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{businessName}</span>
            </p>
          </div>
          {lastSignIn ? (
            /* `shrink-0` y `whitespace-nowrap` juntos son lo que lo mantiene en
               dos líneas. Como hijo flex normal, un nombre largo lo aplasta y
               sale en cuatro: "Última conexión: / 12 sept. 2026, 11:45 p. / m."
               El saludo se parte en su lugar, y eso sí se lee bien. */
            <p className="shrink-0 text-right text-xs leading-tight whitespace-nowrap text-white/70">
              Última conexión:
              <br />
              {lastSignIn}
            </p>
          ) : null}
        </div>
      )}

      {children}
    </header>
  );
}

// El contador, en su propio componente por una razón concreta: suscribirse al
// contexto aquí dentro y no en la cabecera. Si `HomeHeader` leyera
// `useUnreadNotifications()`, cada vez que ese número cambia se volvería a
// renderizar la cabecera entera — incluido el buscador, con el dueño
// escribiendo dentro.
function UnreadBadge() {
  const { unreadCount } = useUnreadNotifications();
  if (unreadCount <= 0) return null;
  return (
    // Idéntico al de la barra de abajo, a propósito: es el mismo aviso visto
    // desde dos sitios y tiene que ser el mismo punto rojo.
    //
    // Llevó un `ring-2 ring-brand-primary` durante media hora, con el argumento
    // de que el rojo no llegaba al 3:1 que WCAG 1.4.11 pide a un gráfico con
    // significado. Dos cosas estaban mal y las dos las dijo `npm run
    // qa:contraste`: el rojo contra #272727 da 3,14:1 — pasa solo — y un anillo
    // del color exacto de la cabecera sobre la que se dibuja no se ve, así que
    // no estaba arreglando nada. El número blanco de dentro queda a 4,76:1,
    // que es el que de verdad va justo: si alguien aclara ese rojo, es el
    // primero que cae.
    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
      {unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : unreadCount}
    </span>
  );
}
