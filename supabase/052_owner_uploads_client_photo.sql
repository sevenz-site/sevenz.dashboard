-- 052_owner_uploads_client_photo.sql
--
-- Deja que el DUEÑO suba la foto de un cliente desde su ficha.
--
-- La columna clients.profile_picture_path y el bucket existen desde la 032,
-- pero el único camino que escribía en ellos era el cliente desde el enlace
-- público — y la 041 cerró esa página entera: un enlace compartido viaja por
-- chats reenviados, así que su audiencia real es mucho más ancha que el cliente
-- al que se mandó. Desde entonces el campo existe y nada lo llena.
--
-- Esto abre el otro camino, el que siempre fue seguro: el dueño, con su sesión,
-- subiendo la foto del cliente que tiene delante.
--
-- El bucket nació SIN políticas a propósito (ver la 032): no había auth.uid()
-- para un cliente anónimo, así que la escritura tenía que pasar por el
-- servidor. El dueño sí tiene sesión, de modo que aquí se usa exactamente el
-- mismo patrón que attachments y logos — la carpeta del primer nivel es su
-- propio id, y la política lo comprueba. Un dueño no puede escribir en la
-- carpeta de otro ni aunque construya la petición a mano.
--
-- Las lecturas siguen siendo públicas, como ya lo eran: el bucket se creó
-- público en la 032 y estas fotos se muestran en el saldo compartido, que por
-- definición lo abre alguien sin sesión.

begin;

drop policy if exists "owners upload own client photos" on storage.objects;
create policy "owners upload own client photos" on storage.objects for insert to public
  with check (
    bucket_id = 'client-profile-pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- update además de insert: cambiar la foto de un cliente reescribe el mismo
-- objeto cuando el nombre coincide, y sin esta política el segundo intento
-- fallaría en silencio con el primero ya subido.
drop policy if exists "owners update own client photos" on storage.objects;
create policy "owners update own client photos" on storage.objects for update to public
  using (
    bucket_id = 'client-profile-pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners delete own client photos" on storage.objects;
create policy "owners delete own client photos" on storage.objects for delete to public
  using (
    bucket_id = 'client-profile-pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

insert into public.schema_migrations (key, description)
values (
  '052_owner_uploads_client_photo',
  'Storage policies so an owner can upload, replace and delete the profile picture of their own clients, under a folder named by their auth.uid(). The bucket and clients.profile_picture_path have existed since 032, but the only writer was the public client page that 041 closed, so nothing has filled the column since.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--   select policyname, cmd
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like '%client photos%'
--   order by policyname;
--
-- Tres filas: insert, update y delete.
