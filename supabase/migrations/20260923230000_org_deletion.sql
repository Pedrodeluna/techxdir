-- Deletion is limited to global admins. Foreign keys remove the organization's
-- managers, events, and event attendance in the same transaction.
revoke delete on public.orgs from anon, authenticated;
grant delete on public.orgs to authenticated;

create policy "admins delete organizations" on public.orgs
  for delete to authenticated
  using ((select public.is_app_admin()));
