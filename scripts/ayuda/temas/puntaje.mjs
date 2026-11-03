import { go, shot } from "../lib.mjs";
import { M, H2 } from "./_m.mjs";
const S = "ver-el-puntaje-del-cliente";
await go(`/clients/${M.clientes.julia}`, 5000);
await shot(S, 1, H2("Puntaje de crédito"), { crop: 0, pad: 2 });
