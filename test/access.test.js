import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceAccountAllowed } from '../src/access.js';

test('only explicit protected Evidence approval admits a verified active account', () => {
  const approved = { id: 'account', email_confirmed_at: '2026-01-01', app_metadata: { system_access: { evidence: true } } };
  assert.equal(evidenceAccountAllowed(approved), true);
  for (const metadata of [{}, { role: 'admin' }, { system_access: null }, { system_access: {} }, { system_access: { workflow: true } }, { system_access: { evidence: false } }, { system_access: { evidence: 'true' } }]) {
    assert.equal(evidenceAccountAllowed({ ...approved, app_metadata: metadata, user_metadata: { system_access: { evidence: true } } }), false);
  }
  for (const state of [{ email_confirmed_at: null }, { deleted_at: '2026-01-01' }, { banned_until: '2099-01-01' }, { is_anonymous: true }, { app_metadata: { ...approved.app_metadata, disabled: true } }, { app_metadata: { ...approved.app_metadata, disabled: 'true' } }]) {
    assert.equal(evidenceAccountAllowed({ ...approved, ...state }), false);
  }
  assert.equal(evidenceAccountAllowed(null), false);
});
