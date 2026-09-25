"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UsdtP2p } from "@/lib/exchange-rate/usdt-p2p";

// El precio del USDT para la calculadora, pedido a nuestra propia ruta.
//
// ─────────────────────────────────────────────────────────────────────────
// SIN TEMPORIZADOR, Y ESO ES LO IMPORTANTE
//
// Lo obvio sería sondear cada minuto. En la PWA instalada no funciona: iOS
// suspende las apps en segundo plano de forma agresiva, y un `setInterval`
// NO corre mientras están dormidas. El dueño cierra la app el lunes, la abre
// el martes, y la reanudación le devuelve la pantalla congelada con el precio
// del lunes — sin ninguna señal de que es viejo.
//
// Así que se pide en los dos momentos en que alguien va a mirar el número:
//
//   1. Al ABRIR la calculadora. Es a demanda —hay que tocar "Calcular"—, así
//      que el dato está fresco justo cuando se mira. Menos peticiones que
//      sondeando, y más frescura.
//   2. Al REANUDAR, si la dejó abierta y el teléfono la durmió.
//
// ─────────────────────────────────────────────────────────────────────────
// EL DATO VIEJO NO SE TIRA
//
// Si una recarga falla —el dueño entró en un sótano sin señal— se conserva
// el último precio conocido en vez de vaciar la pestaña. Quitarle bajo el
// dedo algo que estaba funcionando es peor que enseñarlo diciendo su edad.
//
// La regla completa, que es distinta según el momento:
//   - sin dato al abrir  → la pestaña no se dibuja (lo decide quien llama)
//   - dato que envejece  → se mantiene y se dice cuántos minutos tiene

// FUERA DEL HOOK, y a propósito. Esta función solo trae el dato: no toca
// estado. Así el `setState` vive únicamente dentro de un `.then` o de un
// manejador de evento, nunca en el cuerpo del efecto — que es la forma que
// ya usa el resto de este repo y la que la regla `set-state-in-effect`
// acepta, porque un setState síncrono dentro de un efecto encadena renders.
async function traerPrecio(): Promise<UsdtP2p | null> {
  try {
    const res = await fetch("/api/usdt", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { usdt: UsdtP2p | null };
    return data.usdt;
  } catch {
    // Silencio a propósito: es un extra. La calculadora tiene que seguir
    // funcionando con dólar y euro exactamente igual que antes.
    return null;
  }
}

export function usePrecioUsdt(abierto: boolean) {
  const [precio, setPrecio] = useState<UsdtP2p | null>(null);
  // La edad es ESTADO y se recalcula al recibir, no durante el render.
  //
  // La primera versión la calculaba con `Date.now()` en el cuerpo del
  // componente. Además de impuro —el lint lo rechaza con razón— no habría
  // funcionado: React no vuelve a renderizar porque pase el tiempo, así que
  // el número se habría quedado clavado en la edad que tenía al montar,
  // mintiendo justo en el caso para el que existe.
  const [edadSegundos, setEdad] = useState<number | null>(null);

  // Refs y no estado: solo alimentan el cálculo de la edad, y meterlos en
  // estado provocaría un render de más por cada petición sin cambiar nada de
  // lo que se ve.
  const recibidoEn = useRef<number | null>(null);
  const edadAlRecibir = useRef(0);

  const aplicar = useCallback((nuevo: UsdtP2p | null) => {
    if (nuevo) {
      setPrecio(nuevo);
      // La edad total tiene dos sumandos: lo que ya tenía la cotización en
      // Binance cuando CriptoYa nos la dio, y lo que llevemos nosotros con
      // ella. Aquí el segundo es cero.
      recibidoEn.current = Date.now();
      edadAlRecibir.current = nuevo.edadSegundos ?? 0;
      setEdad(edadAlRecibir.current);
      return;
    }
    // No hubo dato nuevo. El que teníamos se queda, pero envejece — y decirlo
    // es el único motivo por el que se conserva en vez de borrarlo.
    if (recibidoEn.current !== null) {
      setEdad(edadAlRecibir.current + Math.round((Date.now() - recibidoEn.current) / 1000));
    }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    const recibir = (nuevo: UsdtP2p | null) => {
      if (!cancelado) aplicar(nuevo);
    };

    traerPrecio().then(recibir);

    // `visibilitychange` cubre la reanudación de la PWA y el volver a la
    // pestaña en escritorio. Solo mientras la calculadora está abierta: si
    // está cerrada no hay nada que refrescar.
    const alVolver = () => {
      if (document.visibilityState === "visible") traerPrecio().then(recibir);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [abierto, aplicar]);

  return { precio, edadSegundos };
}
