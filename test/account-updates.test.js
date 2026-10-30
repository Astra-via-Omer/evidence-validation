import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAccountUpdates} from '../public/account-updates.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('updates use trusted product links, isolate accounts and clear private UI after revocation or teardown',async()=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="updates"></div></body></html>',{url:'https://evidence-validation.astra-via.com'});
  const previous={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  globalThis.document=dom.window.document;globalThis.window=dom.window;
  let status=200,owner='account-A',calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/account-events');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return Response.json({settings:{accountId:owner,enabled:true,canUseEvidence:false,revision:0},feed:{cursor:'3',items:[{id:'event',seq:'3',product:'workflow',kind:'source',state:'completed',resourceId:'<img onerror="alert(1)">',occurredAt:'2026-10-30T12:00:00Z',unread:true}]}},{status});};
  const host=document.getElementById('updates');let stop;
  try{
    stop=mountAccountUpdates(host);await settle();
    assert.match(host.textContent,/Workspace source/);assert.equal(host.querySelector('a').href,'https://workspace.astra-via.com/');assert(!host.querySelector('img'));assert(!host.textContent.includes('onerror'));
    status=403;window.dispatchEvent(new window.Event('focus'));await settle();assert.equal(host.childNodes.length,0);
    stop();status=200;stop=mountAccountUpdates(host);await settle();owner='account-B';window.dispatchEvent(new window.Event('focus'));await settle();assert.equal(host.childNodes.length,0);
    stop();owner='account-A';stop=mountAccountUpdates(host);stop();await settle();assert.equal(host.childNodes.length,0);assert(calls>=4);
  }finally{stop?.();globalThis.document=previous.document;globalThis.window=previous.window;globalThis.fetch=previous.fetch;dom.window.close();}
});
