import type { SupabaseClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════════
// IS THIS ORDER FROM A CLIENT THE SHOPKEEPER ALREADY HAS?
//
// The order card says it out loud — «El cliente ya existe en tu cuenta de
// Sevenz» or «No hemos encontrado este cliente» — and what happens next hangs
// off the answer: register the order against the ficha that exists, or create
// somebody.
//
// ───────────────────────────────────────────────────────────────────────
// MATCHED BY DOCUMENT. THE OWNER'S DECISION, 2026-10-24
//
// His words: *«se emparejan por el documento»*. It was not the only option —
// the order also carries a name and a phone — so it is worth writing down why
// those two were dropped:
//
//   · NOT BY PHONE, and that is documented in `CT-69` and `MS-30`: the
//     WhatsApp consent hangs off the number, the shopkeeper can correct it,
//     and two people in one house share a phone. Matching there puts the
//     mother-in-law inside the son-in-law's ficha.
//   · NOT BY NAME either: «Pedro Pérez» identifies nobody, and the name is
//     precisely the field everyone types differently every time.
//
// ───────────────────────────────────────────────────────────────────────
// AND IT IS NOT UNIQUE BY DIGITS. MEASURED, NOT ASSUMED
//
// The first version of this file said «the document is unique per owner since
// migration `033`, so a hit is THE person». That is false, and dev says so:
// `033`'s index normalises with `[^a-z0-9]`, which KEEPS the letter. So
// `V-21054832` and `E-21054832` are two different keys and both fit. Dev holds
// three such groups right now, one of them three people deep:
//
//   21054832  → JJ/E · Jesus/V · Jesús/V
//
// So «same digits» can mean several people, and picking one of them is a coin
// flip on whose debt this order becomes. WHEN IT IS AMBIGUOUS THIS ANSWERS
// «not found»: the amber notice saying «no lo encontré» is honest, and a green
// one naming one specific Jesús is confidently wrong. The shopkeeper can act
// on the first and cannot catch the second.
//
// What this does NOT solve is what the shopkeeper does then — picking from the
// three is a screen nobody has designed yet, and creating from here would add
// a fourth. It is written down rather than guessed.
//
// ───────────────────────────────────────────────────────────────────────
// THE LETTER TAKES PART, AND ITS ABSENCE DOES NOT RULE A MATCH OUT
//
// Since migration `155` the order stores its letter (`V`/`E`/`J` or
// `CC`/`CE`/`NIT`) and since `154` the client does too. Two people can hold
// the same number under different letters — that is the case the owner
// reported on 2026-10-24, registering a `V` and a `J` with the same digits —
// so the letter DISTINGUISHES and cannot be ignored.
//
// BUT AN ORDER OLDER THAN `155` HAS NONE, and so does a client older than
// `154`. If a missing letter ruled the match out, every old order would say
// «no hemos encontrado este cliente» about a client the shopkeeper has in
// front of him. So the rule is the one `buscarDocumentoDuplicado` already
// uses: **when either side lacks the letter, the digits decide**.
//
// And the direction of the error matters: being wrong by EXCESS — offering a
// client who is not the one — is something the shopkeeper sees on the card,
// with a name and a document in front of him, and can decline. Being wrong by
// DEFAULT makes him register for a second time somebody he already had, and
// that splits a person's history into two fichas that never join again.
export type OrderClient = {
  id: string;
  name: string;
  document_id: string | null;
  document_type: string | null;
  whatsapp: string | null;
  address: string | null;
};

// DIGITS ONLY. The order holds what the visitor typed and the client holds
// what the shopkeeper typed: «V-12.345.678» and «12345678» are the same
// person and do not look alike as strings.
function digitsOf(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export async function findOrderClient(
  supabase: SupabaseClient,
  ownerId: string,
  document: string | null,
  documentType: string | null,
): Promise<OrderClient | null> {
  const digits = digitsOf(document);
  // NO DOCUMENT, NO SEARCH. An order without one cannot be matched to
  // anybody, and returning the first client that happens to fit on some other
  // field would be inventing the answer this function exists to give.
  if (digits === "") return null;

  // `.eq("owner_id")` EXPLICITLY even though RLS already filters: it is
  // `CLAUDE.md`'s rule for any query whose identifier comes from the browser.
  // Here it comes from the order, which comes from the URL.
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, document_id, document_type, whatsapp, address")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .not("document_id", "is", null);

  if (error) {
    // IT ANSWERS «NOT FOUND» RATHER THAN THROWING. This card is informative:
    // if the query fails the shopkeeper sees the amber notice and carries on.
    // Taking his order screen down because we could not tell him whether the
    // client exists trades a missing fact for a page that does not open.
    console.error("[orders] findOrderClient:", error.message);
    return null;
  }

  const candidates = (data ?? []) as OrderClient[];
  const sameDigits = candidates.filter((c) => digitsOf(c.document_id) === digits);
  if (sameDigits.length === 0) return null;

  const orderLetter = (documentType ?? "").trim().toUpperCase();

  if (orderLetter === "") {
    // No letter in the order, so only the digits can decide — and if several
    // people share them, nothing can. See the header.
    return sameDigits.length === 1 ? sameDigits[0] : null;
  }

  // THE LETTER DECIDES FIRST, and an exact hit is unambiguous by definition:
  // `033`'s index keys on the whole document, letter included, so there can be
  // only one ficha per (digits, letter).
  const exact = sameDigits.find(
    (c) => (c.document_type ?? "").trim().toUpperCase() === orderLetter,
  );
  if (exact) return exact;

  // The order DOES carry a letter and no ficha matches it. One WITHOUT a
  // letter is still a candidate — nobody ever asked that client — but only if
  // it is the only one.
  const sinLetra = sameDigits.filter((c) => (c.document_type ?? "").trim() === "");
  return sinLetra.length === 1 ? sinLetra[0] : null;
}
