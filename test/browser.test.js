import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = (await readFile(new URL('../public/workflow.js', import.meta.url), 'utf8')).replaceAll('export function', 'function') + '\n' +
  (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
const user = { id: 'approved-account', name: 'Approved user', email: 'approved@example.invalid', verified: true };
const job = { id: 'private-task', title: 'Private evidence only for approved users', claim: 'Private claim', location: 'Private source', relationship: 'supports', status: 'draft', visibility: 'private', fee: { grossCents: 0 } };
const response = (status, data) => ({ ok: status < 400, status, json: async () => data });
const denied = () => response(403, { error: 'Evidence access needs administrator approval.', code: 'EVIDENCE_ACCESS_DENIED' });
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };

async function browser(request, url = 'https://evidence.example/') {
  const dom = new JSDOM('<div id="app"></div><div id="notice"></div><dialog id="modal"><button class="close"></button><div id="modal-body"></div></dialog>', { url, runScripts: 'outside-only' });
  dom.window.fetch = async (path, options) => path === '/api/config' ? response(200, { feeBps: 1000 }) : request(path, options);
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
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
