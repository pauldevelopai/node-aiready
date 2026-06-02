// AI Ready Archive — LOCAL entry point.
//
// Runs on a journalist's own machine: their data + AI key stay local. The SAME
// handlers run hosted (server-hosted.js) — write logic once, against the host
// interface only. Replace the demo "items" routes with your Node's real ones.

import 'dotenv/config';
import { createLiteHost, createServer } from '@developai/grounded-node-runtime';
import * as handlers from './lib/handlers.js';
import { mountAppRoutes } from './lib/routes.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const SLUG = 'aiready';
const DISPLAY_NAME = 'AI Ready Archive';

async function main() {
  const host = createLiteHost({
    appSlug: SLUG,
    nodeVersion: pkg.version,
    newsroom: process.env.NEWSROOM, // unset → saved meta, then none
  });

  const app = createServer({
    slug: SLUG,
    host,
    handlers,
    displayName: DISPLAY_NAME,
    nodeVersion: pkg.version,
  });

  // Custom routes (same per-request host signature as hosted; here it's the one
  // fixed lite host). Mount yours here.
  mountAppRoutes(app, () => host);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
