# Node identity card — AI Ready Archive

- **Slug:** `aiready`
- **Display name:** AI Ready Archive
- **Repo:** `pauldevelopai/node-aiready`
- **Storage:** `host.store` (per-newsroom JSON collections; no schema) — the manifest
  will live here, keyed by `article_id` (editors toggle rows constantly, and the lite
  host's `host.db` has no UPDATE/ON CONFLICT, so `host.store` is the right fit).
- **Hosted:** not yet — currently a generic scaffold (the "notes" demo) while the
  archive pipeline is built.
- **What it will do:** turn a newsroom archive into AI-discoverable formats
  (clean markdown, JSON-LD, `llms.txt`/`llms-full.txt`) with article-by-article
  editorial control over what's exposed to AI crawlers, what's concatenated for LLM
  ingestion, and what stays local-only as an internal searchable archive. Concept:
  `node-archive-ready-concept-v1`.

**Status:** scaffold only — no archive logic yet. The demo "items" surface is a
placeholder to prove the wiring runs.
