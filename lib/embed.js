/**
 * lib/embed.js — semantic embeddings for the local-only internal search (Layer 3).
 *
 * The runtime's host.ai is chat-only (and Anthropic-only when hosted), so we call
 * OpenAI's embeddings endpoint DIRECTLY (text-embedding-3-small) — same
 * direct-fetch-behind-a-server-managed-token pattern as node-verifier/enrich.js.
 * Key: OPENAI_API_KEY (server-managed online; the user's own key locally). Without
 * it, embeddingsAvailable() is false and lib/search.js falls back to keyword search,
 * so an Anthropic-only laptop still gets internal search.
 *
 * Long articles are chunked (~6k chars, ~200 overlap) and each chunk embedded;
 * search ranks by the best-matching chunk per article (best-passage retrieval).
 */

import { listArticles, putArticle, putEmbedding } from './store.js';
import { isSearchable } from './manifest.js';
import { invalidateSearchCache } from './search.js';

export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIMS = 1536;
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 200;
const BATCH = 64;

export function embeddingsAvailable() { return !!process.env.OPENAI_API_KEY; }

export function chunkText(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= CHUNK_CHARS) return [s];
  const chunks = [];
  let i = 0;
  while (i < s.length) {
    chunks.push(s.slice(i, i + CHUNK_CHARS));
    i += CHUNK_CHARS - CHUNK_OVERLAP;
  }
  return chunks;
}

/** Call OpenAI embeddings for a batch of strings → array of vectors. */
export async function embedTexts(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No OPENAI_API_KEY — semantic embeddings unavailable.');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed one article's markdown and store its chunk vectors. */
export async function embedArticle(host, article) {
  const chunksText = chunkText(article.clean_markdown);
  if (!chunksText.length) return { ok: false, reason: 'empty' };
  const vectors = [];
  for (let i = 0; i < chunksText.length; i += BATCH) {
    vectors.push(...await embedTexts(chunksText.slice(i, i + BATCH)));
  }
  const now = new Date().toISOString();
  await putEmbedding(host, article.id, {
    model: EMBED_MODEL,
    dims: EMBED_DIMS,
    chunks: chunksText.map((t, i) => ({ i, vec: vectors[i], text: t.slice(0, 500) })),
    updated_at: now,
  });
  await putArticle(host, { ...article, state: { ...article.state, embedded: now } });
  return { ok: true, chunks: chunksText.length };
}

/** Embed all searchable, not-yet-embedded articles. Resumable (skips done). */
export async function embedAll(host, { force = false } = {}) {
  if (!embeddingsAvailable()) return { error: 'no_key', message: 'Add an OpenAI key to enable semantic search (search still works as keyword without it).' };
  const all = (await listArticles(host)).filter(isSearchable);
  const todo = force ? all : all.filter((a) => !a.state?.embedded);
  const stats = { total: todo.length, embedded: 0, failed: 0, errors: [] };
  for (const a of todo) {
    try {
      const r = await embedArticle(host, a);
      r.ok ? stats.embedded++ : stats.failed++;
    } catch (e) {
      stats.failed++; stats.errors.push({ id: a.id, status: e.message });
      if (/401|403/.test(e.message)) { stats.errors.push({ fatal: 'Key rejected by OpenAI.' }); break; }
    }
  }
  invalidateSearchCache(host?.ctx?.newsroomId);
  await host.log?.run?.({ op: 'embed', total: stats.total, embedded: stats.embedded, failed: stats.failed }).catch(() => {});
  return stats;
}
