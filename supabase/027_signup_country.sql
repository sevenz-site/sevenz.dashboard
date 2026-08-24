-- Run once in the SQL editor, DEV Supabase project only for now.
--
-- Signup is now the only place an owner picks their country — "Mi negocio"
-- renders "País" disabled, since currency and future DIAN/SENIAT rules key
-- off of it. The signup form passes country via auth signUp's user
-- metadata; this trigger needs to actually read it instead of always
-- leaving new owners on the column's 'CO' default.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (id, email, business_name, first_name, last_name, whatsapp, country)
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
    end
  );
  return new;
end;
$$;
