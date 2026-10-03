-- LOS DOCUMENTOS QUE NO TIENEN NI UN DIGITO PASAN A null
--
-- ENTORNO: correr en LOS DOS -- primero la rama dev (vzqppwrwnmlbrxizskdh),
-- donde toca CERO filas y solo prueba que la sintaxis es correcta, y despues
-- produccion (rabmiyqodnvnrwiartuj), donde estan las dos de verdad.
--
-- ---------------------------------------------------------------------------
-- QUE SON ESAS DOS FILAS, Y POR QUE NO ERAN BASURA
--
-- Medido en produccion el 2026-10-03, al cerrar CT-32. De 215 clientes con
-- documento, exactamente 2 no tienen ningun digito, y los dos guardan la letra
-- "V" a secas:
--
--   Qwizmo / "Gato"           document_id = 'V'   debe $270   2 movimientos
--   Qwizmo / "Oscar Ventura"  document_id = 'V'   debe $475   3 movimientos
--
-- Son clientes REALES con deuda real, activos, creados el 1 y el 2 de
-- septiembre. Alguien empezo a teclear la "V-" de la cedula venezolana y se
-- quedo ahi, dos dias seguidos, cuando el campo todavia aceptaba cualquier
-- cosa. El campo pasa a aceptar solo digitos el 17 de septiembre, asi que no
-- entran mas.
--
-- Los valores viejos quedan escritos arriba a proposito: lo unico que se
-- pierde al poner null es la letra "V", que no identifica a nadie, pero
-- borrarlo sin dejar constancia de QUE habia seria borrar a ciegas.
--
-- ---------------------------------------------------------------------------
-- POR QUE null Y NO DEJARLO
--
-- Una 'V' es peor que un hueco, y no por estetica:
--
--   * No casa con nadie. La deteccion de duplicados compara documentos
--     normalizados, asi que estos dos clientes son INVISIBLES a ella: si su
--     dueña los registra otra vez por error, nadie le avisa.
--   * Y a la vez casan ENTRE SI. Los dos normalizan igual, asi que para la app
--     "Gato" y "Oscar Ventura" ya comparten documento -- dos personas
--     distintas tratadas como la misma cedula.
--   * Un hueco, en cambio, SE PIDE. Con null, su enlace compartido les pregunta
--     el documento al propio cliente, y la ficha se lo pide a la dueña la
--     proxima vez que la abra. El dato acaba llegando de quien lo sabe.
--
-- CONSECUENCIA QUE HAY QUE SABER ANTES DE CORRER ESTO: los dos clientes veran
-- la pregunta del documento la proxima vez que abran su enlace. Es el efecto
-- buscado, no un daño colateral, pero es visible para dos personas reales.
--
-- No se tocan sus movimientos, su saldo, su marca de mala paga ni su enlace.
-- Solo el campo del documento.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENTE SIN TABLA DE GUARDA, y por que aqui si se puede
--
-- La convencion de este repo para una conversion de datos de una sola vez es
-- una fila en `applied_data_migrations` (ver la 024), porque aquellas reescriben
-- importes y correrlas dos veces los divide dos veces por la tasa.
--
-- Esta no la necesita: despues de la primera pasada esas filas son null, y el
-- `document_id is not null` del WHERE las deja fuera. La segunda corrida toca
-- cero filas por construccion. Una guarda aqui seria ceremonia, y una guarda
-- que no hace falta enseña a ponerlas donde tampoco.
--
-- NO ES REVERSIBLE con un script, y tampoco hace falta: lo que se pierde es la
-- letra "V" de dos fichas, escrita arriba. Si hubiera que deshacerlo, se
-- escribe a mano.

begin;

update public.clients
   set document_id = null
 where document_id is not null
   and regexp_replace(document_id, '[^0-9]', '', 'g') = '';

insert into public.schema_migrations (key, description)
values (
  '080_documento_sin_digitos_a_null',
  'Pone document_id a null en los clientes cuyo documento no tiene ni un digito. En produccion son exactamente 2, los dos de Qwizmo y los dos guardados como la letra "V" a secas: "Gato" (debe $270, 2 movimientos) y "Oscar Ventura" (debe $475, 3 movimientos), creados el 1 y el 2 de septiembre de 2026, antes de que el campo pasara a aceptar solo digitos el 17. En dev toca cero filas. Una V es peor que un hueco: no casa con nadie, asi que esos clientes son invisibles a la deteccion de duplicados y registrarlos otra vez no avisaria; y a la vez casan entre si, asi que la app trata a dos personas distintas como la misma cedula. Un hueco, en cambio, se pide: con null su enlace compartido les pregunta el documento y la ficha se lo pide a la duena. Consecuencia visible: esos dos clientes veran la pregunta del documento la proxima vez que abran su enlace. No se tocan movimientos, saldos, marca de mala paga ni enlaces. Idempotente sin tabla de guarda porque el document_id is not null del WHERE deja fuera a las ya convertidas.'
)
on conflict (key) do nothing;

commit;

-- Lo que quedo, para verlo sin tener que buscarlo. Despues de correr esto en
-- produccion deberia devolver CERO filas; si devuelve alguna, el update no
-- hizo lo que dice.
select count(*) as siguen_sin_digitos
from public.clients
where document_id is not null
  and regexp_replace(document_id, '[^0-9]', '', 'g') = '';
