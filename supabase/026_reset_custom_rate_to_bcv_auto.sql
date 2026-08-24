-- Run once in the SQL editor, DEV Supabase project only for now.
--
-- "Mi propia tasa" (rate_mode = 'CUSTOM') is no longer settable from the
-- "Mi negocio" screen — the option renders disabled there now. Any owner
-- who already had it configured gets switched back to the automatic BCV
-- rate. custom_rate_usd/custom_rate_eur are left in place (harmless, unused
-- history) rather than nulled out, matching how the settings-save action
-- itself now treats those columns.

update public.owner_exchange_settings
set rate_mode = 'BCV_AUTO', updated_at = now()
where rate_mode = 'CUSTOM';
