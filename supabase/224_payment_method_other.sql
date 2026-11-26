-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production (rabmiyqodnvnrwiartuj) comes
-- later, in its release window, with its own green light, and BEFORE the code: a payment saved
-- as «Otro» is refused by a check that does not list it, so the sale would not save.
-- Re-runnable: each constraint is dropped and added again.
--
-- ===========================================================================
-- 224: «OTRO», ONE MORE PAYMENT METHOD, IN BOTH COUNTRIES
--
-- Owner's request of 2026-11-26: «entre las opciones agrega la opción "Otro"», with the field now
-- empty and required. His answers that day: in both lists (Venezuela and Colombia), and no
-- «¿cuál?» text field, just «Otro». Stored as 'other' (CLAUDE.md: stored values in English).
--
-- THREE CHECKS, NOT ONE, as in 220: the payments of a sale, the abonos, and how a return handed
-- the cash back. The condition of each is 214's, unchanged. No row is rewritten.

begin;

alter table public.sale_payments drop constraint if exists sale_payments_payment_method_check;
alter table public.sale_payments add constraint sale_payments_payment_method_check
  check (payment_method is null or payment_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr', 'other'));

alter table public.movements drop constraint if exists movements_payment_method_check;
alter table public.movements add constraint movements_payment_method_check
  check (payment_method is null or (type = 'payment' and payment_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr', 'other')));

alter table public.sale_returns drop constraint if exists sale_returns_refund_method_check;
alter table public.sale_returns add constraint sale_returns_refund_method_check
  check (refund_method is null or (to_cash > 0 and refund_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr', 'other')));

insert into public.schema_migrations (key, description)
values (
  '224_payment_method_other',
  '«Otro» como método de pago en Venezuela y Colombia (pedido del dueño del 2026-11-26): entra en las tres listas que guardan un método, los pagos de una venta, los abonos y cómo se devolvió el dinero de una devolución. No se reescribe ninguna fila.'
)
on conflict (key) do nothing;

commit;
