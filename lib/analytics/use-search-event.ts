"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/mixpanel";

// WHICH SEARCH BOX IS USED, AND HOW OFTEN IT FINDS NOTHING. Owner's request of
// 2026-11-04: *«Searchs (home, reportes, catálogo, etc)»*. An empty result that keeps
// coming back is a missing record or a filter nobody can find.
//
// ONCE PER SEARCH, after a pause and never per letter: this runs on every keystroke,
// and that would be the noisiest event in the app. THE TEXT NEVER TRAVELS, only how
// long it was: it can be a client's name. A gesture, so a floor. Filed under the owner.
export function useSearchEvent(screen: string, query: string, resultsCount: number, queryType: "text" | "transaction_code" = "text") {
  const last = useRef("");
  const count = useRef(resultsCount);

  useEffect(() => {
    count.current = resultsCount;
  }, [resultsCount]);

  useEffect(() => {
    const text = query.trim();
    if (!text || text === last.current) return;
    const wait = setTimeout(() => {
      last.current = text;
      track("Search Performed", {
        screen,
        query_type: queryType,
        query_length: text.length,
        results_count: count.current,
      });
    }, 1500);
    return () => clearTimeout(wait);
  }, [screen, query, queryType]);
}

const SCREEN_OF_PATH: Record<string, string> = {
  "/dashboard": "home",
  "/clients": "clients",
  "/malas-pagas": "malas_pagas",
  "/papelera": "papelera",
};

// The client filters serve four lists through one hook, and the route is what tells
// them apart.
export function useListScreen(): string {
  return SCREEN_OF_PATH[usePathname()] ?? "other";
}
