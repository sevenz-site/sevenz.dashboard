-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
-- Adds a plan tier to owners. No billing integration yet — every owner starts
-- on 'free' and gets flipped to 'pro' by hand in this table until a real
-- upgrade flow exists.

alter table public.owners
  add column if not exists plan text not null default 'free';

alter table public.owners
  drop constraint if exists owners_plan_check;
alter table public.owners
  add constraint owners_plan_check check (plan in ('free', 'pro'));
