import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import PocketBase from 'pocketbase';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { jobSchema, reviewSchema, keySchema, splitFee, digest } from './contracts.js';

const app = express();
const origin = process.env.APP_ORIGIN || 'http://localhost:3200';
const pbUrl = process.env.POCKETBASE_URL;
const feeBps = Number(process.env.PLATFORM_FEE_BPS || 1000);
splitFee(0, feeBps);
const secure = new URL(origin).protocol === 'https:';
if (process.env.NODE_ENV === 'production' && (!secure || !pbUrl)) throw new Error('Production requires HTTPS APP_ORIGIN and POCKETBASE_URL');
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: '128kb' }));
app.use(['/api', '/mcp'], rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60000, limit: 25 }));
const fail = (status, message) => Object.assign(new Error(message), { status });
const pbClient = () => { if (!pbUrl) throw fail(503, 'PocketBase is not configured. Explore the sample workspace or configure the identity service.'); const pb = new PocketBase(pbUrl); pb.autoCancellation(false); return pb; };
function cookieToken(req) { const match = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ev_session=')); return match ? decodeURIComponent(match.slice(11)) : ''; }
function setCookie(res, token) { res.cookie('ev_session', token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 3600000 }); }
app.use(['/api', '/mcp'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.headers.origin && req.headers.origin !== origin) return next(fail(403, 'Origin is not allowed'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && cookieToken(req) && req.headers.origin !== origin) return next(fail(403, 'A same-origin request is required'));
  next();
});
async function adminClient() {
  if (!process.env.POCKETBASE_SUPERUSER_EMAIL || !process.env.POCKETBASE_SUPERUSER_PASSWORD) throw fail(503, 'API credentials are not configured on this server');
  const pb = pbClient();
  await pb.collection('_superusers').authWithPassword(process.env.POCKETBASE_SUPERUSER_EMAIL, process.env.POCKETBASE_SUPERUSER_PASSWORD);
  return pb;
}
async function authenticate(req, res, next) {
  try {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    let pb = pbClient();
    if (bearer?.startsWith('evk_')) {
      const admin = await adminClient();
      const key = await admin.collection('ev_api_keys').getFirstListItem(admin.filter('tokenHash = {:hash}', { hash: digest(bearer) }));
      if (key.revoked || !key.expiresAt || Date.parse(key.expiresAt) <= Date.now()) throw fail(401, 'API credential has expired or was revoked');
      const user = await admin.collection('ev_users').getOne(key.owner);
      if (!user.verified) throw fail(403, 'Verify your email before using integrations');
      // Impersonation uses PocketBase record rules for all business operations.
      const session = await admin.collection('ev_users').impersonate(user.id, 300);
      pb = session;
      req.principal = { user, scopes: key.scopes, keyId: key.id };
    } else {
      const token = bearer || cookieToken(req);
      if (!token) throw fail(401, 'Sign in to continue');
      pb.authStore.save(token, null);
      const auth = await pb.collection('ev_users').authRefresh();
      req.principal = { user: auth.record, scopes: null };
    }
    req.pb = pb;
    next();
  } catch (error) { next(error.status ? error : fail(401, 'Authentication failed')); }
}
function permit(req, scope) { if (req.principal.scopes && !req.principal.scopes.includes(scope)) throw fail(403, `Credential requires ${scope}`); }
function browserOnly(req) { if (req.principal.scopes) throw fail(403, 'Manage credentials in your signed-in account'); }
function verified(req) { if (!req.principal.user.verified) throw fail(403, 'Verify your email before creating records'); }
const publicJob = j => ({ id: j.id, title: j.title, claim: j.claim, quote: j.quote, sourceUrl: j.sourceUrl, location: j.location, relationship: j.relationship, visibility: j.visibility, status: j.status, owner: j.owner, fee: splitFee(j.rewardCents, j.feeBps), created: j.created });
async function listJobs(req) { permit(req, 'jobs:read'); return (await req.pb.collection('ev_jobs').getList(1, 50, { sort: '-created' })).items.map(publicJob); }
async function createJob(req, input) {
  permit(req, 'jobs:write'); verified(req);
  const data = jobSchema.parse(input);
  return publicJob(await req.pb.collection('ev_jobs').create({ ...data, owner: req.principal.user.id, status: 'draft', feeBps }));
}
async function submitReview(req, id, input) {
  permit(req, 'reviews:write'); verified(req);
  const data = reviewSchema.parse(input);
  const job = await req.pb.collection('ev_jobs').getOne(id);
  if (job.owner === req.principal.user.id) throw fail(403, 'You cannot validate your own task');
  if (job.status !== 'open') throw fail(409, 'This task is not open for review');
  const record = await req.pb.collection('ev_reviews').create({ ...data, job: id, reviewer: req.principal.user.id, status: 'submitted' });
  return { id: record.id, status: record.status, message: 'Review submitted. No payment has been initiated.' };
}
async function bundle(req, id) {
  permit(req, 'bundles:read');
  const job = publicJob(await req.pb.collection('ev_jobs').getOne(id));
  const result = await req.pb.collection('ev_reviews').getList(1, 100, { filter: req.pb.filter('job = {:id}', { id }), sort: 'created,id' });
  const reviews = result.items.map(r => ({ id: r.id, reviewer: r.reviewer, verdict: r.verdict, quote: r.quote, location: r.location, reasoning: r.reasoning, status: r.status }));
  const payload = { schema: 'evidence-validation/bundle/v1', job, reviews, coverage: { accessibleReviews: result.totalItems, includedReviews: reviews.length, completeForThisAccount: result.totalItems === reviews.length } };
  return { payload, sha256: digest(payload), publication: 'not_published', signature: null };
}
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/api/config', (req, res) => res.json({ name: 'evidence-validation', pocketbaseConfigured: !!pbUrl, feeBps, storage: 'not_connected', payments: 'not_connected', mcp: '/mcp', api: '/api/v1', capabilities: ['drafts', 'pilot_reviews', 'bundle_export', 'scoped_credentials'] }));
app.post('/api/auth/register', async (req, res) => {
  const data = z.object({ email: z.string().email().max(254), name: z.string().trim().min(2).max(100), password: z.string().min(12).max(128) }).strict().parse(req.body);
  const pb = pbClient();
  await pb.collection('ev_users').create({ ...data, passwordConfirm: data.password });
  let message = 'Account created. Check your email to verify your account before creating tasks or credentials.';
  try { await pb.collection('ev_users').requestVerification(data.email); }
  catch { message = 'Account created, but verification email delivery is unavailable. Contact the service operator; do not register again.'; }
  res.status(201).json({ message });
});
app.post('/api/auth/login', async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).strict().parse(req.body);
  const pb = pbClient();
  try { const auth = await pb.collection('ev_users').authWithPassword(data.email, data.password); setCookie(res, auth.token); res.json({ user: { id: auth.record.id, name: auth.record.name, email: auth.record.email, verified: auth.record.verified } }); }
  catch { throw fail(401, 'Email or password is incorrect'); }
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('ev_session', { httpOnly: true, secure, sameSite: 'strict', path: '/' }); res.json({ ok: true }); });
app.post('/api/auth/reset', async (req, res) => {
  const email = z.string().email().parse(req.body.email);
  const pb = pbClient();
  await pb.collection('ev_users').requestPasswordReset(email).catch(() => {});
  res.json({ message: 'If the account exists, a password reset email has been requested.' });
});
app.get('/api/me', authenticate, (req, res) => { const u = req.principal.user; res.json({ user: { id: u.id, name: u.name, email: u.email, verified: u.verified } }); });
app.get('/api/v1/jobs', authenticate, async (req, res) => res.json({ items: await listJobs(req) }));
app.post('/api/v1/jobs', authenticate, async (req, res) => res.status(201).json(await createJob(req, req.body)));
app.post('/api/v1/jobs/:id/reviews', authenticate, async (req, res) => res.status(201).json(await submitReview(req, req.params.id, req.body)));
app.get('/api/v1/jobs/:id/bundle', authenticate, async (req, res) => res.json(await bundle(req, req.params.id)));
app.get('/api/keys', authenticate, async (req, res) => {
  browserOnly(req);
  const keys = await req.pb.collection('ev_api_keys').getList(1, 50, { sort: '-created' });
  res.json({ items: keys.items.map(k => ({ id: k.id, name: k.name, scopes: k.scopes, expiresAt: k.expiresAt, revoked: k.revoked })) });
});
app.post('/api/keys', authenticate, async (req, res) => {
  browserOnly(req); verified(req); const data = keySchema.parse(req.body);
  const admin = await adminClient();
  const token = 'evk_' + randomBytes(32).toString('hex');
  const record = await admin.collection('ev_api_keys').create({ owner: req.principal.user.id, name: data.name, scopes: [...new Set(data.scopes)], tokenHash: digest(token), expiresAt: new Date(Date.now() + data.expiresDays * 86400000).toISOString(), revoked: false });
  res.status(201).json({ id: record.id, token, expiresAt: record.expiresAt });
});
app.delete('/api/keys/:id', authenticate, async (req, res) => {
  browserOnly(req);
  await req.pb.collection('ev_api_keys').getOne(req.params.id);
  const admin = await adminClient();
  await admin.collection('ev_api_keys').update(req.params.id, { revoked: true });
  res.json({ ok: true });
});
app.post('/mcp', authenticate, async (req, res, next) => {
  const server = new McpServer({ name: 'evidence-validation', version: '0.1.0' });
  const output = async fn => { try { return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] }; } catch (e) { return { isError: true, content: [{ type: 'text', text: e.status ? e.message : 'Operation failed; check the input and your access.' }] }; } };
  server.registerTool('list_review_tasks', { description: 'List tasks accessible to the authenticated account. Requires jobs:read.' }, () => output(() => listJobs(req)));
  server.registerTool('create_review_task', { description: 'Create an unfunded draft. Does not publish evidence or spend money. Requires jobs:write.', inputSchema: jobSchema.shape }, input => output(() => createJob(req, input)));
  server.registerTool('submit_evidence_review', { description: 'Submit a review to an open pilot task. No payment is initiated. Requires reviews:write.', inputSchema: { jobId: z.string(), ...reviewSchema.shape } }, ({ jobId, ...input }) => output(() => submitReview(req, jobId, input)));
  server.registerTool('export_evidence_bundle', { description: 'Export accessible evidence with a SHA-256 digest; not an IPFS CID or signed attestation. Requires bundles:read.', inputSchema: { jobId: z.string() } }, ({ jobId }) => output(() => bundle(req, jobId)));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); } catch (e) { next(e); }
});
app.all('/mcp', (req, res) => res.status(405).json({ error: 'Use POST for stateless MCP requests' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const status = Number(error.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 500 ? 'Service operation failed' : error.message || 'Request failed' });
});
export { app };
if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(Number(process.env.PORT || 3200), '0.0.0.0', () => console.log('evidence-validation listening'));
