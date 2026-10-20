import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseSchema } from '../src/cases.js';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const sample = () => ({ title: 'Investigation case', reference: 'CASE-01', summary: '', nodes: [{ id: a, kind: 'evidence', title: 'Original record', body: '', jobId: b, x: 100, y: 100 }, { id: b, kind: 'person', title: 'Witness', body: '', x: 500, y: 200 }], links: [{ id: a, from: a, to: b, relationship: 'question', label: 'Needs corroboration' }], meeting: { title: '', date: '', participants: '', objective: '', agenda: '', notes: '', questions: [] } });
test('case contract accepts source-linked boards and rejects broken relationships, ambiguous IDs and oversized data', () => {
  assert.equal(caseSchema.parse(sample()).nodes.length, 2);
  for (const mutate of [
    data => data.nodes.push(data.nodes[0]),
    data => data.links[0].to = a,
    data => data.links[0].to = '33333333-3333-4333-8333-333333333333',
    data => delete data.nodes[0].jobId,
    data => data.nodes[1].jobId = a,
    data => data.nodes[0].x = -1,
    data => data.meeting.notes = 'x'.repeat(10001),
    data => data.owner = a,
    data => data.meeting.questions = Array(2).fill({ id: a, text: 'A repeated question', done: false }),
  ]) { const data = sample(); mutate(data); assert.equal(caseSchema.safeParse(data).success, false); }
});
