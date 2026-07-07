// AI Ready Archive — dashboard JS. Plain vanilla, relative API paths.
//
// mountKeyUI() (bottom) is the reusable GROUNDED key UX — copy it into any Node.
// The rest wires the archive tabs: Sources (ingest) · Manifest (per-article control
// + bulk rules) · Search (semantic/keyword) · Crawlers (site + robots policy) ·
// Export (deploy bundle).

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const RULE_WHEN_FIELDS = ['category', 'author', 'title', 'source_kind', 'source_format', 'published_at', 'inclusion'];
  const RULE_OPS = ['eq', 'neq', 'contains', 'is_empty', 'within_days', 'older_than_days', 'before', 'after'];
  const RULE_THEN_FIELDS = ['inclusion', 'out_clean_markdown', 'out_json_ld', 'out_mirror_md', 'in_llms_txt', 'in_llms_full'];
  const TOGGLE_LABELS = { out_clean_markdown: 'Clean MD', out_json_ld: 'JSON-LD', out_mirror_md: 'Mirror .md', in_llms_txt: 'llms.txt', in_llms_full: 'llms-full' };
  let CAPS = { drive: false, embeddings: false };
  let MANIFEST_FIELDS = null;
  const loaded = {};

  async function boot() {
    $('#app').style.display = 'block';
    wireTabs();
    wireSources();
    wireManifest();
    wireSearch();
    wireCrawlers();
    wireExport();
    await refreshStatus();
    showTab('sources');
    mountKeyUI({});
  }

  // ─── Tabs ──
  function wireTabs() {
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) showTab(b.dataset.tab);
    });
  }
  function showTab(name) {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'manifest' && !loaded.manifest) loadManifest();
    if (name === 'crawlers' && !loaded.crawlers) loadSettings();
    if (name === 'export') loadExportPreview();
    if (name === 'search') applySearchMode();
  }

  async function refreshStatus() {
    const s = await fetchJson('api/aiready/status').catch(() => null);
    if (!s) return;
    CAPS = s.capabilities || CAPS;
    const c = s.counts || {};
    $('#counts').innerHTML = [
      ['Documents', c.total], ['Converted', c.converted], ['Publishable', c.publishable],
      ['Local-only', c.local_only], ['Excluded', c.excluded], ['Sensitive', c.sensitive],
      ['In llms.txt', c.in_llms_txt], ['Embedded', c.embedded],
    ].map(([k, v]) => `<span>${k}: <b>${v || 0}</b></span>`).join('');
    // Drive affordance
    if (!CAPS.drive) {
      $('#drive-help').innerHTML = 'A Google API key isn’t set, so folder import is off. <b>Upload a folder or paste page URLs above instead</b>, or set <code>GOOGLE_API_KEY</code> (server-managed online).';
      $('#ingest-drive').disabled = true;
    }
    applySearchMode();
  }

  function applySearchMode() {
    const badge = $('#search-mode');
    if (CAPS.embeddings) { badge.textContent = 'semantic'; badge.className = 'badge good'; $('#embed-btn').style.display = ''; }
    else { badge.textContent = 'keyword'; badge.className = 'badge warn'; $('#embed-btn').style.display = 'none';
      $('#search-help').innerHTML = 'Keyword search over your documents. Add an <code>OPENAI_API_KEY</code> to enable semantic search. Withdrawn documents are never returned.'; }
  }

  // ─── Sources ──
  function wireSources() {
    wireUpload();
    $('#ingest-urls').addEventListener('click', () => runIngest('#ingest-urls', '#urls-status', 'api/aiready/ingest/urls', { urls: $('#urls').value }));
    $('#ingest-sitemap').addEventListener('click', () => runIngest('#ingest-sitemap', '#sitemap-status', 'api/aiready/ingest/sitemap', { sitemap: $('#sitemap').value.trim() }));
    $('#ingest-drive').addEventListener('click', () => runIngest('#ingest-drive', '#drive-status', 'api/aiready/ingest/drive', { folder: $('#drive').value.trim() }));
  }

  // Upload a folder / files from the user's computer (multipart → /ingest/upload).
  let PICKED = [];
  function wireUpload() {
    const folder = $('#file-folder'), files = $('#file-files'), dz = $('#dropzone');
    $('#pick-folder').addEventListener('click', () => folder.click());
    $('#pick-files').addEventListener('click', () => files.click());
    folder.addEventListener('change', () => setPicked(folder.files));
    files.addEventListener('change', () => setPicked(files.files));
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) setPicked(e.dataTransfer.files); });
    $('#ingest-upload').addEventListener('click', uploadPicked);
  }
  function setPicked(fileList) {
    PICKED = Array.from(fileList || []);
    $('#upload-picked').textContent = PICKED.length ? `${PICKED.length} file(s) selected.` : '';
    $('#ingest-upload').disabled = !PICKED.length;
  }
  async function uploadPicked() {
    if (!PICKED.length) return;
    const btn = $('#ingest-upload'), status = $('#upload-status');
    btn.disabled = true; status.textContent = `Uploading + converting ${PICKED.length} file(s)…`;
    try {
      const fd = new FormData();
      PICKED.forEach((f) => fd.append('files', f, f.name));
      const r = await fetch('api/aiready/ingest/upload', { method: 'POST', body: fd }).then((x) => x.json());
      if (!r.ok) { status.textContent = r.message || 'Could not add those files.'; return; }
      status.textContent = `Done — ${r.added || 0} added, ${r.updated || 0} updated, ${r.skipped || 0} skipped, ${r.failed || 0} failed${r.embedded ? `, ${r.embedded} indexed for search` : ''}.`;
      setPicked([]);
      loaded.manifest = false;
      refreshStatus();
    } catch (e) { status.textContent = 'Network error: ' + e.message; }
    finally { btn.disabled = !PICKED.length; }
  }
  async function runIngest(btnSel, statusSel, url, body) {
    const btn = $(btnSel), status = $(statusSel);
    btn.disabled = true; status.textContent = 'Working… (fetching + converting)';
    try {
      const r = await postJson(url, body);
      if (!r.ok) { status.textContent = r.message || 'Could not ingest.'; return; }
      status.textContent = `Done — ${r.added || 0} added, ${r.updated || 0} updated, ${r.skipped || 0} skipped, ${r.failed || 0} failed${r.embedded ? `, ${r.embedded} indexed for search` : ''}.`;
      loaded.manifest = false;
      refreshStatus();
    } catch (e) { status.textContent = 'Network error: ' + e.message; }
    finally { btn.disabled = false; }
  }

  // ─── Manifest ──
  function wireManifest() {
    fillSelect('#r-field', RULE_WHEN_FIELDS);
    fillSelect('#r-op', RULE_OPS);
    fillSelect('#r-then-field', RULE_THEN_FIELDS);
    syncThenValue();
    $('#r-then-field').addEventListener('change', syncThenValue);
    ['#r-field', '#r-op', '#r-value'].forEach((s) => $(s).addEventListener('input', previewRule));
    $('#r-add').addEventListener('click', addRule);
    $('#generate-btn').addEventListener('click', generate);
  }
  function syncThenValue() {
    const f = $('#r-then-field').value;
    fillSelect('#r-then-value', f === 'inclusion' ? ['include', 'exclude', 'local_only'] : ['true', 'false']);
  }
  async function previewRule() {
    const when = currentWhen();
    if (!when) { $('#rule-preview').textContent = ''; return; }
    const r = await postJson('api/aiready/rules/preview', { when }).catch(() => null);
    if (r && r.ok) $('#rule-preview').textContent = `This rule would match ${r.matches} document(s).`;
  }
  function currentWhen() {
    const field = $('#r-field').value, op = $('#r-op').value, value = $('#r-value').value.trim();
    if (op !== 'is_empty' && !value) return null;
    return { field, op, value };
  }
  async function addRule() {
    const when = currentWhen();
    if (!when) { $('#rule-preview').textContent = 'Enter a value first.'; return; }
    let v = $('#r-then-value').value;
    if (v === 'true') v = true; else if (v === 'false') v = false;
    const rule = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), when, then: { [$('#r-then-field').value]: v } };
    const cur = (await fetchJson('api/aiready/rules')).rules || [];
    await putJson('api/aiready/rules', { rules: [...cur, rule] });
    $('#r-value').value = '';
    loadManifest();
    refreshStatus();
  }
  async function deleteRule(id) {
    const cur = (await fetchJson('api/aiready/rules')).rules || [];
    await putJson('api/aiready/rules', { rules: cur.filter((r) => r.id !== id) });
    loadManifest(); refreshStatus();
  }

  async function loadManifest() {
    loaded.manifest = true;
    const [mf, rl] = await Promise.all([fetchJson('api/aiready/manifest'), fetchJson('api/aiready/rules')]);
    MANIFEST_FIELDS = mf.fields;
    renderRules(rl.rules || []);
    renderManifestTable(mf.articles || []);
  }

  function renderRules(rules) {
    const box = $('#rules-list');
    box.innerHTML = rules.length ? rules.map((r) => {
      const k = Object.keys(r.then || {})[0];
      const desc = `When <b>${esc(r.when.field)}</b> ${esc(r.when.op).replace(/_/g, ' ')} ${r.when.op === 'is_empty' ? '' : '<b>' + esc(r.when.value) + '</b>'} → set <b>${esc(k)}</b> = <b>${esc(String(r.then[k]))}</b>`;
      return `<div class="rule"><span class="desc">${desc}</span><button class="ghost" data-del="${esc(r.id)}">Remove</button></div>`;
    }).join('') : '<span class="empty">No rules yet — documents use their own per-row settings.</span>';
    box.querySelectorAll('button[data-del]').forEach((b) => b.addEventListener('click', () => deleteRule(b.dataset.del)));
  }

  function renderManifestTable(articles) {
    const box = $('#manifest-table');
    if (!articles.length) { box.innerHTML = '<span class="empty">Nothing added yet. Add a folder, files, URLs or a Drive folder on the Sources tab.</span>'; return; }
    const toggles = MANIFEST_FIELDS.toggles;
    const head = `<tr><th>Document</th><th>Status</th><th>Include</th>${toggles.map((t) => `<th class="togglecell">${TOGGLE_LABELS[t] || t}</th>`).join('')}<th>Sensitivity</th><th></th></tr>`;
    const rows = articles.map((a) => {
      const eff = a._effective || {};
      const titleCell = a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.slug)}</a>` : esc(a.title || a.slug);
      const stateBadges = [
        a.state?.converted ? '<span class="badge good">md</span>' : '<span class="badge bad">no md</span>',
        a.state?.jsonld ? '<span class="badge good">ld</span>' : '',
        a.state?.embedded ? '<span class="badge">vec</span>' : '',
        a.source_format ? `<span class="badge">${esc(a.source_format)}</span>` : '',
      ].join('');
      const inc = sel(`inc:${a.id}`, MANIFEST_FIELDS.inclusion, a.inclusion, ruled(eff.inclusion, a.inclusion));
      const toggleCells = toggles.map((t) => {
        const byRule = eff[t] !== undefined && eff[t] !== a[t];
        return `<td class="togglecell"><input type="checkbox" data-tg="${esc(a.id)}:${t}" ${a[t] ? 'checked' : ''} title="${byRule ? 'effective: ' + eff[t] + ' (by rule)' : ''}" ${byRule ? 'style="outline:2px solid #c9b27a"' : ''}/></td>`;
      }).join('');
      const sens = sel(`sen:${a.id}`, MANIFEST_FIELDS.sensitivity, a.sensitivity_flag, false);
      return `<tr><td class="title">${titleCell}${a.category ? `<div class="status-line">${esc(a.category)}</div>` : ''}</td>`
        + `<td>${stateBadges}</td><td>${inc}</td>${toggleCells}<td>${sens}</td>`
        + `<td><button class="ghost" data-ld="${esc(a.id)}" title="Copy JSON-LD snippet">&lt;ld&gt;</button></td></tr>`;
    }).join('');
    box.innerHTML = `<table class="manifest"><thead>${head}</thead><tbody>${rows}</tbody></table>`;

    box.querySelectorAll('select[data-k]').forEach((s) => s.addEventListener('change', onCellChange));
    box.querySelectorAll('input[data-tg]').forEach((c) => c.addEventListener('change', onToggleChange));
    box.querySelectorAll('button[data-ld]').forEach((b) => b.addEventListener('click', () => copyJsonLd(b.dataset.ld)));
  }
  function ruled(effVal, stored) { return effVal !== undefined && effVal !== stored; }
  function sel(key, opts, value, byRule) {
    const id = key.split(':');
    return `<select data-k="${id[0]}" data-id="${esc(id[1])}" ${byRule ? 'style="border-color:#c9b27a"' : ''}>`
      + opts.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o.replace(/_/g, '-')}</option>`).join('') + '</select>';
  }
  async function onCellChange(e) {
    const s = e.target, kind = s.dataset.k, id = s.dataset.id;
    const field = kind === 'inc' ? 'inclusion' : 'sensitivity_flag';
    await putJson(`api/aiready/manifest/${id}`, { [field]: s.value });
    refreshStatus();
  }
  async function onToggleChange(e) {
    const [id, field] = e.target.dataset.tg.split(':');
    await putJson(`api/aiready/manifest/${id}`, { [field]: e.target.checked });
    refreshStatus();
  }
  async function copyJsonLd(id) {
    const r = await fetchJson(`api/aiready/jsonld/${id}`).catch(() => null);
    if (!r || !r.ok) { alert('Could not build JSON-LD.'); return; }
    try { await navigator.clipboard.writeText(r.script); alert('JSON-LD snippet copied — paste it into the page\'s <head>.'); }
    catch { prompt('Copy this JSON-LD snippet:', r.script); }
  }
  async function generate() {
    if (!confirm('Use AI to write JSON-LD descriptions + llms.txt summaries for documents that need them? This uses your AI key.')) return;
    const btn = $('#generate-btn'); btn.disabled = true; $('#generate-status').textContent = 'Generating…';
    try {
      const r = await postJson('api/aiready/generate', {});
      $('#generate-status').textContent = r.ok ? `Done — ${r.done} generated, ${r.failed} failed.` : (r.message || 'Failed.');
      loadManifest(); refreshStatus();
    } catch (e) { $('#generate-status').textContent = 'Error: ' + e.message; }
    finally { btn.disabled = false; }
  }

  // ─── Search + Ask (RAG) ──
  function wireSearch() {
    $('#embed-btn').addEventListener('click', buildIndex);
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(runSearch, 300); });
    $('#ask-btn').addEventListener('click', askArchive);
    $('#ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') askArchive(); });
  }
  async function askArchive() {
    const q = $('#ask-q').value.trim();
    const ans = $('#ask-answer');
    if (!q) { ans.innerHTML = ''; return; }
    const btn = $('#ask-btn'); btn.disabled = true; $('#ask-status').textContent = 'Reading the archive…'; ans.innerHTML = '';
    try {
      const r = await postJson('api/aiready/ask', { q });
      $('#ask-status').textContent = r.ok ? '' : (r.message || 'Could not answer.');
      if (!r.ok) return;
      const sources = r.sources || [];
      // Turn [n] citations into links to the matching source.
      const body = esc(r.answer).replace(/\[(\d+)\]/g, (m, n) => {
        const s = sources[Number(n) - 1];
        return s && s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">[${n}]</a>` : `[${n}]`;
      });
      const srcList = sources.length
        ? '<div class="status-line" style="margin-top:0.7rem"><b>Sources</b></div>'
          + sources.map((s) => `<div class="result" style="padding:0.4rem 0">[${s.n}] ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}${s.published_at ? ` <span class="status-line">${esc(s.published_at.slice(0, 10))}</span>` : ''}</div>`).join('')
        : '';
      ans.innerHTML = `<div class="card" style="margin:0;background:#f7f9fc"><div style="white-space:pre-wrap">${body}</div>${srcList}`
        + `<div class="status-line" style="margin-top:0.6rem">Answered by Claude from ${sources.length} source(s) · ${esc(r.mode)} retrieval</div></div>`;
    } catch (e) { $('#ask-status').textContent = 'Error: ' + e.message; }
    finally { btn.disabled = false; }
  }
  async function buildIndex() {
    const btn = $('#embed-btn'); btn.disabled = true; $('#embed-status').textContent = 'Embedding…';
    try {
      const r = await postJson('api/aiready/embed', {});
      $('#embed-status').textContent = r.ok ? `Indexed ${r.embedded} document(s) (${r.failed} failed).` : (r.message || 'Failed.');
      refreshStatus();
    } catch (e) { $('#embed-status').textContent = 'Error: ' + e.message; }
    finally { btn.disabled = false; }
  }
  async function runSearch() {
    const q = $('#q').value.trim();
    const box = $('#search-results');
    if (!q) { box.innerHTML = ''; return; }
    const r = await fetchJson('api/aiready/search?q=' + encodeURIComponent(q)).catch(() => null);
    if (!r || !r.results) { box.innerHTML = '<span class="empty">Search failed.</span>'; return; }
    $('#search-mode').textContent = r.mode; $('#search-mode').className = 'badge ' + (r.mode === 'semantic' ? 'good' : 'warn');
    box.innerHTML = r.results.length ? r.results.map((x) =>
      `<div class="result">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}
       <span class="badge">${x.inclusion}</span>${x.category ? `<span class="badge">${esc(x.category)}</span>` : ''}
       <div class="snip">${esc(x.snippet)}</div></div>`).join('')
      : '<span class="empty">No matches.</span>';
  }

  // ─── Crawlers / site settings ──
  function wireCrawlers() { $('#save-settings').addEventListener('click', saveSettings); }
  async function loadSettings() {
    loaded.crawlers = true;
    const r = await fetchJson('api/aiready/site-settings');
    const s = r.settings || {};
    $('#s-name').value = s.newsroom_name || ''; $('#s-url').value = s.site_url || '';
    $('#s-summary').value = s.llms_summary || ''; $('#s-mirror').value = s.mirror_base || '/';
    const crawlers = (r.crawlers || []).concat(['*']);
    $('#crawlers-list').innerHTML = crawlers.map((bot) => {
      const v = (s.crawlers && s.crawlers[bot]) || 'allow';
      return `<div class="crawler-row"><span class="name">${esc(bot)}</span>
        <label><input type="radio" name="cr-${esc(bot)}" value="allow" ${v === 'allow' ? 'checked' : ''}/> allow</label>
        <label><input type="radio" name="cr-${esc(bot)}" value="disallow" ${v === 'disallow' ? 'checked' : ''}/> disallow</label></div>`;
    }).join('');
    $('#crawlers-list').dataset.bots = JSON.stringify(crawlers);
  }
  async function saveSettings() {
    const bots = JSON.parse($('#crawlers-list').dataset.bots || '[]');
    const crawlers = {};
    bots.forEach((bot) => { const sel = document.querySelector(`input[name="cr-${cssEsc(bot)}"]:checked`); crawlers[bot] = sel ? sel.value : 'allow'; });
    const settings = { newsroom_name: $('#s-name').value.trim(), site_url: $('#s-url').value.trim(), llms_summary: $('#s-summary').value.trim(), mirror_base: $('#s-mirror').value.trim() || '/', crawlers };
    $('#settings-status').textContent = 'Saving…';
    const r = await putJson('api/aiready/site-settings', { settings });
    $('#settings-status').textContent = r.ok ? 'Saved.' : 'Failed.';
  }

  // ─── Export ──
  function wireExport() { $('#download-btn').addEventListener('click', () => { window.location = 'api/aiready/bundle'; }); }
  async function loadExportPreview() {
    const r = await fetchJson('api/aiready/bundle/preview').catch(() => null);
    if (!r || !r.ok) { $('#export-preview').textContent = 'Could not load preview.'; return; }
    const c = r.counts;
    $('#export-preview').innerHTML = `Bundle will contain: <b>${c.mirror}</b> markdown mirror(s), <b>${c.jsonld}</b> JSON-LD file(s), `
      + `<b>${c.in_llms_txt}</b> in llms.txt, <b>${c.in_llms_full}</b> in llms-full.txt — from <b>${r.publishable}</b> publishable document(s).`;
  }

  // ─── small helpers ──
  function fillSelect(sel, opts) { $(sel).innerHTML = opts.map((o) => `<option value="${o}">${o.replace(/_/g, ' ')}</option>`).join(''); }
  async function fetchJson(url) { const r = await fetch(url); return r.json(); }
  async function postJson(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  async function putJson(url, body) { const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cssEsc(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  // ─── Reusable API-key UX (copy this whole function into any Node) ──
  function mountKeyUI(opts = {}) {
    const PROVIDERS = { anthropic: { label: 'Anthropic (Claude)', link: 'https://console.anthropic.com/', hint: 'sk-ant-…' },
                        openai:    { label: 'OpenAI (GPT)',       link: 'https://platform.openai.com/api-keys', hint: 'sk-…' } };
    let picked = 'anthropic';

    const style = document.createElement('style');
    style.textContent = `
      #gk-ov{position:fixed;inset:0;background:rgba(20,20,18,.45);display:none;align-items:center;justify-content:center;z-index:9999;padding:1rem}
      #gk-ov.open{display:flex}
      #gk-card{background:#fff;border:1px solid #e5e3da;border-radius:12px;max-width:440px;width:100%;padding:1.6rem 1.7rem;font-family:inherit;box-shadow:0 10px 40px rgba(0,0,0,.18)}
      #gk-card h2{margin:0 0 .35rem;font-size:1.2rem}
      #gk-card p{color:#6b6b66;font-size:.9rem;margin:.2rem 0 1rem}
      .gk-prov{display:flex;gap:.5rem;margin:.5rem 0 1rem}
      .gk-prov button{flex:1;padding:.6rem;border:1px solid #e5e3da;background:#fff;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.9rem}
      .gk-prov button.sel{border-color:#1d4e8a;background:#eef3f8;font-weight:600}
      #gk-key{width:100%;padding:.6rem .75rem;border:1px solid #e5e3da;border-radius:8px;font-family:inherit;font-size:.95rem}
      #gk-msg{font-size:.85rem;margin:.6rem 0 0;min-height:1.1em}
      #gk-msg.err{color:#8a2c2c}#gk-msg.ok{color:#2c6b35}
      .gk-row{display:flex;gap:.5rem;align-items:center;margin-top:1rem}
      .gk-row .gk-save{background:#1d4e8a;color:#fff;border:none;padding:.6rem 1.1rem;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:500}
      .gk-row .gk-save:disabled{background:#9a9a93}
      .gk-row .gk-ghost{background:none;border:1px solid #e5e3da;color:#1c1c1a;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.88rem}
      .gk-row .gk-spacer{flex:1}
      .gk-link{font-size:.8rem;color:#1d4e8a}`;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'gk-ov';
    ov.innerHTML = `<div id="gk-card">
      <h2 id="gk-title">Add your AI key</h2>
      <p id="gk-sub">Paste your key below — it's saved on this computer only, never uploaded. Nothing to edit by hand.</p>
      <div id="gk-body">
        <div class="gk-prov" id="gk-prov"></div>
        <input type="text" id="gk-key" placeholder="Paste your key" autocomplete="off" />
        <p class="gk-link" id="gk-getlink"></p>
        <p id="gk-msg"></p>
      </div>
      <div class="gk-row" id="gk-actions"></div>
    </div>`;
    document.body.appendChild(ov);

    const el = (id) => ov.querySelector('#' + id);
    const setMsg = (t, kind) => { const m = el('gk-msg'); m.textContent = t || ''; m.className = kind || ''; };
    const renderProviders = () => {
      el('gk-prov').innerHTML = Object.entries(PROVIDERS).map(([k, v]) =>
        `<button data-p="${k}" class="${k === picked ? 'sel' : ''}">${v.label}</button>`).join('');
      el('gk-prov').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        picked = b.dataset.p; renderProviders();
        el('gk-key').placeholder = 'Paste your key (' + PROVIDERS[picked].hint + ')';
        el('gk-getlink').innerHTML = `Don't have one? <a href="${PROVIDERS[picked].link}" target="_blank" rel="noopener">Get a ${PROVIDERS[picked].label} key</a>`;
      }));
      el('gk-key').placeholder = 'Paste your key (' + PROVIDERS[picked].hint + ')';
      el('gk-getlink').innerHTML = `Don't have one? <a href="${PROVIDERS[picked].link}" target="_blank" rel="noopener">Get a ${PROVIDERS[picked].label} key</a>`;
    };

    async function save(required) {
      const key = el('gk-key').value.trim();
      if (!key) { setMsg('Paste your key first.', 'err'); return; }
      const btn = el('gk-savebtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Checking…';
      setMsg('Checking the key with ' + PROVIDERS[picked].label + '…', '');
      try {
        const r = await postJson('api/setup', { provider: picked, apiKey: key });
        if (!r.ok) { setMsg(r.message || 'Could not save the key.', 'err'); return; }
        if (r.warning) { setMsg(r.warning, 'ok'); }
        else { setMsg(r.verified ? '✓ Key works. Saved.' : '✓ Saved.', 'ok'); }
        if (typeof opts.onConfigured === 'function') opts.onConfigured();
        setTimeout(() => { if (required) location.reload(); else close(); }, r.warning ? 1400 : 750);
      } catch (e) { setMsg('Network error: ' + e.message, 'err'); }
      finally { btn.disabled = false; btn.textContent = old; }
    }

    async function removeKey() {
      if (!confirm('Remove the saved key from this computer? You can paste a new one any time.')) return;
      await postJson('api/setup', { provider: null, apiKey: null });
      location.reload();
    }

    function close() { ov.classList.remove('open'); }

    async function open(mode) {
      const status = await fetchJson('api/setup').catch(() => ({}));
      renderProviders();
      el('gk-key').value = '';
      setMsg('', '');
      if (status.serverManaged) {
        el('gk-title').textContent = 'AI key';
        el('gk-sub').textContent = 'When you use this online, the key is managed by Grounded — there’s nothing to set here.';
        el('gk-body').style.display = 'none';
        el('gk-actions').innerHTML = '<div class="gk-spacer"></div><button class="gk-ghost" id="gk-close">Close</button>';
        el('gk-close').addEventListener('click', close);
      } else {
        el('gk-body').style.display = 'block';
        const configured = !!status.configured;
        el('gk-title').textContent = configured ? 'Change your AI key' : 'Add your AI key';
        el('gk-sub').textContent = configured
          ? `A ${status.activeProvider === 'openai' ? 'OpenAI' : 'Anthropic'} key is set. Paste a new one to replace it — saved on this computer only.`
          : 'Paste your key below — saved on this computer only, never uploaded. Nothing to edit by hand.';
        picked = status.activeProvider === 'openai' ? 'openai' : 'anthropic';
        renderProviders();
        const required = mode === 'required';
        el('gk-actions').innerHTML =
          '<button class="gk-save" id="gk-savebtn">Test &amp; save</button>'
          + (configured ? '<button class="gk-ghost" id="gk-remove">Remove key</button>' : '')
          + '<div class="gk-spacer"></div>'
          + (required ? '' : '<button class="gk-ghost" id="gk-close">Close</button>');
        el('gk-savebtn').addEventListener('click', () => save(required));
        el('gk-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(required); });
        if (el('gk-remove')) el('gk-remove').addEventListener('click', removeKey);
        if (el('gk-close')) el('gk-close').addEventListener('click', close);
      }
      ov.classList.add('open');
      setTimeout(() => el('gk-key') && el('gk-key').focus(), 50);
    }

    const trigger = document.getElementById('key-settings');
    if (trigger) trigger.addEventListener('click', (e) => { e.preventDefault(); open('settings'); });

    fetchJson('api/setup').then((s) => {
      if (s && !s.configured && !s.serverManaged) open('required');
      else if (typeof opts.onConfigured === 'function') opts.onConfigured();
    }).catch(() => {});
  }

  boot();
})();
