-- Additive migration: run once in the SQL editor. Doesn't touch existing data.

alter table public.owners add column if not exists first_name text;
alter table public.owners add column if not exists last_name text;
alter table public.owners add column if not exists whatsapp text;

-- Signup now sends first_name/last_name/whatsapp in the auth user's metadata;
-- pick them up the same way business_name already is.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (id, email, business_name, first_name, last_name, whatsapp)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp'
  );
  return new;
end;
$$;
