-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light.
--
-- ===========================================================================
-- 165: WHERE THE REPORTS ASSISTANT KEEPS ITS DAILY NOTE
--
-- The owner asked on 2026-10-29 for an AI assistant at the top of /reportes
-- that reads all three tabs and writes a short summary with recommendations,
-- and he set the shape of it himself: *«la idea es que ese insight se regenere
-- una vez por día»*, over a fixed 7-day window, whatever the date chip says.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AT ALL, AND WHY ONE ROW PER DAY
--
-- `/reportes` deliberately loads ONLY the tab it is about to paint -- its own
-- comment says *«traer los datos de los tres para enseñar uno es pagar tres
-- consultas por pantalla»*. A summary of all three undoes that: about twenty
-- round trips, two of them full-history scans with no date filter.
--
-- Once a day that is affordable. Once per page load it is not. This table is
-- what turns the second into the first, and the primary key is what enforces
-- it: `(owner_id, day)`. The database guarantees one note per owner per day,
-- not a condition somebody can forget to write.
--
-- ---------------------------------------------------------------------------
-- THE FALLBACK IS STORED TOO, AND THAT IS NOT AN OVERSIGHT
--
-- When Gemini fails, the quota runs out, or the generated text does not
-- survive validation, the app falls back to a note written deterministically
-- in TypeScript. That note is SAVED, flagged `degraded` with its reason.
--
-- Two reasons, and both of them matter:
--
--   · Without saving it, every reload of the screen would try the call again.
--   · Without saving it there is nothing to count on the /admin card the owner
--     asked for the same day: *«crea una nueva card en el admin que mida las
--     caídas»*. A failure the shopkeeper never sees -- which is the whole
--     design -- is also a failure nobody can count unless it leaves a row.
--
-- A degraded row does NOT close the day. The endpoint allows three attempts
-- per owner per day, so a transient failure at 8am does not leave the
-- shopkeeper on the fallback text until night.
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT HERE, said out loud
--
-- No prompt, no facts, no model input is stored. Only the finished text. If a
-- summary is ever wrong and needs explaining, the figures can be rebuilt from
-- the loaders for that same window -- and keeping a copy of what was sent to a
-- third party would be a second place for the shop's numbers to live, for no
-- benefit the loaders do not already give.
--
-- ---------------------------------------------------------------------------
-- EVERY NAME AND EVERY STORED VALUE IS IN ENGLISH
--
-- Including `failure_reason`'s and `rating`'s allowed values, which is the half
-- that is easy to get wrong. CLAUDE.md: *«Values stored in the database outlive
-- the code. New enum-like values go into the database in English from the
-- start»* -- renaming one after it reaches production costs far more than a
-- variable. The Spanish the shopkeeper reads («Mucho», «Poco») is put on by the
-- screen.
-- ===========================================================================

create table if not exists public.report_assistant_notes (
  owner_id uuid not null references public.owners(id) on delete cascade,
  -- THE DAY, NOT A TIMESTAMP. The key is "one per day", so the column is the
  -- thing the key is about. A timestamptz would need a cast in every lookup
  -- and would let two rows exist for the same day an hour apart.
  day date not null,

  summary text not null,
  -- AN ARRAY AND NOT ONE TEXT BLOB. The frame draws a real bullet list under
  -- «Recomendaciones:», so the screen needs the items apart. Storing one blob
  -- would push the splitting into the UI, where a model that wrote its bullets
  -- with a different dash would quietly render as one paragraph.
  recommendations text[] not null default '{}',

  -- Which model answered, so a bad run can be told apart from a bad prompt.
  -- NULL on a fallback note: no model answered at all.
  model text,
  degraded boolean not null default false,
  -- Why it degraded. Constrained rather than free text because the /admin card
  -- groups by it, and a typo there turns into a silently empty bar.
  failure_reason text,

  -- The thumb. Beyond what was asked -- the request was a Mixpanel event --
  -- and it answers the question Mixpanel cannot: Mixpanel will say HOW MANY
  -- rated it, never WHICH text they disliked.
  rating text,

  created_at timestamptz not null default now(),

  constraint report_assistant_notes_pkey primary key (owner_id, day),
  constraint report_assistant_notes_failure_reason_check
    check (failure_reason is null
           or failure_reason in ('quota', 'timeout', 'http', 'validation', 'no_key')),
  constraint report_assistant_notes_rating_check
    check (rating is null or rating in ('useful', 'not_useful')),
  -- A degraded note has a reason; a good one does not. Without this, a bug
  -- that forgot to set `failure_reason` would show up on the /admin card as a
  -- failure with no cause, which is worse than no card.
  constraint report_assistant_notes_reason_matches_flag
    check ((degraded and failure_reason is not null)
           or (not degraded and failure_reason is null))
);

-- THE /admin CARD READS BY DAY ACROSS ALL OWNERS, which the primary key cannot
-- serve -- it leads with `owner_id`. Partial, because that card only ever asks
-- about failures.
create index if not exists report_assistant_notes_failures_idx
  on public.report_assistant_notes (day desc)
  where degraded;

alter table public.report_assistant_notes enable row level security;

-- ---------------------------------------------------------------------------
-- RLS AND THE GRANT. BOTH. ALWAYS.
--
-- Migration 108 created two tables, turned RLS on, wrote a correct
-- `owner_id = auth.uid()` policy -- and never granted anything. A policy
-- decides WHICH rows a role may see; a grant decides whether that role may
-- touch the table at all, and without the second the first is never consulted.
-- Every read died with 42501 while `qa:pedidos` passed 14 of 14, because it
-- runs under the service-role key, which bypasses RLS and needs no grant.
-- Migration 116 is that fix. This table does not repeat it.
-- ---------------------------------------------------------------------------
drop policy if exists "owner reads own assistant notes" on public.report_assistant_notes;
create policy "owner reads own assistant notes"
  on public.report_assistant_notes for select
  using (owner_id = auth.uid());

-- UPDATE, BUT ONLY TO RATE IT. The note itself is written by the route under
-- the service client; the only thing the shopkeeper's own session changes is
-- the thumb. `with check` repeats the owner test because `using` governs which
-- rows may be reached and `with check` which rows may RESULT -- without it, an
-- update could move a row to another owner.
drop policy if exists "owner rates own assistant note" on public.report_assistant_notes;
create policy "owner rates own assistant note"
  on public.report_assistant_notes for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

revoke all on public.report_assistant_notes from anon;
grant select, update on public.report_assistant_notes to authenticated;

-- ---------------------------------------------------------------------------
-- AND service_role NEEDS ITS OWN GRANT. EXPLICITLY. THIS IS THE PRODUCTION-ONLY
-- FAILURE THIS FILE EXISTS TO AVOID.
--
-- The note is WRITTEN by the server with the service client, not by the
-- shopkeeper's session: that is what stops any session from inventing its own
-- shop's summary. And `lib/supabase/service.ts` says, in its own words, the
-- thing dev can never show you:
--
--     «In production, SELECT is revoked from service_role on the customer
--      tables, so this client cannot read owners or movements directly no
--      matter what RLS says (…) Adding a third caller means checking the
--      grants in production, not just in dev.»
--
-- Confirmed on 2026-10-29 against production's own grant listing: service_role
-- holds only REFERENCES, TRIGGER and TRUNCATE on every customer table there.
-- Migration `045` says that difference is deliberate -- loose in dev, strict in
-- production -- which is exactly why a missing grant here would pass every dev
-- suite and then fail for every shopkeeper on the day it shipped.
--
-- THREE VERBS AND NOT `all`: the server reads the day's note, writes it, and
-- replaces a degraded one on a retry. It never deletes. Granting `delete` would
-- hand a wider power to the one client that bypasses RLS, for a verb no code
-- path uses.
--
-- WRITTEN OUT RATHER THAN LEFT TO A DEFAULT, even where the default would do
-- it: a table whose behaviour depends on `alter default privileges` is a table
-- that breaks the day somebody tightens them, and this repo has already tripped
-- over exactly that -- see `045`, which had to close defaults that were
-- re-opening every newly created table.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.report_assistant_notes to service_role;

comment on table public.report_assistant_notes is
  'El resumen que el asistente de /reportes escribe una vez al día por negocio, sobre una ventana fija de 7 días. La clave primaria (owner_id, day) es lo que garantiza que solo se genere uno al día: sin ella la pantalla pagaría veinte consultas y una llamada a Gemini en cada carga. Las filas con degraded = true son las que no pudo generar la IA y se resolvieron con el texto escrito a mano; son las que cuenta la tarjeta de caídas de /admin.';

comment on column public.report_assistant_notes.failure_reason is
  'Por qué se degradó: quota (no quedaban intentos), timeout, http (Gemini contestó mal), validation (el texto traía una cifra que no estaba en los hechos) o no_key. Es NULL cuando la nota la escribió la IA.';

comment on column public.report_assistant_notes.rating is
  'El pulgar del tendero: useful o not_useful, que la pantalla enseña como «Mucho» y «Poco». El encargo era un evento de Mixpanel, que dice cuántos calificaron; esta columna es lo único que dice QUÉ texto les pareció malo.';

insert into public.schema_migrations (key, description)
values (
  '165_el_asistente_guarda_su_informe',
  'La tabla donde el asistente de /reportes guarda su resumen diario. Clave primaria (owner_id, day): uno al día por negocio, garantizado por la base y no por el código, porque resumir los tres apartados cuesta unas veinte consultas. Guarda también el texto de respaldo marcado como degraded, que es lo que cuenta la tarjeta de caídas de /admin. Lleva RLS y su grant a authenticated (la 108 escribió la política y olvidó el permiso, y el dueño recibía 42501 en cada lectura) y, explícito, el de service_role, que es quien escribe la nota: en producción ese rol tiene revocado el SELECT sobre las tablas de clientes, así que sin esta línea el asistente funcionaría en dev y fallaría para todos el día que saliera.'
)
on conflict (key) do nothing;
