-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, after 171. Re-runnable: one function with no
-- arguments, `create or replace` keeps its signature.
--
-- ===========================================================================
-- 175: THE OWNER CAN READ WHEN THEIR OWN TRIAL ENDS
--
-- Found on 2026-11-02 while writing 174: nothing in the app tells an owner how
-- many trial days are left, so on the end date they open Sevenz to write a
-- fiado and meet «Terminó tu prueba gratis» with no warning. That is now true
-- of every signup (171) and of the 18 free accounts 174 moves to a trial, all
-- of them on the same day. The owner asked for a notice the same day
-- («propónlo tú siguiendo el sistema de diseño con un mensaje muy breve y
-- preciso»).
--
-- WHY A FUNCTION: `subscriptions` has RLS on and no policy for the owner
-- (057: «RLS on, zero policies, zero grants»), on purpose -- the price and
-- the payment history are not theirs to read from the browser. This returns
-- one date and nothing else, only their own, and only while the trial is
-- running: an expired trial is 171's block, which has its own message.

create or replace function public.mi_fin_de_prueba()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select s.demo_termina_el
  from public.subscriptions s
  where s.owner_id = auth.uid()
    and s.estado = 'demo'
    and s.demo_termina_el is not null
    and s.demo_termina_el >= now();
$$;

revoke execute on function public.mi_fin_de_prueba() from public, anon;
grant execute on function public.mi_fin_de_prueba() to authenticated;

insert into public.schema_migrations (key, description)
values (
  '175_aviso_de_fin_de_prueba',
  'mi_fin_de_prueba(): el dueño lee la fecha de fin de SU prueba (y nada más de su suscripción), para el aviso de los últimos 14 días en Inicio. Pedido del dueño el 2026-11-02. Va después de la 171.'
)
on conflict (key) do nothing;
