"use client";

import type { EntryPoint } from "./events";

// THE ID THAT TIES ONE ATTEMPT TOGETHER, so a Mixpanel funnel can hold it constant
// and tell two sales the same morning apart.
//
// `crypto.randomUUID` needs a secure context and an iOS newer than 15.4, and this
// must never be the reason a sale fails, so it falls back to something good enough
// for an analytics id.
export function newFlowId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// A FLOW THAT CROSSES PAGES. The payment goes from the client search to its own
// screen and back from the amount, and the component unmounts on the way, so the
// id lives in `sessionStorage`. If iOS wipes it the worst case is one attempt
// counted as two: an analytics rounding error, never lost money.
export type StoredFlow = { id: string; entry?: EntryPoint };

// Two hours, the same life as the payment draft: past that, whoever comes back is
// starting again.
const FLOW_TTL_MS = 2 * 60 * 60 * 1000;

export function readFlow(key: string, maxAgeMs = FLOW_TTL_MS): StoredFlow | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const flow = JSON.parse(raw) as StoredFlow & { at?: number };
    return Date.now() - (flow.at ?? 0) < maxAgeMs ? flow : null;
  } catch {
    return null;
  }
}

export function writeFlow(key: string, flow: StoredFlow) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...flow, at: Date.now() }));
  } catch {
    // Blocked storage: the funnel loses the join, the payment loses nothing.
  }
}

export function clearFlow(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Same.
  }
}

// THE PAYMENT'S FLOW. It can start in the client search, before anyone knows the
// client, so the search leaves it under a shared key and the first screen with a
// client claims it. A payment started on a profile never takes that one: it would
// inherit an abandoned search.
const PENDING_PAYMENT = "sevenz:flujo:abono";
const paymentKey = (clientId: string) => `${PENDING_PAYMENT}:${clientId}`;

// `isNew` is false when the same opening reaches here twice: the dialog can mount twice
// while the marker in the URL settles, and that is one attempt, not two.
export function startPendingPayment(entry: EntryPoint): { flow: StoredFlow; isNew: boolean } {
  const recent = readFlow(PENDING_PAYMENT, 5000);
  if (recent) return { flow: recent, isNew: false };
  const flow = { id: newFlowId(), entry };
  writeFlow(PENDING_PAYMENT, flow);
  return { flow, isNew: true };
}

export const pendingPayment = () => readFlow(PENDING_PAYMENT);

// `isNew` says the caller has to send `Payment Started`. Coming back from the amount
// screen finds the flow already there and sends nothing.
export function claimPaymentFlow(clientId: string, entry: EntryPoint): { flow: StoredFlow; isNew: boolean } {
  const own = readFlow(paymentKey(clientId));
  if (own) return { flow: own, isNew: false };

  const pending = entry === "client_profile" ? null : readFlow(PENDING_PAYMENT);
  clearFlow(PENDING_PAYMENT);
  const flow = pending ?? { id: newFlowId(), entry };
  writeFlow(paymentKey(clientId), flow);
  return { flow, isNew: pending == null };
}

export const finishPaymentFlow = (clientId: string) => clearFlow(paymentKey(clientId));
