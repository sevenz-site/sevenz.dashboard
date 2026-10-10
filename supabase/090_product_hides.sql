-- 090_product_hides.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083 a 090 viajan juntas: produccion no tiene ninguna.
--
-- ===========================================================================
-- BORRAR UN PRODUCTO SALE EN NOTIFICACIONES, Y SE PUEDE DESHACER
--
-- Decision del dueno el 2026-10-10. Tabla espejo de `client_hides` (migracion
-- 044), a proposito: a un dueno, borrar un producto es el mismo gesto que
-- borrar un cliente a otra escala, y deberia producir la misma clase de
-- notificacion de la que se puede volver.
--
-- UNA FILA POR TRANSICION, NO UN ESTADO. El historial de un producto borrado,
-- restaurado y vuelto a borrar es lo que vale, y es justo lo que un booleano
-- pierde. Mismo razonamiento que `client_flags` con el marcado de mala paga.
--
-- SIN LA ACCION `hidden`. En clientes significa el ocultado permanente, que en
-- productos todavia no existe (ver CT-44: la papelera ni siquiera sabe pintar
-- un producto). Cuando exista se anade al check; mientras tanto el check
-- impide escribir una transicion que ninguna pantalla sabe pintar.

begin;

create table if not exists public.product_hides (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  action text not null check (action in ('trashed', 'restored')),
  occurred_at timestamptz not null default now(),
  read_at timestamptz
);

-- La consulta caliente es «las ultimas notificaciones de este dueno».
create index if not exists product_hides_owner_idx
  on public.product_hides (owner_id, occurred_at desc);

alter table public.product_hides enable row level security;

drop policy if exists "owners manage own product hides" on public.product_hides;
create policy "owners manage own product hides" on public.product_hides
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Con `update` porque `getNotifications` marca `read_at` al abrir el panel.
-- Sin `delete`: una notificacion no se borra, se lee.
grant select, insert, update on public.product_hides to authenticated;

insert into public.schema_migrations (key, description)
values (
  '090_product_hides',
  'Decision del dueno el 2026-10-10: borrar un producto sale en notificaciones y se puede restaurar, y la restauracion tambien sale. Tabla espejo de client_hides (migracion 044) y por la misma razon: una fila POR TRANSICION, no un estado. El historial de un producto borrado, restaurado y vuelto a borrar es lo que vale, y es lo que un booleano pierde. Sin la accion hidden, que en clientes es el ocultado permanente y en productos todavia no existe -- cuando exista se anade al check, y mientras tanto el check impide escribir una transicion que ninguna pantalla sabe pintar. Con grant de update porque getNotifications marca read_at al abrir el panel; sin delete, porque una notificacion no se borra, se lee.'
)
on conflict (key) do nothing;

commit;
