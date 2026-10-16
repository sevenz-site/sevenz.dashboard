// THE CLOSED LISTS OF THE PRODUCT FORM.
//
// Figma frame 1175:5881 turns two free-text fields into pickers. They live here
// and not inside the dialog because the movement form is going to reuse both
// when a product is created inline, and a second copy of either list is a
// second vocabulary for the same thing.

// ───────────────────────────────────────────────────────────────────────────
// EL CAMPO «UNIDAD» YA NO EXISTE, y aquí estaba su lista.
//
// Salió del formulario el 2026-10-10 con el frame 1192:4185, decisión del
// dueño. `UNIT_OPTIONS` y `unitPlural` se borraron con él en vez de quedarse
// «por si acaso»: código muerto que nadie llama es código que nadie actualiza
// y que el siguiente lector cree que está en uso.
//
// LA COLUMNA `products.unit` SE QUEDA. Los productos que ya la tienen la
// conservan, el catálogo público la sigue enseñando y la ficha la reenvía tal
// cual al guardar. Lo que desapareció es la pregunta, no el dato.
//
// ───────────────────────────────────────────────────────────────────────────
// MARGIN PRESETS
//
// The frame lists 10, 15, 20, 25, 35, 40 — and NOT 30.
//
// 30 is added here on purpose. It is the single most-cited number in the field
// research of 2026-10-09: Tendero 1 said «al precio de venta le pongo
// comúnmente un 30 % de margen», and Tendero 2 said «10 %, 15 % ó 30 % según
// el caso». A picker of the six closest numbers that omits the one both
// shopkeepers named sends the most common case straight to "Otro".
//
// Said out loud rather than fixed silently, because it contradicts the frame
// and the frame is the owner's: if the omission was intentional, this is the
// line to delete.
export const MARGIN_PRESETS = [10, 15, 20, 25, 30, 35, 40] as const;
