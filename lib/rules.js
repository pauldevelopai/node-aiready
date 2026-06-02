/**
 * lib/rules.js — bulk control rules (Layer 1 + Layer 2 at scale). No editor ticks
 * a thousand boxes: a rule says "all Investigations → exclude", "news in the last
 * 30 days → publish everything", "op-eds older than 2 years → local_only", and the
 * editor only adjusts exceptions.
 *
 * applyRules() is a PURE function: it computes each article's EFFECTIVE toggles by
 * layering matching rules over the stored row, but NEVER overwrites the row — so
 * turning a rule off restores the prior state. A field the editor set by hand
 * (listed in `manual_overrides`) always wins over any rule. Output (bundle, jsonld)
 * and the manifest preview both read through this, so the manifest stays the truth.
 *
 * Rule shape: { id, label?, when: Condition | { all: Condition[] }, then: {patch} }
 * Condition:  { field, op, value }
 *   ops: eq | neq | contains | within_days | older_than_days | before | after | is_empty
 *   fields: category | author | title | source_kind | source_format | published_at | inclusion
 */

const RULE_FIELDS = ['inclusion', 'out_clean_markdown', 'out_json_ld', 'out_mirror_md', 'in_llms_txt', 'in_llms_full'];

export function applyRules(article, rules) {
  const eff = { ...article };
  const manual = new Set(article.manual_overrides || []);
  for (const rule of rules || []) {
    if (!matches(article, rule.when)) continue;
    for (const [k, v] of Object.entries(rule.then || {})) {
      if (!RULE_FIELDS.includes(k)) continue;
      if (manual.has(k)) continue;            // manual edit wins
      eff[k] = v;
    }
  }
  return eff;
}

/** Effective rows for the whole manifest (used by output + preview). */
export function applyRulesAll(articles, rules) {
  return articles.map((a) => applyRules(a, rules));
}

/** How many articles a single rule's `when` matches (for the rule-builder preview). */
export function countMatches(articles, when) {
  return articles.filter((a) => matches(a, when)).length;
}

function matches(article, when) {
  if (!when) return false;
  if (Array.isArray(when.all)) return when.all.every((c) => matchOne(article, c));
  if (Array.isArray(when.any)) return when.any.some((c) => matchOne(article, c));
  return matchOne(article, when);
}

function matchOne(a, c) {
  if (!c || !c.field) return false;
  const raw = a[c.field];
  const val = c.value;
  switch (c.op) {
    case 'eq': return norm(raw) === norm(val);
    case 'neq': return norm(raw) !== norm(val);
    case 'contains': return norm(raw).includes(norm(val));
    case 'is_empty': return raw == null || raw === '';
    case 'within_days': return ageDays(raw) != null && ageDays(raw) <= Number(val);
    case 'older_than_days': return ageDays(raw) != null && ageDays(raw) > Number(val);
    case 'before': return dateOf(raw) != null && dateOf(raw) < dateOf(val);
    case 'after': return dateOf(raw) != null && dateOf(raw) > dateOf(val);
    default: return false;
  }
}

function norm(v) { return String(v ?? '').trim().toLowerCase(); }
function dateOf(v) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
function ageDays(v) {
  const t = dateOf(v);
  if (t == null) return null;
  return (Date.now() - t) / 86400000;
}

export const OPS = ['eq', 'neq', 'contains', 'is_empty', 'within_days', 'older_than_days', 'before', 'after'];
export const RULE_TARGET_FIELDS = RULE_FIELDS;
