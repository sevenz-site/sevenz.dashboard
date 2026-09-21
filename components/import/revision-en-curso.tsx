"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

// ¿Hay una libreta leída esperando confirmación?
//
// Lo produce ImportFlow, en la pantalla de revisión, y lo consumen dos piezas
// del layout que están muy por encima de él: la barra inferior, que se
// esconde, y AppMain, que deja de reservarle sitio.
//
// POR QUÉ SE ESCONDE LA BARRA. En ese momento hay veintitantos movimientos
// leídos y corregidos a mano que todavía no se han guardado, y la barra ofrece
// cuatro salidas de un toque a cinco milímetros del pulgar. Todas preguntan
// antes de salir —van por el mismo guard—, pero un diálogo que salta cuatro
// veces por error es peor que no tener el atajo: lo que hace falta ahí es una
// sola salida, la del chevron, y que esa pregunte.
//
// CONTRASTE DELIBERADO con search-focus-context.tsx, que decidió lo contrario
// para el buscador: allí la barra SE QUEDA, porque buscar no pone nada en
// riesgo y quitarla dejaba al dueño sin navegación justo cuando más probable
// es que quiera irse. La diferencia no es de gusto: aquí irse cuesta el
// trabajo de revisión, y allí no cuesta nada.
//
// SE ESCRIBE DESDE MANEJADORES, nunca durante el render. `handleViewResults`,
// "Volver" y el final de la importación son los tres sitios que lo tocan, y
// los tres son respuestas a un toque. Por eso no hace falta ningún efecto, y
// por tanto no choca con `react-hooks/set-state-in-effect`.

type Valor = { revisando: boolean; setRevisando: (v: boolean) => void };

const RevisionContext = createContext<Valor>({ revisando: false, setRevisando: () => {} });

export function useRevisionEnCurso() {
  return useContext(RevisionContext);
}

export function RevisionEnCursoProvider({ children }: { children: React.ReactNode }) {
  const [revisando, setRevisandoState] = useState(false);
  const setRevisando = useCallback((v: boolean) => setRevisandoState(v), []);
  const valor = useMemo(() => ({ revisando, setRevisando }), [revisando, setRevisando]);
  return <RevisionContext.Provider value={valor}>{children}</RevisionContext.Provider>;
}
