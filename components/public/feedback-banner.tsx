"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/app/s/[token]/actions";

// Le pregunta al cliente de una bodega qué querría hacer en Sevenz.
//
// POR QUÉ VIVE AQUÍ. Todo lo que hay pensado para clientes —pagar desde la app,
// mandar comprobantes, ver lo que deben en varias tiendas, pedir crédito— es una
// suposición, y a estas personas no les ha preguntado nadie. `/s/[token]` es la
// única superficie donde un cliente se encuentra con Sevenz, así que es el único
// sitio donde la pregunta se puede hacer.
//
// EL DESCARTE VIVE EN localStorage, NO EN EL SERVIDOR. Es a propósito: saberlo
// del lado del servidor obligaría a tocar `get_shared_balance`, que es la única
// función pública del producto y la que más caro sale romper (ver migración 036).
// El precio de esta decisión es que quien limpie los datos del navegador —o use
// iOS, que los borra solo cada cierto tiempo— vuelve a ver el banner. Para una
// pregunta de producto eso es una molestia menor; para un dato de dinero no lo
// sería.
const STORAGE_PREFIX = "sevenz.feedback.";

export function FeedbackBanner({ token }: { token: string }) {
  // Arranca oculto y se muestra tras la hidratación. Al revés habría un
  // parpadeo del banner para quien ya lo descartó, que es justo la persona a la
  // que no hay que volver a molestar.
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(`${STORAGE_PREFIX}${token}`)) setVisible(true);
    } catch {
      // Modo privado, cookies bloqueadas, o un navegador que simplemente dice
      // que no. Se enseña el banner: preguntar de más es mejor que no preguntar.
      setVisible(true);
    }
  }, [token]);

  function remember() {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${token}`, "1");
    } catch {
      // Si no se puede recordar, no pasa nada: el límite de envíos del servidor
      // es lo que evita que alguien mande cien respuestas.
    }
  }

  function dismiss() {
    remember();
    setVisible(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Escribe tu respuesta.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await submitFeedback(token, trimmed);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    remember();
    setOpen(false);
    setThanked(true);
  }

  if (!visible) return null;

  if (thanked) {
    return (
      <div className="rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-200">
        ¡Gracias! Lo tendremos en cuenta.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-3 rounded-xl bg-neutral-900 p-4">
        {/* icon.svg ya trae su propio fondo oscuro, así que se funde con el
            banner sin necesidad de una variante en blanco. */}
        <Image src="/icon.svg" alt="" width={32} height={32} className="shrink-0 rounded-md" />

        {/* min-w-0 para que el texto largo se parta en vez de empujar la X
            fuera de la tarjeta en un teléfono. */}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="text-sm font-medium text-neutral-50">¡Ayúdanos a mejorar!</p>
          <p className="text-sm text-neutral-400">
            ¿Hay algo que quisieras hacer a través de Sevenz y aún no puedes?
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1 text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            Responder
          </button>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar"
          className="shrink-0 text-neutral-400 hover:text-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none"
        >
          <X className="size-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué te gustaría hacer en Sevenz?</DialogTitle>
            <DialogDescription>Leemos todas las respuestas, nos ayudan a mejorar.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="feedback_message">Tu respuesta</Label>
              <Textarea
                id="feedback_message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Por ejemplo: pagar desde aquí, mandar el comprobante, ver lo que debo en otras tiendas..."
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando..." : "Enviar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
