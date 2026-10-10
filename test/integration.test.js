import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Supabase migration enforces shared-account RLS, blind reviews, and secret isolation', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth,public to authenticated,anon,service_role;
   grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610040001_evidence_validation.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202610110001_evidence_access_required.sql', import.meta.url), 'utf8'));
  const owner = '00000000-0000-4000-8000-000000000001', reviewer = '00000000-0000-4000-8000-000000000002', third = '00000000-0000-4000-8000-000000000003', unverified = '00000000-0000-4000-8000-000000000004';
  await db.exec(`insert into auth.users(id,email_confirmed_at,raw_app_meta_data) values ('${owner}',now(),'{"system_access":{"evidence":true}}'),('${reviewer}',now(),'{"system_access":{"evidence":true}}'),('${third}',now(),'{"system_access":{"evidence":true}}'),('${unverified}',null,'{"system_access":{"evidence":true}}');`);
  const jobData = { title:'Validate this claim',claim:'A sufficiently long claim',quote:'An exact excerpt',sourceUrl:'https://example.org',location:'Page 2',relationship:'supports',rewardCents:2000,feeBps:1000,visibility:'public',status:'draft' };
  const columns = Object.keys(jobData).map(x => `"${x}"`).join(',');
  const values = Object.values(jobData).map(x => typeof x === 'number' ? x : `'${x}'`).join(',');
  async function as(id) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`); }
  await as(owner);
  const draft = (await db.query(`insert into public.ev_jobs(owner,${columns}) values('${owner}',${values}) returning id`)).rows[0].id;
  await assert.rejects(db.query(`update public.ev_jobs set status='open' where id='${draft}'`));
  await assert.rejects(db.query(`insert into public.ev_jobs(owner,${columns}) values('${reviewer}',${values})`));
  await as(reviewer);
  assert.equal((await db.query('select * from public.ev_jobs')).rows.length,0, 'Public drafts remain private');
  await db.exec(`reset role; update public.ev_jobs set status='open' where id='${draft}';`);
  await as(reviewer);
  assert.equal((await db.query('select * from public.ev_jobs')).rows.length,1);
  const reviewColumns = 'job,reviewer,"taskOwner",verdict,reasoning,quote,location,"conflictFree"';
  const reviewValues = `'${draft}','${reviewer}','${owner}','supports','This exact excerpt supports the claim within the measured population.','Exact quote','Page 2',true`;
  await db.query(`insert into public.ev_reviews(${reviewColumns}) values(${reviewValues})`);
  await assert.rejects(db.query(`insert into public.ev_reviews(${reviewColumns}) values(${reviewValues})`), 'Duplicate review must fail');
  await as(third);
  assert.equal((await db.query('select * from public.ev_reviews')).rows.length,0, 'Reviews stay blind');
  await assert.rejects(db.query(`insert into public.ev_reviews(${reviewColumns}) values(${reviewValues.replace(reviewer,third).replace(owner,third)})`),'Forged task owner must fail');
  await as(owner);
  assert.equal((await db.query('select * from public.ev_reviews')).rows.length,1);
  await assert.rejects(db.query(`insert into public.ev_reviews(${reviewColumns}) values(${reviewValues.replace(reviewer,owner)})`),'Owner self-review must fail');
  await as(unverified);
  assert.equal((await db.query('select * from public.ev_jobs')).rows.length,0);
  await assert.rejects(db.query(`insert into public.ev_jobs(owner,${columns}) values('${unverified}',${values})`));
  await db.exec(`reset role; insert into public.ev_api_keys(owner,name,scopes,"tokenHash","expiresAt") values('${owner}','Astra Lab',array['jobs:read'],'${'a'.repeat(64)}',now()+interval '1 day');`);
  await as(owner);
  assert.equal((await db.query('select id,name,scopes from public.ev_api_keys')).rows.length,1);
  await assert.rejects(db.query('select "tokenHash" from public.ev_api_keys'),'Hash is server-only');
  await assert.rejects(db.query('update public.ev_api_keys set revoked=true'),'Direct key mutations are server-only');
  await as(reviewer);
  assert.equal((await db.query('select id from public.ev_api_keys')).rows.length,0);
  for (const metadata of ['{}', '{"system_access":{"evidence":false}}', '{"system_access":{"workflow":true}}', '{"system_access":{"evidence":"true"}}', '{"disabled":true,"system_access":{"evidence":true}}']) {
   await db.exec(`reset role; update auth.users set raw_app_meta_data='${metadata}' where id='${owner}';`);
   await as(owner);
   assert.equal((await db.query('select * from public.ev_jobs')).rows.length,0,'Current approval is required even for an existing JWT');
   assert.equal((await db.query('select * from public.ev_reviews')).rows.length,0);
   assert.equal((await db.query('select id from public.ev_api_keys')).rows.length,0);
   await assert.rejects(db.query(`insert into public.ev_jobs(owner,${columns}) values('${owner}',${values})`));
  }
  await db.exec(`reset role; update auth.users set raw_app_meta_data='{"system_access":{"evidence":true}}' where id='${owner}';`);
  await as(owner);
  assert.equal((await db.query('select * from public.ev_jobs')).rows.length,1,'Approval can restore access without changing the JWT');
  await db.exec('reset role; set role anon;');
  for(const table of ['ev_jobs','ev_reviews','ev_api_keys'])await assert.rejects(db.query(`select id from public.${table}`));
 } finally { await db.close(); }
});
