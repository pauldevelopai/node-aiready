/**
 * lib/ingest.js — get articles INTO the manifest from live URLs.
 *
 * Two entry points: a pasted list of article URLs, and a sitemap.xml crawl
 * (expands <loc> entries, follows one level of sitemap-index nesting). Each URL is
 * fetched (scrape.js) and converted to markdown (convert.js) in one pass — we have
 * the HTML in hand, and re-fetching later would just re-hit the publisher. Rows are
 * upserted idempotently by article id; an already-ingested URL is skipped unless
 * `force`. A bounded worker pool keeps egress polite. Drive ingestion lives in
 * lib/drive.js (it needs the binary converters first).
 */

import { fetchArticle } from './scrape.js';
import { htmlToMarkdown } from './convert.js';
import { makeArticle, canonicalUrl, slugify } from './manifest.js';
import { getArticle, putArticle, upsertArticle } from './store.js';

const MAX_URLS = 2000;        // safety cap per ingest call
const CONCURRENCY = 4;        // polite parallel fetches

/** Ingest a list of article URLs. Returns { added, updated, skipped, failed, errors }. */
export async function ingestUrls(host, urls, { force = false, sourceKind = 'url', onProgress } = {}) {
  const clean = dedupe((urls || []).map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u)))
    .slice(0, MAX_URLS);
  const stats = { total: clean.length, added: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  await pool(clean, CONCURRENCY, async (url) => {
    try {
      const article = makeArticle({ source_kind: sourceKind, source_ref: url, url: canonicalUrl(url) });
      const { article: row, created } = await upsertArticle(host, article);
      if (!created && !force && row.state?.converted) { stats.skipped++; return; }

      const res = await fetchArticle(url);
      if (res.status !== 'ok' || !res.html) {
        await putArticle(host, { ...row, state: { ...row.state, fetched: new Date().toISOString() } });
        stats.failed++; stats.errors.push({ url, status: res.status });
        return;
      }
      const markdown = htmlToMarkdown(res.html);
      const now = new Date().toISOString();
      await putArticle(host, {
        ...row,
        url: canonicalUrl(res.finalUrl || url),
        title: row.title || res.title || null,
        slug: row.title ? row.slug : slugify(res.title || url, row.slug),
        source_format: 'html',
        clean_markdown: markdown || null,
        state: { ...row.state, fetched: now, converted: markdown ? now : null },
      });
      created ? stats.added++ : stats.updated++;
    } catch (e) {
      stats.failed++; stats.errors.push({ url, status: e.message });
    }
    if (onProgress) onProgress(stats);
  });

  await host.log?.run?.({ op: 'ingest_urls', total: stats.total, added: stats.added, failed: stats.failed }).catch(() => {});
  return stats;
}

/** Fetch a sitemap (or sitemap index), expand to article URLs, then ingestUrls. */
export async function ingestSitemap(host, sitemapUrl, { limit = MAX_URLS, force = false } = {}) {
  if (!/^https?:\/\//i.test(sitemapUrl || '')) return { error: 'Enter a full sitemap URL (https://…/sitemap.xml).' };
  const urls = await expandSitemap(sitemapUrl, limit);
  if (!urls.length) return { error: "Couldn't read any URLs from that sitemap. Check the URL is a sitemap.xml.", total: 0 };
  const stats = await ingestUrls(host, urls, { force, sourceKind: 'sitemap' });
  return { ...stats, sitemap: sitemapUrl };
}

/** Read a sitemap; if it's a sitemap index, follow one level of nested sitemaps. */
async function expandSitemap(url, limit, depth = 0) {
  const xml = await fetchText(url);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  if (isIndex && depth < 1) {
    const out = [];
    for (const child of locs.slice(0, 50)) {
      if (out.length >= limit) break;
      out.push(...(await expandSitemap(child, limit - out.length, depth + 1)));
    }
    return dedupe(out).slice(0, limit);
  }
  return dedupe(locs.filter((u) => /^https?:\/\//i.test(u))).slice(0, limit);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIReadyArchive/1.0; +https://grounded.developai.co.za)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(timer); }
}

function decodeXml(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}
function dedupe(arr) { return [...new Set(arr)]; }

/** Run `worker` over items with bounded concurrency. */
async function pool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

export { pool };
