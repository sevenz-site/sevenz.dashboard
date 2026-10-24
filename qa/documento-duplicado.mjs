// ¿EL PREFIJO DEL DOCUMENTO CUENTA COMO PARTE DEL DOCUMENTO?
//
// Reportado por el dueño el 2026-10-24: registró un cliente con el mismo
// número cambiando la letra de V a J y la app lo frenó como repetido. El
// prefijo no vive en `document_id` —las acciones lo filtran a dígitos— sino
// en `document_type`, así que la comparación acertaba con media cédula.
//
// LOS DOS ERRORES NO CUESTAN LO MISMO, y por eso la mitad de estos controles
// vigilan la dirección CONTRARIA a la que motivó el arreglo:
//
//   · avisar de más (los controles 5, 6 y 7) es un cartel que el tendero
//     descarta con «Registrar a cuenta separada» — esto nunca fue un bloqueo;
//   · avisar de menos parte a una persona en DOS fichas con la mitad de lo
//     que debe en cada una, y no se descubre hasta que alguien discute su
//     cuenta.
//
// Sin los controles 5 y 6, «arreglar» esto comparando en estricto pasaría la
// prueba y dejaría de ver como repetida cualquier ficha anterior a la
// migración `125`, importada de una libreta, o con un tipo que no
// correspondía al país y se descartó al guardar.
//
// Escribe sus propios clientes de prueba en dev y los borra al terminar.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { buscarDocumentoDuplicado } = await import("../lib/clients/duplicate-document.ts");
const { data: o } = await db.from("owners").select("id").eq("country","VE").limit(1).single();
const PRE = "ZZ QA doc ";
const hechos = [];
const crear = async (name, document_id, document_type) => {
  const { data } = await db.from("clients").insert({ owner_id:o.id, name:PRE+name, document_id, document_type }).select("id").single();
  hechos.push(data.id); return data.id;
};
await crear("persona", "70707077", "V");
let n = 0, ok = 0;
const t = async (titulo, real, esperado) => { n++; const p = (real===esperado); if(p) ok++; console.log(`${p?"PASS":"FAIL"}  ${titulo}  — ${real===null?"sin duplicado":"duplicado: "+real}  (esperado: ${esperado===null?"sin duplicado":esperado})`); };
const buscar = async (doc, tipo) => { const r = await buscarDocumentoDuplicado(db, o.id, doc, tipo); return r ? "si" : null; };
await t("1. mismo numero y MISMA letra (V) -> es duplicado", await buscar("70707077","V"), "si");
await t("2. mismo numero y OTRA letra (J) -> NO es duplicado  <- el caso del dueno", await buscar("70707077","J"), null);
await t("3. mismo numero con E -> tampoco", await buscar("70707077","E"), null);
await t("4. otro numero con la misma letra -> no", await buscar("99999999","V"), null);
await t("5. mismo numero SIN letra -> avisa igual (la ficha podria ser vieja)", await buscar("70707077", null), "si");
await crear("sin tipo", "80808088", null);
await t("6. ficha SIN tipo + busqueda CON tipo -> avisa igual", await buscar("80808088","V"), "si");
await t("7. y con puntos de por medio sigue encontrandola", await buscar("8.080.808-8","V"), "si");
await db.from("clients").delete().in("id", hechos);
const { data: quedan } = await db.from("clients").select("id").like("name", PRE+"%");
console.log(`\nlimpieza: quedan ${(quedan??[]).length}`);
console.log(`\n${ok}/${n} pasan.`);
process.exit(ok===n?0:1);
