import { go, click, shot, sleep, js } from "../lib.mjs";
const S = "mi-negocio";
await go(`/dashboard`, 4000);
await click("Abrir menú", { wait: 1500 });
await shot(S, 1, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Mi negocio')", { crop: 0 });
await go(`/profile`, 5000);
await shot(S, 2, "Subir logo");
await shot(S, 3, "js:[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Nombre del negocio').parentElement");
await shot(S, 4, "Agregar método de pago");
const NOTICES = "js:[...document.querySelectorAll('*')].filter(e=>!e.children.length&&e.textContent.trim()==='Avisos por WhatsApp activados').pop().closest('button')";
// «Guardar cambios» is stuck to the bottom and the card can lie half under it: centre it first.
await js(`(()=>{${NOTICES.slice(3)}.scrollIntoView({block:'center',behavior:'instant'}); return 1})()`);
await sleep(400);
await shot(S, 5, NOTICES);
// v0.10.0: «Consejos de Sevenz», a second switch inside the same accordion. Opened for the
// picture only: nothing is switched, so the demo owner keeps both as the seed left them.
await click(NOTICES, { wait: 1200 });
await shot(S, 6, "js:document.getElementById('consejos-sevenz').closest('div').parentElement", { pad: 4 });
await click(NOTICES, { wait: 800 });
await sleep(400);
await shot(S, 7, "Cambiar contraseña");
// Since C1 of PL-22 (v0.4.0) the number and the second factor live here too.
await shot(S, 8, "js:[...document.querySelectorAll('p')].find(e=>e.textContent.trim()==='Verificación en dos pasos').closest('section')", { pad: 4 });
await shot(S, 9, "Guardar cambios", { crop: 0 });
