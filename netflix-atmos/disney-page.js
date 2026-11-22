// Disney+ diagnostics (read-only). Runs in the page's JS world on disneyplus.com and
// records how the player delivers audio, without changing anything:
//  - MSE vs Safari's native HLS player
//  - HLS playlists the page fetches itself: audio renditions (codecs, CHANNELS, JOC)
//  - audio capability checks the player makes (isTypeSupported, decodingInfo)
//  - the audio stream header actually appended (codec, channels, Atmos flag)
//  - DRM key system requested
// Output goes to the console as [Atmosphere/Disney+] lines, only when Debug mode is on.
(() => {
  // Already installed (disney-content.js was injected again, e.g. by the popup after the
  // extension was enabled or updated): don't hook twice; the content script asks for a replay.
  if (window.__atmosphereDisneyHooks) return;
  window.__atmosphereDisneyHooks = true;
  const TAG = '[Atmosphere/Disney+]';
  const on = () => document.documentElement.dataset.dolbyDebug === 'on';
  const seen = new Set();
  // Structured status for the popup (always sent; not gated on Debug mode). The latest event
  // of each status kind is replayed when a (re-)injected content script says hello.
  const REPLAY = ['hooks', 'requested', 'quality', 'audioOpen', 'videoOpen', 'header'];
  const latest = {};
  const post = (kind, data) => {
    try { window.postMessage({ __atmosEvent: true, kind, data }, location.origin); } catch (e) { /* ignore */ }
  };
  const event = (kind, data) => {
    if (REPLAY.includes(kind)) {
      latest[kind] = data;
      if (kind === 'audioOpen') delete latest.header; // a new audio stream supersedes the old header
    }
    post(kind, data);
  };
  // Which audio buffer the status describes, so we can tell when the player closes it
  // (left the title). A buffer removed from its MediaSource throws on .buffered; this works
  // however the player attached the stream (blob: src or srcObject), unlike DOM checks.
  // Fallback for a player that is just removed from the page with its stream still attached:
  // once its <video> has been in the document, no <video> for 2 s also means it's gone.
  let currentAudio = null, seenVideo = false, noVideo = 0;
  const track = (sb) => { currentAudio = sb; seenVideo = false; noVideo = 0; };
  const playerGone = () => {
    if (document.querySelector('video')) { seenVideo = true; noVideo = 0; } else if (seenVideo) noVideo++;
    return !attached(currentAudio) || noVideo >= 2;
  };
  const attached = (sb) => {
    if (sb.__atmosMS && sb.__atmosMS.readyState === 'closed') return false;
    try { void sb.buffered; return true; } catch (e) { return false; }
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__atmosHello) return;
    for (const k of REPLAY) if (k in latest) post(k, latest[k]);
  });
  const log = (msg, data, key) => {
    if (!on()) return;
    if (key) { if (seen.has(key)) return; seen.add(key); }
    // Plain text so it survives copy/paste from the console.
    const text = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
    console.info(`${TAG} ${msg}${text ? ' :: ' + text : ''}`);
    try { window.postMessage({ __atmosLog: true, msg, text }, location.origin); } catch (e) { /* ignore */ }
  };

  // --- HLS playlists fetched by page JS (fetch + XHR) ---
  function inspectPlaylist(url, text) {
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U')) return;
    const audio = text.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l))
      .map((l) => ({
        group: (l.match(/GROUP-ID="([^"]+)"/) || [])[1],
        name: (l.match(/NAME="([^"]+)"/) || [])[1],
        lang: (l.match(/LANGUAGE="([^"]+)"/) || [])[1],
        channels: (l.match(/CHANNELS="([^"]+)"/) || [])[1],
      }));
    const codecs = [...new Set(text.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF'))
      .map((l) => (l.match(/CODECS="([^"]+)"/) || [])[1]).filter(Boolean)
      .flatMap((c) => c.split(',').map((s) => s.trim())).filter((c) => !/^(avc|hvc|hev|dvh|dvav|av01|vp09)/.test(c)))];
    if (!audio.length && !codecs.length) return;
    const atmos = audio.some((a) => /JOC/i.test(a.channels || '')) || codecs.some((c) => /ec\+3/.test(c));
    log(atmos ? 'Playlist INCLUDES Atmos (JOC) audio' : 'Playlist has no Atmos audio',
      { url: String(url).split('?')[0].slice(-60), audioCodecs: codecs.join(', '),
        audioRenditions: audio.map((a) => `${a.group} | ${a.lang || '-'} | ${a.name || '-'} | channels=${a.channels || '?'}`).join('\n') },
      'pl:' + String(url).split('?')[0]);
  }

  // --- Playback API: log only audio/video capability fields (no tokens, IDs or keys) ---
  const INTEREST = /audio|atmos|dolby|channel|codec|video|resolution|range|hdr|scenario|quality|capabilit|bitrate|stereo|surround|5\.1|eac|ec-?3|preferences?/i;
  const SECRET = /token|auth|session|cookie|password|secret|signature|license|cert|key|account|profile|device|user|email|^id$|Id$|_id$/i;
  function pickFields(obj, path = '', out = {}, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 7 || Object.keys(out).length > 200) return out;
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET.test(k)) continue;
      const p = path ? path + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) pickFields(v, p, out, depth + 1);
      else if (Array.isArray(v) && v.length && typeof v[0] === 'object') v.slice(0, 16).forEach((x, i) => pickFields(x, p + '[' + i + ']', out, depth + 1));
      else if (INTEREST.test(p) && (v === null || ['string', 'number', 'boolean'].includes(typeof v) || Array.isArray(v))) {
        const val = Array.isArray(v) ? v.slice(0, 20) : v;
        if (typeof val !== 'string' || val.length < 200) out[p] = val;
      }
    }
    return out;
  }
  const isPlaybackUrl = (u) => !!u && !/\.(m3u8|mp4|m4s|m4a|ts|vtt|js|css|png|jpe?g|webp|svg|woff2?)(\?|$)/i.test(u)
    && !/datadog|sentry|analytics|telemetry|braze|segment|google|doubleclick|\/log/i.test(u);
  function logApi(dir, url, json) {
    const fields = pickFields(json);
    if (!Object.keys(fields).length) return;
    const path = String(url).split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    log(`API ${dir}: ${path}`, JSON.stringify(fields, null, 1), 'api:' + dir + path + Object.keys(fields).join());
  }
  // Every POST endpoint once: host + path only (no query string), plus the body's top-level keys.
  function logEndpoint(kind, url, body) {
    const u = new URL(String(url), location.href);
    if (/datadog|sentry|analytics|telemetry|braze|segment|google|doubleclick|log/i.test(u.hostname + u.pathname)) return;
    let keys = '';
    try { if (typeof body === 'string' && body.trim().startsWith('{')) keys = Object.keys(JSON.parse(body)).filter((k) => !SECRET.test(k)).join(','); } catch (e) { /* ignore */ }
    log(`${kind} ${u.hostname}${u.pathname}`, keys ? 'body keys: ' + keys : undefined, 'ep:' + u.hostname + u.pathname);
  }

  // --- Experimental: ask Disney+'s playback API for Dolby audio and Atmos ---
  // The web player declares only AAC in /v7/playback/<scenario>; Disney+ then omits Atmos.
  // We declare Dolby (eac-3) only and ask for ATMOS / 5.1 audio types.
  // Values follow the vocabulary the API itself returns (audioType STEREO / 5.1 / ATMOS,
  // audioCodec eac-3). Toggle: popup "Ask for Atmos" (data-dolby-request).
  function patchPlaybackBody(url, body) {
    try {
      if (document.documentElement.dataset.dolbyRequest === 'off') return body;
      if (!/\/playback\/[^/?]+/.test(String(url)) || typeof body !== 'string' || !body.trim().startsWith('{')) return body;
      const j = JSON.parse(body);
      const attrs = j && j.playback && j.playback.attributes;
      if (!attrs) return body;
      attrs.codecs = attrs.codecs || {};
      // Keep AAC (the player only treats AAC as playable; the playlist remap below handles the rest).
      const orig = Array.isArray(attrs.codecs.audio) ? attrs.codecs.audio : [];
      const objectStyle = orig.length === 0 || typeof orig[0] === 'object';
      const mk = (n) => (objectStyle ? { name: n, muxed: false } : n);
      const audio = [mk('aac'), mk('eac-3')];
      attrs.codecs.audio = audio;
      attrs.audioTypes = ['ATMOS', '5.1', 'STEREO'];
      // The Safari player caps itself at 1280x720 even with Data Usage set to Automatic,
      // and declares only h.264/vp9. Ask for up to 4K and add HEVC (Disney+'s 4K codec).
      const max = attrs.resolution && Array.isArray(attrs.resolution.max) ? attrs.resolution.max : null;
      let resolution = max;
      if (max) {
        attrs.resolution.max = ['3840x2160'];
        resolution = `${max.join(',')} -> 3840x2160`;
      }
      if (Array.isArray(attrs.codecs.video) && !attrs.codecs.video.includes('h.265')) attrs.codecs.video.push('h.265');
      // HDR unlocks 4K. Popup "HDR" setting: dv (Dolby Vision first), hdr10, or sdr.
      const range = document.documentElement.dataset.dolbyRange || 'dv';
      if (range === 'dv') attrs.videoRanges = ['DOLBY_VISION', 'HDR10', 'SDR'];
      else if (range === 'hdr10') attrs.videoRanges = ['HDR10', 'SDR'];
      else attrs.videoRanges = ['SDR'];
      event('requested', { resolution: attrs.resolution && attrs.resolution.max, videoRanges: attrs.videoRanges });
      log('Asked Disney+ for Atmos', { codecsAudio: audio, audioTypes: attrs.audioTypes, resolution, codecsVideo: attrs.codecs.video, videoRanges: attrs.videoRanges });
      return JSON.stringify(j);
    } catch (e) {
      log('Could not modify playback request', String(e));
      return body;
    }
  }
  function logPlaybackStatus(url, status, text) {
    if (!/\/playback\/[^/?]+/.test(String(url))) return;
    if (status >= 400) log(`Playback request FAILED (HTTP ${status})`, String(text || '').slice(0, 400));
    else log(`Playback request OK (HTTP ${status})`);
  }

  // --- Experimental: point the player's AAC variants at the Atmos audio group ---
  // The Disney+ web player only treats AAC as playable in Safari: removing AAC variants makes
  // it fail (Error 83), and with them present it always picks 720p+AAC. So keep every variant,
  // but remap AUDIO="aac..." to the Atmos group. The player still thinks it's AAC; the
  // addSourceBuffer hook below then opens the audio buffer as ec-3 to match the real data.

  // Popup "Quality" setting: drop variants below the chosen height so the player can't sit
  // at low resolution ("Highest" = the title's top tier). If the title has nothing that
  // high, keep its highest tier. Settings reach the page synchronously (localStorage cache),
  // so this applies to the first stream list and 4K starts within seconds.
  function applyQualityFloor(text) {
    try {
      const q = document.documentElement.dataset.dolbyQuality || 'max';
      if (q === 'auto') return text;
      // "Highest": keep only the title's top resolution tier (4K on 4K titles, 1080p on 1080p ones).
      const want = q === 'max' ? Infinity : parseInt(q, 10);
      const lines = text.split('\n');
      const variants = [];
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith('#') || !lines[j].trim())) j++;
        const h = parseInt(((lines[i].match(/RESOLUTION=\d+x(\d+)/) || [])[1]) || '0', 10);
        variants.push({ i, j, h });
      }
      if (!variants.length) return text;
      const top = Math.max(...variants.map((v) => v.h));
      const floor = Math.min(want, top);
      const keep = variants.filter((v) => v.h >= floor);
      if (keep.length === variants.length) return text;
      const drop = new Set();
      for (const v of variants) if (v.h < floor) { drop.add(v.i); drop.add(v.j); }
      event('quality', { floor: q, kept: [...new Set(keep.map((v) => v.h))] });
      log(`Quality ${q === 'max' ? 'Highest' : 'floor ' + q + 'p'}: kept ${keep.length} of ${variants.length} variants`, `heights kept: ${[...new Set(keep.map((v) => v.h))].sort((a, b) => b - a).join(', ')}`);
      return lines.filter((_, k) => !drop.has(k)).join('\n');
    } catch (e) {
      log('Quality floor failed', String(e));
      return text;
    }
  }
  let audioRemapped = false;
  function filterMasterPlaylist(text) {
    try {
      if (document.documentElement.dataset.dolbyRequest === 'off') return text;
      if (typeof text !== 'string' || !text.startsWith('#EXTM3U') || !text.includes('#EXT-X-STREAM-INF')) return text;
      const groups = [...new Set((text.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*/g) || [])
        .map((l) => (l.match(/GROUP-ID="([^"]+)"/) || [])[1]).filter(Boolean))];
      const atmos = groups.find((g) => /atmos|joc/i.test(g));
      if (!atmos) return applyQualityFloor(text);
      let n = 0;
      const out = text.split('\n').map((l) => {
        if (!l.startsWith('#EXT-X-STREAM-INF')) return l;
        const g = (l.match(/AUDIO="([^"]+)"/) || [])[1] || '';
        if (!/aac/i.test(g)) return l;
        n++;
        return l.replace(`AUDIO="${g}"`, `AUDIO="${atmos}"`);
      }).join('\n');
      if (n) {
        audioRemapped = true;
        log('Playlist: AAC variants now use the Atmos audio group', `${n} variants -> "${atmos}" (groups: ${groups.join(', ')})`);
      }
      return applyQualityFloor(n ? out : text);
    } catch (e) {
      log('Playlist remap failed', String(e));
      return text;
    }
  }
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url0 = typeof input === 'string' ? input : input && input.url;
    if (init && typeof init.body === 'string') init = { ...init, body: patchPlaybackBody(url0, init.body) };
    try {
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (/post/i.test(method)) logEndpoint('fetch POST', url0, init && init.body);
    } catch (e) { /* ignore */ }
    try {
      if (isPlaybackUrl(url0) && init && typeof init.body === 'string' && init.body.trim().startsWith('{'))
        logApi('request', url0, JSON.parse(init.body));
    } catch (e) { /* ignore */ }
    const res = await origFetch.call(this, input, init);
    try { if (/\/playback\/[^/?]+/.test(String(url0))) res.clone().text().then((t) => logPlaybackStatus(url0, res.status, t)).catch(() => {}); } catch (e) { /* ignore */ }
    try {
      if (isPlaybackUrl(url0) && /json/i.test(res.headers.get('content-type') || ''))
        res.clone().json().then((j) => logApi('response', url0, j)).catch(() => {});
    } catch (e) { /* ignore */ }
    try {
      const url = url0;
      if (/\.m3u8|mpegurl/i.test(url || '') || /mpegurl/i.test(res.headers.get('content-type') || '')) {
        const text = await res.clone().text();
        inspectPlaylist(url, text);
        const filtered = filterMasterPlaylist(text);
        if (filtered !== text) {
          const out = new Response(filtered, { status: res.status, statusText: res.statusText, headers: res.headers });
          Object.defineProperty(out, 'url', { value: res.url });
          return out;
        }
      }
    } catch (e) { /* ignore */ }
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__atmosUrl = url;
    this.__atmosMethod = method;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    try { if (/post/i.test(this.__atmosMethod || '')) logEndpoint('XHR POST', this.__atmosUrl, args[0]); } catch (e) { /* ignore */ }
    if (/post/i.test(this.__atmosMethod || '') && typeof args[0] === 'string') {
      args[0] = patchPlaybackBody(this.__atmosUrl, args[0]);
      if (/\/playback\/[^/?]+/.test(String(this.__atmosUrl)))
        this.addEventListener('loadend', () => { try { logPlaybackStatus(this.__atmosUrl, this.status, this.responseType && this.responseType !== 'text' ? '' : this.responseText); } catch (e) { /* ignore */ } });
    }
    try {
      if (isPlaybackUrl(String(this.__atmosUrl)) && typeof args[0] === 'string' && args[0].trim().startsWith('{')) {
        logApi('request', this.__atmosUrl, JSON.parse(args[0]));
        this.addEventListener('load', () => {
          try { if (!this.responseType || this.responseType === 'text') logApi('response', this.__atmosUrl, JSON.parse(this.responseText)); } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    if (!/post/i.test(this.__atmosMethod || '') && isPlaybackUrl(String(this.__atmosUrl || ''))) {
      this.addEventListener('load', () => {
        try {
          if ((!this.responseType || this.responseType === 'text') && /^\s*[{[]/.test(this.responseText)) logApi('response', this.__atmosUrl, JSON.parse(this.responseText));
          else if (this.responseType === 'json' && this.response) logApi('response', this.__atmosUrl, this.response);
        } catch (e) { /* ignore */ }
      });
    }
    if (/\.m3u8|mpegurl/i.test(String(this.__atmosUrl || ''))) {
      const xhr = this;
      const textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
      const respDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
      let cache = null;
      const filtered = () => {
        if (cache === null) cache = filterMasterPlaylist(textDesc.get.call(xhr));
        return cache;
      };
      const textual = () => !xhr.responseType || xhr.responseType === 'text';
      Object.defineProperty(xhr, 'responseText', { configurable: true, get() { return xhr.readyState === 4 && textual() ? filtered() : textDesc.get.call(xhr); } });
      Object.defineProperty(xhr, 'response', { configurable: true, get() { return xhr.readyState === 4 && textual() ? filtered() : respDesc.get.call(xhr); } });
      this.addEventListener('load', () => {
        try { if (!this.responseType || this.responseType === 'text') inspectPlaylist(this.__atmosUrl, Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get.call(this)); } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, args);
  };

  // --- Capability checks the player makes ---
  if (window.MediaSource && MediaSource.isTypeSupported) {
    const orig = MediaSource.isTypeSupported.bind(MediaSource);
    MediaSource.isTypeSupported = function (t) {
      const r = orig(t);
      if (/audio|ec-3|ac-3|mp4a|joc/i.test(t)) log('isTypeSupported', { type: t, result: r }, 'its:' + t);
      return r;
    };
  }
  if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
    const mc = navigator.mediaCapabilities;
    const orig = mc.decodingInfo.bind(mc);
    mc.decodingInfo = async function (cfg) {
      const r = await orig(cfg);
      if (cfg && cfg.audio) log('decodingInfo', { audio: cfg.audio, type: cfg.type, supported: r.supported }, 'di:' + JSON.stringify(cfg.audio));
      return r;
    };
  }
  const canPlay = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (t) {
    const r = canPlay.call(this, t);
    if (/audio|ec-3|ac-3|mp4a|joc|mpegurl/i.test(t)) log('canPlayType', { type: t, result: r }, 'cpt:' + t);
    return r;
  };

  // --- MSE usage and the audio header actually appended ---
  if (window.MediaSource) {
    const origAdd = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (type) {
      if (audioRemapped && /audio/i.test(type) && /mp4a/i.test(type) && document.documentElement.dataset.dolbyRequest !== 'off') {
        log('Opening audio buffer as Dolby instead of AAC', `${type} -> audio/mp4; codecs="ec-3"`);
        type = 'audio/mp4; codecs="ec-3"';
      }
      const sb = origAdd.call(this, type);
      sb.__atmosType = type;
      sb.__atmosMS = this;
      if (/audio/i.test(type)) track(sb);
      event(/audio/i.test(type) ? 'audioOpen' : 'videoOpen', type);
      log('Player uses MSE: opened SourceBuffer', type);
      return sb;
    };
    const origAppend = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      try {
        // Buffers opened before these hooks existed have no recorded type: check their
        // init segments too (media segments are rejected after a few KB).
        const unknown = this.__atmosType === undefined;
        if ((unknown || /audio/i.test(this.__atmosType)) && typeof __dolbyInspectInit === 'function') {
          const info = __dolbyInspectInit(data);
          if (info && unknown) { this.__atmosType = 'audio (opened before Atmosphere loaded)'; track(this); }
          if (info) event('header', info);
          if (info) log('Audio stream header: ' + info.label + (info.dataRateKbps ? ` (${info.dataRateKbps} kbps)` : ''), info, 'hdr:' + info.label + info.dataRateKbps);
        }
      } catch (e) { /* ignore */ }
      return origAppend.call(this, data);
    };
  }

  // --- Web Audio routing: if the page pipes the <video>'s sound through an AudioContext,
  // Safari renders it as stereo PCM and macOS never sees Dolby Atmos. Detect it. ---
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const origCtor = AC;
    const wrap = function (...args) {
      const ctx = new origCtor(...args);
      log('Page created an AudioContext', `sampleRate=${ctx.sampleRate}, maxChannelCount=${ctx.destination.maxChannelCount}`);
      return ctx;
    };
    wrap.prototype = origCtor.prototype;
    try { window.AudioContext = wrap; if (window.webkitAudioContext) window.webkitAudioContext = wrap; } catch (e) { /* ignore */ }
    for (const m of ['createMediaElementSource', 'createMediaStreamSource']) {
      const orig = origCtor.prototype[m];
      if (!orig) continue;
      origCtor.prototype[m] = function (el, ...rest) {
        log(`Web Audio is capturing ${m === 'createMediaElementSource' ? 'a <' + (el && el.tagName || '?').toLowerCase() + '> element' : 'a media stream'}: its sound now goes through Web Audio (stereo)`);
        return orig.call(this, el, ...rest);
      };
    }
  }
  if (HTMLMediaElement.prototype.captureStream) {
    const orig = HTMLMediaElement.prototype.captureStream;
    HTMLMediaElement.prototype.captureStream = function (...a) { log('Page called captureStream() on a media element'); return orig.apply(this, a); };
  }

  // --- DRM ---
  if (navigator.requestMediaKeySystemAccess) {
    const orig = navigator.requestMediaKeySystemAccess.bind(navigator);
    navigator.requestMediaKeySystemAccess = function (ks, cfgs) {
      log('DRM requested: ' + ks, (cfgs || []).map((c) => (c.audioCapabilities || []).map((a) => a.contentType)), 'drm:' + ks);
      return orig(ks, cfgs);
    };
  }
  if (window.WebKitMediaKeys) log('Legacy WebKitMediaKeys available (FairPlay, used with native HLS)', undefined, 'wkmk');

  // --- Native HLS vs MSE: check what the <video> element is playing ---
  setInterval(() => {
    for (const v of document.querySelectorAll('video')) {
      const src = v.currentSrc || v.src || '';
      if (!src || v.paused) continue;
      const kind = src.startsWith('blob:') ? 'MSE (blob: URL)' : /m3u8/i.test(src) ? "Safari's native HLS player" : 'direct URL';
      log('Video element playing via ' + kind, src.startsWith('blob:') ? undefined : src.split('?')[0], 'src:' + kind);
      const size = `${v.videoWidth}x${v.videoHeight}`;
      if (v.videoWidth && size !== v.__atmosSize) {
        v.__atmosSize = size;
        const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        event('video', { width: v.videoWidth, height: v.videoHeight });
        log('Now playing video at ' + size, (q ? `dropped ${q.droppedVideoFrames}/${q.totalVideoFrames} frames; ` : '') + `volume=${v.volume} muted=${v.muted} rate=${v.playbackRate}`);
      }
      if (v.audioTracks && v.audioTracks.length) {
        const tracks = [...v.audioTracks].map((t) => ({ label: t.label, lang: t.language, kind: t.kind, enabled: t.enabled }));
        log('Audio tracks exposed to the page', tracks, 'at:' + JSON.stringify(tracks));
      }
    }
  }, 2000);

  setInterval(() => {
    if (!currentAudio || !playerGone()) return;
    currentAudio = null;
    for (const k of ['audioOpen', 'videoOpen', 'header']) delete latest[k];
    event('closed');
    log('Player closed its streams');
  }, 1000);

  event('hooks');
  log('Hooks installed');
})();
