"use client";

import { useEffect } from "react";
import { marcarPantallaVacia } from "@/components/dashboard/pantalla-vacia";

// ENCIENDE LA BANDERA DE «PANTALLA VACÍA» MIENTRAS ESTÉ MONTADO, y no dibuja
// nada.
//
// Existe para las pantallas de SERVIDOR: la bandera vive en un almacén de
// cliente --`pantalla-vacia.ts`, que explica por qué-- así que un estado vacío
// renderizado en el servidor no puede encenderla por su cuenta. Montar esto a
// su lado es todo lo que hace falta.
//
// SE APAGA AL DESMONTAR, y eso no es opcional: una bandera que se queda
// encendida esconde el botón flotante en TODA la app hasta recargar.
export function MarcarPantallaVacia() {
  useEffect(() => {
    marcarPantallaVacia(true);
    return () => marcarPantallaVacia(false);
  }, []);
  return null;
}
