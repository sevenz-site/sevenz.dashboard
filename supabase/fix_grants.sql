-- Run this once in your project's SQL editor. It only adds missing
-- privileges — it doesn't touch tables, policies, or data you already have.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.owners to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.movements to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;
grant select on public.client_summary to authenticated;
