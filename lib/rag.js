/**
 * lib/rag.js — "Ask the archive" (Retrieval-Augmented Generation).
 *
 * The retrieval half is lib/search.js (semantic when an embeddings key is present,
 * keyword otherwise). The generation half is Claude (host.ai): we take the top
 * matching articles, hand their text to Claude as NUMBERED sources, and ask it to
 * answer ONLY from those and cite each claim [n]. So the answer is grounded in the
 * newsroom's own past reporting, with links back to it — exactly the Layer-3 use
 * case (what have we written about X / find prior coverage / fact-check against our
 * own work). Retrieval = embeddings (OpenAI); answer = Claude. Withdrawn articles
 * are already excluded by search().
 */

import { search } from './search.js';
import { getArticle } from './store.js';
import { getProfile, formatContextForPrompt } from './context.js';

const MAX_SOURCES = 6;
const PER_SOURCE_CHARS = 1800;

export async function askArchive(host, question, { limit = MAX_SOURCES } = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, message: 'Type a question first.' };

  const found = await search(host, q, { limit });
  const hits = (found.results || []).slice(0, limit);
  if (!hits.length) {
    return { ok: true, answer: "I couldn't find anything in the archive about that yet.", sources: [], mode: found.mode };
  }

  // Build numbered sources from the actual article text (not just the snippet).
  const sources = [];
  let context = '';
  for (const h of hits) {
    const a = await getArticle(host, h.id);
    if (!a || !a.clean_markdown) continue;
    const n = sources.length + 1;
    const excerpt = String(a.clean_markdown).replace(/\s+/g, ' ').slice(0, PER_SOURCE_CHARS);
    sources.push({ n, id: a.id, title: a.title || a.slug, url: a.url || null, published_at: a.published_at || null });
    context += `[${n}] ${a.title || a.slug}${a.url ? ` — ${a.url}` : ''}${a.published_at ? ` (${a.published_at.slice(0, 10)})` : ''}\n${excerpt}\n\n`;
  }
  if (!sources.length) {
    return { ok: true, answer: "I found matching articles but none have converted text yet — run conversion first.", sources: [], mode: found.mode };
  }

  const ground = formatContextForPrompt(await getProfile(host));
  const system =
    'You are a research assistant for a newsroom, answering questions using ONLY the '
    + 'newsroom\'s own past reporting, supplied as numbered sources. Rules: (1) use ONLY '
    + 'the sources — never outside knowledge; (2) if they do not answer the question, say so '
    + 'plainly; (3) cite every claim with [n] matching the source numbers; (4) be concise and '
    + 'factual, never invent facts, dates, names or quotes. If sources conflict, note it.';
  const prompt =
    `${ground ? `## This newsroom\n${ground}\n\n` : ''}## Question\n${q}\n\n`
    + `## Sources from the archive\n${context}\n`
    + 'Answer the question using only these sources, citing [n] for each claim.';

  const res = await host.ai.chat(prompt, { system, maxTokens: 800, model: 'claude-sonnet-4-6' });
  await host.log?.run?.({ op: 'ask', sources: sources.length, mode: found.mode }).catch(() => {});
  return { ok: true, answer: (res.text || '').trim(), sources, mode: found.mode, model: res.model };
}
