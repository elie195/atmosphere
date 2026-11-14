// Atmosphere popup: shows live status from the active Netflix tab's content script.
// Opened outside Safari (no extension API), it renders demo data for previewing.
const api = globalThis.browser;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { requestAtmos: true, prime: true, debug: false };

let tabId = null;
let lastLogs = [];

const DEMO = {
  settings: { ...DEFAULTS, debug: true },
  state: {
    hooks: true, requested: true, active: true,
    playing: { jocFlag: 1, dataRateKbps: 768, complexityIndex: 16, label: 'Dolby Atmos' },
    primed: 'ok', primeSource: 'extension',
    switches: [{ t: Date.now() - 2000, from: 'Dolby Digital Plus 5.1 448 kbps', to: 'Dolby Atmos 768 kbps', gainedAtmos: true }],
  },
  logs: [
    { t: Date.now() - 9000, kind: 'hooks', msg: 'Hooks installed' },
    { t: Date.now() - 7000, kind: 'prime', msg: "Primed Safari's Atmos mode (click, extension clip)" },
    { t: Date.now() - 6000, kind: 'profiles', msg: 'Asked Netflix for Atmos', count: 4 },
    { t: Date.now() - 5000, kind: 'manifest', msg: 'Stream list includes Atmos' },
    { t: Date.now() - 4000, kind: 'sourcebuffer', msg: 'Player opened an audio stream' },
    { t: Date.now() - 3000, kind: 'header', msg: 'Audio: Dolby Digital Plus 5.1 (448 kbps)' },
    { t: Date.now() - 2000, kind: 'switch', msg: 'Stream changed mid-playback: Dolby Digital Plus 5.1 448 kbps → Dolby Atmos 768 kbps' },
  ],
};

async function send(msg) {
  if (!api) return msg.dolby === 'get' ? DEMO : {};
  if (tabId == null) {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tab ? tab.id : null;
  }
  if (tabId == null) throw new Error('no tab');
  return api.tabs.sendMessage(tabId, msg);
}

function setStep(id, cls, note) {
  const li = $(id);
  li.className = cls;
  li.querySelector('small').textContent = note || '';
}

function render({ state, logs, settings }) {
  $('away').hidden = true;
  $('steps').hidden = false;
  $('t-request').checked = settings.requestAtmos;
  $('t-prime').checked = settings.prime;
  $('t-debug').checked = !!settings.debug;
  $('logs').hidden = !settings.debug;

  setStep('s-requested', state.requested ? 'ok' : settings.requestAtmos ? 'wait' : 'warn',
    state.requested ? 'Dolby 5.1 + Atmos added to the request' : settings.requestAtmos ? 'Happens when a title starts' : 'Turned off');

  const p = state.playing;
  const live = !!state.active;
  let cls = 'wait', note = 'Nothing playing';
  if (p && live && p.tentative && p.codec === 'eac3') {
    note = 'Dolby Digital Plus · checking for Atmos…';
  } else if (p && live) {
    cls = p.jocFlag ? 'ok' : 'warn';
    const kbps = p.dataRateKbps ? ` · ${p.dataRateKbps} kbps` : '';
    note = p.jocFlag ? `Dolby Atmos${kbps}` : `${p.label || 'Non-Atmos audio'}${kbps} · no Atmos for this title`;
  } else if (p) {
    note = `Paused · ${p.label || (p.jocFlag ? 'Dolby Atmos' : 'audio')} loaded`;
  } else if (live) {
    note = 'Waiting for the audio stream';
  }
  const sw = (state.switches || [])[state.switches ? state.switches.length - 1 : 0];
  if (sw) {
    const at = new Date(sw.t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const more = state.switches.length > 1 ? ` (${state.switches.length} changes)` : '';
    note += `\n↳ Changed at ${at} from ${sw.from}${more}`;
    if (sw.lostAtmos && cls === 'warn') note += '\nNetflix dropped Atmos, often due to bandwidth';
  }
  setStep('s-playing', cls, note);

  setStep('s-primed', state.primed === 'ok' ? 'ok' : state.primed === 'failed' || state.primed === 'off' ? 'warn' : 'wait',
    state.primed === 'ok' ? `Primed with the ${state.primeSource} clip`
      : state.primed === 'failed' ? "Couldn't prime: try Prime now"
      : state.primed === 'off' ? 'Priming turned off' : 'Primes on your first click');

  const atmosLive = live && !!(p && p.jocFlag);
  const badge = $('badge');
  badge.className = 'badge ' + (atmosLive ? 'ok' : live && p ? 'warn' : '');
  $('badgeText').textContent = atmosLive ? 'Atmos is on'
    : live && p ? 'Playing ' + (p.label ? p.label.replace(/^Dolby Digital Plus /, 'Dolby ') : 'without Atmos')
    : p ? 'Paused'
    : state.hooks ? 'Ready: start a title' : 'Loading…';
  $('eq').classList.toggle('live', atmosLive);

  renderLogs(logs);
}

function renderLogs(logs) {
  lastLogs = logs;
  $('logCount').textContent = logs.length;
  const ul = $('logList');
  const atBottom = ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 4;
  ul.replaceChildren(...(logs.length ? logs : [null]).map((l) => {
    const li = document.createElement('li');
    if (!l) { li.className = 'empty'; li.textContent = 'No events yet'; return li; }
    const time = document.createElement('time');
    time.textContent = new Date(l.t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const kind = document.createElement('span');
    kind.className = 'kind ' + l.kind;
    kind.textContent = l.kind;
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = l.msg + (l.count > 1 ? `  ×${l.count}` : '');
    li.append(time, kind, msg);
    return li;
  }));
  if (atBottom) ul.scrollTop = ul.scrollHeight;
}

async function activeTab() {
  if (!api) return null;
  try { const [tab] = await api.tabs.query({ active: true, currentWindow: true }); return tab || null; } catch { return null; }
}

async function showAway() {
  const tab = await activeTab();
  // Safari only reveals the URL for sites the extension may access.
  const onNetflix = !!(tab && tab.url && /^https:\/\/www\.netflix\.com\//.test(tab.url));
  $('away').hidden = false;
  $('steps').hidden = true;
  $('reloadTab').hidden = !onNetflix;
  $('awayTitle').textContent = onNetflix ? "Atmosphere isn't connected to this tab" : 'Open a Netflix tab';
  $('awayText').textContent = onNetflix
    ? 'This usually happens after Atmosphere updates. Reload the tab to reconnect.'
    : "Status and logs appear here while Netflix is the active tab. On Netflix already? Check that Atmosphere is allowed on netflix.com (click the extension's icon, or Safari Settings → Websites → Extensions).";
  $('badge').className = 'badge warn';
  $('badgeText').textContent = onNetflix ? 'Reload needed' : 'Not on Netflix';
  $('eq').classList.remove('live');
  renderLogs([]);
}

async function refresh() {
  try { render(await send({ dolby: 'get' })); } catch { tabId = null; await showAway(); }
}

async function saveSettings() {
  const settings = { requestAtmos: $('t-request').checked, prime: $('t-prime').checked, debug: $('t-debug').checked };
  if (api) await api.storage.local.set(settings);
  try { await send({ dolby: 'settings', settings }); } catch { /* not on Netflix */ }
  refresh();
}

$('reloadTab').addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab) { tabId = null; await api.tabs.reload(tab.id); }
  window.close();
});

$('t-request').addEventListener('change', saveSettings);
$('t-prime').addEventListener('change', saveSettings);
$('t-debug').addEventListener('change', saveSettings);

$('primeNow').addEventListener('click', async () => {
  const b = $('primeNow');
  b.disabled = true; b.textContent = 'Priming…';
  try { await send({ dolby: 'prime' }); } catch { /* ignore */ }
  b.disabled = false; b.textContent = '✦ Prime now';
  refresh();
});

$('copy').addEventListener('click', async (e) => {
  e.preventDefault();
  const text = lastLogs.map((l) => `${new Date(l.t).toISOString()} [${l.kind}] ${l.msg}` + (l.count > 1 ? ` x${l.count}` : '') +
    (l.data ? ' ' + JSON.stringify(l.data) : '')).join('\n');
  try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Failed'; }
  setTimeout(() => (e.target.textContent = 'Copy'), 1200);
});

$('clear').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await send({ dolby: 'clear' }); } catch { /* ignore */ }
  refresh();
});

(async () => {
  if (api) {
    try { const s = await api.storage.local.get(DEFAULTS); $('t-request').checked = s.requestAtmos; $('t-prime').checked = s.prime; $('t-debug').checked = s.debug; $('logs').hidden = !s.debug; } catch { /* ignore */ }
  }
  refresh();
  setInterval(refresh, 1000);
})();
