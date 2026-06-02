# node-aiready — "AI Ready Archive"

A GROUNDED Node (scaffolded from `node-template`). **Currently the clean generic
base** — it runs **locally** (one-command install) AND **hosted** (multi-tenant)
with the "notes" demo as a placeholder. The archive pipeline (manifest → markitdown
→ JSON-LD / `llms.txt` + the four editorial control layers) is NOT built yet; see
`NODE.md` and the concept note `node-archive-ready-concept-v1`.

## What's here (and what to change)
- **`index.js`** (LOCAL) / **`server-hosted.js`** (HOSTED) — the two entry points,
  same handlers. Slug `aiready`, display name "AI Ready Archive".
- **`lib/handlers.js`** — the generic standard `/api/*` handlers (`getSetupStatus`,
  `postSetup` = the local AI-key flow; `getActivity`). Auto-mounted by the runtime.
- **`lib/routes.js`** — `mountAppRoutes(app, getHost)`: a DEMO "items" surface
  (`GET`/`POST /api/items` via `host.store`). **This is the bit you replace** with
  your Node's real routes. Always go through the host interface (`host.store` /
  `host.db` / `host.ai` / `host.log`) — never `fs`/`pg`/`express` in handlers.
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
This Node uses **`host.store`** (save/list records — simplest, no schema). If
your Node needs relational queries, switch to `host.db` + an `ensureSchema` that
creates `node_<slug>_*` tables (see `node-analytics` in the `nodes` repo).

## Deps & deploy
`@developai/grounded-node-runtime` pinned to the current tag (check
`package.json` — today `#v0.12.0`). To host: add the `nodes.json` entry in the
`nodes` repo, then on the box `cd /home/ubuntu/nodes && bash deploy-node.sh <slug> <port>`
and paste the Caddy app block it prints. Downloads (`/nodes/<slug>/{mac,windows}`)
work automatically via a generic Caddy rule. See `nodes/ADD_A_NODE.md` for the
full recipe and `nodes/HANDOVER.md` for the system map.

## Adding an external API later
Hosted-only, behind a server-managed env token (set in the box `.env`); fall back
gracefully to native when absent; document the token in `.env.example`; verify the
provider's real field names against one live call before trusting them. For social
platforms use logged-off public data only — never a login cookie.
