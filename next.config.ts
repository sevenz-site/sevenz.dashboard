import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Los comprobantes de /admin viajan DENTRO del envio del formulario, y el
    // tope por defecto de una accion de servidor es 1 MB. Las imagenes se
    // reducen en el navegador antes de salir —unos 200 KB— asi que esto es
    // para los PDF, que no se pueden reducir. El bucket los limita a 5 MB;
    // este margen deja sitio al resto del formulario.
    //
    // Es un techo, no un valor por defecto: nada empieza a enviar mas datos
    // por subirlo. Y no toca las fotos del tendero, que suben directas a
    // Storage desde el navegador y no pasan por aqui.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
