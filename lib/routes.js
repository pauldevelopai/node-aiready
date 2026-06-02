// Custom app routes — your Node's real surface. Mounted on the express app the
// runtime returns, alongside the standard /api/* handlers.
//
//   Local  (index.js):         mountAppRoutes(app, () => host)
//   Hosted (server-hosted.js): mountAppRoutes(app, hostFor)   // per-request host
//
// getHost(req) returns the host for THIS request — a fixed lite host locally, or
// a per-request, newsroom-scoped Postgres host online. ALWAYS go through the host
// interface (host.store / host.db / host.ai / host.log) so the same code works both
// ways — never touch fs/pg/express directly in here.
//
// This is a DEMO ("items": save a line of text, list them) so the scaffold runs
// out of the box. Delete it and write your Node's routes.

export function mountAppRoutes(app, getHost) {
  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'route error' });
      try { await host?.log?.error?.({ op: req.path, error: err, context: { method: req.method } }); }
      catch { /* swallow */ }
    }
  };

  // GET /api/items — list saved items (most recent first).
  app.get('/api/items', wrap(async (_req, host) => {
    const items = (await host.store.list('items')).map((i) => i.value).filter(Boolean);
    return { ok: true, items: items.slice(-50).reverse() };
  }));

  // POST /api/items — save one. (Example of a write through host.store.)
  app.post('/api/items', wrap(async (req, host) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return { ok: false, message: 'Type something first.' };
    const item = { text, created_at: new Date().toISOString() };
    const key = `${item.created_at}-${Math.random().toString(36).slice(2, 8)}`;
    await host.store.put('items', key, item);
    await host.log.run({ op: 'item_add', bytes: text.length });
    return { ok: true, item };
  }));

  // SHARED NEWSROOM PROFILE (host.profile) — the cross-node data layer. The same
  // object (location, audience, beats, about…) is read/written by EVERY Node, so
  // your Node gets the newsroom's context for free and can contribute to it.
  // STANDARD: ground every AI call in it. e.g. inside an AI handler:
  //     const p = host.profile ? await host.profile.get() : null;
  //     // prepend p.country / p.audience / p.about to your prompt
  // and contribute back with host.profile.set({ ...fields }).
  app.get('/api/profile', wrap(async (_req, host) => ({
    ok: true,
    profile: host.profile ? await host.profile.get() : null,
  })));
}
