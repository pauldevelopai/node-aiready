# AI Ready Archive — Handover

> Single source of truth for resuming work on this Node. For deep architecture see
> `CLAUDE.md`; for the identity card see `NODE.md`; for the original product spec see
> the concept note `node-archive-ready-concept-v1`.

_Last updated: 2026-06-03._

---

## 1. What this Node is

Turns a newsroom's archive into AI-discoverable formats with **article-by-article
editorial control**. Pipeline: **ingest** (paste URLs / sitemap crawl / Google Drive
folder) → **convert** to clean markdown (native-JS) → **control** (per-article toggles +
bulk rules + sensitivity) → **AI** JSON-LD + summaries → **search / Ask** (semantic + RAG)
→ **export** a deploy-ready zip for the newsroom's own site. The manifest (one row per
article + its toggles) is the product; conversion is the easy part.

## 2. Status — LIVE ✅

- **Deployed & live** at <https://grounded.developai.co.za/nodes/aiready/app/> (sign in
  with a Grounded account). Front-door card is `status:"live"`, `hosted:true`.
- **Box:** pm2 process **`aiready-hosted`** on **port 3006**, runtime **v0.14.0**.
  Clone at `/home/ubuntu/node-aiready`.
- **Repo:** `github.com/pauldevelopai/node-aiready` (main). Latest work: metadata
  extraction (`44f92a5`), RAG (`f7e38ca`), pipeline (`c1420e4`).

### Providers (decided 2026-06-03)
- **All generation = Claude** (Sonnet 4.6) via the box's shared `ANTHROPIC_API_KEY`
  (JSON-LD descriptions, summaries, RAG answers).
- **Embeddings = OpenAI** (`text-embedding-3-small`) — Claude has NO embeddings API, so
  semantic search/RAG retrieval must use OpenAI (or Voyage). The box's existing
  `OPENAI_API_KEY` was injected into the node `.env`. Semantic search is **ON**.
- **Drive import = OFF** — needs a `GOOGLE_API_KEY` (see TODO #2).

## 3. Built & verified ✅

- Ingest: paste URLs + sitemap.xml crawl (sitemap-index aware). Idempotent, resumable.
- Convert: turndown (HTML) + mammoth (DOCX) + pdf-parse / word-extractor (PDF/.doc). No Python.
- **Metadata extraction** (`lib/scrape.js` `extractMeta`): title/author/published_at/
  category/description from JSON-LD → OpenGraph → meta tags. Populated on ingest.
- Manifest control: L1 include/exclude/local-only, L2 five publication toggles,
  sensitivity flag (hard override). `isPublishable()` is the SINGLE public-output gate.
- Bulk rules (`lib/rules.js`): reversible; manual per-article edits always win.
- Semantic + keyword search (`lib/embed.js` / `lib/search.js`), withdrawn excluded.
- **RAG "Ask the archive"** (`lib/rag.js`, `POST /api/aiready/ask`): retrieve → Claude
  answers from sources with `[n]` citations, grounded only in the newsroom's own work.
- Export: in-memory jszip bundle (llms.txt, llms-full.txt, robots.txt, mirrors, JSON-LD,
  README). Sensitivity gate verified — protected articles never leak into the bundle.
- AI JSON-LD + summaries grounded in `host.profile`.

## 4. TODO — what still needs doing (priority order)

### #1 — Real-archive test (THE meaningful finish line)
Everything so far was tested on `example.com` + synthetic HTML. Run one **real newsroom
site's `sitemap.xml`** (a few hundred articles) end-to-end: ingest → convert → check
metadata coverage → embed → Ask → export. This surfaces the real unknowns: scraper
quality on that publisher's HTML, conversion fidelity, % of articles with usable
metadata, embedding cost/time, crawl performance. Expect to tune things after.

### #2 — Turn on Google Drive ingestion
Coded (`lib/drive.js`) but OFF — no key. The box has Google **OAuth** creds only (can't
list folders). Need a plain **Google API key** with the **Drive API enabled**:
1. console.cloud.google.com → project `864910907253` → APIs & Services → Library →
   "Google Drive API" → **Enable**.
2. Credentials → **Create credentials → API key**; restrict it to the Drive API.
3. Add to the node: `OPENAI…` style — append `GOOGLE_API_KEY=AIza…` to
   `/home/ubuntu/node-aiready/.env`, then `pm2 restart aiready-hosted --update-env`.
4. Test against a folder shared **"anyone with the link → Viewer"**.

### #3 — Small hardening
- Re-verify the **local install one-liner** now that the pipeline added deps:
  `curl -fsSL https://grounded.developai.co.za/nodes/aiready/mac | GROUNDED_HOME=/tmp/g PORT=3099 bash`
  → expect "✓ AI Ready Archive is running".
- **Scale** (only if a real archive is large, >~10k articles): the in-memory vector
  search (`lib/search.js` warm cache) and the one-AI-call-per-article `generateAll` would
  need paging / batching + rate-limiting.

### Out of scope (build only if asked)
WordPress connector; file-upload ingestion; Voyage embeddings (zero-OpenAI option — a
one-function swap in `lib/embed.js`).

### Standing security debts (not specific to this Node)
Rotate the **Apify** + **Anthropic** keys pasted into chat in earlier sessions, and the
**leaked Lightsail default SSH key**.

## 5. How to resume / operate

**Deploy a code change to the box** (no new npm deps → no install needed):
```bash
ssh -i ~/.ssh/lightsail-grounded.pem ubuntu@52.56.143.231
cd /home/ubuntu/node-aiready
git checkout -- package-lock.json      # box clone's lock is often dirtied by npm install
git pull --ff-only origin main
pm2 restart aiready-hosted --update-env
```
(If a runtime bump or new dep: `rm -rf node_modules/@developai && npm install` — see the
runtime-cache gotchas in the team's hosted-deploy notes.)

**Authed smoke test on the box** (mint a short JWT, hit the API):
```bash
cd /home/ubuntu/node-aiready && node -e "import('dotenv/config').then(async()=>{
  const pg=await import('pg'); const jwt=(await import('jsonwebtoken')).default;
  const {rows}=await new pg.default.Pool({connectionString:process.env.DATABASE_URL})
    .query(\"select id,email,role from team_members order by (role='admin') desc, id limit 1\");
  const t=jwt.sign({id:rows[0].id,email:rows[0].email,role:rows[0].role,sector_ids:[]},process.env.JWT_SECRET,{expiresIn:'5m'});
  const r=await fetch('http://localhost:3006/api/aiready/status',{headers:{cookie:'tracker_token='+t}});
  console.log(r.status, await r.text());
});"
```

**Local dev:** `npm start` → http://localhost:3000 (lite host, JSON files in `data/`).

**Key API routes** (all `/api/aiready/*`, JWT-gated when hosted): `ingest/urls`,
`ingest/sitemap`, `ingest/drive`, `convert`, `manifest` (GET) / `manifest/:id` (PUT/DELETE),
`rules` (GET/PUT), `site-settings` (GET/PUT), `embed`, `search?q=`, `ask` (POST, RAG),
`generate`, `bundle` (GET, binary zip), `status`.
