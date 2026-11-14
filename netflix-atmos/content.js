// Isolated-world content script on netflix.com.
// - Injects dec3.js and page.js into Netflix's own JS context.
// - Primes Safari's Dolby Atmos output mode (see prime()).
// - Collects status and logs from page.js for the toolbar popup.
const TAG = '[DolbyAudio]';
const DEFAULTS = { requestAtmos: true, prime: true, debug: false };
let settings = { ...DEFAULTS };

const state = {
  hooks: false,        // page.js running
  requested: false,    // Atmos added to at least one Netflix request on this page
  playing: null,       // header of the audio stream currently loaded in the player
  primed: null,        // null = not yet, 'ok', 'failed', 'off'
  primeSource: null,
  switches: [],        // mid-playback stream changes: { t, from, to }
};
const debugConsole = (...a) => { if (settings.debug) console.info(TAG, ...a); };
const describe = (p) => p.label + (p.dataRateKbps ? ` ${p.dataRateKbps} kbps` : '');
const logs = [];
const video = createVideoTracker();
// Repeated identical events (Netflix sends many requests) collapse into one line with a count.
function log(kind, msg, data) {
  if (!settings.debug) return; // debug mode off: keep no logs
  const last = logs[logs.length - 1];
  if (last && last.kind === kind && last.msg === msg) {
    last.count = (last.count || 1) + 1;
    last.t = Date.now();
    return;
  }
  logs.push({ t: Date.now(), kind, msg, data: data === undefined ? null : data, count: 1 });
  try {
    const text = data === undefined || data === null ? '' : (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 4000);
    browser.runtime.sendMessage({ atmosLog: { site: 'netflix', kind, msg, text } });
  } catch (e) { /* ignore */ }
  if (logs.length > 200) logs.shift();
}

// Is any Netflix <video> actually playing right now?
function isPlaying() {
  return [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2);
}

// Settings page.js reads from <html> data attributes.
function applySettingsToPage() {
  document.documentElement.dataset.dolbyRequest = settings.requestAtmos ? 'on' : 'off';
  document.documentElement.dataset.dolbyDebug = settings.debug ? 'on' : 'off';
}
// Default synchronously so page.js never misses the first request.
applySettingsToPage();
const settingsReady = browser.storage.local.get(DEFAULTS).then((s) => {
  settings = { ...DEFAULTS, ...s };
  applySettingsToPage();
  if (!settings.prime) state.primed = 'off';
}).catch(() => {});

for (const file of ['dec3.js', 'page.js']) {
  const s = document.createElement('script');
  s.src = browser.runtime.getURL(file);
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || !e.data.__dolbyAudio) return;
  const { kind, msg, data } = e.data;
  if (kind === 'hooks') state.hooks = true;
  if (kind === 'profiles') state.requested = true;
  // A new audio stream is opening (new title or episode). Until its header is read,
  // show a provisional answer from the stream type the player declared.
  if (kind === 'videotype') video.setCodec(data);
  if (kind === 'sourcebuffer') {
    state.switches = [];
    video.reset();
    const t = String(data || '');
    state.playing = /ec-3|ec\+3/.test(t) ? { tentative: true, codec: 'eac3', jocFlag: 0, label: 'Dolby Digital Plus' }
      : /ac-3/.test(t) ? { tentative: true, codec: 'ac3', jocFlag: 0, label: 'Dolby Digital' }
      : /mp4a|aac/.test(t) ? { tentative: true, codec: 'aac', jocFlag: 0, label: 'AAC stereo' }
      : null;
  }
  if (kind === 'header') {
    // A new header while a confirmed stream is already loaded means the stream
    // changed mid-playback (quality drop/raise, language or codec change).
    const before = state.playing;
    if (before && !before.tentative && describe(before) !== describe(data)) {
      const sw = { t: Date.now(), from: describe(before), to: describe(data), lostAtmos: !!before.jocFlag && !data.jocFlag, gainedAtmos: !before.jocFlag && !!data.jocFlag };
      state.switches.push(sw);
      if (state.switches.length > 20) state.switches.shift();
      log('switch', `Stream changed mid-playback: ${sw.from} → ${sw.to}`, sw);
      debugConsole('stream changed', sw);
    }
    state.playing = data;
  }
  if (kind === 'codecswitch' && state.playing) state.playing = { ...state.playing, tentative: false };
  log(kind, msg, data);
});

// Atmos priming. Safari only switches its audio output into Dolby Atmos mode
// when Atmos plays through its direct (non-MSE) player; Netflix uses MSE, so on
// a fresh Safari it stays "Multichannel". Playing a few seconds of a known Atmos
// clip, almost silently, through the direct player flips Safari into Atmos mode,
// and Netflix's playback then stays in it.
const SOURCES = [
  browser.runtime.getURL('prime.mp4'),
  'https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/DASH/OnDemand_MPD/Fragment_Audio/ChID_voices_Atmos_6ch_640kbps_ddp_joc.mp4',
];
const PLAY_MS = 3000;
let priming = false;

async function playClip(src) {
  const a = new Audio();
  a.preload = 'auto';
  a.volume = 0.001; // near-silent; fully muted may not engage the Atmos route
  a.src = src;
  await a.play();
  await new Promise((r) => setTimeout(r, PLAY_MS));
  a.pause();
  a.removeAttribute('src');
  a.load();
}

async function prime(reason, force = false) {
  await settingsReady;
  if (priming || (!force && (state.primed === 'ok' || !settings.prime))) return state.primed;
  priming = true;
  let lastErr = '';
  for (const src of SOURCES) {
    const where = src.startsWith('https') ? 'dolby.com' : 'extension';
    try {
      await playClip(src);
      state.primed = 'ok';
      state.primeSource = where;
      debugConsole(`Atmos priming played (${reason}) from ${where}`);
      log('prime', `Primed Safari's Atmos mode (${reason}, ${where} clip)`);
      break;
    } catch (e) {
      lastErr = `${e.name}: ${e.message}`;
      debugConsole(`Atmos priming failed from ${where} - ${lastErr}`);
    }
  }
  if (state.primed !== 'ok') {
    if (reason === 'page load') {
      // Normal: Safari blocks sound until you interact with the page.
      log('prime', 'Will prime on your first click (Safari blocks sound before that)');
    } else {
      state.primed = 'failed';
      log('prime', `Couldn't prime (${reason}): ${lastErr}`);
    }
  }
  priming = false;
  return state.primed;
}

window.addEventListener('DOMContentLoaded', () => prime('page load'), { once: true });
for (const ev of ['pointerdown', 'keydown'])
  window.addEventListener(ev, () => prime('click'), { capture: true });

// Popup API
browser.runtime.onMessage.addListener((m) => {
  if (!m || !m.dolby) return;
  if (m.dolby === 'get') return Promise.resolve({ site: 'netflix', state: { ...state, active: isPlaying(), video: video.snapshot() }, logs, settings });
  if (m.dolby === 'prime') return prime('popup', true).then((r) => ({ primed: r }));
  if (m.dolby === 'clear') { logs.length = 0; return Promise.resolve({ ok: true }); }
  if (m.dolby === 'settings') {
    settings = { ...settings, ...m.settings };
    applySettingsToPage();
    if (!settings.debug) logs.length = 0;
    if (!settings.prime && state.primed !== 'ok') state.primed = 'off';
    if (settings.prime && state.primed === 'off') state.primed = null;
    return Promise.resolve({ ok: true });
  }
});
