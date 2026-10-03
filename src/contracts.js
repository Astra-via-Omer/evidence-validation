import { z } from 'zod';
import { createHash } from 'node:crypto';

export const scopes = ['jobs:read', 'jobs:write', 'reviews:write', 'bundles:read'];
export const jobSchema = z.object({
  title: z.string().trim().min(5).max(180),
  claim: z.string().trim().min(10).max(10000),
  quote: z.string().trim().min(5).max(10000),
  sourceUrl: z.string().url().max(2000).refine(v => /^https?:\/\//.test(v), 'Use an HTTP or HTTPS source'),
  location: z.string().trim().min(1).max(500),
  relationship: z.enum(['supports', 'challenges', 'context']),
  rewardCents: z.number().int().min(0).max(1000000),
  visibility: z.enum(['private', 'public']).default('private'),
}).strict();
export const reviewSchema = z.object({
  verdict: z.enum(['supports', 'challenges', 'context', 'insufficient', 'mismatch']),
  reasoning: z.string().trim().min(40).max(10000),
  quote: z.string().trim().min(5).max(10000),
  location: z.string().trim().min(1).max(500),
  conflictFree: z.literal(true),
}).strict();
export const keySchema = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(scopes)).min(1).max(4), expiresDays: z.number().int().min(1).max(90).default(30) }).strict();
export function splitFee(amountCents, feeBps) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new Error('Invalid fee inputs');
  const feeCents = Math.floor(amountCents * feeBps / 10000);
  return { grossCents: amountCents, feeCents, validatorCents: amountCents - feeCents, feeBps, currency: 'USD', settlement: 'not_connected' };
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
