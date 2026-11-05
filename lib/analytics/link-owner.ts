import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import type { EventName, EventProps } from "./events";
import type { PublicSurface } from "./public-events";

export type LinkOwner = { owner_id: string; owner_email: string | null; client_id?: string | null };

// WHO A PUBLIC LINK BELONGS TO. A client has no identity in Mixpanel, so what
// happens on `/s/[token]` or `/c/[token]` is filed under the business that shared
// the link. An unknown token resolves to null and nothing is recorded: an event
// filed under a guessed owner is worse than a missing one.
//
// `client_id` only exists on a balance link, since migration 190. On a server
// where that migration has not run it is simply absent, and the event still goes.
export async function linkOwner(surface: PublicSurface, token: string): Promise<LinkOwner | null> {
  const { data, error } = await createServiceClient().rpc(
    surface === "balance" ? "share_link_owner" : "catalog_link_owner",
    { p_token: token },
  );
  if (error) {
    console.error(`[link-owner] ${surface}:`, error.message);
    return null;
  }
  const owner = data as LinkOwner | null;
  return owner?.owner_id ? owner : null;
}

// For a public server action. Never throws: what it measures has already
// happened, and analytics cannot be the thing that breaks a client's answer.
export async function trackLinkEvent<E extends EventName>(
  surface: PublicSurface,
  token: string,
  event: E,
  props: EventProps[E],
): Promise<void> {
  try {
    const owner = await linkOwner(surface, token);
    if (!owner) return;
    trackServer(
      event,
      owner.owner_id,
      { ...props, ...(owner.client_id ? { client_id: owner.client_id } : {}) },
      owner.owner_email,
    );
  } catch (error) {
    console.error(`[link-owner] "${event}":`, error instanceof Error ? error.message : error);
  }
}
