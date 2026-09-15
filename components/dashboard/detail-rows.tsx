import type React from "react";
import type { MovementCurrencyCode } from "@/lib/types";

// Las piezas con las que se dibuja la ficha de un movimiento.
//
// POR QUÉ VIVEN APARTE. Habia dos fichas —la que se abre desde el historial y
// la que sale al restaurar algo borrado— escritas cada una por su lado, y se
// separaron: una gano el rastro de bolivares y la otra se quedo formateando
// todo en pesos colombianos, de modo que un cargo de 45 euros se leia
// "$ 45,00" en una pantalla y "€45.00" en la otra. Las dos enseñan el mismo
// movimiento; que se vean igual no puede depender de acordarse.

export const NOMBRE_DE_MONEDA: Record<MovementCurrencyCode, string> = {
  VES: "Bolívares",
  USD: "Dólares",
  EUR: "Euros",
};

// Una fila: nombre a la izquierda, dato a la derecha.
//
// El dato va alineado a la derecha y no pegado al nombre porque estas fichas se
// leen en vertical: con todos los datos en el mismo margen, el ojo baja por una
// columna en vez de ir saltando al final de cada etiqueta.
//
// leading-5 —20px de alto de linea— y no el 16px que trae text-xs por defecto.
// El motivo no es el aire: es que las filas midan TODAS lo mismo. Las que
// llevan bandera o flecha crecian hasta los 20px del icono y las de solo texto
// se quedaban en 16, asi que la separacion cambiaba segun lo que hubiera dentro
// y la columna de la derecha no caia a un ritmo constante. Con 20px fijos el
// icono ya cabe sin empujar nada, y un dato de dos lineas mide exactamente el
// doble en vez de una cifra intermedia.
export function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs leading-5">
      <dt className="shrink-0 text-muted-foreground">{nombre}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

// Un grupo de filas. Los grupos van separados por aire y no por una raya: son
// respuestas a preguntas distintas —cuando y que fue, cuanto dinero, y que se
// acordo alrededor— y una raya entre ellos convertiria la ficha en una tabla de
// tres tablas.
export function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}
