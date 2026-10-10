begin;
-- Read current protected metadata, so revocation also denies existing JWTs.
create or replace function public.ev_verified() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from auth.users where id = auth.uid()
   and email_confirmed_at is not null and deleted_at is null
   and coalesce(is_anonymous, false) = false
   and coalesce(raw_app_meta_data->>'disabled','false') <> 'true'
   and (banned_until is null or banned_until <= now())
   and raw_app_meta_data#>'{system_access,evidence}' = 'true'::jsonb);
$$;
revoke all on function public.ev_verified() from public, anon;
grant execute on function public.ev_verified() to authenticated;
notify pgrst, 'reload schema';
commit;
