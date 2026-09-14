import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

// icon.svg es identico en los dos repos, asi que el .ico que sale de aqui
// sirve para los dos y quedan byte a byte iguales.
const svg = readFileSync("public/icon.svg");
const TAMANOS = [16, 32, 48, 64, 128];

const pngs = [];
for (const t of TAMANOS) {
  pngs.push({ t, buf: await sharp(svg, { density: 384 }).resize(t, t, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer() });
}

// Contenedor ICO: cabecera de 6 bytes, una entrada de 16 por imagen, y luego
// los PNG tal cual. PNG dentro de ICO lo entienden todos los navegadores
// actuales, y pesa mucho menos que BMP sin comprimir.
const n = pngs.length;
const cabecera = Buffer.alloc(6);
cabecera.writeUInt16LE(0, 0);   // reservado
cabecera.writeUInt16LE(1, 2);   // 1 = icono
cabecera.writeUInt16LE(n, 4);

let offset = 6 + n * 16;
const entradas = [];
for (const { t, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(t >= 256 ? 0 : t, 0);   // ancho
  e.writeUInt8(t >= 256 ? 0 : t, 1);   // alto
  e.writeUInt8(0, 2);                  // colores de paleta
  e.writeUInt8(0, 3);                  // reservado
  e.writeUInt16LE(1, 4);               // planos
  e.writeUInt16LE(32, 6);              // bits por pixel
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  entradas.push(e);
  offset += buf.length;
}

const ico = Buffer.concat([cabecera, ...entradas, ...pngs.map((p) => p.buf)]);
writeFileSync("zz-favicon.ico", ico);
console.log(`favicon.ico generado: ${ico.length} bytes · ${TAMANOS.join(", ")}px`);
