import { go, click, shot } from "../lib.mjs";
const S = "mi-negocio";
await go(`/dashboard`, 4000);
await click("Abrir menú", { wait: 1500 });
await shot(S, 1, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Mi negocio')", { crop: 0 });
await go(`/profile`, 5000);
await shot(S, 2, "Subir logo");
await shot(S, 3, "js:[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Nombre del negocio').parentElement");
await shot(S, 4, "Agregar método de pago");
await shot(S, 5, "js:[...document.querySelectorAll('*')].filter(e=>!e.children.length&&e.textContent.trim()==='Avisos por WhatsApp activados').pop().closest('label,div')");
await shot(S, 6, "Cambiar contraseña");
// Since C1 of PL-22 (v0.4.0) the number and the second factor live here too.
await shot(S, 7, "js:[...document.querySelectorAll('p')].find(e=>e.textContent.trim()==='Verificación en dos pasos').closest('section')", { pad: 4 });
await shot(S, 8, "Guardar cambios", { crop: 0 });
