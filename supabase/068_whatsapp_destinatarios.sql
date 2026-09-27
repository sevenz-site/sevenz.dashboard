-- 068_whatsapp_destinatarios.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- A quién le toca el resumen semanal, y con qué cifras. Una fila por dueño que
-- aceptó los avisos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ ES UNA FUNCIÓN Y NO UNA CONSULTA DEL CRON
--
-- Lo mismo que la 067: el cron corre con la clave de servicio, y producción le
-- revoca SELECT sobre `owners` y las tablas de clientes. Una consulta directa
-- funcionaría en dev y daría 500 en producción — la caída del 2026-09-05.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA TRAMPA DE `overdue_clients`
--
-- Está escrita en ../docs/WHATSAPP-PLANTILLAS.md y se repite aquí porque este
-- es el sitio donde se puede escribir mal sin que nadie lo note.
--
-- NO se cuenta pasando por `getClientStatus()` de lib/types.ts. Esa función
-- devuelve `critico` ANTES que `plazo_vencido` cuando pasan 30 días sin abono,
-- porque existe para pintar UNA insignia por cliente y sus estados son
-- excluyentes. Contar `status = 'plazo_vencido'` dejaría fuera justo a los
-- peores:
--
--   María tiene diez clientes con el plazo pasado. Seis llevan más de un mes
--   sin pagar nada y cuatro se pasaron hace días. El mensaje diría "Clientes
--   con plazo vencido: 4" y los seis graves no aparecerían. El número no sería
--   falso — es correcto según cómo se calculó. Simplemente cuenta lo que no
--   importa.
--
-- Aquí se cuenta desde los datos crudos: el cliente debe, su carga más antigua
-- sin pagar tenía plazo, y ese plazo ya pasó.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS CIFRAS TIENEN QUE COINCIDIR CON LA PANTALLA
--
-- `amount_due` es lo mismo que "Capital por cobrar" del dashboard, incluidos
-- los clientes marcados como mala paga — ese total ya los cuenta, y el aviso
-- que diga otra cosa enseña al dueño a desconfiar de los dos. Por coherencia,
-- `overdue_clients` los cuenta también: son los que más deben preocuparle.
--
-- Lo que NO entra: papelera y ocultos (`client_summary`, no
-- `client_summary_all`).
--
-- El formateo se queda en TypeScript. Un dueño VE tiene cartera en USD y en
-- EUR y uno CO en COP; `formatBalanceSummary()` ya sabe resolverlo y
-- reescribirlo en PL/pgSQL serían dos versiones libres de divergir — la misma
-- razón por la que el puntaje de crédito no se movió a la base.

begin;

create or replace function public.whatsapp_destinatarios_resumen()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(d)
  from (
    select
      o.id as owner_id,
      o.whatsapp,
      o.first_name,
      o.country,
      -- Cada moneda por su lado: sumarlas sería inventar un número. Solo los
      -- saldos deudores, igual que "Capital por cobrar".
      coalesce(sum(cs.balance)     filter (where cs.balance > 0), 0)     as balance_cop,
      coalesce(sum(cs.balance_usd) filter (where cs.balance_usd > 0), 0) as balance_usd,
      coalesce(sum(cs.balance_eur) filter (where cs.balance_eur > 0), 0) as balance_eur,
      -- Ver la nota larga de arriba: desde los datos crudos, nunca desde el
      -- estado que pinta la insignia.
      count(*) filter (
        where (cs.balance > 0 or cs.balance_usd > 0 or cs.balance_eur > 0)
          and cs.oldest_unpaid_charge_at is not null
          and cs.oldest_unpaid_charge_plazo_dias is not null
          and cs.oldest_unpaid_charge_at
              + (cs.oldest_unpaid_charge_plazo_dias || ' days')::interval < now()
      ) as overdue_clients
    from public.owners o
    -- Aceptó y no se dio de baja después. Misma regla que
    -- `aceptaAvisosWhatsapp()` en lib/whatsapp-opt-in.ts, y escrita dos veces
    -- a propósito: la de TypeScript decide qué enseña la pantalla, ésta decide
    -- a quién se le escribe de verdad. Si alguna vez divergen, la que manda es
    -- ésta.
    left join public.client_summary cs on cs.owner_id = o.id
    where o.whatsapp is not null
      and o.whatsapp <> ''
      and o.whatsapp_opt_in_at is not null
      and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
    group by o.id, o.whatsapp, o.first_name, o.country
  ) d;
$$;

-- Igual que en la 067: revocar a `public` no basta. Supabase concede EXECUTE a
-- anon y authenticated sobre toda función nueva del esquema public, y eso es
-- un grant explícito que `from public` no toca. Esta función devuelve los
-- teléfonos de TODOS los dueños: dejarla abierta sería una fuga de datos, no
-- una molestia.
revoke execute on function public.whatsapp_destinatarios_resumen() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_resumen() to service_role;

insert into public.schema_migrations (key, description)
values (
  '068_whatsapp_destinatarios',
  'whatsapp_destinatarios_resumen(): una fila por dueno que acepto los avisos, con su telefono y las cifras del resumen semanal. Funcion SECURITY DEFINER granted solo a service_role, por lo mismo que la 067 — el cron corre con la clave de servicio y produccion le revoca SELECT sobre owners y las tablas de clientes, asi que una consulta directa funcionaria en dev y daria 500 en produccion. overdue_clients se cuenta desde los datos crudos (carga mas antigua sin pagar, con plazo, ya vencido) y NO pasando por getClientStatus(), que devuelve critico antes que plazo_vencido a los 30 dias y dejaria fuera justo a los peores deudores. amount_due incluye a los marcados como mala paga, igual que "Capital por cobrar" del dashboard: si las dos cifras no coinciden, el dueno aprende a desconfiar de las dos. El formateo de moneda se queda en TypeScript para no tener dos versiones libres de divergir.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Nadie con sesión puede sacar los teléfonos de todos los dueños:
--
--   select has_function_privilege('anon', 'public.whatsapp_destinatarios_resumen()', 'execute'),
--          has_function_privilege('authenticated', 'public.whatsapp_destinatarios_resumen()', 'execute');
--   -- EXPECTED: false, false.
--
-- 2. Hoy no debería devolver a nadie, porque ningún dueño ha aceptado:
--
--   select count(*) from public.whatsapp_destinatarios_resumen();
--   -- EXPECTED: 0 mientras nadie tenga whatsapp_opt_in_at.
--
-- 3. Y las cifras tienen que cuadrar con la pantalla. Para un dueño que sí
--    haya aceptado, `balance_cop` debe ser idéntico al "Capital por cobrar"
--    que ve en su Cartera.
