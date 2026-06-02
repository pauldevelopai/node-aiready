// AI Ready Archive — dashboard JS. Plain vanilla, relative API paths.
//
// The API-KEY UX lives in mountKeyUI() below — a self-contained component you can
// drop into any Node's app.js: a first-run gate (no key → blocking setup) and an
// always-available Settings modal (change/remove the key, switch provider, with
// live validation). Nobody edits .env by hand. To reuse: copy mountKeyUI() and
// call it once on boot.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  async function boot() {
    // Always show the app; the key UI gates on top if a key is needed.
    $('#app').style.display = 'block';
    wireApp();
    mountKeyUI({ onConfigured: () => { /* re-enable AI features here if you gate them */ } });
  }

  function wireApp() {
    $('#save-btn').addEventListener('click', saveNote);
    loadItems();
  }

  // ─── Demo feature (replace with your Node's) ─────────────────────
  async function saveNote() {
    const ta = $('#note');
    const text = ta.value.trim();
    const status = $('#save-status');
    if (!text) { status.textContent = 'Type something first.'; return; }
    $('#save-btn').disabled = true; status.textContent = 'Saving…';
    try {
      const r = await postJson('api/items', { text });
      if (!r.ok) { status.textContent = r.message || 'Could not save.'; return; }
      ta.value = ''; status.textContent = 'Saved.';
      loadItems();
    } catch (e) { status.textContent = 'Network error: ' + e.message; }
    finally { $('#save-btn').disabled = false; }
  }

  async function loadItems() {
    const box = $('#items');
    const r = await fetchJson('api/items').catch(() => ({ items: [] }));
    const items = r.items || [];
    box.innerHTML = items.length
      ? items.map((it) => `<div class="item"><div class="when">${new Date(it.created_at).toLocaleString()}</div><div>${escapeHtml(it.text)}</div></div>`).join('')
      : '<span class="empty">No notes yet. Add the first one above.</span>';
  }

  // ─── Reusable API-key UX (copy this whole function into any Node) ──
  function mountKeyUI(opts = {}) {
    const PROVIDERS = { anthropic: { label: 'Anthropic (Claude)', link: 'https://console.anthropic.com/', hint: 'sk-ant-…' },
                        openai:    { label: 'OpenAI (GPT)',       link: 'https://platform.openai.com/api-keys', hint: 'sk-…' } };
    let picked = 'anthropic';

    // One-time styles + DOM
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

    // Wire a settings trigger if the page has one.
    const trigger = document.getElementById('key-settings');
    if (trigger) trigger.addEventListener('click', (e) => { e.preventDefault(); open('settings'); });

    // First-run gate: no key + not server-managed → require one now.
    fetchJson('api/setup').then((s) => {
      if (s && !s.configured && !s.serverManaged) open('required');
      else if (typeof opts.onConfigured === 'function') opts.onConfigured();
    }).catch(() => {});
  }

  // ─── Helpers ──
  async function fetchJson(url) { const r = await fetch(url); return r.json(); }
  async function postJson(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  boot();
})();
