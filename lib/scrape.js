/**
 * lib/scrape.js — best-effort fetch of an article URL.
 *
 * Server-side (the browser can't cross-origin fetch arbitrary publisher sites).
 * AbortController timeout, redirect follow, friendly UA, content-type guard, a
 * light readability pass (prefer <article>/<main>). Returns the trimmed HTML so
 * convert.js can turn it into STRUCTURED markdown (turndown), plus an extracted
 * title and a plain-text fallback. NEVER throws — blocked/empty pages degrade to
 * { status:'blocked'|'empty' } so the caller records and moves on.
 *
 * Adapted from node-analytics/lib/scrape.js (which only returned text).
 */

export async function fetchArticle(url, { timeoutMs = 10000, maxChars = 200000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return { status: 'bad_url', html: null, text: null, title: null, finalUrl: url };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIReadyArchive/1.0; +https://grounded.developai.co.za)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { status: res.status === 401 || res.status === 403 ? 'blocked' : `error_${res.status}`, html: null, text: null, title: null, finalUrl: res.url || url };
    const ctype = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype)) return { status: 'not_text', html: null, text: null, title: null, finalUrl: res.url || url };
    const raw = (await res.text()).slice(0, maxChars);
    const meta = extractMeta(raw);
    const html = readability(raw);
    const text = htmlToText(html);
    return { status: text ? 'ok' : 'empty', html: html || null, text: text || null, title: meta.title, meta, finalUrl: res.url || url };
  } catch {
    return { status: 'error', html: null, text: null, title: null, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip scripts/styles/comments and, if present, keep just <article>/<main>. */
export function readability(html) {
  let h = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const article = h.match(/<article[\s\S]*?<\/article>/i);
  const main = h.match(/<main[\s\S]*?<\/main>/i);
  if (article && article[0].length > 400) return article[0];
  if (main && main[0].length > 400) return main[0];
  // No semantic container — drop the obvious chrome and keep the body.
  const body = h.match(/<body[\s\S]*?<\/body>/i);
  return (body ? body[0] : h)
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
}

function extractTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) { const t = decodeEntities(h1[1].replace(/<[^>]+>/g, '')).trim(); if (t) return t; }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return decodeEntities(title[1].replace(/<[^>]+>/g, '')).trim();
  return null;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;/gi, "'");
}

/**
 * Pull title / author / published date / section / description from the page's
 * own metadata, in priority order: JSON-LD (richest) → OpenGraph/article meta →
 * <title>/<h1>. This is what makes bulk rules (by category/date/author) and the
 * JSON-LD output actually useful, instead of every field being null.
 */
export function extractMeta(html) {
  const out = { title: null, author: null, published_at: null, category: null, description: null };
  const ld = parseJsonLdArticle(html);
  if (ld) {
    out.title = clean(ld.headline) || out.title;
    out.published_at = isoDate(ld.datePublished || ld.dateCreated || ld.dateModified) || out.published_at;
    out.author = authorName(ld.author) || out.author;
    out.category = firstStr(ld.articleSection) || out.category;
    out.description = clean(ld.description) || out.description;
  }
  out.title = out.title || metaContent(html, ['og:title']);
  out.published_at = out.published_at || isoDate(metaContent(html, ['article:published_time', 'article:published', 'datePublished', 'publishdate', 'date']));
  out.category = out.category || metaContent(html, ['article:section', 'section']);
  out.description = out.description || metaContent(html, ['og:description', 'description', 'twitter:description']);
  if (!out.author) {
    const a = metaContent(html, ['article:author', 'author', 'twitter:creator', 'parsely-author']);
    if (a && !/^https?:\/\//i.test(a) && !a.startsWith('@')) out.author = a;   // skip URLs / handles
  }
  out.title = out.title || extractTitle(html);
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].trim() || null;
  return out;
}

function parseJsonLdArticle(html) {
  const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data; try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const arr = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
    const TYPES = ['NewsArticle', 'Article', 'BlogPosting', 'Report', 'ReportageNewsArticle', 'LiveBlogPosting'];
    for (const node of arr) {
      if (!node || typeof node !== 'object') continue;
      const tlist = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (tlist.some((x) => TYPES.includes(x))) return node;
    }
  }
  return null;
}
function authorName(a) {
  if (!a) return null;
  if (typeof a === 'string') return clean(a);
  if (Array.isArray(a)) return a.map(authorName).filter(Boolean).join(', ') || null;
  if (typeof a === 'object') return clean(a.name) || null;
  return null;
}
function firstStr(v) { return Array.isArray(v) ? (v.find((x) => typeof x === 'string') || null) : (typeof v === 'string' ? v : null); }
function metaContent(html, props) {
  for (const p of props) {
    const tag = String(html).match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escapeRe(p)}["'][^>]*>`, 'i'));
    if (tag) { const c = tag[0].match(/content=["']([^"']*)["']/i); if (c && c[1].trim()) return decodeEntities(c[1]).trim(); }
  }
  return null;
}
function isoDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
function clean(s) { return s ? decodeEntities(String(s)).replace(/\s+/g, ' ').trim() : null; }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}
