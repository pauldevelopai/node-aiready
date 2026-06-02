/**
 * lib/context.js — the shared cross-node newsroom profile (host.profile).
 *
 * We READ it to ground AI calls (JSON-LD descriptions, summaries) in the
 * newsroom's real identity — location, audience, what they cover — and to fill
 * the publisher fields of schema.org NewsArticle. We don't own this data; every
 * GROUNDED Node reads/writes the same object (runtime ≥ v0.14.0), seeded from the
 * tracker Newsroom Profile.
 *
 * (formatContextForPrompt copied from node-analytics/lib/context.js.)
 */

export async function getProfile(host) {
  if (host?.profile?.get) {
    const p = await host.profile.get().catch(() => null);
    if (p && Object.keys(p).length) return p;
  }
  return null;
}

/** One block for AI prompts — grounds output in the newsroom's real context. */
export function formatContextForPrompt(c) {
  if (!c) return '';
  const where = [c.city, c.region, c.country].filter(Boolean).join(', ');
  const parts = [];
  if (c.name) parts.push(`Newsroom: ${c.name}`);
  if (where) parts.push(`Location: ${where}`);
  if (c.languages) parts.push(`Languages: ${c.languages}`);
  if (c.audience) parts.push(`Audience: ${c.audience}`);
  if (c.about) parts.push(`About: ${c.about}`);
  if (c.beats_note) parts.push(`Beats/focus: ${c.beats_note}`);
  return parts.join('\n');
}

/** Publisher fields for schema.org, derived from the profile (best-effort). */
export function publisherFromProfile(c) {
  if (!c) return null;
  const name = c.name || c.publisher || c.newsroom || null;
  if (!name) return null;
  return { '@type': 'Organization', name, ...(c.site_url ? { url: c.site_url } : {}) };
}
