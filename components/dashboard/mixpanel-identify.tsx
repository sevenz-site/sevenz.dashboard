"use client";

import { useEffect } from "react";
import { identifyOwner } from "@/lib/mixpanel";

export function MixpanelIdentify({
  ownerId,
  email,
  plan,
}: {
  ownerId: string;
  email: string;
  plan: string;
}) {
  useEffect(() => {
    identifyOwner(ownerId, { email, plan });
  }, [ownerId, email, plan]);

  return null;
}
