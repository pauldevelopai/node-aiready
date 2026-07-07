/**
 * lib/manifest.js — the manifest record: one row per article, with the editorial
 * control toggles. THE MANIFEST IS THE PRODUCT. Conversion just fills the body in.
 *
 * Stored in host.store (collection 'manifest', key = article id) because the row
 * is edited constantly and the lite host.db has no UPDATE / ON CONFLICT. See
 * lib/store.js for the read-modify-write helpers.
 *
 * Control layers (from the concept note):
 *   L1 source-filter   → `inclusion`: include | exclude | local_only
 *   L2 publication      → the five out_* / in_* toggles
 *   L3 local search     → handled by embed/search; `withdrawn` is excluded there
 *   L4 crawler policy   → site-level (config/site_settings), not per-article
 *
 * `sensitivity_flag` is a HARD override: anything other than 'none' forces the
 * article out of every PUBLIC artefact regardless of the L2 toggles. isPublishable()
 * is the single gate every output path must call — no exceptions.
 */

import crypto from 'node:crypto';

export const SENSITIVITY = ['none', 'source-protected', 'legal-hold', 'embargoed', 'withdrawn'];
export const INCLUSION = ['include', 'exclude', 'local_only'];

// The L2 publication toggles, in display order.
export const L2_TOGGLES = ['out_clean_markdown', 'out_json_ld', 'out_mirror_md', 'in_llms_txt', 'in_llms_full'];

// Pipeline steps tracked in `state` (timestamp when done, null when not) — for
// idempotency + resumability. Re-running a step skips rows already done.
export const STEPS = ['fetched', 'converted', 'summarized', 'jsonld', 'embedded'];

/** Stable id: canonical URL for url/sitemap sources, '<kind>:'+ref for Drive/upload. */
export function articleId({ source_kind, source_ref }) {
  const basis = (source_kind === 'drive' || source_kind === 'upload') ? `${source_kind}:${source_ref}` : canonicalUrl(source_ref);
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Drop common tracking params; keep the rest (path identity matters).
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(p)) u.searchParams.delete(p);
    }
    let s = u.toString();
    return s.replace(/\/$/, '');
  } catch { return String(url || '').trim(); }
}

export function slugify(s, fallback = 'article') {
  const base = String(s || '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return base || fallback;
}

/** A fresh manifest row. Defaults: included, nothing published yet (opt-in). */
export function makeArticle({ source_kind, source_ref, url = null, title = null }) {
  const now = new Date().toISOString();
  return {
    id: articleId({ source_kind, source_ref }),
    source_kind,                 // 'url' | 'sitemap' | 'drive' | 'upload'
    source_ref,                  // the URL, the Drive fileId, or an upload content hash
    source_format: null,         // 'html' | 'pdf' | 'docx' | 'doc' | 'gdoc' | 'text'
    url,                         // canonical public URL (null for Drive / upload)
    slug: slugify(title || url || source_ref, 'article'),
    title: title || null,
    author: null,
    category: null,
    published_at: null,
    // L1
    inclusion: 'include',
    // L2 — opt-in: editor turns on what they want exposed
    out_clean_markdown: false,
    out_json_ld: false,
    out_mirror_md: false,
    in_llms_txt: false,
    in_llms_full: false,
    // sensitivity
    sensitivity_flag: 'none',
    // payloads
    clean_markdown: null,
    json_ld: null,
    summary: null,
    // processing state (timestamps)
    state: Object.fromEntries(STEPS.map((s) => [s, null])),
    // which toggle keys the editor set by hand — these win over bulk rules
    manual_overrides: [],
    notes: '',
    created_at: now,
    updated_at: now,
  };
}

/**
 * THE SINGLE PUBLIC-OUTPUT GATE. An article may appear in public artefacts
 * (mirror .md, llms.txt, llms-full.txt, JSON-LD) only if it's included and not
 * sensitive. Call this everywhere output is produced (lib/bundle.js, lib/jsonld.js).
 */
export function isPublishable(a) {
  if (!a) return false;
  if (a.inclusion !== 'include') return false;          // exclude / local_only are never public
  if (a.sensitivity_flag && a.sensitivity_flag !== 'none') return false; // hard override
  return true;
}

/** Local-only internal search corpus: everything except hard-withdrawn. */
export function isSearchable(a) {
  if (!a) return false;
  if (a.inclusion === 'exclude') return false;
  if (a.sensitivity_flag === 'withdrawn') return false;
  return !!a.clean_markdown;
}
