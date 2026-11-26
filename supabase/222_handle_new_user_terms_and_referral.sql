-- 222 · The sign-up stores the terms acceptance and «¿Cómo conociste Sevenz?» again
--
-- WHAT BROKE, AND NOBODY SAW IT. `handle_new_user()` (the trigger that creates the
-- business row when someone signs up) stamped `owners.accepted_terms_at` since 029 and
-- copied `owners.referral_source` since 048. Migration 070 (2026-09-23) rewrote the
-- function to add the WhatsApp consent and its column list left both out; 171 copied
-- 070 verbatim and kept the gap. The form kept requiring both answers and the action
-- kept checking them, so nothing failed: the answers were simply thrown away.
--
-- Found on 2026-11-26 while testing the sign-up fix (a throwaway dev account came out
-- with no referral answer). Measured in PRODUCTION by the owner that day, by month of
-- sign-up: 2026-10, 1 business, 0 with terms, 0 with an answer; 2026-11, 13 businesses,
-- 0 and 0. In dev, none of 23 businesses had an answer.
--
-- WHAT THIS DOES: 171's definition, verbatim, plus the two columns. Nothing else in the
-- function changes. It does not fill in the past: nobody knows when those owners
-- accepted or how they heard of Sevenz, and writing a guess would present it as a
-- record (CLAUDE.md, «Una cifra del pasado no se calcula con datos de hoy»).
--
-- THE TERMS DATE NEEDS THE FORM TO SAY SO. Until 070 it was `now()` for everybody,
-- including users created from the admin panel, who never saw a terms screen. Now it
-- is stamped only when the sign-up metadata carries `accepted_terms: true`, which
-- `app/signup/actions.ts` sends from 2026-11-26 on (it only gets there with the box
-- ticked). ORDER: either order is safe. This migration with the old code stores the
-- referral answer and leaves the terms date empty, as today; the new code with the old
-- function sends one more key that nothing reads.
--
-- SAFE TO RE-RUN: `create or replace` with the same signature, and the ledger insert
-- does nothing the second time. The trigger `on_auth_user_created` is not touched.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- La frase que el dueño leyó en el formulario. Llega desde el cliente y se
  -- guarda sin transformar — su valor es ser una copia literal de lo que se
  -- mostró, no una paráfrasis nuestra. Es el mismo criterio que en
  -- guardarAvisosWhatsapp().
  --
  -- Si no viene (un usuario creado desde el panel de admin, una versión vieja
  -- del formulario), el dueño queda SIN aceptar. Nunca se inventa un
  -- consentimiento: sin frase no hubo pantalla, y sin pantalla no hubo
  -- permiso.
  v_texto text := new.raw_user_meta_data ->> 'whatsapp_opt_in_text';
  v_tiene_whatsapp boolean := coalesce(new.raw_user_meta_data ->> 'whatsapp', '') <> '';
begin
  insert into public.owners (
    id, email, business_name, first_name, last_name, whatsapp, country,
    whatsapp_opt_in_at, whatsapp_opt_in_text,
    accepted_terms_at, referral_source
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp',
    -- Signup is the only place an owner picks their country — 'Mi negocio'
    -- renders it disabled afterward. Anything other than the two valid
    -- codes (a missing field, an admin-created user, ...) falls back to
    -- the column's own default rather than failing the whole signup.
    case
      when new.raw_user_meta_data ->> 'country' in ('CO', 'VE') then new.raw_user_meta_data ->> 'country'
      else 'CO'
    end,
    -- Y sin número tampoco se acepta: un consentimiento que no se puede
    -- ejecutar no sirve de nada, y es la misma regla que aplica el
    -- interruptor de Mi negocio. Hoy el WhatsApp es obligatorio al
    -- registrarse, así que esto solo protege de un alta hecha por otra vía.
    case when v_texto is not null and v_texto <> '' and v_tiene_whatsapp then now() else null end,
    case when v_texto is not null and v_texto <> '' and v_tiene_whatsapp then v_texto else null end,
    -- BACK FROM 048, lost by 070 (see the header). Stamped only when the sign-up form says
    -- the box was ticked: a user created any other way never saw the terms, and a date
    -- for them would be evidence of something that did not happen.
    case when new.raw_user_meta_data ->> 'accepted_terms' = 'true' then now() else null end,
    -- The same closed list as `owners_referral_source_check` (048) and
    -- `lib/referral-source.ts`. Anything else is stored as null, never refused: a value
    -- the check rejects would fail the whole sign-up, not just this field.
    case
      when new.raw_user_meta_data ->> 'referral_source' in (
        'visita_vendedor', 'recomendacion', 'redes_sociales', 'busqueda_internet', 'otro'
      ) then new.raw_user_meta_data ->> 'referral_source'
      else null
    end
  );

  -- THE 3-MONTH TRIAL (migration 171).
  begin
    insert into public.subscriptions (owner_id, plan_code, estado, demo_termina_el, limites, precio_pactado_usd)
    select o.id, o.plan, 'demo', public.fin_de_prueba(now(), o.country),
           coalesce(p.limites, '{}'::jsonb), p.precio_usd
    from public.owners o
    join public.plans p on p.code = o.plan
    where o.id = new.id
    on conflict (owner_id) do nothing;

    insert into public.subscription_events (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
    select o.id, 'sistema', null, 'demo', o.plan, o.plan, 'Prueba de 3 meses al registrarse'
    from public.owners o
    where o.id = new.id;
  exception when others then
    raise warning 'handle_new_user: no se pudo abrir la prueba de %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '222_handle_new_user_terms_and_referral',
  'El registro vuelve a guardar la fecha de aceptación de los Términos y la respuesta a «¿Cómo conociste Sevenz?», que se perdían desde la migración 070.'
)
on conflict (key) do nothing;
