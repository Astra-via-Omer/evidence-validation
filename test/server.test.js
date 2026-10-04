import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { digest } from '../src/contracts.js';

test('shared Supabase auth, scoped keys, browser secret isolation, and real MCP transport', async () => {
 const owner='00000000-0000-4000-8000-000000000001';
 const foreign='00000000-0000-4000-8000-000000000002';
 const keyId='00000000-0000-4000-8000-000000000003';
 const readKey='evk_'+ 'a'.repeat(64);
 const user={id:owner,email:'test@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Existing Astra account'},app_metadata:{}};
 const calls=[];
 const job={id:keyId,owner,title:'Existing review draft',claim:'An exact and sufficiently long claim',quote:'Exact quotation',sourceUrl:'https://example.org',location:'Page 1',relationship:'supports',visibility:'private',status:'draft',rewardCents:2000,feeBps:1000,created:new Date().toISOString()};
 const upstream=express();upstream.use(express.json());
 upstream.get('/auth/v1/user',(req,res)=>{
  const token=req.headers.authorization;
  if(token==='Bearer good-jwt')return res.json(user);
  if(token==='Bearer disabled-jwt')return res.json({...user,app_metadata:{disabled:true}});
  if(token==='Bearer unverified-jwt')return res.json({...user,email_confirmed_at:null});
  res.status(401).json({message:'Invalid JWT'});
 });
 upstream.get('/auth/v1/admin/users/:id',(req,res)=>{assert.equal(req.params.id,owner);res.json(user)});
 upstream.all('/rest/v1/:table',(req,res)=>{
  calls.push({table:req.params.table,method:req.method,query:req.query,body:req.body,key:req.headers.apikey});
  const table=req.params.table;
  if(table==='ev_api_keys' && req.query.tokenHash){
   assert.equal(req.headers.apikey,'service-key-test');
   if(req.query.tokenHash==='eq.'+digest(readKey))return res.json({id:keyId,owner,scopes:['jobs:read'],revoked:false,expiresAt:new Date(Date.now()+86400000).toISOString()});
   return res.status(406).json({code:'PGRST116',message:'No rows'});
  }
  if(table==='ev_api_keys'){
   assert.equal(req.query.owner,'eq.'+owner);
   assert.ok(!req.query.select.includes('tokenHash'));
   if(req.query.id)return res.json(null);
   return res.set('Content-Range','0-0/1').json([{id:keyId,name:'Astra Lab',scopes:['jobs:read'],revoked:false,expiresAt:new Date(Date.now()+86400000).toISOString(),created:job.created}]);
  }
  if(table==='ev_jobs'){
   if(req.method==='GET'){
    assert.equal(req.query.or,`(owner.eq.${owner},and(visibility.eq.public,status.eq.open))`);
    return req.query.id ? res.json(job) : res.set('Content-Range','0-0/1').json([job]);
   }
   assert.equal(req.body.owner,owner);assert.equal(req.body.status,'draft');return res.status(201).json({...job,...req.body});
  }
  return res.status(404).json({message:'Unexpected table'});
 });
 const upstreamServer=upstream.listen(0,'127.0.0.1');await new Promise(r=>upstreamServer.once('listening',r));
 process.env.SUPABASE_URL=`http://127.0.0.1:${upstreamServer.address().port}`;
 process.env.SUPABASE_ANON_KEY='publishable-key-test';
 process.env.SUPABASE_SERVICE_ROLE_KEY='service-key-test';
 process.env.APP_ORIGIN='http://localhost:3200';
 const {app}=await import('../src/server.js');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,token,options={})=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});
 let client;
 try {
  const config=await (await request('/api/config')).json();
  assert.equal(config.authentication,'supabase');assert.equal(config.supabaseConfigured,true);assert.equal(JSON.stringify(config).includes('service-key-test'),false);
  assert.equal((await request('/api/me')).status,401);
  assert.equal((await request('/api/me','invalid')).status,401);
  assert.equal((await request('/api/me','disabled-jwt')).status,403);
  assert.equal((await (await request('/api/me','good-jwt')).json()).user.name,'Existing Astra account');
  assert.equal((await request('/api/v1/jobs',readKey)).status,200);
  assert.equal((await request('/api/v1/jobs','evk_unknown')).status,401);
  assert.equal((await request('/api/v1/jobs',readKey,{method:'POST',body:JSON.stringify(job)})).status,403);
  assert.equal((await request('/api/keys',readKey,{method:'POST',body:'{}'})).status,403);
  assert.equal((await request('/api/keys/'+foreign,'good-jwt',{method:'DELETE'})).status,404);
  assert.equal(calls.some(c=>c.method==='PATCH'),false,'Foreign keys cannot be revoked');
  assert.equal((await request('/api/keys','good-jwt')).status,200);
  const input={title:job.title,claim:job.claim,quote:job.quote,sourceUrl:job.sourceUrl,location:job.location,relationship:job.relationship,rewardCents:job.rewardCents};
  assert.equal((await request('/api/v1/jobs','unverified-jwt',{method:'POST',body:JSON.stringify(input)})).status,403);
  assert.equal((await request('/api/v1/jobs','good-jwt',{method:'POST',body:JSON.stringify({...input,owner:foreign})})).status,400);
  assert.equal((await request('/api/v1/jobs','good-jwt',{method:'POST',body:JSON.stringify(input)})).status,201);
  assert.equal((await request('/api/v1/jobs','good-jwt',{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await request('/api/auth/logout',null,{method:'POST',headers:{Cookie:'ev_session=good-jwt'},body:'{}'})).status,403);
  const logout=await request('/api/auth/logout',null,{method:'POST',headers:{Cookie:'ev_session=good-jwt',Origin:'http://localhost:3200'},body:'{}'});
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/ev_refresh=/);
  client=new Client({name:'ev-test',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+readKey}}}));
  const tools=await client.listTools();assert.equal(tools.tools.length,4);
  const listed=await client.callTool({name:'list_review_tasks',arguments:{}});assert.equal(JSON.parse(listed.content[0].text)[0].id,keyId);
  const denied=await client.callTool({name:'create_review_task',arguments:input});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/jobs:write/);
 } finally {await client?.close();await new Promise(r=>server.close(r));await new Promise(r=>upstreamServer.close(r));}
});
