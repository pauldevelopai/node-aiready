/**
 * lib/drive.js — ingest articles from a shared Google Drive FOLDER.
 *
 * Native + no OAuth dance: the Drive API v3 with an API key can list and download
 * a folder shared "anyone with the link". Key is server-managed online
 * (GOOGLE_API_KEY in the box .env) and optional locally — exactly the
 * node-verifier/enrich.js APIFY_TOKEN pattern: read process.env directly, degrade
 * gracefully when absent. Google Docs export as HTML (best structure); binary
 * DOCX/PDF download raw and route through the same converters as everything else.
 */

import { toCleanMarkdown } from './convert.js';
import { detectFormat } from './extract.js';
import { makeArticle, slugify } from './manifest.js';
import { upsertArticle, putArticle } from './store.js';
import { pool } from './ingest.js';

const API = 'https://www.googleapis.com/drive/v3';

export function driveAvailable() { return !!process.env.GOOGLE_API_KEY; }

/** Pull the folder id out of any Drive folder URL (or accept a bare id). */
export function folderIdFromUrl(input) {
  const s = String(input || '').trim();
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{16,}$/.test(s)) return s;
  return null;
}

const MIME = {
  gdoc: 'application/vnd.google-apps.document',
  folder: 'application/vnd.google-apps.folder',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** Ingest every supported file in a public Drive folder. */
export async function ingestDriveFolder(host, folderUrl, { force = false } = {}) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { error: 'no_drive_key', message: 'Connecting a Drive folder needs a Google API key (server-managed online; paste one locally). You can paste individual article URLs instead.' };
  const folderId = folderIdFromUrl(folderUrl);
  if (!folderId) return { error: 'bad_folder', message: "That doesn't look like a Google Drive folder link." };

  let files;
  try { files = await listFolder(folderId, key); }
  catch (e) {
    if (e.status === 403 || e.status === 404) return { error: 'not_public', message: "That folder isn't shared as 'anyone with the link'. Set link-sharing to Viewer and try again." };
    return { error: 'drive_error', message: e.message };
  }

  const supported = files.filter((f) => [MIME.gdoc, MIME.docx, MIME.pdf].includes(f.mimeType) || /\.(html?|txt|md)$/i.test(f.name));
  const stats = { total: supported.length, added: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  await pool(supported, 3, async (f) => {
    try {
      const article = makeArticle({ source_kind: 'drive', source_ref: f.id, title: stripExt(f.name) });
      const { article: row, created } = await upsertArticle(host, article);
      if (!created && !force && row.state?.converted) { stats.skipped++; return; }

      const dl = await downloadFile(f, key);            // { format, html?, buffer? }
      const { markdown, format } = await toCleanMarkdown(host, dl);
      const now = new Date().toISOString();
      await putArticle(host, {
        ...row,
        title: row.title || stripExt(f.name),
        slug: slugify(stripExt(f.name), row.slug),
        source_format: format,
        published_at: row.published_at || f.modifiedTime || null,
        clean_markdown: markdown || null,
        state: { ...row.state, fetched: now, converted: markdown ? now : null },
      });
      if (!markdown) { stats.failed++; stats.errors.push({ name: f.name, status: 'empty' }); return; }
      created ? stats.added++ : stats.updated++;
    } catch (e) {
      stats.failed++; stats.errors.push({ name: f.name, status: e.message });
    }
  });

  await host.log?.run?.({ op: 'ingest_drive', total: stats.total, added: stats.added, failed: stats.failed }).catch(() => {});
  return stats;
}

async function listFolder(folderId, key) {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}/files?q=${q}&key=${key}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,modifiedTime)`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) { const err = new Error(`Drive list failed (${res.status})`); err.status = res.status; throw err; }
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken && out.length < 5000);
  return out;
}

async function downloadFile(f, key) {
  if (f.mimeType === MIME.gdoc) {
    const url = `${API}/files/${f.id}/export?mimeType=text/html&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive export failed (${res.status})`);
    return { format: 'gdoc', html: await res.text() };
  }
  const url = `${API}/files/${f.id}?alt=media&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { format: detectFormat(buffer), buffer };
}

function stripExt(name) { return String(name || '').replace(/\.[^.]+$/, '').trim(); }
