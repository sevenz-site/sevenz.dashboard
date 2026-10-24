// EL AVISO QUE SUSTITUYE A LA CASILLA CUANDO EL NÚMERO YA TIENE PERMISO.
//
// Pedido por el dueño el 2026-10-21, después de que un tendero en producción
// registrara a un cliente sin marcar la casilla y el cliente recibiera el
// recibo de su abono igualmente: *«en el formulario, donde se pide activar la
// notificación, se debería mencionar que el número ya se encuentra registrado
// a <nombre del cliente> y ya posee las notificaciones de WhatsApp
// activadas»*.
//
// ===========================================================================
// DOS FRASES, Y LA DIFERENCIA ES UNA FRONTERA DE PRIVACIDAD
//
// El permiso es del NÚMERO, así que el teléfono que el tendero está tecleando
// puede estar en una ficha SUYA o en la de otra bodega. Las dos cosas hacen
// que su cliente reciba mensajes; solo una de ellas es asunto suyo.
//
//   CON NOMBRE — la ficha es del propio tendero. Nombrarla es recordarle a
//   alguien que ya tiene, y le dice dónde mirar si cree que se equivoca.
//
//   SIN NOMBRE — ese número es cliente de otro negocio. Decir de quién sería
//   contarle a un tendero que ese teléfono compra en otra bodega y bajo qué
//   nombre figura allí. Ninguno de los dos datos es suyo. El servidor ni
//   siquiera lo manda: `whatsapp_consent_for_phone` solo devuelve el nombre
//   cuando la ficha pertenece a quien pregunta, así que esto no puede
//   enseñarlo aunque alguien lo intente.
//
// LA SEGUNDA FRASE DICE MENOS Y SIGUE SIENDO LA ÚTIL: lo que el tendero
// necesita saber no es de quién es la otra ficha, sino que **su cliente va a
// recibir los avisos aunque él no toque nada**. Eso es exactamente lo que no
// sabía.
//
// ===========================================================================
// POR QUÉ NO ES UNA CASILLA YA MARCADA
//
// Era la alternativa obvia y es peor. Una casilla marcada invita a
// desmarcarla, y aquí desmarcarla no retiraría el permiso —es del número, y
// retirarlo es otra acción con sus consecuencias— sino que no haría
// absolutamente nada. Un control que no hace nada al tocarlo es peor que no
// tener control.
export function AvisoNumeroYaAcepta({ clientName }: { clientName: string | null }) {
  return (
    <p className="rounded-lg border bg-accent p-2.5 text-xs leading-4 text-muted-foreground">
      {clientName ? (
        <>
          Ya tienes este número registrado como{" "}
          <span className="font-medium text-foreground">{clientName}</span>, y ya recibe
          notificaciones de su saldo por WhatsApp.
        </>
      ) : (
        <>Este número ya recibe notificaciones de su saldo por WhatsApp.</>
      )}
    </p>
  );
}
