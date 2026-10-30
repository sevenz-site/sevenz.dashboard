"use client";

import { useEffect, useState } from "react";
import {
  searchTransactionsByCode,
  type TransactionSearchResult,
} from "@/app/(app)/dashboard/search-transactions";
import { normalizePartialCode } from "@/lib/transaction-code";

// THE TRANSACTION HALF OF INICIO'S SEARCH BOX.
//
// It only ever asks the server when the text could be the start of a code --
// four letters and up (see `normalizePartialCode`) -- so typing a client's name
// costs nothing. The call waits for a short pause in typing instead of firing on
// every keystroke.
//
// RESULTS BELONG TO THE TEXT THEY WERE ASKED FOR. The state remembers which code
// each answer is for, and the hook only hands back an answer whose code matches
// what is in the box now. That is what keeps a slow reply for `ABCD` from
// landing under `ABCD123`, and it needs no cancellation: the stale answer is
// simply never read.
//
// `pending` IS EXPOSED SO THE SCREEN DOES NOT SAY «Sin resultados» WHILE THE
// ANSWER IS STILL ON ITS WAY. For a code-shaped text with no client match, that
// message would flash for a moment and then be taken back -- which reads as a
// search that found nothing and then changed its mind.
const DEBOUNCE_MS = 250;

type Answer = {
  code: string;
  results: TransactionSearchResult[];
  failed: boolean;
};

export function useTransactionSearch(text: string): {
  results: TransactionSearchResult[];
  pending: boolean;
  failed: boolean;
} {
  const code = normalizePartialCode(text);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchTransactionsByCode(code)
        .then((response) => {
          if (cancelled) return;
          setAnswer(
            "error" in response
              ? { code, results: [], failed: true }
              : { code, results: response.results, failed: false },
          );
        })
        .catch(() => {
          if (!cancelled) setAnswer({ code, results: [], failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  if (!code) return { results: [], pending: false, failed: false };
  if (answer?.code !== code) return { results: [], pending: true, failed: false };
  return { results: answer.results, pending: false, failed: answer.failed };
}
