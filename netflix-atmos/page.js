// Runs in the page's own JS world on netflix.com, before Netflix's player loads.
// Netflix's player builds its manifest request as a plain object and serialises it
// with JSON.stringify before encrypting it. We add Dolby audio profiles to the
// `profiles` list at that point. We also watch JSON.parse to see which audio
// streams Netflix sends back, and read the audio header (metadata only) as it is
// appended. Nothing touches DRM or decryption.
// Events go to the console and, via postMessage, to content.js for the popup.
(() => {
  // Already installed (content.js was injected again, e.g. by the popup after the extension
  // was enabled or updated): don't hook twice; content.js asks for a replay instead.
  if (window.__atmosphereNetflixHooks) return;
  window.__atmosphereNetflixHooks = true;
  const TAG = '[DolbyAudio]';
  const EXTRA_PROFILES = ['ddplus-2.0-dash', 'ddplus-5.1-dash', 'ddplus-5.1hq-dash', 'ddplus-atmos-dash'];

  // The latest event of each kind that makes up the popup's status, replayed when a
  // (re-)injected content.js says hello, so it starts with the current state.
  const REPLAY = ['hooks', 'profiles', 'sourcebuffer', 'videotype', 'header'];
  const latest = {};
  const post = (kind, msg, data, replay = false) => {
    try { window.postMessage({ __dolbyAudio: true, kind, msg, data, replay }, location.origin); } catch (e) { /* ignore */ }
  };
  const emit = (kind, msg, data) => {
    // Console output only in debug mode (content.js sets data-dolby-debug).
    if (document.documentElement.dataset.dolbyDebug === 'on') console.info(TAG, msg, data === undefined ? '' : data);
    if (REPLAY.includes(kind)) {
      latest[kind] = { kind, msg, data };
      // A new audio stream supersedes the previous one's header.
      if (kind === 'sourcebuffer') delete latest.header;
    }
    post(kind, msg, data);
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
    for (const k of REPLAY) if (latest[k]) post(latest[k].kind, latest[k].msg, latest[k].data, true);
  });
  // content.js sets data-dolby-request="off" when the popup toggle is off.
  const requestEnabled = () => document.documentElement.dataset.dolbyRequest !== 'off';

  const isProfileList = (a) =>
    Array.isArray(a) && a.length > 0 && a.every((p) => typeof p === 'string') &&
    a.some((p) => /dash$|^playready|^heaac|^h264|^vp9|^av1|^hevc/i.test(p));

  function patchProfiles(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return;
    if (isProfileList(obj.profiles)) {
      const added = EXTRA_PROFILES.filter((p) => !obj.profiles.includes(p));
      added.forEach((p) => obj.profiles.push(p));
      if (added.length) emit('profiles', 'Asked Netflix for Atmos', added);
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object' && k !== 'profiles') patchProfiles(v, depth + 1);
    }
  }

  const origStringify = JSON.stringify;
  JSON.stringify = function (value, ...rest) {
    try { if (requestEnabled()) patchProfiles(value); } catch (e) { /* never break the page */ }
    return origStringify.call(this, value, ...rest);
  };

  function findAudioTracks(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    if (Array.isArray(obj.audio_tracks)) return obj.audio_tracks;
    for (const k of Object.keys(obj)) {
      const r = findAudioTracks(obj[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  // Fallback when the manifest's shape isn't recognised: sniff the raw JSON text
  // for Netflix's audio profile names.
  let lastSniff = null;
  function sniffManifestText(text) {
    if (typeof text !== 'string' || text.length < 1000 || !text.includes('ddplus-')) return;
    if (!/content_?[pP]rofile|"profile"/.test(text)) return;
    const atmos = text.includes('ddplus-atmos');
    const found = [...new Set(text.match(/(?:ddplus|heaac|xheaac)-[a-z0-9.\-]+?-dash/g) || [])];
    const key = atmos + found.join(',');
    if (key === lastSniff) return;
    lastSniff = key;
    emit('manifest', atmos ? 'Stream list includes Atmos' : 'Stream list has no Atmos', { atmos, profiles: found, via: 'text' });
  }

  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    const result = origParse.apply(this, args);
    try {
      const tracks = findAudioTracks(result);
      if (!tracks) sniffManifestText(args[0]);
      if (tracks) {
        const summary = tracks.map((t) => ({
          language: t.language || t.languageDescription,
          channels: t.channels || t.channelsLabel,
          profiles: [...new Set((t.streams || []).map((s) => s.content_profile))],
        }));
        const atmos = summary.some((t) => t.profiles.some((p) => /atmos/i.test(p || '')));
        emit('manifest', atmos ? 'Stream list includes Atmos' : 'Stream list has no Atmos', { atmos, tracks: summary });
      }
    } catch (e) { /* ignore */ }
    return result;
  };

  const origAdd = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (type) {
    const sb = origAdd.call(this, type);
    sb.__dolbyType = type;
    sb.__atmosMS = this;
    if (/audio/i.test(type)) { track(sb); emit('sourcebuffer', 'Player opened an audio stream', type); }
    else if (/video/i.test(type)) emit('videotype', 'Player opened a video stream', type);
    return sb;
  };
  // Players switch codec mid-playback (e.g. AAC ↔ Dolby) with changeType() on the same buffer.
  if (SourceBuffer.prototype.changeType) {
    const origChange = SourceBuffer.prototype.changeType;
    SourceBuffer.prototype.changeType = function (type) {
      const wasAudio = /audio/i.test(this.__dolbyType || '');
      this.__dolbyType = type;
      this.__dolbyHeaderKey = null;
      if (wasAudio || /audio/i.test(type)) emit('codecswitch', 'Player switched audio codec', type);
      return origChange.call(this, type);
    };
  }
  const origAppend = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (data) {
    try {
      // Only init segments carry a dec3 box; report each change of audio stream once.
      // Buffers the player opened before these hooks existed have no recorded type:
      // check their init segments too (media segments are rejected after a few KB).
      const unknown = this.__dolbyType === undefined;
      if ((unknown || /audio/i.test(this.__dolbyType)) && typeof __dolbyInspectInit === 'function') {
        const info = __dolbyInspectInit(data);
        if (info && unknown) { this.__dolbyType = 'audio (opened before Atmosphere loaded)'; track(this); }
        if (info) {
          const key = info.label + ':' + info.dataRateKbps;
          if (key !== this.__dolbyHeaderKey) {
            this.__dolbyHeaderKey = key;
            emit('header', 'Audio: ' + info.label + (info.dataRateKbps ? ` (${info.dataRateKbps} kbps)` : ''), info);
          }
        }
      }
    } catch (e) { /* ignore */ }
    return origAppend.call(this, data);
  };
  if (navigator.requestMediaKeySystemAccess) {
    const origReq = navigator.requestMediaKeySystemAccess.bind(navigator);
    navigator.requestMediaKeySystemAccess = function (ks, cfgs) {
      emit('drm', 'DRM requested: ' + ks);
      return origReq(ks, cfgs);
    };
  }

  setInterval(() => {
    if (!currentAudio || !playerGone()) return;
    currentAudio = null;
    for (const k of ['sourcebuffer', 'videotype', 'header']) delete latest[k];
    emit('closed', 'Player closed its streams');
  }, 1000);

  emit('hooks', 'Hooks installed');
})();
