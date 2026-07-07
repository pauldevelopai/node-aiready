// Custom app routes — the AI Ready Archive surface. Mounted on the express app the
// runtime returns, alongside the standard /api/* handlers.
//
//   Local  (index.js):         mountAppRoutes(app, () => host)
//   Hosted (server-hosted.js): mountAppRoutes(app, hostFor)   // per-request host
//
// getHost(req) returns the host for THIS request — a fixed lite host locally, or a
// per-request, newsroom-scoped Postgres host online. ALWAYS go through the host
// interface; the same code runs both ways. All data lives in host.store (manifest +
// config + embeddings). Everything under /api/aiready/* sits behind the hosted JWT
// guard and the no-cache app-shell middleware.

import multer from 'multer';
import { ingestUrls, ingestSitemap } from './ingest.js';
import { ingestDriveFolder, driveAvailable } from './drive.js';
import { ingestFiles } from './upload.js';
import { listArticles, getConfig, setConfig, patchArticle, deleteArticle } from './store.js';
import { applyRulesAll, countMatches } from './rules.js';
import { isPublishable, isSearchable, SENSITIVITY, INCLUSION, L2_TOGGLES, STEPS } from './manifest.js';
import { RULE_TARGET_FIELDS } from './rules.js';
import { embedAll, embeddingsAvailable } from './embed.js';
import { search } from './search.js';
import { askArchive } from './rag.js';
import { generateAll, buildNewsArticle, jsonLdScript } from './jsonld.js';
import { buildBundle, defaultSiteSettings, CRAWLERS } from './bundle.js';
import { getProfile } from './context.js';

const EDITABLE = new Set([...RULE_TARGET_FIELDS, 'sensitivity_flag', 'title', 'author', 'category', 'published_at', 'notes', 'slug']);

export function mountAppRoutes(app, getHost) {
  // MUST-HAVE: keep the chrome-injected app shell uncached (harmless if also set by
  // server-hosted.js). Without it, browsers cache index.html and UI updates don't show.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) res.set('Cache-Control', 'no-cache');
    next();
  });

  // Uploaded documents are held in memory (never written to disk) and converted
  // straight from the buffer — same as a Drive download. Folder-sized (many files),
  // capped per-file so a stray huge file can't exhaust the box's RAM.
  const MAX_UPLOAD_MB = Number(process.env.AIREADY_MAX_UPLOAD_MB) || 50;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2000 } });
  // Multer aborts the WHOLE request if any one file is over the cap; catch that and
  // answer with clean JSON, or the browser hangs forever on "converting…".
  const uploadFiles = (req, res, next) => upload.array('files')(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `One file is larger than the ${MAX_UPLOAD_MB} MB limit. Remove it (or add it on its own) and try the rest again.`
      : (err.message || 'Upload failed.');
    res.status(200).json({ ok: false, message: msg });
  });

  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('aiready route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'route error' });
      try { await host?.log?.error?.({ op: req.path, error: err, context: { method: req.method } }); } catch { /* swallow */ }
    }
  };

  // Shared cross-node newsroom profile (read-only here; written via the tracker).
  app.get('/api/profile', wrap(async (_req, host) => ({ ok: true, profile: await getProfile(host) })));

  // ── Overview / capabilities (drives the dashboard + UI affordances) ──
  app.get('/api/aiready/status', wrap(async (_req, host) => {
    const rules = await getConfig(host, 'bulk_rules', []);
    const articles = applyRulesAll(await listArticles(host), rules);
    const count = (p) => articles.filter(p).length;
    return {
      ok: true,
      capabilities: { drive: driveAvailable(), embeddings: embeddingsAvailable() },
      counts: {
        total: articles.length,
        converted: count((a) => a.state?.converted),
        publishable: count(isPublishable),
        local_only: count((a) => a.inclusion === 'local_only'),
        excluded: count((a) => a.inclusion === 'exclude'),
        sensitive: count((a) => a.sensitivity_flag && a.sensitivity_flag !== 'none'),
        in_llms_txt: count((a) => isPublishable(a) && a.in_llms_txt),
        embedded: count((a) => a.state?.embedded),
        searchable: count(isSearchable),
      },
    };
  }));

  // ── Ingestion ──
  app.post('/api/aiready/ingest/urls', wrap(async (req, host) => {
    const urls = parseUrls(req.body?.urls);
    if (!urls.length) return { ok: false, message: 'Paste one or more article URLs (one per line).' };
    return { ok: true, ...(await ingestUrls(host, urls, { force: !!req.body?.force })) };
  }));
  app.post('/api/aiready/ingest/sitemap', wrap(async (req, host) => {
    const r = await ingestSitemap(host, String(req.body?.sitemap || '').trim(), { force: !!req.body?.force });
    return r.error ? { ok: false, message: r.error } : { ok: true, ...r };
  }));
  app.post('/api/aiready/ingest/drive', wrap(async (req, host) => {
    const r = await ingestDriveFolder(host, String(req.body?.folder || '').trim(), { force: !!req.body?.force });
    return r.error ? { ok: false, message: r.message, reason: r.error } : { ok: true, ...r };
  }));
  // A folder / files uploaded from the user's computer (multipart, field "files").
  app.post('/api/aiready/ingest/upload', uploadFiles, wrap(async (req, host) => {
    const files = req.files || [];
    if (!files.length) return { ok: false, message: 'Choose a folder or some files to add first.' };
    return { ok: true, ...(await ingestFiles(host, files, { force: !!(req.body && req.body.force) })) };
  }));

  // ── Re-convert rows that were fetched but produced no markdown (retry) ──
  app.post('/api/aiready/convert', wrap(async (host_req, host) => {
    const articles = await listArticles(host);
    const urls = articles.filter((a) => ['url', 'sitemap'].includes(a.source_kind) && a.url && !a.state?.converted).map((a) => a.url);
    if (!urls.length) return { ok: true, message: 'Nothing to re-convert.', total: 0 };
    return { ok: true, ...(await ingestUrls(host, urls, { force: true })) };
  }));

  // ── Manifest ──
  app.get('/api/aiready/manifest', wrap(async (_req, host) => {
    const rules = await getConfig(host, 'bulk_rules', []);
    const stored = await listArticles(host);
    const effective = applyRulesAll(stored, rules);
    // Return both stored (manual baseline) and effective (after rules) for the editor.
    return {
      ok: true,
      fields: { sensitivity: SENSITIVITY, inclusion: INCLUSION, toggles: L2_TOGGLES, steps: STEPS },
      articles: stored.map((a, i) => ({ ...a, _effective: pickEffective(effective[i]) })),
    };
  }));

  app.put('/api/aiready/manifest/:id', wrap(async (req, host) => {
    const patch = {};
    const manualTouched = [];
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!EDITABLE.has(k)) continue;
      patch[k] = v;
      if (RULE_TARGET_FIELDS.includes(k)) manualTouched.push(k);
    }
    if (!Object.keys(patch).length) return { ok: false, message: 'Nothing to update.' };
    const cur = (await listArticles(host)).find((a) => a.id === req.params.id);
    if (!cur) return { ok: false, message: 'Unknown article.' };
    if (manualTouched.length) patch.manual_overrides = [...new Set([...(cur.manual_overrides || []), ...manualTouched])];
    const updated = await patchArticle(host, req.params.id, patch);
    return { ok: true, article: updated };
  }));

  app.delete('/api/aiready/manifest/:id', wrap(async (req, host) => {
    await deleteArticle(host, req.params.id);
    return { ok: true };
  }));

  // ── Control layers: bulk rules + crawler / site settings ──
  app.get('/api/aiready/rules', wrap(async (_req, host) => ({ ok: true, rules: await getConfig(host, 'bulk_rules', []) })));
  app.put('/api/aiready/rules', wrap(async (req, host) => {
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
    await setConfig(host, 'bulk_rules', rules);
    // Preview impact of each rule against the current manifest.
    const articles = await listArticles(host);
    return { ok: true, rules, impact: rules.map((r) => ({ id: r.id, matches: countMatches(articles, r.when) })) };
  }));
  app.post('/api/aiready/rules/preview', wrap(async (req, host) => {
    const articles = await listArticles(host);
    return { ok: true, matches: countMatches(articles, req.body?.when) };
  }));

  app.get('/api/aiready/site-settings', wrap(async (_req, host) => {
    const profile = await getProfile(host);
    const saved = await getConfig(host, 'site_settings', null);
    return { ok: true, crawlers: CRAWLERS, settings: { ...defaultSiteSettings(profile), ...(saved || {}) } };
  }));
  app.put('/api/aiready/site-settings', wrap(async (req, host) => {
    const s = req.body?.settings || {};
    const profile = await getProfile(host);
    const next = { ...defaultSiteSettings(profile), ...s };
    await setConfig(host, 'site_settings', next);
    return { ok: true, settings: next };
  }));

  // ── Embeddings + search (Layer 3) ──
  app.post('/api/aiready/embed', wrap(async (req, host) => {
    const r = await embedAll(host, { force: !!req.body?.force });
    return r.error ? { ok: false, message: r.message, reason: r.error } : { ok: true, ...r };
  }));
  app.get('/api/aiready/search', wrap(async (req, host) => search(host, req.query?.q, { limit: Math.min(50, Number(req.query?.limit) || 20) })));

  // Ask the archive (RAG): retrieve top matches, Claude answers from them with citations.
  app.post('/api/aiready/ask', wrap(async (req, host) => askArchive(host, req.body?.q || req.body?.question)));

  // ── AI JSON-LD + summaries (grounded in host.profile) ──
  app.post('/api/aiready/generate', wrap(async (req, host) => ({ ok: true, ...(await generateAll(host, { force: !!req.body?.force })) })));
  app.get('/api/aiready/jsonld/:id', wrap(async (req, host) => {
    const a = (await listArticles(host)).find((x) => x.id === req.params.id);
    if (!a) return { ok: false, message: 'Unknown article.' };
    const obj = a.json_ld || buildNewsArticle(a, await getProfile(host));
    return { ok: true, json_ld: obj, script: jsonLdScript(obj) };
  }));

  // ── Export bundle (BINARY — outside wrap, streams the zip) ──
  app.get('/api/aiready/bundle', async (req, res) => {
    let host;
    try {
      host = getHost(req);
      const { buffer, filename } = await buildBundle(host);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      console.error('bundle error:', err);
      res.status(500).json({ ok: false, error: err.message || 'bundle error' });
      try { await host?.log?.error?.({ op: '/api/aiready/bundle', error: err }); } catch { /* swallow */ }
    }
  });
  // JSON preview of what the bundle will contain (for the Export tab, before download).
  app.get('/api/aiready/bundle/preview', wrap(async (_req, host) => {
    const rules = await getConfig(host, 'bulk_rules', []);
    const pub = applyRulesAll(await listArticles(host), rules).filter(isPublishable);
    return {
      ok: true,
      counts: {
        mirror: pub.filter((a) => a.out_mirror_md && a.clean_markdown).length,
        jsonld: pub.filter((a) => a.out_json_ld).length,
        in_llms_txt: pub.filter((a) => a.in_llms_txt).length,
        in_llms_full: pub.filter((a) => a.in_llms_full && a.clean_markdown).length,
      },
      publishable: pub.length,
    };
  }));
}

function parseUrls(input) {
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}
function pickEffective(a) {
  const out = { inclusion: a.inclusion };
  for (const k of L2_TOGGLES) out[k] = a[k];
  return out;
}
