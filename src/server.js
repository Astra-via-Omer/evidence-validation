import express from 'express';
import { evidenceAccountAllowed } from './access.js';
import { ipfsConfigured, ipfsRequest, publicSnapshot } from './ipfs.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { database } from './supabase.js';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { jobSchema, reviewSchema, keySchema, splitFee, digest } from './contracts.js';

const app = express();
const origin = process.env.APP_ORIGIN || 'http://localhost:3200';
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const feeBps = Number(process.env.PLATFORM_FEE_BPS || 1000);
splitFee(0, feeBps);
const secure = new URL(origin).protocol === 'https:';
if (process.env.NODE_ENV === 'production' && (!secure || (!supabaseUrl || !anonKey))) throw new Error('Production requires HTTPS APP_ORIGIN and SUPABASE_URL and SUPABASE_ANON_KEY');
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: '128kb' }));
app.use(['/api', '/mcp'], rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60000, limit: 25 }));
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const authClient = () => { if (!supabaseUrl || !anonKey) throw fail(503, 'Supabase is not configured'); return createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); };
const userView = u => ({ id: u.id, name: u.user_metadata?.name || u.user_metadata?.full_name || u.email, email: u.email, verified: !!u.email_confirmed_at });
async function result(promise) { const { data, error } = await promise; if (error) throw fail(error.status || 400, 'Supabase operation failed'); return data; }
function cookieToken(req, name = 'ev_session') { const match = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`)); return match ? decodeURIComponent(match.slice(name.length + 1)) : ''; }
function setCookie(res, session) { const opts = { httpOnly: true, secure, sameSite: 'strict', path: '/' }; res.cookie('ev_session', session.access_token, { ...opts, maxAge: session.expires_in * 1000 }); res.cookie('ev_refresh', session.refresh_token, { ...opts, maxAge: 30 * 86400000 }); }
function clearCookies(res) { for (const name of ['ev_session', 'ev_refresh']) res.clearCookie(name, { httpOnly: true, secure, sameSite: 'strict', path: '/' }); }
app.use(['/api', '/mcp'], (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.headers.origin && req.headers.origin !== origin) return next(fail(403, 'Origin is not allowed'));
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (cookieToken(req) || cookieToken(req, 'ev_refresh')) && req.headers.origin !== origin) return next(fail(403, 'A same-origin request is required'));
  next();
});
function adminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw fail(503, 'Integration credentials are not configured');
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function checkAccount(user) {
  if (!evidenceAccountAllowed(user)) throw fail(403, 'This account needs verified email and administrator approval for Evidence access.', 'EVIDENCE_ACCESS_DENIED');
}
async function authenticate(req, res, next) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  try {
    if (bearer?.startsWith('evk_')) {
      const admin = adminClient();
      const { data: key, error } = await admin.from('ev_api_keys').select('*').eq('tokenHash', digest(bearer)).single();
      if (error || !key || key.revoked || Date.parse(key.expiresAt) <= Date.now()) throw fail(401, 'API credential has expired or was revoked');
      const user = (await result(admin.auth.admin.getUserById(key.owner))).user;
      checkAccount(user);
      if (!user.email_confirmed_at) throw fail(403, 'Verify your email before using integrations');
      req.principal = { user: userView(user), scopes: key.scopes, keyId: key.id };
      req.db = database(admin, user.id);
    } else {
      let token = bearer || cookieToken(req);
      if (!token && !cookieToken(req, 'ev_refresh')) throw fail(401, 'Sign in to continue', 'AUTHENTICATION_REQUIRED');
      const auth = authClient();
      let refreshToken = cookieToken(req, 'ev_refresh');
      let refreshedSession;
      let account = token ? await auth.auth.getUser(token) : { error: true };
      if (account.error && !bearer && cookieToken(req, 'ev_refresh')) {
        const { data: refreshed, error } = await auth.auth.refreshSession({ refresh_token: cookieToken(req, 'ev_refresh') });
        if (error || !refreshed.session) throw fail(error?.status >= 500 ? 503 : 401, 'Your session expired. Sign in again.', 'AUTHENTICATION_REQUIRED');
        token = refreshed.session.access_token;
        refreshToken = refreshed.session.refresh_token;
        refreshedSession = refreshed.session;
        account = await auth.auth.getUser(token);
      }
      if (account.error || !account.data?.user) throw fail(401, 'Sign in to continue', 'AUTHENTICATION_REQUIRED');
      const user = account.data.user;
      checkAccount(user);
      if (refreshedSession) setCookie(res, refreshedSession);
      req.principal = { user: userView(user), scopes: null };
      req.accessToken = token; req.refreshToken = refreshToken;
      const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      req.db = database(db, user.id);
    }
    next();
  } catch (error) {
    if (!bearer && (cookieToken(req) || cookieToken(req, 'ev_refresh'))) clearCookies(res);
    next(error.status ? error : fail(401, 'Authentication failed', 'AUTHENTICATION_REQUIRED'));
  }
}
function permit(req, scope) { if (req.principal.scopes && !req.principal.scopes.includes(scope)) throw fail(403, `Credential requires ${scope}`); }
function browserOnly(req) { if (req.principal.scopes) throw fail(403, 'Manage credentials in your signed-in account'); }
function verified(req) { if (!req.principal.user.verified) throw fail(403, 'Verify your email before creating records'); }
const publicJob = j => ({ id: j.id, title: j.title, claim: j.claim, quote: j.quote, sourceUrl: j.sourceUrl, location: j.location, relationship: j.relationship, visibility: j.visibility, status: j.status, owner: j.owner, fee: splitFee(j.rewardCents, j.feeBps), created: j.created });
async function listJobs(req) { permit(req, 'jobs:read'); return (await req.db.collection('ev_jobs').getList(1, 50, { sort: '-created' })).items.map(publicJob); }
async function createJob(req, input) {
  permit(req, 'jobs:write'); verified(req);
  const data = jobSchema.parse(input);
  return publicJob(await req.db.collection('ev_jobs').create({ ...data, owner: req.principal.user.id, status: 'draft', feeBps }));
}
async function submitReview(req, id, input) {
  permit(req, 'reviews:write'); verified(req);
  const data = reviewSchema.parse(input);
  const job = await req.db.collection('ev_jobs').getOne(id);
  if (job.owner === req.principal.user.id) throw fail(403, 'You cannot validate your own task');
  if (job.status !== 'open') throw fail(409, 'This task is not open for review');
  const record = await req.db.collection('ev_reviews').create({ ...data, job: id, reviewer: req.principal.user.id, status: 'submitted' });
  return { id: record.id, status: record.status, message: 'Review submitted. No payment has been initiated.' };
}
async function bundle(req, id) {
  permit(req, 'bundles:read');
  const job = publicJob(await req.db.collection('ev_jobs').getOne(id));
  const result = await req.db.collection('ev_reviews').getList(1, 100, { filter: req.db.filter('job = {:id}', { id }), sort: 'created,id' });
  const reviews = result.items.map(r => ({ id: r.id, reviewer: r.reviewer, verdict: r.verdict, quote: r.quote, location: r.location, reasoning: r.reasoning, status: r.status }));
  const payload = { schema: 'evidence-validation/bundle/v1', job, reviews, coverage: { accessibleReviews: result.totalItems, includedReviews: reviews.length, completeForThisAccount: result.totalItems === reviews.length } };
  return { payload, sha256: digest(payload), publication: 'not_published', signature: null };
}
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/api/config', (req, res) => res.json({ name: 'evidence-validation', supabaseConfigured: !!supabaseUrl && !!anonKey, authentication: 'supabase', feeBps, storage: ipfsConfigured ? 'ipfs' : 'not_connected', payments: 'not_connected', mcp: '/mcp', api: '/api/v1', capabilities: ['drafts', 'pilot_reviews', 'bundle_export', 'scoped_credentials'] }));
app.post('/api/auth/register', (req, res) => res.status(403).json({ error: 'Evidence access is managed by your Astra administrator. Ask them to create or approve your account.' }));
app.post('/api/auth/login', async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).strict().parse(req.body);
  const { data: auth, error } = await authClient().auth.signInWithPassword(data);
  if (error || !auth.session) throw fail(401, 'Email or password is incorrect');
  checkAccount(auth.user);
  setCookie(res, auth.session);
  res.json({ user: userView(auth.user) });
});
app.post('/api/auth/logout', async (req, res) => {
  // Revoke only this login's refresh session; other Astra sessions remain active.
  const access_token = cookieToken(req), refresh_token = cookieToken(req, 'ev_refresh');
  if (access_token && refresh_token) {
    const auth = authClient();
    const { error } = await auth.auth.setSession({ access_token, refresh_token });
    if (!error) await auth.auth.signOut({ scope: 'local' });
  }
  clearCookies(res); res.json({ ok: true });
});
app.post('/api/auth/reset', async (req, res) => {
  const email = z.string().email().parse(req.body.email);
  await authClient().auth.resetPasswordForEmail(email, { redirectTo: origin });
  res.json({ message: 'If the account exists, a password reset email has been requested through Astra authentication.' });
});
app.post('/api/auth/session', async (req, res) => {
  const data = z.object({ access_token: z.string().min(20).max(8192), refresh_token: z.string().min(10).max(8192) }).strict().parse(req.body);
  const { data: auth, error } = await authClient().auth.setSession(data);
  if (error || !auth.session || !auth.user) throw fail(401, 'The email link is invalid or expired');
  checkAccount(auth.user); setCookie(res, auth.session); res.json({ user: userView(auth.user) });
});
app.post('/api/auth/password', authenticate, async (req, res) => {
  browserOnly(req);
  const password = z.string().min(12).max(128).parse(req.body.password);
  const auth = authClient();
  await result(auth.auth.setSession({ access_token: req.accessToken, refresh_token: req.refreshToken }));
  await result(auth.auth.updateUser({ password }));
  res.json({ message: 'Your Astra account password has been updated.' });
});
app.get('/api/me', authenticate, (req, res) => { const u = req.principal.user; res.json({ user: { id: u.id, name: u.name, email: u.email, verified: u.verified } }); });
app.get('/api/v1/jobs', authenticate, async (req, res) => res.json({ items: await listJobs(req) }));
app.post('/api/v1/jobs', authenticate, async (req, res) => res.status(201).json(await createJob(req, req.body)));
app.post('/api/v1/jobs/:id/reviews', authenticate, async (req, res) => res.status(201).json(await submitReview(req, req.params.id, req.body)));
app.get('/api/v1/jobs/:id/bundle', authenticate, async (req, res) => res.json(await bundle(req, req.params.id)));
app.get('/api/storage/status', authenticate, async(req,res)=>{permit(req,'bundles:read');res.json(await ipfsRequest('/status'));});
app.get('/api/storage/files', authenticate, async(req,res)=>{permit(req,'bundles:read');res.json(await ipfsRequest('/files?owner='+req.principal.user.id));});
app.post('/api/v1/jobs/:id/publish', authenticate, async(req,res)=>{
 browserOnly(req);verified(req);
 z.object({confirmPublic:z.literal(true)}).strict().parse(req.body);
 const job=await req.db.collection('ev_jobs').getOne(req.params.id);
 if(job.owner!==req.principal.user.id)throw fail(403,'Only the task owner can publish');
 if(job.visibility!=='public'||job.status!=='open')throw fail(409,'An operator must open this public task before publication');
 const exported=await bundle(req,job.id);
 if(!exported.payload.coverage.completeForThisAccount)throw fail(409,'The review export exceeds the publication limit');
 const snapshot=publicSnapshot(exported.payload);
 if(Buffer.byteLength(JSON.stringify(snapshot))>120000)throw fail(413,'This bundle exceeds the pilot publication size limit');
 res.status(201).json(await ipfsRequest('/publish',{owner:req.principal.user.id,job:job.id,title:job.title,bundle:snapshot}));
});
app.get('/api/storage/files/:cid/content', authenticate, async(req,res)=>{
 permit(req,'bundles:read');const cid=z.string().regex(/^b[a-z2-7]{20,120}$/).parse(req.params.cid);
 const files=await ipfsRequest('/files?owner='+req.principal.user.id);
 if(!files.items.some(f=>f.cid===cid))throw fail(404,'Published file not found');
 const data=await ipfsRequest('/content/'+cid);
 res.set('Content-Type','application/json').set('Content-Disposition','inline; filename="evidence-'+cid+'.json"').send(data);
});
app.get('/api/keys', authenticate, async (req, res) => {
  browserOnly(req);
  const keys = await req.db.collection('ev_api_keys').getList(1, 50, { sort: '-created' });
  res.json({ items: keys.items.map(k => ({ id: k.id, name: k.name, scopes: k.scopes, expiresAt: k.expiresAt, revoked: k.revoked })) });
});
app.post('/api/keys', authenticate, async (req, res) => {
  browserOnly(req); verified(req); const data = keySchema.parse(req.body);
  const admin = await adminClient();
  const token = 'evk_' + randomBytes(32).toString('hex');
  const record = await database(admin, req.principal.user.id).collection('ev_api_keys').create({ owner: req.principal.user.id, name: data.name, scopes: [...new Set(data.scopes)], tokenHash: digest(token), expiresAt: new Date(Date.now() + data.expiresDays * 86400000).toISOString(), revoked: false });
  res.status(201).json({ id: record.id, token, expiresAt: record.expiresAt });
});
app.delete('/api/keys/:id', authenticate, async (req, res) => {
  browserOnly(req);
  await req.db.collection('ev_api_keys').getOne(req.params.id);
  const admin = await adminClient();
  await database(admin, req.principal.user.id).collection('ev_api_keys').update(req.params.id, { revoked: true });
  res.json({ ok: true });
});
app.post('/mcp', authenticate, async (req, res, next) => {
  const server = new McpServer({ name: 'evidence-validation', version: '0.1.0' });
  const output = async fn => { try { return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] }; } catch (e) { return { isError: true, content: [{ type: 'text', text: e.status ? e.message : 'Operation failed; check the input and your access.' }] }; } };
  server.registerTool('list_review_tasks', { description: 'List tasks accessible to the authenticated account. Requires jobs:read.' }, () => output(() => listJobs(req)));
  server.registerTool('create_review_task', { description: 'Create an unfunded draft. Does not publish evidence or spend money. Requires jobs:write.', inputSchema: jobSchema.shape }, input => output(() => createJob(req, input)));
  server.registerTool('submit_evidence_review', { description: 'Submit a review to an open pilot task. No payment is initiated. Requires reviews:write.', inputSchema: { jobId: z.string(), ...reviewSchema.shape } }, ({ jobId, ...input }) => output(() => submitReview(req, jobId, input)));
  server.registerTool('export_evidence_bundle', { description: 'Export accessible evidence with a SHA-256 digest; not an IPFS CID or signed attestation. Requires bundles:read.', inputSchema: { jobId: z.string() } }, ({ jobId }) => output(() => bundle(req, jobId)));
  server.registerTool('list_published_evidence', {description:'List your real IPFS CIDs and publication records. Requires bundles:read.'},()=>output(async()=>{permit(req,'bundles:read');return ipfsRequest('/files?owner='+req.principal.user.id);}));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); } catch (e) { next(e); }
});
app.all('/mcp', (req, res) => res.status(405).json({ error: 'Use POST for stateless MCP requests' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.get('/workspace', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  authenticate(req, res, error => {
    if (error?.status === 401 || error?.status === 403) return res.redirect('/');
    if (error) return next(error);
    try { browserOnly(req); res.sendFile('index.html', { root: fileURLToPath(new URL('../public', import.meta.url)) }); }
    catch (error) { next(error); }
  });
});
app.get('/how-it-works', (req, res) => res.sendFile('index.html', { root: fileURLToPath(new URL('../public', import.meta.url)) }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (['/api/auth/login', '/api/auth/session'].includes(req.path)) clearCookies(res);
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  const status = Number(error.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 500 ? 'Service operation failed' : error.message || 'Request failed', ...(error.code ? { code: error.code } : {}) });
});
export { app };
if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(Number(process.env.PORT || 3200), '0.0.0.0', () => console.log('evidence-validation listening'));
