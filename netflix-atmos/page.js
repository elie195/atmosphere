// Runs in the page's own JS world on netflix.com, before Netflix's player loads.
// Netflix's player builds its manifest request as a plain object and serialises it
// with JSON.stringify before encrypting it. We add Dolby audio profiles to the
// `profiles` list at that point. We also watch JSON.parse to see which audio
// streams Netflix sends back, and read the audio header (metadata only) as it is
// appended. Nothing touches DRM or decryption.
// Events go to the console and, via postMessage, to content.js for the popup.
(() => {
  const TAG = '[DolbyAudio]';
  const EXTRA_PROFILES = ['ddplus-2.0-dash', 'ddplus-5.1-dash', 'ddplus-5.1hq-dash', 'ddplus-atmos-dash'];

  const emit = (kind, msg, data) => {
    // Console output only in debug mode (content.js sets data-dolby-debug).
    if (document.documentElement.dataset.dolbyDebug === 'on') console.info(TAG, msg, data === undefined ? '' : data);
    try { window.postMessage({ __dolbyAudio: true, kind, msg, data }, location.origin); } catch (e) { /* ignore */ }
  };
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
    if (/audio/i.test(type)) emit('sourcebuffer', 'Player opened an audio stream', type);
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
      if (/audio/i.test(this.__dolbyType || '') && typeof __dolbyInspectInit === 'function') {
        const info = __dolbyInspectInit(data);
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

  emit('hooks', 'Hooks installed');
})();
