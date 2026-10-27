// LA MISMA IMAGEN, PARA LA OTRA ETIQUETA — y existe por un fallo real.
//
// El 2026-10-27 el dueño compartió un producto CON FOTO por WhatsApp y la
// vista previa salió con el logo de Sevenz y la frase de la marca, no con la
// foto. El nombre y la descripción sí eran los del producto.
//
// LA CAUSA: `app/layout.tsx` declara un bloque `twitter` global con
// `card: "summary_large_image"` e `images: ["/og.png"]`. Los metadatos de
// Next se heredan por clave, así que una página que define `openGraph` pero
// NO `twitter` se queda con el `twitter:image` del layout -- el de la marca.
// Y WhatsApp lee las etiquetas de Twitter: teniendo las dos, enseñó esa.
//
// POR QUÉ UN ARCHIVO Y NO UNA URL ESCRITA A MANO: la ruta que genera la
// imagen lleva un hash que Next calcula en cada compilación
// (`?a4f67b0ef730d162`), así que escribirla sería una cadena que caduca sola
// en el próximo despliegue, en silencio. Con el archivo, Next emite
// `twitter:image` apuntando a la misma imagen que `og:image` y mantiene el
// hash él.
//
// LO QUE ESTO NO ARREGLA: WhatsApp guarda la vista previa POR URL durante
// días. Un enlace ya compartido seguirá enseñando la tarjeta vieja; hay que
// probar con otro producto.
// `runtime` SE DECLARA, NO SE REEXPORTA. Next lo lee en tiempo de compilación
// con un analizador estático, así que un `export { runtime } from ...` lo deja
// sin reconocer y la ruta devuelve 500 -- medido aquí mismo el 2026-10-27, con
// las etiquetas ya correctas apuntando a una imagen que no cargaba.
export const runtime = "nodejs";
export { default, alt, size, contentType } from "./opengraph-image";
