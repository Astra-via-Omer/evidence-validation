import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFee, digest, jobSchema, reviewSchema } from '../src/contracts.js';
test('fee split conserves every cent, including fractional fees', () => {
  for (const amount of [0,1,19,1999,2000,1000000]) {
    const split = splitFee(amount,1000);
    assert.equal(split.feeCents+split.validatorCents,amount);
    assert.equal(split.settlement,'not_connected');
    assert.equal(split.feeCents,Math.floor(amount/10));
  }
  assert.throws(()=>splitFee(-1,1000)); assert.throws(()=>splitFee(100,10001));
});
test('bundle digest is independent of object key insertion order',()=>{
  assert.equal(digest({b:2,a:{y:4,x:3}}),digest({a:{x:3,y:4},b:2}));
  assert.notEqual(digest({quote:'First'}),digest({quote:'Changed'}));
});
test('job input cannot set a funding state or owner and forbids unsafe URLs',()=>{
  const job={title:'A review task',claim:'A sufficiently long claim.',quote:'Exact quote',sourceUrl:'https://example.org',location:'Page 1',relationship:'supports',rewardCents:2000};
  assert.equal(jobSchema.parse(job).visibility,'private');
  assert.throws(()=>jobSchema.parse({...job,status:'paid'}));
  assert.throws(()=>jobSchema.parse({...job,owner:'another-user'}));
  assert.throws(()=>jobSchema.parse({...job,sourceUrl:'javascript:alert(1)'}));
});
test('review requires conflict declaration and meaningful reasoning',()=>{
  const review={verdict:'insufficient',reasoning:'The excerpt does not establish whether the sample represents the wider population.',quote:'Exact quote',location:'Page 1',conflictFree:true};
  assert.equal(reviewSchema.parse(review).verdict,'insufficient');
  assert.throws(()=>reviewSchema.parse({...review,conflictFree:false}));
  assert.throws(()=>reviewSchema.parse({...review,reasoning:'Looks good'}));
});
