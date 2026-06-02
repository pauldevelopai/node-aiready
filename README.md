# AI Ready Archive

A **GROUNDED Node** — a small AI tool a newsroom can **run on its own machine** or
**use online**. It turns a newsroom archive into AI-discoverable formats with
article-by-article editorial control over what's exposed. _Right now this is the
scaffold (a tiny "notes" demo) — the archive pipeline is being built._

## Run it locally
One line in your computer's built-in terminal — nothing to install by hand:

**macOS**
```bash
curl -fsSL https://grounded.developai.co.za/nodes/aiready/mac | bash
```
**Windows** (PowerShell)
```powershell
irm https://grounded.developai.co.za/nodes/aiready/windows | iex
```
The first time, it asks for an AI key (it shows you where to get one); the key and
your data stay on your computer.

Or from a clone:
```bash
npm install
npm start        # → http://localhost:3000
```

## Build your own Node from it
1. Copy this folder to `node-<your-slug>` and **rebrand** (`package.json`,
   `index.js`/`server-hosted.js` slug + display name, the installers + launchers,
   this README).
2. Replace the demo routes in `lib/routes.js` with your feature; add standard
   handlers in `lib/handlers.js` if you need them.
3. Build the dashboard in `public/` (keep paths relative).
4. List it on the front door (`nodes.json`) and deploy — see
   [`nodes/ADD_A_NODE.md`](https://github.com/pauldevelopai/nodes/blob/main/ADD_A_NODE.md).

Everything you need to know to extend it is in **`CLAUDE.md`**.

## What it gives you for free (via the shared runtime)
Local + hosted boots from one set of handlers, tracker-cookie auth when hosted, a
per-newsroom data store, the GROUNDED nav + feedback chrome, and the "run it
locally" footer with step-by-step instructions.

By **Develop AI** · part of [Grounded](https://grounded.developai.co.za).
