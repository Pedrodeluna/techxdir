-- Share images. When someone shares their badge, the app uploads a picture of
-- it to badges/<user id>.png and shares /acreditacion/<handle>. That page
-- (web/api/badge.ts) points og:image and twitter:image here, so X shows the
-- badge in the link preview. Its crawler fetches the image without signing
-- in, so the bucket is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('badges', 'badges', true, 5242880, array['image/png'])
on conflict (id) do nothing;

-- Each person writes only their own file. Replacing it (upsert) needs select,
-- insert and update.
create policy "people read their own badge image" on storage.objects
  for select to authenticated
  using (bucket_id = 'badges' and name = (select auth.uid())::text || '.png');

create policy "people upload their own badge image" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'badges' and name = (select auth.uid())::text || '.png');

create policy "people replace their own badge image" on storage.objects
  for update to authenticated
  using (bucket_id = 'badges' and name = (select auth.uid())::text || '.png')
  with check (bucket_id = 'badges' and name = (select auth.uid())::text || '.png');

create policy "people delete their own badge image" on storage.objects
  for delete to authenticated
  using (bucket_id = 'badges' and name = (select auth.uid())::text || '.png');
