-- ===========================================================================
-- 215 · Where each recommendation of the Reportes assistant leads
--
-- Owner's request of 2026-11-17 (frame 2189:28630): «Agregar botón link que redirija a lo
-- mencionado en recomendaciones del asistente». Each recommendation gets «Ver clientes» or
-- «Ver productos», and that needs the daily note to keep, next to each recommendation, the key
-- of the list it talks about (`lib/reports/assistant/links.ts`): «criticos», «por-agotarse»…
--
-- A PARALLEL COLUMN, SAME INDEX AS `recommendations`, and not the key glued into the text:
-- the text is what the owner reads and what the admin card counts, and parsing a marker out of
-- free text written by a model is the kind of trick that fails on the first odd answer. A NULL
-- element means «this one has no link». A note stored before this migration has an empty
-- array: it shows its recommendations without links, and nothing breaks.
--
-- DEPLOY ORDER, AND WHY THE OLD SIGNATURE STAYS: this runs in production before the code
-- (CLAUDE.md, «Migrations into production first»). Between the two, the code still calls the
-- seven-argument `upsert_report_assistant_note`; dropping it here would make every daily note
-- fail to save for those minutes. So the old one stays, redefined to clear the links (a note
-- rewritten without links must not keep yesterday's), and the new one takes eight arguments
-- with NO default, so PostgREST can never confuse the two: a call with
-- `p_recommendation_links` reaches the new one, a call without it the old one.
--
-- Re-runnable: `add column if not exists`, `create or replace` on the unchanged signature, and
-- `drop function if exists` on the new one before creating it.
-- ===========================================================================

begin;

alter table public.report_assistant_notes
  add column if not exists recommendation_links text[] not null default '{}';

-- The seven-argument writer, as migration 166 left it, plus clearing the links.
create or replace function public.upsert_report_assistant_note(
  p_owner_id uuid,
  p_day date,
  p_summary text,
  p_recommendations text[],
  p_degraded boolean,
  p_model text,
  p_failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.report_assistant_notes
    (owner_id, day, summary, recommendations, recommendation_links, degraded, model, failure_reason, rating)
  values
    (p_owner_id, p_day, p_summary, coalesce(p_recommendations, '{}'), '{}', p_degraded, p_model, p_failure_reason, null)
  on conflict (owner_id, day) do update set
    summary = excluded.summary,
    recommendations = excluded.recommendations,
    recommendation_links = '{}',
    degraded = excluded.degraded,
    model = excluded.model,
    failure_reason = excluded.failure_reason,
    rating = null,
    created_at = now();
end;
$$;

revoke execute on function public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text) to service_role;

-- The eight-argument writer, with the links.
drop function if exists public.upsert_report_assistant_note(uuid, date, text, text[], text[], boolean, text, text);

create function public.upsert_report_assistant_note(
  p_owner_id uuid,
  p_day date,
  p_summary text,
  p_recommendations text[],
  p_recommendation_links text[],
  p_degraded boolean,
  p_model text,
  p_failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.report_assistant_notes
    (owner_id, day, summary, recommendations, recommendation_links, degraded, model, failure_reason, rating)
  values
    (p_owner_id, p_day, p_summary, coalesce(p_recommendations, '{}'), coalesce(p_recommendation_links, '{}'),
     p_degraded, p_model, p_failure_reason, null)
  on conflict (owner_id, day) do update set
    summary = excluded.summary,
    recommendations = excluded.recommendations,
    recommendation_links = excluded.recommendation_links,
    degraded = excluded.degraded,
    model = excluded.model,
    failure_reason = excluded.failure_reason,
    rating = null,
    created_at = now();
end;
$$;

revoke execute on function public.upsert_report_assistant_note(uuid, date, text, text[], text[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.upsert_report_assistant_note(uuid, date, text, text[], text[], boolean, text, text) to service_role;

comment on function public.upsert_report_assistant_note(uuid, date, text, text[], text[], boolean, text, text) is
  'Escribe la nota diaria del asistente de Reportes con el destino de cada recomendación (migración 215). SECURITY DEFINER y solo para service_role, como la de siete argumentos de la 166, que se queda para no romper el guardado entre la migración y el despliegue del código.';

insert into public.schema_migrations (key, description)
values ('215_assistant_recommendation_links', 'Asistente de Reportes: destino de cada recomendación (Ver clientes, Ver productos), columna recommendation_links y escritura de ocho argumentos')
on conflict (key) do nothing;

commit;
