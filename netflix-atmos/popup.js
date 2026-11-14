// Atmosphere popup: shows live status from the active Netflix tab's content script.
// Opened outside Safari (no extension API), it renders demo data for previewing.
const api = globalThis.browser;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { requestAtmos: true, prime: true, debug: false, disneyQuality: 'max', disneyRange: 'dv' };

let tabId = null;
let lastLogs = [];

const DEMO_SITE = new URLSearchParams(location.search).get('site') || 'netflix';
const DEMO = {
  site: DEMO_SITE,
  settings: { ...DEFAULTS, debug: true },
  state: {
    hooks: true, requested: true, active: true,
    playing: { jocFlag: 1, dataRateKbps: 768, complexityIndex: 16, label: 'Dolby Atmos' },
    primed: 'ok', primeSource: 'extension',
    switches: [{ t: Date.now() - 2000, from: 'Dolby Digital Plus 5.1 448 kbps', to: 'Dolby Atmos 768 kbps', gainedAtmos: true }],
    video: { width: 3840, height: 2160, label: '4K', codec: 'dvh1.05.06', range: DEMO_SITE === 'disney' ? 'Dolby Vision' : 'SDR',
      format: 'HEVC', dropped: 12, total: 4210, switches: [{ t: Date.now() - 6000, from: '480p', to: '4K' }] },
    qualityFloor: { floor: '2160', kept: [2160] },
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

const SITES = {
  netflix: { name: 'Netflix', theme: '', requested: 'Asked Netflix for Atmos', desc: "Add Dolby audio to Netflix's request" },
  disney: { name: 'Disney+', theme: 'theme-disney', requested: 'Asked Disney+ for Atmos', desc: 'Add Atmos, 4K and HDR to Disney+\'s request' },
};
function applySite(site) {
  const s = SITES[site] || SITES.netflix;
  document.body.className = s.theme;
  $('subtitle').textContent = `Dolby Atmos for ${s.name} in Safari`;
  $('requestedTitle').textContent = s.requested;
  $('requestDesc').textContent = s.desc;
  $('disneyCard').hidden = site !== 'disney';
}

function render({ site, state, logs, settings }) {
  site = site || 'netflix';
  applySite(site);
  $('away').hidden = true;
  $('steps').hidden = false;
  $('t-request').checked = settings.requestAtmos;
  $('t-prime').checked = settings.prime;
  $('t-debug').checked = !!settings.debug;
  $('logs').hidden = !settings.debug;

  const requestedNote = site === 'disney'
    ? `Atmos, up to 4K, ${({ dv: 'Dolby Vision', hdr10: 'HDR10', sdr: 'SDR' })[settings.disneyRange] || 'HDR'}`
    : 'Dolby 5.1 + Atmos added to the request';
  setStep('s-requested', state.requested ? 'ok' : settings.requestAtmos ? 'wait' : 'warn',
    state.requested ? requestedNote : settings.requestAtmos ? 'Happens when a title starts' : 'Turned off');

  const v = state.video;
  if (v) {
    const fmt = (t) => new Date(t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = [v.height && `${v.label} (${v.width}x${v.height})`, v.range, v.format].filter(Boolean);
    let vnote = parts.length ? parts.join(' · ') : 'Nothing playing';
    if (v.total > 0 && v.dropped > 0) vnote += `\nDropped ${v.dropped} of ${v.total} frames`;
    const vsw = v.switches && v.switches[v.switches.length - 1];
    if (vsw) vnote += `\n↳ Changed at ${fmt(vsw.t)} from ${vsw.from}${v.switches.length > 1 ? ` (${v.switches.length} changes)` : ''}`;
    if (site === 'disney') {
      const floor = settings.disneyQuality;
      if (floor === 'max') vnote += '\nQuality: Highest';
      else if (floor !== 'auto') vnote += `\nQuality floor: ${floor === '2160' ? '4K' : floor + 'p'}`;
    }
    setStep('s-video', v.height ? (v.height >= 1080 ? 'ok' : 'warn') : 'wait', vnote);
  }

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
    if (sw.lostAtmos && cls === 'warn') note += `\n${SITES[site].name} dropped Atmos, often due to bandwidth`;
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
  const url = (tab && tab.url) || '';
  const site = /^https:\/\/www\.netflix\.com\//.test(url) ? 'netflix' : /^https:\/\/([a-z0-9-]+\.)*disneyplus\.com\//.test(url) ? 'disney' : null;
  applySite(site || 'netflix');
  $('subtitle').textContent = 'Dolby Atmos for Netflix and Disney+ in Safari';
  $('disneyCard').hidden = site !== 'disney';
  $('away').hidden = false;
  $('steps').hidden = true;
  $('reloadTab').hidden = !site;
  $('awayTitle').textContent = site ? "Atmosphere isn't connected to this tab" : 'Open Netflix or Disney+';
  $('awayText').textContent = site
    ? 'This usually happens after Atmosphere updates. Reload the tab to reconnect.'
    : "Status and logs appear here while Netflix or Disney+ is the active tab. Already there? Check that Atmosphere is allowed on the site (click the extension's icon, or Safari Settings → Websites → Extensions).";
  $('badge').className = 'badge warn';
  $('badgeText').textContent = site ? 'Reload needed' : 'Not on a supported site';
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

// Disney+ video settings (stored; read by disney-content.js when a title starts).
(async () => {
  const VDEF = { disneyQuality: 'max', disneyRange: 'dv' };
  let v = VDEF;
  if (api) { try { v = await api.storage.local.get(VDEF); } catch { /* ignore */ } }
  const QDESC = {
    max: 'Best resolution the title has, within seconds',
    auto: "Disney+'s own quality choice (starts low)",
    2160: '4K, or the best the title has', 1440: 'At least 1440p',
    1080: 'At least 1080p', 720: 'At least 720p',
  };

  $('s-quality').value = v.disneyQuality;
  $('s-range').value = v.disneyRange;
  $('qualityDesc').textContent = QDESC[v.disneyQuality] || '';
  $('s-quality').addEventListener('change', () => { $('qualityDesc').textContent = QDESC[$('s-quality').value] || ''; });
  const save = () => api && api.storage.local.set({ disneyQuality: $('s-quality').value, disneyRange: $('s-range').value });
  $('s-quality').addEventListener('change', save);
  $('s-range').addEventListener('change', save);
})();
