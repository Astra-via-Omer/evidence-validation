begin;
-- Adds evidence records to the existing Astra Supabase project. No new auth users table.
create function public.ev_verified() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
   and coalesce(raw_app_meta_data->>'disabled','false') <> 'true'
   and (banned_until is null or banned_until <= now()));
$$;
revoke all on function public.ev_verified() from public, anon;
grant execute on function public.ev_verified() to authenticated;
create table public.ev_jobs (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 5 and 180), claim text not null check(length(claim) between 10 and 10000),
 quote text not null check(length(quote) between 5 and 10000), "sourceUrl" text not null check("sourceUrl" ~ '^https?://' and length("sourceUrl") <= 2000),
 location text not null check(length(location) between 1 and 500), relationship text not null check(relationship in ('supports','challenges','context')),
 "rewardCents" integer not null check("rewardCents" between 0 and 1000000), "feeBps" integer not null default 1000 check("feeBps" between 0 and 10000),
 visibility text not null default 'private' check(visibility in ('private','public')),
 status text not null default 'draft' check(status in ('draft','open','closed')), created timestamptz not null default now()
);
create index ev_jobs_owner_created on public.ev_jobs(owner, created desc);
create table public.ev_reviews (
 id uuid primary key default gen_random_uuid(), job uuid not null references public.ev_jobs(id) on delete cascade,
 reviewer uuid not null references auth.users(id) on delete cascade, "taskOwner" uuid not null references auth.users(id) on delete cascade,
 verdict text not null check(verdict in ('supports','challenges','context','insufficient','mismatch')),
 reasoning text not null check(length(reasoning) between 40 and 10000), quote text not null check(length(quote) between 5 and 10000),
 location text not null check(length(location) between 1 and 500), "conflictFree" boolean not null check("conflictFree"),
 status text not null default 'submitted' check(status='submitted'), created timestamptz not null default now(), unique(job,reviewer), check(reviewer <> "taskOwner")
);
create index ev_reviews_owner on public.ev_reviews("taskOwner",job);
create table public.ev_api_keys (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 80), scopes text[] not null check(cardinality(scopes) between 1 and 4 and scopes <@ array['jobs:read','jobs:write','reviews:write','bundles:read']::text[]),
 "tokenHash" text not null unique check("tokenHash" ~ '^[0-9a-f]{64}$'), "expiresAt" timestamptz not null check("expiresAt" <= created + interval '90 days'),
 revoked boolean not null default false, created timestamptz not null default now()
);
create index ev_keys_owner on public.ev_api_keys(owner);
alter table public.ev_jobs enable row level security;
alter table public.ev_reviews enable row level security;
alter table public.ev_api_keys enable row level security;
revoke all on public.ev_jobs,public.ev_reviews,public.ev_api_keys from anon, authenticated;
grant select,insert on public.ev_jobs,public.ev_reviews to authenticated;
grant select(id,owner,name,scopes,"expiresAt",revoked,created) on public.ev_api_keys to authenticated;
grant all on public.ev_jobs,public.ev_reviews,public.ev_api_keys to service_role;
create policy ev_jobs_read on public.ev_jobs for select to authenticated using (public.ev_verified() and (owner=auth.uid() or (visibility='public' and status='open')));
create policy ev_jobs_insert on public.ev_jobs for insert to authenticated with check(public.ev_verified() and owner=auth.uid() and status='draft' and "feeBps"=1000);
create policy ev_reviews_read on public.ev_reviews for select to authenticated using(public.ev_verified() and (reviewer=auth.uid() or "taskOwner"=auth.uid()));
create policy ev_reviews_insert on public.ev_reviews for insert to authenticated with check(public.ev_verified() and reviewer=auth.uid() and exists(select 1 from public.ev_jobs j where j.id=job and j.owner="taskOwner" and j.owner<>auth.uid() and j.visibility='public' and j.status='open'));
create policy ev_keys_read on public.ev_api_keys for select to authenticated using(public.ev_verified() and owner=auth.uid());
-- Users cannot edit tasks, publish drafts, amend blind reviews, or manage secret hashes directly.
notify pgrst, 'reload schema';
commit;
