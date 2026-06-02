# Node identity card — AI Ready Archive

- **Slug:** `aiready`
- **Display name:** AI Ready Archive
- **Repo:** `pauldevelopai/node-aiready`
- **Storage:** `host.store` — three collections: `manifest` (keyed by `article_id`,
  one row per article + its editorial toggles), `embeddings` (keyed by `article_id`),
  `config` (`site_settings`, `bulk_rules`). Editors toggle rows constantly and the
  lite `host.db` has no UPDATE/ON CONFLICT, so `host.store` is the right fit.
- **What it does:** turn a newsroom archive into AI-discoverable formats with
  article-by-article control. Ingest via pasted URLs, a sitemap.xml crawl, or a
  shared Google Drive folder → convert to clean markdown (native-JS: turndown /
  mammoth / pdf-parse) → set per-article L1 (include/exclude/local-only), L2 (the
  five publication toggles) and a sensitivity flag → AI writes JSON-LD + summaries
  (grounded in `host.profile`) → semantic/keyword internal search → export a
  deploy-ready zip bundle (`llms.txt`, `llms-full.txt`, `robots.txt`, markdown
  mirrors, JSON-LD) the newsroom drops onto its own site. Concept:
  `node-archive-ready-concept-v1`.
- **External keys (server-managed online, optional local, graceful fallback):**
  `OPENAI_API_KEY` → semantic search embeddings (else keyword); `GOOGLE_API_KEY` →
  Drive folder import (else paste URLs).
- **The single output gate:** `isPublishable()` in `lib/manifest.js` — exclude /
  local-only / any sensitivity flag are forced out of every public artefact. Every
  output path calls it.
- **Hosted:** code is hosted-ready (all data via `host.store`, routes under
  `/api/aiready/*`, bundle streamed in-memory). Not yet deployed on the box — front
  door is "soon" until the box gets the two keys + `deploy-node.sh aiready <port>`.

**Status:** pipeline built and verified locally end-to-end (ingest → convert →
manifest control → bundle, with the sensitivity gate holding). AI generate +
semantic embeddings need an AI / OpenAI key to exercise.
