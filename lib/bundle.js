/**
 * lib/bundle.js — assemble the deploy-ready bundle the newsroom drops onto its OWN
 * site (they don't host on our box). Built entirely in memory with jszip, so it
 * works identically local and hosted (hosted can't write to disk).
 *
 * Layout:
 *   /README.md            where each file goes on your site
 *   /llms.txt             llmstxt.org index (only in_llms_txt articles)
 *   /llms-full.txt        concatenated bodies (only in_llms_full articles)
 *   /robots.txt           per-AI-crawler allow/deny (site-level)
 *   /mirror/<slug>.md     public markdown mirror, one per out_mirror_md article
 *   /jsonld/<slug>.json   schema.org NewsArticle, one per out_json_ld article
 *
 * EVERY public artefact passes through isPublishable() — exclude / local_only /
 * any sensitivity flag never leak into the bundle.
 */

import JSZip from 'jszip';
import { listArticles, getConfig } from './store.js';
import { applyRulesAll } from './rules.js';
import { isPublishable } from './manifest.js';
import { buildNewsArticle } from './jsonld.js';
import { getProfile } from './context.js';

export const CRAWLERS = ['ClaudeBot', 'GPTBot', 'PerplexityBot', 'CCBot', 'Google-Extended'];

export function defaultSiteSettings(profile) {
  return {
    newsroom_name: profile?.name || profile?.newsroom || 'Our newsroom',
    site_url: profile?.site_url || '',
    llms_summary: profile?.about || '',
    mirror_base: '/',                 // where /mirror/<slug>.md will live on their site
    crawlers: Object.fromEntries([...CRAWLERS, '*'].map((c) => [c, 'allow'])),
  };
}

/** Build the zip. Returns { buffer, filename, stats }. */
export async function buildBundle(host) {
  const profile = await getProfile(host);
  const settings = { ...defaultSiteSettings(profile), ...(await getConfig(host, 'site_settings', {})) };
  const rules = await getConfig(host, 'bulk_rules', []);
  const effective = applyRulesAll(await listArticles(host), rules);
  const pub = effective.filter(isPublishable);

  // Stable, collision-free slugs within the bundle.
  const used = new Set();
  for (const a of pub) {
    let s = a.slug || 'article'; let i = 2;
    while (used.has(s)) s = `${a.slug || 'article'}-${i++}`;
    used.add(s); a._slug = s;
  }

  const zip = new JSZip();
  const stats = { mirror: 0, jsonld: 0, llms_txt: 0, llms_full: 0 };

  for (const a of pub) {
    if (a.out_mirror_md && a.clean_markdown) {
      zip.file(`mirror/${a._slug}.md`, mirrorFile(a));
      stats.mirror++;
    }
    if (a.out_json_ld) {
      const obj = a.json_ld || buildNewsArticle(a, profile);
      zip.file(`jsonld/${a._slug}.json`, JSON.stringify(obj, null, 2));
      stats.jsonld++;
    }
  }

  const llmsList = pub.filter((a) => a.in_llms_txt);
  const llmsFull = pub.filter((a) => a.in_llms_full && a.clean_markdown);
  stats.llms_txt = llmsList.length;
  stats.llms_full = llmsFull.length;

  zip.file('llms.txt', buildLlmsTxt(settings, llmsList));
  zip.file('llms-full.txt', buildLlmsFull(settings, llmsFull));
  zip.file('robots.txt', buildRobots(settings));
  zip.file('README.md', buildReadme(settings, stats));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await host.log?.run?.({ op: 'bundle', ...stats }).catch(() => {});
  return { buffer, filename: 'ai-ready-bundle.zip', stats };
}

function mirrorFile(a) {
  const fm = ['---', `title: ${yaml(a.title || a._slug)}`];
  if (a.url) fm.push(`source_url: ${yaml(a.url)}`);
  if (a.author) fm.push(`author: ${yaml(a.author)}`);
  if (a.published_at) fm.push(`date: ${yaml(a.published_at)}`);
  if (a.category) fm.push(`section: ${yaml(a.category)}`);
  fm.push('---', '');
  // Avoid a double H1: if the body already opens with one, don't add our own.
  const body = String(a.clean_markdown || '');
  const hasLeadingH1 = /^\s*#\s+\S/.test(body);
  const heading = hasLeadingH1 ? '' : `# ${a.title || a._slug}\n\n`;
  return fm.join('\n') + heading + body + '\n';
}

function buildLlmsTxt(settings, list) {
  const out = [`# ${settings.newsroom_name}`, ''];
  if (settings.llms_summary) out.push(`> ${oneLine(settings.llms_summary)}`, '');
  // Group by category (or "Articles").
  const groups = new Map();
  for (const a of list) {
    const g = a.category || 'Articles';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  for (const [g, items] of groups) {
    out.push(`## ${g}`, '');
    for (const a of items) {
      const link = a.url || `${settings.mirror_base.replace(/\/$/, '')}/mirror/${a._slug}.md`;
      out.push(`- [${a.title || a._slug}](${link})${a.summary ? `: ${oneLine(a.summary)}` : ''}`);
    }
    out.push('');
  }
  return out.join('\n').trim() + '\n';
}

function buildLlmsFull(settings, list) {
  const out = [`# ${settings.newsroom_name} — full text`, ''];
  if (settings.llms_summary) out.push(`> ${oneLine(settings.llms_summary)}`, '');
  for (const a of list) {
    out.push('---', '', `# ${a.title || a._slug}`);
    if (a.url) out.push(`Source: ${a.url}`);
    if (a.published_at) out.push(`Published: ${a.published_at}`);
    out.push('', a.clean_markdown, '');
  }
  return out.join('\n').trim() + '\n';
}

function buildRobots(settings) {
  const lines = ['# AI crawler policy — generated by AI Ready Archive', ''];
  for (const bot of CRAWLERS) {
    const allow = (settings.crawlers?.[bot] || 'allow') === 'allow';
    lines.push(`User-agent: ${bot}`, allow ? 'Allow: /' : 'Disallow: /', '');
  }
  const starAllow = (settings.crawlers?.['*'] || 'allow') === 'allow';
  lines.push('User-agent: *', starAllow ? 'Allow: /' : 'Disallow: /', '');
  return lines.join('\n');
}

function buildReadme(settings, stats) {
  return `# AI Ready Archive — your deploy bundle

Generated for **${settings.newsroom_name}**. Everything here is yours to put on your
own website. Nothing in this bundle is hosted by Grounded.

## Where each file goes

| File | Put it | What it does |
|---|---|---|
| \`llms.txt\` | Your site **root** (\`/llms.txt\`) | An index of the articles you chose to surface, for AI assistants. |
| \`llms-full.txt\` | Your site **root** (\`/llms-full.txt\`) | The full text you chose to make ingestible. |
| \`robots.txt\` | Your site **root** (merge with any existing \`robots.txt\`) | Tells each AI crawler what it may read. |
| \`mirror/<slug>.md\` (${stats.mirror}) | Serve at a public path, e.g. \`/mirror/<slug>.md\` | Clean markdown mirrors of articles. Match the path to \`mirror_base\` in your settings. |
| \`jsonld/<slug>.json\` (${stats.jsonld}) | Inject into each article's HTML \`<head>\` | schema.org NewsArticle markup. Wrap in \`<script type="application/ld+json">…</script>\`. |

## What's included
- ${stats.llms_txt} article(s) listed in \`llms.txt\`
- ${stats.llms_full} article(s) concatenated into \`llms-full.txt\`
- ${stats.mirror} markdown mirror(s), ${stats.jsonld} JSON-LD file(s)

Articles you marked **exclude**, **local-only**, or with any **sensitivity flag**
(source-protected, legal-hold, embargoed, withdrawn) are NOT in this bundle.

Re-export any time you change the manifest.
`;
}

function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function yaml(s) { const v = String(s ?? ''); return /[:#]/.test(v) ? JSON.stringify(v) : v; }
