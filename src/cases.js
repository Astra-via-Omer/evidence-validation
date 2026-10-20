import { z } from 'zod';

const text = max => z.string().max(max);
const node = z.object({
  id: z.string().uuid(), kind: z.enum(['evidence', 'person', 'event', 'note']),
  title: z.string().trim().min(1).max(180), body: text(3000).default(''),
  jobId: z.string().uuid().optional(), x: z.number().min(0).max(1260), y: z.number().min(0).max(880),
}).strict().superRefine((value, ctx) => {
  if ((value.kind === 'evidence') !== Boolean(value.jobId)) ctx.addIssue({ code: 'custom', message: 'Evidence cards require a review task; other cards cannot reference one.' });
});
export const caseSchema = z.object({
  title: z.string().trim().min(3).max(180), reference: text(100).default(''),
  summary: text(3000).default(''), nodes: z.array(node).max(80),
  links: z.array(z.object({ id: z.string().uuid(), from: z.string().uuid(), to: z.string().uuid(),
    relationship: z.enum(['supports', 'challenges', 'context', 'question']), label: text(180).default(''),
  }).strict()).max(160),
  meeting: z.object({ title: text(180), date: text(40), participants: text(1000), objective: text(3000), agenda: text(5000), notes: text(10000),
    questions: z.array(z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(1000), done: z.boolean() }).strict()).max(60),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.nodes.map(n => n.id));
  const linkIds = new Set(value.links.map(n => n.id));
  const jobIds = value.nodes.filter(n => n.kind === 'evidence').map(n => n.jobId);
  if (ids.size !== value.nodes.length || linkIds.size !== value.links.length || new Set(jobIds).size !== jobIds.length || new Set(value.meeting.questions.map(q => q.id)).size !== value.meeting.questions.length) ctx.addIssue({ code: 'custom', message: 'Card, evidence, connection and question IDs must be unique.' });
  if (value.links.some(link => !ids.has(link.from) || !ids.has(link.to) || link.from === link.to)) ctx.addIssue({ code: 'custom', message: 'Connections must join two different cards in this case.' });
  if (Buffer.byteLength(JSON.stringify(value)) > 100000) ctx.addIssue({ code: 'custom', message: 'Case file exceeds the 100 KB pilot limit.' });
});

export function caseRoutes(app, { authenticate, browserOnly, verified }) {
  const guard = (req, res, next) => { try { browserOnly(req); verified(req); next(); } catch (error) { next(error); } };
  app.get('/api/cases', authenticate, guard, async (req, res) => {
    const result = await req.db.collection('ev_cases').getList(1, 50, { sort: '-updated' });
    res.json({ items: result.items, totalItems: result.totalItems });
  });
  async function validate(req) {
    const input = z.object({ document: caseSchema, revision: z.number().int().min(0) }).strict().parse(req.body);
    const ids = [...new Set(input.document.nodes.filter(n => n.jobId).map(n => n.jobId))];
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(id => req.db.collection('ev_jobs').getOne(id)));
    return input;
  }
  app.post('/api/cases', authenticate, guard, async (req, res) => {
    const input = await validate(req);
    if (input.revision !== 0) throw Object.assign(Error('New cases must start at revision zero.'), { status: 400 });
    res.status(201).json(await req.db.collection('ev_cases').create({ document: input.document, revision: 1 }));
  });
  app.put('/api/cases/:id', authenticate, guard, async (req, res) => {
    z.string().uuid().parse(req.params.id);
    const input = await validate(req);
    res.json(await req.db.collection('ev_cases').update(req.params.id, { document: input.document, revision: input.revision }));
  });
}
