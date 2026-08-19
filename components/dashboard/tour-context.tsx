"use client";

import { createContext, useContext } from "react";

export type TourStep = 1 | 2 | 2.5 | 3;

export type TourContextValue = {
  step: TourStep | null;
  advance: () => void;
  restart: () => void;
};

export const TourContext = createContext<TourContextValue>({
  step: null,
  advance: () => {},
  restart: () => {},
});

export function useTour() {
  return useContext(TourContext);
}
