import { Loader2 } from "lucide-react";

// LO QUE SE VE MIENTRAS /import CARGA.
//
// El botón "Subir libreta" de Inicio ya hacía `router.push("/import")` en cuanto
// se elegía la foto (`components/dashboard/importar-cartera.tsx`). Lo que
// faltaba era esto: sin un `loading.tsx`, Next no pinta NADA durante la
// navegación a una ruta que espera datos del servidor, así que la pantalla se
// queda en Inicio uno o dos segundos con la foto ya elegida y sin ninguna señal.
//
// Para el dueño eso es indistinguible de que no haya pasado nada: elige la foto,
// mira Inicio, y vuelve a intentarlo. La lectura con IA ya arrancó de fondo, así
// que el segundo intento gasta otra petición de cuota para leer la misma página.
//
// El texto dice lo que está pasando de verdad — la foto ya se está leyendo — y
// no un "Cargando..." que no informa de nada.
export default function Cargando() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">
        Abriendo Subir libreta…
        <br />
        Tu foto ya se está leyendo.
      </p>
    </div>
  );
}
