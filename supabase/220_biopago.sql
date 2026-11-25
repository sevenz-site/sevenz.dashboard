-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production (rabmiyqodnvnrwiartuj) comes
-- later, in its release window, with its own green light, and BEFORE the code: a payment saved
-- with a value this check does not list is refused by the database, so the sale would not save.
-- Re-runnable: each constraint is dropped and added again.
--
-- ===========================================================================
-- 220: «BIOPAGO», ONE MORE PAYMENT METHOD
--
-- Owner's request of 2026-11-25: «Agregar biopago en método de pago». Biopago is the biometric
-- terminal of a Venezuelan bank, so it exists only in the Venezuelan list
-- (`lib/payments/methods.ts`). The checks below carry every value of both countries, as 214 wrote
-- them, and the server refuses a method that is not in the book's list.
--
-- THREE CHECKS, NOT ONE. The same list lives on the payments of a sale, on the abonos and on how
-- a return handed the cash back. Adding the value to two of them would leave the third refusing a
-- method its own screen offers.
--
-- The condition of each check is 214's, unchanged: a movement carries a method only when it is a
-- payment, and a return only when it handed cash back. No row is rewritten, and every value
-- already stored is in the new list.

begin;

alter table public.sale_payments drop constraint if exists sale_payments_payment_method_check;
alter table public.sale_payments add constraint sale_payments_payment_method_check
  check (payment_method is null or payment_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr'));

alter table public.movements drop constraint if exists movements_payment_method_check;
alter table public.movements add constraint movements_payment_method_check
  check (payment_method is null or (type = 'payment' and payment_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr')));

alter table public.sale_returns drop constraint if exists sale_returns_refund_method_check;
alter table public.sale_returns add constraint sale_returns_refund_method_check
  check (refund_method is null or (to_cash > 0 and refund_method in ('mobile_payment', 'cash', 'card', 'biopago', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr')));

insert into public.schema_migrations (key, description)
values (
  '220_biopago',
  'Biopago como método de pago (pedido del dueño del 2026-11-25): entra en las tres listas que guardan un método, los pagos de una venta, los abonos y cómo se devolvió el dinero de una devolución. No se reescribe ninguna fila.'
)
on conflict (key) do nothing;

commit;
