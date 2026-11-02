// TEXT FOR SEARCHING: no accents, no case. The owner's request of 2026-10-31:
// «el buscador de cliente en el home debe buscar sin distinguir acentos,
// mayúsculas o minúsculas, ejemplo: Sofía = Sofia = sofia = sofía».
//
// ONE FUNCTION FOR EVERY SEARCH BOX, owner and customer side alike -- the
// owner's go-ahead of 2026-10-31 («pásalos todos»). Before that, Pedidos
// folded accents and every other box did not, so «sofia» found her in one
// place and not in the next. Non-search copies of the same normalisation
// (the «falta por completar» card, suppliers, two report exports) match
// names rather than filter a list, and were left alone.
//
// THE COST, said out loud: «ñ» decomposes into «n» plus a tilde, so «Peña»
// and «pena» match. For finding a client that is a feature -- people type
// without the tilde all the time -- and it is the same rule the six copies
// already applied.
export function foldForSearch(text: string | null | undefined): string {
  return (text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
