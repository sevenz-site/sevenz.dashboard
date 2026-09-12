-- ENTORNO: correr en los DOS — primero el branch dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj), antes de desplegar el código.
--
-- POR QUÉ. Ningún registro de dinero guarda quién lo escribió, porque hasta hoy
-- solo podía haberlo escrito una persona: owners.id ES auth.users.id, uno a uno,
-- por clave foránea. En el momento en que dos personas puedan escribir en el
-- mismo negocio, "¿quién anotó este fiado?" pasa a ser una pregunta que el
-- esquema no puede responder — y para entonces las filas viejas ya no tendrán
-- respuesta posible.
--
-- Esto se hace ahora aunque multicuenta esté abortada, precisamente porque el
-- relleno solo es honesto mientras siga habiendo un único autor posible.
--
-- ALCANCE: solo movements. client_flags y movement_deletions ya guardan
-- owner_id, que hoy es el autor; el día que eso deje de ser cierto necesitarán
-- lo mismo, y no antes.
begin;

-- Nullable y sin default: en Postgres moderno es un cambio de catálogo, sin
-- reescribir la tabla, así que no bloquea la caja de nadie.
alter table public.movements add column if not exists created_by uuid;

-- Relleno honesto, a diferencia de owners.referral_source en la 048, donde
-- cualquier valor habría sido una invención. Aquí no se inventa nada: las tres
-- rutas que escriben movimientos son del dueño, y las del import por foto las
-- transcribió él de su propia libreta. El único autor posible era el dueño.
update public.movements m
set created_by = c.owner_id
from public.clients c
where c.id = m.client_id
  and m.created_by is null;

-- ON DELETE SET NULL, nunca CASCADE. Un registro de dinero no puede
-- desaparecer porque se borre una cuenta de usuario: preferimos un movimiento
-- con autor desconocido a un saldo que cambia solo.
--
-- Por eso la columna se queda nullable: NOT NULL y SET NULL se contradicen —
-- el borrado fallaría contra la restricción en vez de resolverse. La garantía
-- de que toda fila nueva lleva autor vive donde se puede cumplir, en las tres
-- acciones que insertan, igual que el requisito de referral_source vive en el
-- formulario y en la acción de registro.
alter table public.movements drop constraint if exists movements_created_by_fkey;
alter table public.movements
  add constraint movements_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- Sin índice todavía. Nadie consulta aún por autor, y un índice sobre una
-- columna que hoy tiene un solo valor por negocio no ayuda a nada. Se añade
-- cuando exista la pantalla que pregunte "qué hizo fulano".

insert into public.schema_migrations (key, description)
values (
  '049_movement_created_by',
  'Adds movements.created_by (nullable, FK a auth.users con on delete set null) y rellena las filas existentes con el owner del cliente, que es el único autor que podía tener. Preparación para multi-autor; el código ya lo estampa en las tres rutas de inserción.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
-- Ninguna fila debería quedar sin autor:
--
--   select count(*) as sin_autor
--   from public.movements
--   where created_by is null;
--
-- Y el autor debe coincidir con el dueño del cliente en todas, que es la
-- invariante que el relleno acaba de establecer:
--
--   select count(*) as autor_distinto_del_dueno
--   from public.movements m
--   join public.clients c on c.id = m.client_id
--   where m.created_by is distinct from c.owner_id;
--
-- Las dos deben dar 0. La segunda dejará de dar 0 el día que exista
-- membresía, y ese será el momento de borrar esta nota.
