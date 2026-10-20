begin;
create table public.ev_cases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 120000),
  revision integer not null default 1 check (revision > 0),
  created timestamptz not null default now(), updated timestamptz not null default now()
);
create index ev_cases_owner_updated on public.ev_cases(owner, updated desc);
alter table public.ev_cases enable row level security;
revoke all on public.ev_cases from anon, authenticated;
grant select, insert on public.ev_cases to authenticated;
grant update(document, revision) on public.ev_cases to authenticated;
grant all on public.ev_cases to service_role;
create policy ev_cases_read on public.ev_cases for select to authenticated
  using (public.ev_verified() and owner = auth.uid());
create policy ev_cases_insert on public.ev_cases for insert to authenticated
  with check (public.ev_verified() and owner = auth.uid() and revision = 1);
create policy ev_cases_update on public.ev_cases for update to authenticated
  using (public.ev_verified() and owner = auth.uid())
  with check (public.ev_verified() and owner = auth.uid());
create function public.ev_case_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then raise exception 'Case revision conflict' using errcode = '40001'; end if;
  new.updated := now();
  return new;
end;
$$;
create trigger ev_case_revision before update on public.ev_cases for each row execute function public.ev_case_revision();
notify pgrst, 'reload schema';
commit;
