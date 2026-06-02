/**
 * lib/search.js — the local-only internal archive search (Layer 3).
 *
 * Semantic when an OpenAI key is present (cosine over stored chunk vectors, ranked
 * by best-passage per article); otherwise a zero-dependency keyword/TF-IDF scorer
 * over the clean markdown. Either way the response reports { mode } so the UI can
 * say which it used. `withdrawn` articles are excluded from the corpus (isSearchable).
 *
 * Vectors are loaded into a warm per-newsroom cache on first query and reused;
 * embed.js calls invalidateSearchCache() after writing new vectors. At ≤~10k
 * articles the cosine sweep is a few ms; above that we warn (see routes).
 */

import { listArticles, listEmbeddings } from './store.js';
import { isSearchable } from './manifest.js';
import { embeddingsAvailable, embedTexts } from './embed.js';

// newsroomId → { vectors: [{id, vec}], builtAt }
const _cache = new Map();
export function invalidateSearchCache(newsroomId) {
  if (newsroomId) _cache.delete(newsroomId); else _cache.clear();
}

export async function search(host, query, { limit = 20 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: true, mode: 'none', results: [] };

  const articles = (await listArticles(host)).filter(isSearchable);
  const byId = new Map(articles.map((a) => [a.id, a]));

  // ── Semantic path ──
  if (embeddingsAvailable()) {
    const index = await warmIndex(host);
    const usable = index.filter((e) => byId.has(e.id));   // respect current filters
    if (usable.length) {
      const [qvec] = await embedTexts([q]);
      const scored = usable.map((e) => ({ id: e.id, score: bestChunkCosine(qvec, e.chunks) }))
        .sort((a, b) => b.score - a.score).slice(0, limit);
      return { ok: true, mode: 'semantic', count: usable.length, results: scored.map((s) => present(byId.get(s.id), s.score, q)) };
    }
    // key present but nothing embedded yet → fall through to keyword
  }

  // ── Keyword fallback (TF-IDF) ──
  const results = keywordRank(articles, q, limit);
  return { ok: true, mode: 'keyword', count: articles.length, results: results.map((r) => present(r.article, r.score, q)) };
}

async function warmIndex(host) {
  const nid = host?.ctx?.newsroomId || 'local';
  if (_cache.has(nid)) return _cache.get(nid).vectors;
  const rows = await listEmbeddings(host);
  const vectors = rows.map((r) => ({ id: r.id, chunks: (r.chunks || []).map((c) => c.vec).filter(Array.isArray) }))
    .filter((v) => v.chunks.length);
  _cache.set(nid, { vectors, builtAt: Date.now() });
  return vectors;
}

function bestChunkCosine(q, chunks) {
  let best = -1;
  for (const c of chunks) { const s = cosine(q, c); if (s > best) best = s; }
  return best;
}
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : -1;
}

// ── Keyword / TF-IDF ──
function keywordRank(articles, query, limit) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const docs = articles.map((a) => ({ article: a, tokens: tokenize(`${a.title || ''} ${a.clean_markdown || ''}`) }));
  const df = new Map();
  for (const t of new Set(terms)) df.set(t, docs.filter((d) => d.tokens.includes(t)).length);
  const N = docs.length || 1;
  return docs.map((d) => {
    const tf = new Map();
    for (const tok of d.tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + N / (1 + (df.get(t) || 0)));
      score += (f / d.tokens.length) * idf * 1000;
    }
    return { article: d.article, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

function present(a, score, query) {
  return {
    id: a.id, title: a.title || a.slug, url: a.url, category: a.category,
    inclusion: a.inclusion, sensitivity_flag: a.sensitivity_flag,
    score: Math.round(score * 1000) / 1000,
    snippet: snippet(a.clean_markdown, query),
  };
}
function snippet(md, query) {
  const text = String(md || '').replace(/[#>*_`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const terms = tokenize(query);
  const lc = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lc.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + text.slice(start, start + 220) + (text.length > start + 220 ? '…' : '');
}
