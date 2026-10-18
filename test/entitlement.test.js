import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveEntitlement } from '../src/entitlement.js';

const now=Date.parse('2026-10-18T10:00:00.000Z');
const active={version:1,kind:'trial',enabled:true,expiresAt:'2026-10-18T10:00:00.001Z'};
test('trial and subscription expiry share a strict boundary and deny missing or malformed plans',()=>{
 for(const kind of ['trial','subscription']) {
  assert.equal(hasActiveEntitlement({astra_entitlement:{...active,kind}},now),true);
  assert.equal(hasActiveEntitlement({astra_entitlement:{...active,kind,expiresAt:'2026-10-18T10:00:00.000Z'}},now),false);
 }
 for(const value of [null,{},[],{...active,version:2},{...active,enabled:'true'},{...active,enabled:false},{...active,kind:'permanent'},{...active,expiresAt:'not-a-date'},{...active,expiresAt:'2026-02-30T10:00:00.000Z'},{...active,expiresAt:null}]) assert.equal(hasActiveEntitlement({astra_entitlement:value},now),false);
 assert.equal(hasActiveEntitlement(undefined,now),false);
 assert.equal(hasActiveEntitlement({role:'admin'},now),false,'An admin role never grants a term');
 assert.equal(hasActiveEntitlement({user_metadata:{astra_entitlement:active}},now),false,'Editable metadata never grants a term');
});
