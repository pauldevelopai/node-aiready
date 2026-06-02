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
    const title = extractTitle(raw);
    const html = readability(raw);
    const text = htmlToText(html);
    return { status: text ? 'ok' : 'empty', html: html || null, text: text || null, title, finalUrl: res.url || url };
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

export function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}
