/**
 * lib/upload.js — ingest documents UPLOADED from the browser (a whole folder, or
 * a set of files dragged in). This is the hosted answer to "a directory on my
 * computer": run online, a business can't point us at a local path, so the browser
 * ships the files up as multipart buffers and they route through the SAME native
 * converters as a Drive folder (convert.js / extract.js). No Google key needed.
 *
 * Mirrors drive.js exactly, minus the Drive API: for each file we detect the format
 * from magic bytes, convert to clean markdown, and upsert one manifest row. A
 * re-upload of the same file updates in place (id = hash of content + name).
 */

import crypto from 'node:crypto';
import { toCleanMarkdown } from './convert.js';
import { detectFormat } from './extract.js';
import { makeArticle, slugify } from './manifest.js';
import { upsertArticle, putArticle } from './store.js';
import { pool } from './ingest.js';

// Extensions we can convert. A file with no useful extension still gets a chance
// if its magic bytes look like a document (detectFormat != 'unknown').
const SUPPORTED_EXT = /\.(pdf|docx?|html?|txt|md|markdown)$/i;
const MAX_FILES = 2000;             // safety cap per upload
const CONVERT_TIMEOUT_MS = 90_000;  // per-file: don't let one bad file stall the batch

// Reject after `ms` so a hung converter can't block the pool. The losing promise
// keeps running (uncancellable) but is orphaned; the row is marked failed.
function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('conversion timed out')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** Ingest an array of multer files ({ originalname, buffer }). Returns stats. */
export async function ingestFiles(host, files, { force = false } = {}) {
  const usable = (files || [])
    .filter((f) => f && f.buffer && f.buffer.length)
    .filter((f) => SUPPORTED_EXT.test(f.originalname || '') || detectFormat(f.buffer) !== 'unknown')
    .slice(0, MAX_FILES);
  const stats = { total: usable.length, added: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  await pool(usable, 3, async (f) => {
    const name = baseName(f.originalname || 'document');
    try {
      // Stable id from content + name so the same file re-uploaded updates in place.
      const ref = crypto.createHash('sha1').update(f.buffer).update(String(name)).digest('hex').slice(0, 20);
      const article = makeArticle({ source_kind: 'upload', source_ref: ref, title: stripExt(name) });
      const { article: row, created } = await upsertArticle(host, article);
      if (!created && !force && row.state?.converted) { stats.skipped++; return; }

      const format = detectFormat(f.buffer);
      // Per-file timeout: one pathological file (e.g. a PDF that hangs the parser)
      // must not stall the whole batch — mark it failed and move on.
      const { markdown, format: fmt } = await withTimeout(
        toCleanMarkdown(host, { format, buffer: f.buffer }), CONVERT_TIMEOUT_MS,
      );
      const now = new Date().toISOString();
      await putArticle(host, {
        ...row,
        title: row.title || stripExt(name),
        slug: slugify(stripExt(name), row.slug),
        source_format: fmt,
        clean_markdown: markdown || null,
        state: { ...row.state, fetched: now, converted: markdown ? now : null },
      });
      if (!markdown) { stats.failed++; stats.errors.push({ name, status: 'empty' }); return; }
      created ? stats.added++ : stats.updated++;
    } catch (e) {
      stats.failed++; stats.errors.push({ name, status: e.message });
    }
  });

  await host.log?.run?.({ op: 'ingest_upload', total: stats.total, added: stats.added, failed: stats.failed }).catch(() => {});
  return stats;
}

// A folder upload sends paths like "myfolder/sub/report.pdf"; keep just the file.
function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
function stripExt(name) { return String(name || '').replace(/\.[^.]+$/, '').trim(); }
