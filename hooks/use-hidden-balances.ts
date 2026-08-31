"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "sevenz:hide-dashboard-balances";

// A single on/off switch shared by every KPI card on the dashboard (both
// the USD and EUR cards, or the COP card) — an external store, not
// component state, so toggling it from one card instantly updates the
// others without lifting state into a shared parent or a Context
// provider. Persisted to localStorage so the choice survives reloads and
// future visits, which is the whole point: an owner hides real balance
// figures because they're somewhere public, and expects it to stay
// hidden next time, not reset on every page load.
let hidden = false;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  hidden = window.localStorage.getItem(STORAGE_KEY) === "1";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  hydrate();
  return hidden;
}

// The server (and the pre-hydration client render) has no access to
// localStorage — always render balances visible until the real
// preference loads in, same one-render flicker tradeoff any
// localStorage-backed toggle (e.g. a theme switch) accepts.
function getServerSnapshot() {
  return false;
}

function setHidden(next: boolean) {
  hidden = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }
  listeners.forEach((listener) => listener());
}

export function useHiddenBalances(): [boolean, () => void] {
  const isHidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [isHidden, () => setHidden(!isHidden)];
}
