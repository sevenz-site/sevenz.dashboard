// El mensaje con el que sale el enlace del cliente.
//
// Lo mandan TRES botones desde dos pantallas: "Compartir enlace" y "Escribir
// por WhatsApp" en el perfil, y "Compartir" dentro de la ficha de un
// movimiento. Tienen que mandar exactamente lo mismo, y este es el sitio donde
// se comprueba que siguen haciendolo.
import { mensajeDeSaldo } from "../lib/share-balance.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

const url = "https://app.sevenz.site/s/a84befadefc5674229b5c98b063b349f";
const m = mensajeDeSaldo("Camilo Camisama", "€75.95", url);
console.log("---\n" + m + "\n---");

check("saluda por su nombre", m.startsWith("Hola Camilo Camisama,"));
check("dice el saldo tal cual se lo dieron", m.includes("€75.95"));
check("el enlace va entero y sin tocar", m.includes(url));
check("el enlace cierra el mensaje", m.trimEnd().endsWith(url), "asi WhatsApp lo detecta entero");
check("una sola linea", !m.includes("\n"));

// Nombres con acentos, con ñ y con emoji: el nombre lo escribe el dueño y aqui
// entra tal cual. Nada de escapes ni recortes.
for (const nombre of ["Ángela Muñoz", "Mini Abasto El Chino", "José 🌟"]) {
  check(`"${nombre}" entra sin tocar`, mensajeDeSaldo(nombre, "$1,08", url).includes(nombre));
}

// Un cliente con deuda en dos monedas trae las dos en el mismo texto.
check("dos monedas caben en el saldo",
  mensajeDeSaldo("Ana", "$50.00 y €20.00", url).includes("$50.00 y €20.00"));

// Cabe en un WhatsApp sin que lo corten en la notificacion.
check("el mensaje no se desmadra de largo", m.length < 200, `${m.length} caracteres`);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
