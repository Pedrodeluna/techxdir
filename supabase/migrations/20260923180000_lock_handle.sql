-- The X handle is the identity people signed in with, so it cannot be edited.
-- It can be set once when it is still empty (email sign-ins complete it on
-- /auth/callback, as do X sign-ins whose handle was already taken), and never
-- changed after that by the people themselves. Admins (postgres, service
-- role) can still fix it by hand.
create function public.lock_handle() returns trigger
language plpgsql as $$
begin
  if old.handle is not null
    and new.handle is distinct from old.handle
    and current_user in ('anon', 'authenticated')
  then
    raise exception 'handle cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_lock_handle
  before update of handle on public.profiles
  for each row execute function public.lock_handle();
