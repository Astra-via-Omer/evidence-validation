import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assistReview } from '../src/colossus.js';
const job={id:'saved-task',claim:'Capacity increased by 30%.',quote:'Measured capacity was 30 percent higher in the pilot.',sourceUrl:'https://example.org/source',location:'Page 1',relationship:'supports',owner:'private-owner',rewardCents:1000};
const valid={assessment:'The supplied quote describes a pilot measurement; broader conditions need checking.',suggestedRelationship:'supports',quote:job.quote,questions:['Check the pilot baseline and operating conditions.']};
test('optional assistance uses saved evidence, account identity and a scoped Colossus key; concurrent retries make one call',async()=>{
 process.env.COLOSSUS_SERVICE_KEY='cs_'+'b'.repeat(64);process.env.COLOSSUS_URL='https://gateway.example';
 let calls=0;
 const input={requestId:randomUUID(),focus:'Check the pilot scope'},request={userId:'alice',token:'verified-account',job,input};
 const fetcher=async(url,options)=>{calls++;assert.equal(String(url),'https://gateway.example/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer verified-account');assert.equal(options.headers['X-Colossus-Service-Key'],process.env.COLOSSUS_SERVICE_KEY);assert.equal(options.headers['X-Colossus-Activity'],'evidence.review');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body),sent=JSON.parse(body.messages[1].content);assert.equal(body.model,'astra-default');assert.equal(sent.quote,job.quote);assert(!('owner' in sent));assert(!('rewardCents' in sent));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});};
 const [one,two]=await Promise.all([assistReview(request,fetcher),assistReview(request,fetcher)]);assert.equal(calls,1);assert.deepEqual(one,two);assert.equal(one.submitted,false);assert.equal(one.usage.totalTokens,120);
 await assert.rejects(assistReview({...request,input:{...input,focus:'Changed focus'}},fetcher),{status:409});assert.equal(calls,1);
 await assistReview({...request,userId:'bob'},fetcher);assert.equal(calls,2);
});
test('invented quotes, malformed output, revoked groups and network failure cannot become human reviews',async()=>{
 process.env.COLOSSUS_SERVICE_KEY='cs_'+'b'.repeat(64);process.env.COLOSSUS_URL='https://gateway.example';
 for(const mode of ['quote','schema','length','group','network']){
  let calls=0;const request={userId:'alice',token:'verified-account',job,input:{requestId:randomUUID()}};
  const fetcher=async()=>{calls++;if(mode==='network')throw Error('secret-key-must-not-escape');if(mode==='group')return Response.json({error:{code:'group_required'}},{status:409});return Response.json({choices:[{finish_reason:mode==='length'?'length':'stop',message:{content:JSON.stringify(mode==='quote'?{...valid,quote:'Invented evidence'}:mode==='schema'?{}:valid)}}]});};
  await assert.rejects(assistReview(request,fetcher),error=>error.status===(mode==='group'?409:mode==='network'?503:502)&&!error.message.includes('secret-key'));
  await assert.rejects(assistReview(request,fetcher));assert.equal(calls,1,'Uncertain retries do not make hidden provider calls');
 }
});
test('invalid gateway credentials and client model overrides are rejected before inference',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error();},request={userId:'alice',token:'account',job,input:{requestId:randomUUID(),model:'override'}};
 await assert.rejects(assistReview(request,fetcher));
 request.input={requestId:randomUUID()};process.env.COLOSSUS_SERVICE_KEY='direct-provider-key';await assert.rejects(assistReview(request,fetcher),{status:503});
 process.env.COLOSSUS_SERVICE_KEY='cs_'+'b'.repeat(64);process.env.COLOSSUS_URL='https://username:secret@gateway.example';await assert.rejects(assistReview(request,fetcher),{status:503});assert.equal(calls,0);
});

test('shared credit denials remain actionable and never become AI review output',async()=>{
 process.env.COLOSSUS_SERVICE_KEY='cs_'+'b'.repeat(64);process.env.COLOSSUS_URL='https://gateway.example';
 for(const [code,status] of [['insufficient_credits',402],['credits_paused',403],['account_inactive',403],['credit_account_required',409],['credit_price_required',409],['credits_unavailable',503]]) {
  const request={userId:'alice',token:'account',job,input:{requestId:randomUUID()}};
  await assert.rejects(assistReview(request,async()=>Response.json({error:{code}},{status})),error=>error.status===status);
 }
});
