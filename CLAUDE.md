# node-aiready — "AI Ready Archive"

A GROUNDED Node. Runs **locally** (one-command install) AND **hosted** (multi-tenant)
from one set of handlers. It turns a newsroom archive into AI-discoverable formats
with article-by-article editorial control. Concept note: `node-archive-ready-concept-v1`.

**The pipeline:** ingest (paste URLs / sitemap crawl / Google Drive folder) → convert
to clean markdown (native-JS: turndown + mammoth + pdf-parse, NO Python/markitdown) →
per-article control (L1 include/exclude/local-only, L2 five publication toggles,
sensitivity flag) + reversible bulk rules → AI JSON-LD + summaries (grounded in
`host.profile`) → semantic/keyword internal search → export a deploy-ready zip
(`llms.txt`, `llms-full.txt`, `robots.txt`, markdown mirrors, JSON-LD) for the
newsroom's own site. THE MANIFEST IS THE PRODUCT; conversion is the easy part.

## lib/ map
- **`index.js`** (LOCAL) / **`server-hosted.js`** (HOSTED) — entry points, same handlers,
  same routes. Slug `aiready`.
- **`lib/manifest.js`** — the per-article record shape + `isPublishable()` (the SINGLE
  gate every public-output path calls: exclude/local-only/any sensitivity flag → out).
- **`lib/store.js`** — all persistence via `host.store` (collections: `manifest`,
  `embeddings`, `config`). Read-modify-write; never `host.db` (lite shim has no UPDATE).
- **`lib/scrape.js`** + **`lib/extract.js`** + **`lib/convert.js`** — fetch + format-detect
  + native-JS → clean markdown. **`lib/ingest.js`** (URLs/sitemap), **`lib/drive.js`** (Drive).
- **`lib/rules.js`** — pure `applyRules()` (bulk rules; manual edits always win, never
  destructively written). **`lib/jsonld.js`** (schema.org + AI fields). **`lib/embed.js`**
  + **`lib/search.js`** (OpenAI embeddings + cosine, keyword fallback). **`lib/bundle.js`**
  (jszip, in-memory, works local + hosted). **`lib/context.js`** (host.profile grounding).
- **`lib/routes.js`** — `mountAppRoutes(app, getHost)`: all `/api/aiready/*` via the `wrap`
  pattern; the bundle route streams binary outside `wrap`. Keep the no-cache app-shell mw.
- **`lib/handlers.js`** — the standard runtime handlers (`getSetupStatus`/`postSetup` AI-key
  flow, `getActivity`).
- **`public/`** — tabbed dashboard (Sources/Manifest/Search/Crawlers/Export). **Relative
  paths only.** `mountKeyUI()` is the reusable key UX. Do NOT hand-write nav.
- **`public/`** — the dashboard. **Relative paths only** (`fetch("api/…")`,
  `<script src="app.js">`) so it works at `/` and under `/nodes/<slug>/app/`. Do
  NOT hand-write nav — `/nodes/chrome.js` injects it.
- **`install.sh` / `install.ps1`**, `Start.*`, `Update.*`, `update.mjs` — the
  one-command local installers + launchers. **Rebrand fully** (repo, display name,
  header comment, example URL) when you copy.
- **`.env.example`** — local key vars + a commented hosted-only token section.

## Two non-obvious must-haves (already wired here — keep them)
1. **No-cache app shell** — `server-hosted.js`'s `mountRoutes` sets
   `Cache-Control: no-cache` on non-`/api` GETs. Without it, browsers cache the
   chrome-injected `index.html` and UI updates won't show until a hard refresh.
2. **`getSetupStatus` returns `configured:true` when `GROUNDED_HOSTED`** (the AI key
   is server-managed online); `postSetup` refuses online. Keep that branch.

## API keys — entered in the browser, never hand-edited (the standard)
Users never edit `.env`. `mountKeyUI()` in `public/app.js` gates first-run (no key
→ a blocking "Add your AI key" prompt) and wires an always-available **"API key"**
Settings link (change / remove the key, switch provider). `postSetup` in
`lib/handlers.js` **live-validates** the key against the provider's `/v1/models`
endpoint (zero-cost, caching-immune) and rejects bad keys before saving. Hosted →
the key is server-managed, so the modal just says so. Copy `mountKeyUI()` verbatim
into any Node; keep `postSetup`'s validation. This is the standard for all Nodes.

## Shared newsroom profile — `host.profile` (use it; the standard)
`host.profile` (runtime ≥ v0.14.0) is the **cross-node** newsroom data layer: one
merged object per newsroom (location, audience, beats, about…), read/written by
EVERY Node, backed by the shared `grounded_newsroom_profile` table (hosted) /
a JSON file (local), and seeded from the tracker Newsroom Profile.
- **Ground every AI call in it** so output fits the newsroom's real context:
  ```js
  const p = host.profile ? await host.profile.get() : null;   // {country, audience, about, ...}
  // prepend p.country / p.audience / p.about to your prompt
  ```
- **Contribute** anything you learn about the newsroom: `await host.profile.set({ ...fields })` (shallow-merges).
- `lib/routes.js` ships a `GET /api/profile` example. This is how Audience Signal
  (writes context) and Election Watch (grounds verification) share newsroom data —
  do the same in your Node.

## Storage choice
This Node uses **`host.store`** (collections `manifest` / `embeddings` / `config`).
The manifest row is edited constantly; the lite `host.db` has no UPDATE / ON CONFLICT,
so `host.store` (which upserts identically local + hosted) is the only correct fit
here — do NOT move the manifest to `host.db`.

## External keys (the enrich.js pattern — read process.env directly, degrade)
- `OPENAI_API_KEY` → semantic-search embeddings (`lib/embed.js`); without it search
  falls back to keyword (`lib/search.js`). Separate from the Anthropic chat key.
- `GOOGLE_API_KEY` → Drive folder import (`lib/drive.js`); without it, paste URLs.
Both are server-managed on the box, optional locally. Documented in `.env.example`.

## Deps & deploy
`@developai/grounded-node-runtime` pinned `#v0.14.0` (check `package.json`). Added deps:
`turndown` + `jszip` (deps), `pdf-parse` + `word-extractor` (optional, lazy). To host: add the `nodes.json` entry in the
`nodes` repo, then on the box `cd /home/ubuntu/nodes && bash deploy-node.sh <slug> <port>`
and paste the Caddy app block it prints. Downloads (`/nodes/<slug>/{mac,windows}`)
work automatically via a generic Caddy rule. See `nodes/ADD_A_NODE.md` for the
full recipe and `nodes/HANDOVER.md` for the system map.

## Adding an external API later
Hosted-only, behind a server-managed env token (set in the box `.env`); fall back
gracefully to native when absent; document the token in `.env.example`; verify the
provider's real field names against one live call before trusting them. For social
platforms use logged-off public data only — never a login cookie.
