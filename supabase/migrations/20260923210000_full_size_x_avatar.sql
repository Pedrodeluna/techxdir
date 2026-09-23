-- X OAuth supplies a small `_normal` profile image. Store the full-size CDN
-- variant for newly created badges; existing badges are handled by the web UI.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := coalesce(meta ->> 'user_name', meta ->> 'preferred_username');
  avatar text := meta ->> 'avatar_url';
begin
  if avatar ~* '^https://pbs\.twimg\.com/profile_images/[0-9]+/[^/?]+_normal\.(jpg|jpeg|png|webp)(\?.*)?$' then
    avatar := regexp_replace(avatar, '_normal\.(jpg|jpeg|png|webp)(\?.*)?$', '.\1\2', 'i');
  end if;

  insert into public.profiles (id, name, handle, photo_url)
  values (
    new.id,
    left(coalesce(meta ->> 'name', meta ->> 'full_name', ''), 40),
    case
      when wanted ~ '^[A-Za-z0-9_]{1,15}$'
        and not exists (select 1 from public.profiles p where lower(p.handle) = lower(wanted))
      then wanted
    end,
    avatar
  );
  return new;
end;
$$;
