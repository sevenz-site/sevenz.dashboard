"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SUPPORT_WHATSAPP } from "@/lib/config";
import {
  avisarCuentaPausada,
  esCuentaPausada,
  EVENTO_CUENTA_PAUSADA,
  MENSAJE_CUENTA_PAUSADA,
} from "@/lib/cuenta-pausada";

// Lo que ve un tendero con la cuenta bloqueada. Dos formas del mismo aviso:
//
//   El diálogo ... aparece solo, al entrar, y cada vez que intenta escribir.
//   La franja roja ... se queda en la cartera mientras dure.
//
// LA BASE ES LA CERRADURA, ESTO ES EL CARTEL. La política de la 061 impide
// escribir de verdad; sin este aviso, el tendero llenaría el formulario, daría
// a Guardar y recibiría "new row violates row-level security policy". Eso es
// exactamente lo que pasó al probar el bloqueo: el mensaje crudo de Postgres,
// en rojo, debajo del resumen del fiado.
//
// Las dos formas viven en el mismo archivo para que el texto no se separe. Ya
// ocurrió con los chips de /admin: dos sitios diciendo lo mismo de dos maneras.
//
// NO DICE POR QUÉ. El motivo del bloqueo se escribe para el historial —"no
// paga desde julio, avisado dos veces"— y es una nota interna. Enseñársela
// sería discutir con él desde la pantalla en vez de por WhatsApp, que es donde
// se arregla.
//
// "Pausada" y no "bloqueada" ni "suspendida": lo que tiene que entender es que
// esto se revierte hablando, no que le cerraron la puerta.
//
// THREE TEXTS SINCE 2026-10-31 (migration 171), one per reason, and that does
// not contradict «no dice por qué» above: that rule is about the INTERNAL note
// written in /admin, which is still never shown. «Your trial ended» and «your
// plan is overdue» are facts the owner already knows -- they come from dates he
// was told -- and naming them turns «why can't I write?» into «I know what to
// do». A manual block keeps the old, reason-less text.
export type MotivoDeBloqueo = "bloqueada" | "prueba_vencida" | "pago_vencido";
// YA NO ES IDÉNTICO AL DE LA PLANTILLA DE WHATSAPP, y es a propósito.
//
// Este párrafo estaba calcado del cuerpo de `cartera_pausada`, la plantilla
// aprobada por Meta, que dice "tu cartera y el historial siguen ahí". El
// 2026-09-28 "cartera" salió de todo lo que lee un dueño dentro de la app,
// pero una plantilla aprobada NO se puede editar: habría que crear otra y
// pedir aprobación de nuevo. Así que el mensaje de WhatsApp seguirá diciendo
// "cartera" mientras la pantalla dice "lo que te deben".
//
// Es una decisión tomada, no un descuido: no lo "arregles" devolviendo la
// palabra aquí. Si algún día se rehacen las plantillas, las dos vuelven a
// coincidir y entonces sí conviene volver a calcarlo.
// Widened on 2026-10-31 (migration 170): the block now covers sales,
// clients, products and orders too, so «no puedes registrar fiados ni abonos»
// stopped being the whole truth. The catalogue still taking orders is said
// out loud, because otherwise a paused owner would assume it went dark.
const CUERPO =
  "Por ahora no puedes registrar ventas, fiados, abonos, clientes ni pedidos, ni crear o publicar productos. Lo que te deben y el historial siguen aquí, el enlace que les mandaste a tus clientes sigue funcionando y tu catálogo sigue recibiendo pedidos.";

const TEXTOS: Record<MotivoDeBloqueo, { titulo: string; cuerpo: string; boton: string; ayuda: string }> = {
  bloqueada: {
    titulo: "Tu cuenta está pausada",
    cuerpo: CUERPO,
    boton: "Escríbenos para reactivarla",
    ayuda: "aparece pausada y necesito reactivarla",
  },
  prueba_vencida: {
    titulo: "Terminó tu prueba gratis",
    cuerpo: `Tus 3 meses de prueba terminaron. ${CUERPO}`,
    boton: "Escríbenos para activar tu plan",
    ayuda: "terminó su prueba gratis y quiero activar mi plan",
  },
  pago_vencido: {
    titulo: "Tu plan está vencido",
    cuerpo: `No tenemos registrado el pago de tu plan. ${CUERPO}`,
    boton: "Escríbenos para reactivarla",
    ayuda: "tiene el plan vencido y necesito reactivarla",
  },
};
// El correo va DENTRO del mensaje, no como algo que pedirle después.
//
// Quien recibe ese WhatsApp llega con un número de teléfono y nada más, y la
// cuenta se busca por correo en /admin. Sin él, la primera respuesta siempre es
// "¿con qué correo entras?" — un viaje de ida y vuelta, con alguien que no
// puede cobrar mientras espera.
//
// Sin correo se manda la frase sin él, que es rara pero se entiende, en vez de
// "mi cuenta undefined de Sevenz".
function mensajeDeAyuda(correo: string | null, motivo: MotivoDeBloqueo): string {
  const ayuda = TEXTOS[motivo].ayuda;
  return correo ? `Hola, mi cuenta ${correo} de Sevenz ${ayuda}.` : `Hola, mi cuenta de Sevenz ${ayuda}.`;
}

type CuentaPausadaValor = { pausada: boolean; correo: string | null; motivo: MotivoDeBloqueo };

const CuentaPausadaContext = createContext<CuentaPausadaValor>({
  pausada: false,
  correo: null,
  motivo: "bloqueada",
});

function enlaceDeWhatsapp(correo: string | null, motivo: MotivoDeBloqueo): string {
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(mensajeDeAyuda(correo, motivo))}`;
}

export function CuentaPausadaProvider({
  pausada,
  correo,
  motivo,
  children,
}: {
  pausada: boolean;
  // El correo con el que entra, para que el WhatsApp diga de qué cuenta habla.
  correo: string | null;
  // Why, when it is paused. Absent or null reads as a manual block, which is
  // also what the code says until migration 171 has run.
  motivo?: MotivoDeBloqueo | null;
  children: React.ReactNode;
}) {
  const motivoFinal: MotivoDeBloqueo = motivo ?? "bloqueada";
  const textos = TEXTOS[motivoFinal];
  // Abierto DE ENTRADA si la cuenta está pausada, como valor inicial y no
  // desde un efecto. Además de ahorrarse un render de más, el servidor y el
  // navegador pintan lo mismo.
  //
  // Sale una vez por carga de página, no una por pantalla: este proveedor vive
  // en el layout, y pasar de Cartera a Clientes no lo vuelve a montar. Taparle
  // la pantalla en cada salto lo convertiría en algo que se cierra sin leer.
  const [abierto, setAbierto] = useState(pausada);

  // El diálogo se abre por dos caminos distintos y no por uno solo:
  //
  //   1. `pausada`, que viene del servidor al cargar el layout.
  //   2. El evento, que lo lanza una acción rechazada.
  //
  // El segundo NO depende del primero, y es deliberado: si se bloquea la
  // cuenta con la pestaña abierta, `pausada` sigue diciendo false hasta la
  // siguiente carga, y sin embargo la escritura ya está rechazada. Con una
  // sola condición ahí volvería el error crudo.
  useEffect(() => {
    function alRechazar() {
      setAbierto(true);
    }
    window.addEventListener(EVENTO_CUENTA_PAUSADA, alRechazar);
    return () => window.removeEventListener(EVENTO_CUENTA_PAUSADA, alRechazar);
  }, []);

  const cerrar = useCallback(() => setAbierto(false), []);

  // Memorizado para que el contexto no cambie de identidad en cada render y
  // vuelva a dibujar todo lo que cuelga de él — que aquí es la app entera.
  const valor = useMemo(() => ({ pausada, correo, motivo: motivoFinal }), [pausada, correo, motivoFinal]);

  return (
    <CuentaPausadaContext.Provider value={valor}>
      {children}
      <AlertDialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PauseCircle className="size-5 shrink-0 text-destructive" aria-hidden />
              {textos.titulo}
            </AlertDialogTitle>
            <AlertDialogDescription>{textos.cuerpo}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* WhatsApp primero: es la única de las dos que arregla algo. */}
            <Button variant="outline" asChild>
              <a href={enlaceDeWhatsapp(correo, motivoFinal)} target="_blank" rel="noopener noreferrer">
                <WhatsappIcon className="size-4" />
                {textos.boton}
              </a>
            </Button>
            <AlertDialogAction onClick={cerrar}>Entendido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CuentaPausadaContext.Provider>
  );
}

// Para los formularios que pintan su error en rojo debajo del boton.
//
// Hace dos cosas de una vez: abre el dialogo, y dice que ese texto NO hay que
// pintarlo. Las dos juntas porque separarlas es justo como se llega a lo que
// se vio al probar el bloqueo — el dialogo delante y, al cerrarlo, el error
// crudo de Postgres esperando debajo del resumen del fiado.
export function useErrorDeCuentaPausada(error: string | null | undefined): boolean {
  useEffect(() => {
    avisarCuentaPausada(error);
  }, [error]);
  return esCuentaPausada(error);
}

export function useCuentaPausada(): CuentaPausadaValor {
  return useContext(CuentaPausadaContext);
}

// EL PORTERO. Se llama al EMPEZAR una accion, no al guardarla.
//
// Con la cuenta pausada, `guardia()` saca el dialogo y devuelve true, y quien
// llama se da la vuelta. Asi el formulario no llega a abrirse.
//
// Por que no basta con el aviso al guardar: es lo que se vio al probar el
// bloqueo. El tendero abrio el formulario, eligio Euros, escribio 50, miro la
// equivalencia en bolivares, y solo entonces se entero de que no podia
// registrar nada. Lo que se le pidio fue trabajo que iba a tirar.
//
// LA COMPROBACION DEL SERVIDOR SE QUEDA IGUAL, y no es redundante: esto lee
// `pausada` de cuando cargo la pagina. Si se bloquea la cuenta con la pestana
// abierta, el portero dice que si y el servidor dice que no — y ahi el aviso
// del error es el que salva la pantalla.
export function useGuardiaDeCuentaPausada(): () => boolean {
  const { pausada } = useCuentaPausada();
  return useCallback(() => {
    if (!pausada) return false;
    avisarCuentaPausada(MENSAJE_CUENTA_PAUSADA);
    return true;
  }, [pausada]);
}

// La misma puerta, para los dialogos que se abren SOLOS.
//
// Hay dialogos que no los abre un clic sino un MARCADOR en la direccion: la
// hoja de "Registrar" navega a /dashboard?nuevo=cliente (o ?nuevo=abono) y es
// la pantalla la que, al montarse, decide abrirse. Eso ocurre durante el
// render, donde no se puede lanzar un evento -- asi que aqui se separan las dos
// mitades: devuelve si hay que abstenerse de abrir, y avisa desde un efecto.
//
// Hasta el 2026-10-18 el marcador lo ponia el boton "Agregar" de la barra de
// abajo con ?nuevo=1. Ese boton ahora abre la hoja, que es quien navega.
export function useGuardiaAlAbrir(quiereAbrir: boolean): boolean {
  const { pausada } = useCuentaPausada();
  const bloqueado = pausada && quiereAbrir;
  useEffect(() => {
    if (bloqueado) avisarCuentaPausada(MENSAJE_CUENTA_PAUSADA);
  }, [bloqueado]);
  return bloqueado;
}

// La franja roja de la cartera. Se decide sola a partir del contexto, así que
// la pantalla no necesita consultar nada: antes la cartera hacía su propia
// consulta de "¿puede escribir?" además de la del layout, y dos lecturas de lo
// mismo en la misma carga es una de más.
export function CuentaPausada() {
  const { pausada, correo, motivo } = useCuentaPausada();
  if (!pausada) return null;
  const textos = TEXTOS[motivo];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <PauseCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">{textos.titulo}</p>
          <p className="text-sm text-muted-foreground">{textos.cuerpo}</p>
        </div>
      </div>
      <Button asChild variant="outline" className="w-fit">
        <a href={enlaceDeWhatsapp(correo, motivo)} target="_blank" rel="noopener noreferrer">
          <WhatsappIcon className="size-4" />
          {textos.boton}
        </a>
      </Button>
    </div>
  );
}

// THE DOOR OF A WRITE FLOW, for a blocked account -- plan of 2026-10-31, phase
// B. Until then a blocked owner could walk a whole sale, abono or order flow
// and only be refused at «Registrar y finalizar» (PR-A9 in
// REGISTRO-DE-PEDIDO-BORDES.md), with the cart already filled in. Now the
// layout of each flow renders this instead of the flow.
//
// WITH A WAY BACK, on purpose: these flows are full-screen and have no app
// header, so without the button the owner would be stuck on a dead screen.
export function PantallaCuentaPausada() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <CuentaPausada />
      <Button asChild className="h-10 w-full sm:w-fit">
        <Link href="/dashboard">Volver al inicio</Link>
      </Button>
    </div>
  );
}
