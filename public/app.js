'use strict';
// All dynamic content is inserted with textContent (never innerHTML) to prevent XSS from webhook payloads.

const $ = (sel) => document.querySelector(sel);
let mode = 'login';
let tab = 'relays';
let selectedEvent = null;
let refreshTimer = null;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'hookrelay', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) { showAuth(); throw new Error('Session expired'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error([].concat(err.message || res.statusText).join(', '));
  }
  return res.status === 204 ? null : res.json();
}

const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }) : '');
const ingestUrl = (slug) => `${location.origin}/in/${slug}`;
const copyBtn = (text) => h('button', { class: 'secondary', type: 'button', onclick: () => navigator.clipboard.writeText(text) }, 'Copy');
const pill = (s) => h('span', { class: `pill ${s}` }, s === 'succeeded' ? 'delivered' : s);
const act = (fn) => async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  try { await fn(); } catch (err) { alert(err.message); } finally { btn.disabled = false; }
};

// ---------- auth ----------
function showAuth() {
  clearInterval(refreshTimer);
  for (const id of ['relays', 'events', 'dead']) $('#' + id).hidden = true;
  $('#tabs').hidden = $('#signout').hidden = true;
  $('#stats').textContent = $('#whoami').textContent = '';
  $('#auth').hidden = false;
}

function setMode(next) {
  mode = next;
  const login = mode === 'login';
  $('#auth-title').textContent = $('#auth-submit').textContent = login ? 'Sign in' : 'Create account';
  $('#auth-switch-text').textContent = login ? 'No account?' : 'Already have an account?';
  $('#auth-switch').textContent = login ? 'Create one' : 'Sign in';
  $('#password').placeholder = login ? 'Password' : 'Password (10+ characters)';
  $('#password').autocomplete = login ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}
$('#auth-switch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

$('#auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const user = await api('POST', `/api/auth/${mode}`, { email: $('#email').value, password: $('#password').value });
    $('#password').value = ''; $('#auth-error').textContent = '';
    start(user);
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#signout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  selectedEvent = null;
  showAuth();
});

function start(user) {
  $('#auth').hidden = true;
  $('#whoami').textContent = user.email;
  $('#tabs').hidden = $('#signout').hidden = false;
  show(tab);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refreshStats(); if (tab === 'events') loadEvents(); if (tab === 'dead') loadDead(); }, 5000);
}

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
function show(name) {
  tab = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const id of ['relays', 'events', 'dead']) $('#' + id).hidden = id !== name;
  refreshStats();
  ({ relays: loadRelays, events: loadEvents, dead: loadDead })[name]();
}

async function refreshStats() {
  const s = await api('GET', '/api/stats').catch(() => null);
  if (!s) return;
  $('#stats').textContent = `Last 24h: ${s.succeeded} delivered · ${s.retrying + s.pending} in flight · ${s.dead} dead`;
}

// ---------- relays ----------
$('#new-relay').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('POST', '/api/sources', { name: f.name.value, destinationUrl: f.url.value, requireSignature: f.sign.checked });
    f.reset();
    showSecrets(r.name, [
      ['Ingest URL', ingestUrl(r.slug)],
      r.inboundSecret && ['Inbound secret (sign requests with X-Signature-256)', r.inboundSecret],
      r.destination && ['Destination signing secret', r.destination.signingSecret],
    ]);
    loadRelays();
  } catch (err) { alert(err.message); }
});

function showSecrets(title, rows) {
  $('#secrets').replaceChildren(h('div', { class: 'card secret' },
    h('div', { class: 'relay-head' }, h('h2', {}, title), h('button', { class: 'link', onclick: () => $('#secrets').replaceChildren() }, 'Dismiss')),
    h('p', { class: 'muted' }, 'Copy secrets now. They are not shown again.'),
    rows.filter(Boolean).map(([label, value]) => h('div', { class: 'dest' }, h('span', { class: 'muted' }, label), h('code', {}, value), copyBtn(value))),
  ));
}

async function loadRelays() {
  const sources = await api('GET', '/api/sources');
  $('#relay-list').replaceChildren(...(sources.length ? sources.map(relayCard) : [h('p', { class: 'muted' }, 'No relays yet. Create one above.')]));
}

function relayCard(s) {
  const transform = h('textarea', { placeholder: '{ "type": "$.event", "id": "$.data.id" }' });
  transform.value = s.transform ? JSON.stringify(s.transform, null, 2) : '';
  const newDest = h('input', { placeholder: 'Add destination https://…' });

  return h('div', { class: 'card' },
    h('div', { class: 'relay-head' },
      h('h2', {}, s.name),
      !s.enabled && h('span', { class: 'pill dead' }, 'paused'),
      h('button', { class: 'secondary', onclick: act(async () => { await api('PATCH', `/api/sources/${s.id}`, { enabled: !s.enabled }); loadRelays(); }) }, s.enabled ? 'Pause' : 'Resume'),
      h('button', { class: 'danger', onclick: act(async () => { if (confirm(`Delete "${s.name}" and all its events?`)) { await api('DELETE', `/api/sources/${s.id}`); loadRelays(); } }) }, 'Delete'),
    ),
    h('div', { class: 'dest' }, h('span', { class: 'muted' }, 'Ingest'), h('code', {}, ingestUrl(s.slug)), copyBtn(ingestUrl(s.slug))),
    s.destinations.map((d) => h('div', { class: 'dest' },
      h('span', { class: 'muted' }, 'Forward'),
      h('code', {}, d.url),
      !d.enabled && h('span', { class: 'pill dead' }, 'off'),
      h('button', { class: 'secondary', onclick: act(async () => { await api('PATCH', `/api/destinations/${d.id}`, { enabled: !d.enabled }); loadRelays(); }) }, d.enabled ? 'Disable' : 'Enable'),
      h('button', { class: 'secondary', onclick: act(async () => { const r = await api('POST', `/api/destinations/${d.id}/rotate-secret`); showSecrets(`New signing secret for ${d.url}`, [['Signing secret', r.signingSecret]]); }) }, 'Rotate secret'),
      h('button', { class: 'danger', onclick: act(async () => { if (confirm('Remove destination and its delivery history?')) { await api('DELETE', `/api/destinations/${d.id}`); loadRelays(); } }) }, 'Remove'),
    )),
    h('form', { class: 'row', style: 'margin:10px 0 0', onsubmit: async (e) => {
      e.preventDefault();
      try { const r = await api('POST', `/api/sources/${s.id}/destinations`, { url: newDest.value }); showSecrets(`Added ${r.url}`, [['Signing secret', r.signingSecret]]); loadRelays(); } catch (err) { alert(err.message); }
    } }, newDest, h('button', { class: 'secondary' }, 'Add')),
    h('details', {},
      h('summary', {}, `Settings${s.transform ? ' · transform on' : ''}${s.requiresSignature ? ' · signed' : ''}`),
      h('h3', {}, 'Transform (optional): map fields with "$.path", other values are literals'),
      transform,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'secondary', onclick: act(async () => {
          let spec; try { spec = transform.value.trim() ? JSON.parse(transform.value) : null; } catch { throw new Error('Transform must be valid JSON'); }
          await api('PATCH', `/api/sources/${s.id}`, spec ? { transform: spec } : { clearTransform: true }); loadRelays();
        }) }, 'Save transform'),
        s.requiresSignature
          ? h('button', { class: 'secondary', onclick: act(async () => { await api('DELETE', `/api/sources/${s.id}/secret`); loadRelays(); }) }, 'Stop requiring signatures')
          : h('button', { class: 'secondary', onclick: act(async () => { const r = await api('POST', `/api/sources/${s.id}/rotate-secret`); showSecrets(`Inbound secret for ${s.name}`, [['Inbound secret', r.inboundSecret]]); loadRelays(); }) }, 'Require signatures'),
        s.requiresSignature && h('button', { class: 'secondary', onclick: act(async () => { const r = await api('POST', `/api/sources/${s.id}/rotate-secret`); showSecrets(`New inbound secret for ${s.name}`, [['Inbound secret', r.inboundSecret]]); }) }, 'Rotate inbound secret'),
      ),
    ),
  );
}

// ---------- events ----------
$('#status-filter').addEventListener('change', loadEvents);

async function loadEvents() {
  const status = $('#status-filter').value;
  const rows = await api('GET', `/api/events?limit=100${status ? `&status=${status}` : ''}`);
  $('#event-list').replaceChildren(
    h('tr', {}, h('th', {}, 'Received'), h('th', {}, 'Relay'), h('th', {}, 'Status')),
    ...(rows.length ? rows.map((r) => h('tr', { class: `clickable${r.id === selectedEvent ? ' selected' : ''}`, onclick: () => openEvent(r.id) },
      h('td', {}, fmtTime(r.receivedAt)), h('td', {}, r.sourceName), h('td', {}, r.statuses.length ? r.statuses.map(pill) : h('span', { class: 'muted' }, 'no destinations')),
    )) : [h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'No events yet. POST to a relay\'s ingest URL.'))]),
  );
  if (selectedEvent) openEvent(selectedEvent, true);
}

async function openEvent(id, quiet) {
  selectedEvent = id;
  if (!quiet) document.querySelectorAll('#event-list tr').forEach((tr) => tr.classList.remove('selected'));
  const e = await api('GET', `/api/events/${id}`);
  let body = e.body; try { body = JSON.stringify(JSON.parse(e.body), null, 2); } catch {}
  $('#event-detail').replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'relay-head' }, h('h2', {}, e.source.name), h('button', { onclick: act(async () => { await api('POST', `/api/events/${id}/replay`); openEvent(id); }) }, 'Replay event')),
    h('p', { class: 'muted' }, `${fmtTime(e.receivedAt)} · ${e.id}${e.idempotencyKey ? ` · key ${e.idempotencyKey}` : ''}`),
    h('h3', {}, 'Payload'), h('pre', {}, body),
    h('details', {}, h('summary', {}, 'Headers'), h('pre', {}, JSON.stringify(e.headers, null, 2))),
    h('h3', {}, 'Deliveries'),
    e.deliveries.length ? e.deliveries.map((d) => h('div', { class: 'card' },
      h('div', { class: 'relay-head' },
        h('code', { style: 'flex:1' }, d.url), pill(d.status),
        d.status === 'dead' && !d.replayedAt && h('button', { class: 'secondary', onclick: act(async () => { await api('POST', `/api/deliveries/${d.id}/replay`); openEvent(id); }) }, 'Retry'),
      ),
      d.replayOf && h('p', { class: 'muted' }, 'Replay of an earlier delivery'),
      d.status === 'retrying' && d.nextAttemptAt && h('p', { class: 'muted' }, `Next attempt ${fmtTime(d.nextAttemptAt)}`),
      d.attempts.length ? h('table', {},
        h('tr', {}, h('th', {}, '#'), h('th', {}, 'Time'), h('th', {}, 'Result'), h('th', {}, 'ms')),
        d.attempts.map((a) => h('tr', { title: a.responseBody || '' },
          h('td', {}, a.attemptNumber), h('td', {}, fmtTime(a.createdAt)), h('td', {}, a.statusCode ? `HTTP ${a.statusCode}` : a.error), h('td', {}, a.durationMs))),
      ) : h('p', { class: 'muted' }, d.lastError || 'Waiting for first attempt…'),
    )) : h('p', { class: 'muted' }, 'This relay has no destinations.'),
  ));
}

// ---------- dead letters ----------
$('#replay-all').addEventListener('click', act(async () => { const r = await api('POST', '/api/dead-letters/replay'); alert(`Replaying ${r.replayed} deliveries`); loadDead(); }));

async function loadDead() {
  const rows = await api('GET', '/api/dead-letters');
  $('#dead-count').textContent = rows.length ? String(rows.length) : '';
  $('#replay-all').disabled = !rows.length;
  $('#dead-list').replaceChildren(
    h('tr', {}, h('th', {}, 'Failed'), h('th', {}, 'Relay'), h('th', {}, 'Destination'), h('th', {}, 'Reason'), h('th', {}, '')),
    ...(rows.length ? rows.map((d) => h('tr', {},
      h('td', {}, fmtTime(d.updatedAt)), h('td', {}, d.sourceName), h('td', {}, h('code', {}, d.url)),
      h('td', {}, `${d.lastError || ''} (${d.attempts} attempt${d.attempts === 1 ? '' : 's'})`),
      h('td', {}, h('button', { class: 'secondary', onclick: act(async () => { await api('POST', `/api/deliveries/${d.id}/replay`); loadDead(); }) }, 'Replay')),
    )) : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nothing here. Failed deliveries land here after all retries.'))]),
  );
}

api('GET', '/api/auth/me').then(start, () => { setMode('login'); showAuth(); });
