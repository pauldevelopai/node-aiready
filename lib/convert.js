/**
 * lib/convert.js — turn whatever we ingested into CLEAN MARKDOWN. Native-JS only
 * (no Python / markitdown): turndown for HTML structure, mammoth (via
 * host.parse.docxToHtml) for .docx, pdf-parse / word-extractor for PDF + legacy
 * .doc. The conversion is the easy part; the manifest around it is the product.
 */

import TurndownService from 'turndown';
import { detectFormat, pdfToText, docToText } from './extract.js';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
// Drop anything that isn't article content if it slipped through readability.
td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'svg']);

/** HTML string → clean markdown. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  return tidy(td.turndown(String(html)));
}

/** Plain text (PDF / .doc) → minimal markdown: collapse runs, keep paragraphs. */
export function textToMarkdown(text) {
  if (!text) return '';
  return tidy(String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' '));
}

/**
 * Convert one ingested source to markdown.
 *   input: { format?, html?, text?, buffer? }  (format from detectFormat or the source)
 *   host:  needed for host.parse.docxToHtml
 * Returns { markdown, format } (markdown '' on failure — caller records state).
 */
export async function toCleanMarkdown(host, input = {}) {
  let { format, html, text, buffer } = input;
  if (!format && buffer) format = detectFormat(buffer);
  if (!format && html) format = 'html';
  if (!format && text) format = 'text';

  try {
    switch (format) {
      case 'html':
      case 'gdoc':                                   // Google Doc exported as HTML
        return { markdown: htmlToMarkdown(html || (buffer ? buffer.toString('utf8') : '')), format };
      case 'docx':
      case 'docx-truncated': {
        const asHtml = await host.parse.docxToHtml(buffer);
        return { markdown: htmlToMarkdown(asHtml), format: 'docx' };
      }
      case 'pdf':
        return { markdown: textToMarkdown(await pdfToText(buffer)), format };
      case 'doc':
        return { markdown: textToMarkdown(await docToText(buffer)), format };
      case 'text':
        return { markdown: textToMarkdown(text || (buffer ? buffer.toString('utf8') : '')), format };
      default:
        return { markdown: text ? textToMarkdown(text) : '', format: format || 'unknown' };
    }
  } catch (e) {
    return { markdown: '', format: format || 'unknown', error: e.message };
  }
}

function tidy(md) {
  return String(md || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
