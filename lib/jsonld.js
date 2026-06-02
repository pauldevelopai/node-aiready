/**
 * lib/jsonld.js — schema.org NewsArticle JSON-LD + the short summary that feeds
 * llms.txt. The skeleton (headline, dates, author, url, publisher) is DETERMINISTIC
 * from the manifest row + the newsroom profile; only `description` and `keywords`
 * are AI-filled, grounded in host.profile so they fit the newsroom's real context.
 * One AI call per article returns {summary, description, keywords}.
 */

import { listArticles, putArticle } from './store.js';
import { isPublishable } from './manifest.js';
import { getProfile, formatContextForPrompt, publisherFromProfile } from './context.js';

/** Deterministic schema.org NewsArticle from the row (+ AI-filled desc/keywords if present). */
export function buildNewsArticle(a, profile) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title || a.slug,
    ...(a.url ? { url: a.url, mainEntityOfPage: a.url } : {}),
    ...(a.published_at ? { datePublished: a.published_at } : {}),
    ...(a.author ? { author: { '@type': 'Person', name: a.author } } : {}),
    ...(a.category ? { articleSection: a.category } : {}),
    ...(a.summary ? { description: a.summary } : {}),
    ...(a.keywords && a.keywords.length ? { keywords: a.keywords.join(', ') } : {}),
  };
  const publisher = publisherFromProfile(profile);
  if (publisher) obj.publisher = publisher;
  return obj;
}

/** The copy-paste <script> snippet for the newsroom's HTML <head>. */
export function jsonLdScript(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

/** Generate summary + JSON-LD for one article via host.ai (grounded in profile). */
export async function generateForArticle(host, article, profile) {
  const body = String(article.clean_markdown || '').slice(0, 6000);
  if (!body) return { ok: false, reason: 'no_markdown' };
  const ground = formatContextForPrompt(profile);
  const system = 'You write concise, factual schema metadata for a newsroom archive. '
    + 'Return STRICT JSON only: {"summary": string (<=220 chars, neutral, no clickbait), '
    + '"description": string (<=160 chars, for meta/JSON-LD), "keywords": string[] (3-8 topical terms)}. '
    + 'Ground everything in the article text; do not invent facts.';
  const prompt = `${ground ? `## This newsroom\n${ground}\n\n` : ''}## Article: ${article.title || article.slug}\n\n${body}\n\n`
    + 'Return the JSON described in the system prompt.';

  const res = await host.ai.chat(prompt, { system, maxTokens: 500, model: 'claude-sonnet-4-6' });
  const parsed = safeJson(res.text);
  if (!parsed) return { ok: false, reason: 'parse_failed' };

  const now = new Date().toISOString();
  const merged = {
    ...article,
    summary: clamp(parsed.summary, 240) || article.summary || null,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
    description: clamp(parsed.description, 180) || null,
  };
  merged.json_ld = buildNewsArticle(merged, profile);
  merged.state = { ...article.state, summarized: now, jsonld: now };
  await putArticle(host, merged);
  return { ok: true };
}

/** Generate for all publishable articles needing JSON-LD/summary. Resumable. */
export async function generateAll(host, { force = false } = {}) {
  const profile = await getProfile(host);
  const all = await listArticles(host);
  // Only spend AI on rows that will actually be published with JSON-LD or listed.
  const todo = all.filter((a) => a.clean_markdown && (isPublishable(a) || a.inclusion === 'include'))
    .filter((a) => force || !a.state?.jsonld);
  const stats = { total: todo.length, done: 0, failed: 0, errors: [] };
  for (const a of todo) {
    try { (await generateForArticle(host, a, profile)).ok ? stats.done++ : stats.failed++; }
    catch (e) { stats.failed++; stats.errors.push({ id: a.id, status: e.message }); }
  }
  await host.log?.run?.({ op: 'generate', total: stats.total, done: stats.done, failed: stats.failed }).catch(() => {});
  return stats;
}

function safeJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function clamp(s, n) { return s ? String(s).trim().slice(0, n) : null; }
