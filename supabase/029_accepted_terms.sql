-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Signup now requires checking a mandatory Terms & Conditions box before
-- the form can submit (both client-side and re-checked in signup/actions.ts
-- server-side) — this column records when that happened, for future legal
-- defensibility. handle_new_user() always stamps now() at insert time: the
-- form gates submission on the checkbox, so every row this trigger creates
-- going forward represents a real acceptance.

alter table public.owners add column if not exists accepted_terms_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (
    id, email, business_name, first_name, last_name, whatsapp, country, accepted_terms_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp',
    case
      when new.raw_user_meta_data ->> 'country' in ('CO', 'VE') then new.raw_user_meta_data ->> 'country'
      else 'CO'
    end,
    now()
  );
  return new;
end;
$$;

insert into public.schema_migrations (key, description)
values ('029_accepted_terms', 'Adds owners.accepted_terms_at, stamped by handle_new_user() at signup')
on conflict (key) do nothing;
