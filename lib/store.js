/**
 * lib/store.js — all persistence goes through host.store (get/put/delete/list),
 * which behaves identically on the lite host (JSON files) and hosted (Postgres
 * node_aiready_store). We use host.store (not host.db) because manifest rows are
 * edited constantly and the lite host.db is an append/replace-only JSON shim with
 * no UPDATE / ON CONFLICT.
 *
 * Collections:
 *   manifest    — key = article id   → the per-article record (see manifest.js)
 *   embeddings  — key = article id   → { model, dims, chunks:[{i,vec,text}], updated_at }
 *   config      — key = 'site_settings' | 'bulk_rules' | 'ingest_jobs'
 *
 * (Read-modify-write pattern lifted from node-analytics/lib/store.js patchExtra.)
 */

const MANIFEST = 'manifest';
const EMBEDDINGS = 'embeddings';
const CONFIG = 'config';

// ── Manifest ─────────────────────────────────────────────────────────
export async function listArticles(host) {
  const items = await host.store.list(MANIFEST).catch(() => []);
  return items.map((i) => i.value).filter(Boolean);
}
export async function getArticle(host, id) {
  return (await host.store.get(MANIFEST, id).catch(() => null)) || null;
}
export async function putArticle(host, article) {
  article.updated_at = new Date().toISOString();
  await host.store.put(MANIFEST, article.id, article);
  return article;
}
/** Merge a patch into one article (read-modify-write). Returns the merged row. */
export async function patchArticle(host, id, patch) {
  const cur = await getArticle(host, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  if (patch.state) next.state = { ...cur.state, ...patch.state };
  return await putArticle(host, next);
}
export async function deleteArticle(host, id) {
  await host.store.delete(MANIFEST, id).catch(() => {});
  await host.store.delete(EMBEDDINGS, id).catch(() => {});
}
/** Insert if new; if the id already exists, keep the existing row (idempotent ingest). */
export async function upsertArticle(host, article) {
  const existing = await getArticle(host, article.id);
  if (existing) return { article: existing, created: false };
  await putArticle(host, article);
  return { article, created: true };
}

// ── Embeddings ───────────────────────────────────────────────────────
export async function getEmbedding(host, id) {
  return (await host.store.get(EMBEDDINGS, id).catch(() => null)) || null;
}
export async function putEmbedding(host, id, value) {
  await host.store.put(EMBEDDINGS, id, value);
}
export async function listEmbeddings(host) {
  const items = await host.store.list(EMBEDDINGS).catch(() => []);
  return items.map((i) => ({ id: i.key, ...i.value })).filter((e) => e && e.chunks);
}

// ── Config (site settings, bulk rules, ingest jobs) ──────────────────
export async function getConfig(host, key, fallback = null) {
  const v = await host.store.get(CONFIG, key).catch(() => null);
  return v == null ? fallback : v;
}
export async function setConfig(host, key, value) {
  await host.store.put(CONFIG, key, value);
  return value;
}
