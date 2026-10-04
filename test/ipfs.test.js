import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicSnapshot} from '../src/ipfs.js';
test('public IPFS snapshots omit account identifiers and private export metadata',()=>{
 const result=publicSnapshot({job:{owner:'secret-owner',id:'job',claim:'public claim'},reviews:[{reviewer:'secret-reviewer',verdict:'context',reasoning:'public explanation'}],coverage:{private:'metadata'}});
 const text=JSON.stringify(result);assert.ok(!text.includes('secret-owner'));assert.ok(!text.includes('secret-reviewer'));assert.ok(!text.includes('coverage'));assert.equal(result.job.claim,'public claim');assert.equal(result.reviews[0].verdict,'context');
});
