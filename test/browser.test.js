import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const caseSource = (await readFile(new URL('../public/cases.js', import.meta.url), 'utf8')).replaceAll('export function', 'function');
const source = (await readFile(new URL('../public/workflow.js', import.meta.url), 'utf8')).replaceAll('export function', 'function') + '\n' +
  `const {createCaseWorkspace, web3Markup} = (() => {${caseSource}; return {createCaseWorkspace, web3Markup};})();\n` +
  (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const user = { id: 'approved-account', name: 'Approved user', email: 'approved@example.invalid', verified: true };
const job = { id: 'private-task', title: 'Private evidence only for approved users', claim: 'Private claim', location: 'Private source', relationship: 'supports', status: 'draft', visibility: 'private', fee: { grossCents: 0 } };
const response = (status, data) => ({ ok: status < 400, status, json: async () => data });
const denied = () => response(403, { error: 'Evidence access needs administrator approval.', code: 'EVIDENCE_ACCESS_DENIED' });
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };

async function browser(request, url = 'https://evidence.example/') {
  const dom = new JSDOM('<div id="app"></div><div id="notice"></div><dialog id="modal"><button class="close"></button><div id="modal-body"></div></dialog>', { url, runScripts: 'outside-only' });
  dom.window.fetch = async (path, options) => path === '/api/config' ? response(200, { feeBps: 1000 }) : request(path, options);
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.structuredClone = structuredClone;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  await dom.window.eval(`(async () => {${source}\n})()`);
  return dom;
}

async function login(dom) {
  const document = dom.window.document;
  document.querySelector('[data-action="login"]').click();
  const form = document.querySelector('#auth-form');
  form.elements.email.value = user.email;
  form.elements.password.value = 'synthetic-password';
  await form.onsubmit({ preventDefault() {}, target: form });
}

test('anonymous visitors and denied login cannot open any workspace or sample mode', async () => {
  const requests = [];
  const dom = await browser(async path => { requests.push(path); return path === '/api/auth/login' ? denied() : response(401, { error: 'Sign in to continue' }); });
  try {
    const document = dom.window.document;
    assert.equal(document.querySelector('.shell'), null);
    assert.equal(document.querySelector('[data-action="demo"]'), null);
    assert.equal(document.querySelector('[data-action="register"]'), null);
    document.querySelector('[data-action="docs"]').click();
    await flush();
    assert.ok(document.querySelector('#auth-form'));
    assert.equal(document.querySelector('.shell'), null);
    dom.window.document.querySelector('#modal').close();
    await login(dom);
    assert.equal(document.querySelector('.shell'), null);
    assert.match(document.querySelector('.formerror').textContent, /administrator approval/);
    assert.equal(requests.includes('/api/v1/jobs'), false);
  } finally { dom.window.close(); }
});

test('case board pins actual evidence, connects annotations, persists meeting preparation and retains fees', async () => {
  let signedIn = false, saved = null, bundles = 0;
  const task = { ...job, id: '11111111-1111-4111-8111-111111111111', owner: user.id, quote: 'A traceable source quotation.', sourceUrl: 'https://example.org/report', fee: { grossCents: 2000, feeCents: 200, validatorCents: 1800 } };
  const dom = await browser(async (path, options = {}) => {
    if (path === '/api/me') return signedIn ? response(200, { user }) : response(401, { error: 'Sign in' });
    if (path === '/api/auth/login') { signedIn = true; return response(200, { user }); }
    if (path === '/api/v1/jobs') return response(200, { items: [task] });
    if (path === '/api/cases' && options.method === 'POST') { saved = { id: '22222222-2222-4222-8222-222222222222', ...JSON.parse(options.body), revision: 1 }; return response(201, saved); }
    if (path === '/api/cases') return response(200, { items: [], totalItems: 0 });
    if (path.endsWith('/bundle')) { bundles++; return response(200, { payload: { reviews: [{ verdict: 'context', reasoning: '<img src=x> is untrusted review text.', quote: 'An exact excerpt', location: 'Page 3' }], coverage: { includedReviews: 1, accessibleReviews: 1, completeForThisAccount: true } } }); }
    throw Error('Unexpected request: ' + path);
  });
  try {
    const doc = dom.window.document;
    await login(dom);
    doc.querySelector('[data-page="investigation"]').click(); await flush();
    assert.ok(doc.querySelector('.case-board-viewport'));
    doc.querySelector('[data-cw-pin]').click(); await flush();
    assert.equal(doc.querySelectorAll('.case-node.evidence').length, 1);
    assert.equal(bundles, 1);
    assert.match(doc.querySelector('.case-inspector').textContent, /untrusted review text/);
    assert.equal(doc.querySelector('.case-inspector img'), null);
    doc.querySelector('[data-cw-action="add-card"]').click(); await flush();
    let form = doc.querySelector('#case-card-form'); form.elements.title.value = 'Witness A'; form.elements.body.value = 'An unverified recollection.';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
    doc.querySelector('[data-cw-action="add-link"]').click(); await flush();
    form = doc.querySelector('#case-link-form'); form.elements.from.value = doc.querySelector('.case-node.evidence').dataset.cwNode; form.elements.to.value = doc.querySelector('.case-node.person').dataset.cwNode;
    form.elements.relationship.value = 'question'; form.elements.label.value = 'Needs corroboration';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
    assert.match(doc.querySelector('.case-edges').textContent, /Needs corroboration/);
    const node = doc.querySelector('.case-node.person'); node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    doc.querySelector('[data-cw-action="legal"]').click(); await flush();
    const objective = doc.querySelector('[data-meeting-field="objective"]'); objective.value = 'Agree which missing source to request.'; objective.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(doc.querySelectorAll('.meeting-exhibit').length, 1);
    form = doc.querySelector('#case-question-form'); form.elements.question.value = 'Can we obtain the original record?'; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
    doc.querySelector('[data-cw-question]').click(); await flush();
    doc.querySelector('[data-cw-action="save"]').click(); await flush();
    assert.equal(saved.document.nodes.length, 2); assert.equal(saved.document.links[0].relationship, 'question');
    assert.equal(saved.document.nodes[1].x, 400, 'Keyboard movement is saved');
    assert.equal(saved.document.meeting.objective, objective.value); assert.equal(saved.document.meeting.questions[0].done, true);
    assert.match(doc.querySelector('#case-save-state').textContent, /All changes saved/);
    doc.querySelector('[data-page="earnings"]').click(); await flush();
    assert.match(doc.querySelector('.web3-process').textContent, /\$18\.00/); assert.match(doc.querySelector('.web3-process').textContent, /\$2\.00/);
    assert.match(doc.querySelector('.web3-process').textContent, /Anchor & attest/); assert.match(doc.querySelector('.web3-process').textContent, /Integration pending/);
  } finally { dom.window.close(); }
});

test('approved login opens real records; revocation removes cached records and workspace', async () => {
  let revoked = false, signedIn = false;
  const dom = await browser(async path => {
    if (path === '/api/me') return revoked ? denied() : signedIn ? response(200, { user }) : response(401, { error: 'Sign in' });
    if (path === '/api/auth/login') { signedIn = true; return response(200, { user }); }
    if (revoked) return denied();
    if (path === '/api/v1/jobs') return response(200, { items: [job] });
    throw Error('Unexpected request: ' + path);
  });
  try {
    await login(dom);
    assert.ok(dom.window.document.querySelector('.shell'));
    assert.match(dom.window.document.querySelector('.shell').textContent, /Private evidence/);
    assert.equal(dom.window.location.pathname, '/workspace');
    revoked = true;
    dom.window.document.querySelector('[data-page="integrations"]').click();
    await flush();
    assert.equal(dom.window.document.querySelector('.shell'), null);
    assert.equal(dom.window.document.body.textContent.includes(job.title), false);
    assert.equal(dom.window.location.pathname, '/');
  } finally { dom.window.close(); }
});

test('denied email-link exchange strips tokens and leaves the workspace closed', async () => {
  const dom = await browser(async path => { assert.equal(path, '/api/auth/session'); return denied(); }, 'https://evidence.example/#access_token=synthetic&refresh_token=synthetic');
  try {
    assert.equal(dom.window.location.hash, '');
    assert.equal(dom.window.document.querySelector('.shell'), null);
    assert.match(dom.window.document.querySelector('#notice').textContent, /administrator approval/);
  } finally { dom.window.close(); }
});

test('AI assistance is explicit, escapes model text and never submits a human review', async () => {
 let signedIn=false, aiCalls=0;const requests=[];
 const dom=await browser(async(path,options)=>{
  requests.push(path);
  if(path==='/api/me')return signedIn?response(200,{user}):response(401,{error:'Sign in'});
  if(path==='/api/auth/login'){signedIn=true;return response(200,{user});}
  if(path==='/api/v1/jobs')return response(200,{items:[job]});
  if(path==='/api/v1/jobs/'+job.id+'/assist'){
   aiCalls++;const sent=JSON.parse(options.body);assert.equal(typeof sent.requestId,'string');assert.equal(sent.focus,'Check the scope');assert.deepEqual(Object.keys(sent).sort(),['focus','requestId']);
   return response(200,{assessment:'<img src=x onerror=alert(1)> is untrusted model text.',suggestedRelationship:'context',quote:'Quoted evidence',questions:['Check primary measurements.'],submitted:false});
  }
  throw Error('Unexpected request: '+path);
 });
 try{
  await login(dom);assert.equal(aiCalls,0);
  dom.window.document.querySelector('[data-task]').click();await flush();
  dom.window.document.querySelector('[data-assist]').click();await flush();assert.equal(aiCalls,0);
  const form=dom.window.document.querySelector('#assist-form');form.elements.focus.value='Check the scope';
  await form.onsubmit({preventDefault(){},target:form});
  const result=dom.window.document.querySelector('#assist-result');assert.match(result.textContent,/No review was submitted/);assert.equal(result.querySelector('img'),null);assert.equal(aiCalls,1);
  assert.equal(requests.some(path=>path.endsWith('/reviews')),false);
 }finally{dom.window.close();}
});
