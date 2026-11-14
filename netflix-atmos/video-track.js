// Shared by both content scripts (loaded first): tracks what the <video> element is
// actually showing, and records quality changes, like the audio stream changes.
function createVideoTracker() {
  const t = { width: 0, height: 0, codec: '', range: '', format: '', dropped: 0, total: 0, switches: [] };
  const label = (h) => !h ? '' : h >= 2160 ? '4K' : h >= 1440 ? '1440p' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${h}p`;
  t.setCodec = (type) => {
    const codec = String(type || '').replace(/^.*codecs="?([^";]+)"?.*$/, '$1');
    t.codec = codec;
    t.range = /dvh1|dvhe/i.test(codec) ? 'Dolby Vision' : /(hvc1|hev1)\.2\./i.test(codec) ? 'HDR10' : codec ? 'SDR' : '';
    t.format = /dvh1|dvhe|hvc1|hev1/i.test(codec) ? 'HEVC' : /avc/i.test(codec) ? 'H.264' : /vp09|vp9/i.test(codec) ? 'VP9' : /av01/i.test(codec) ? 'AV1' : '';
  };
  t.reset = () => { t.width = 0; t.height = 0; t.switches = []; };
  t.poll = () => {
    const v = [...document.querySelectorAll('video')].find((x) => x.videoHeight && !x.paused) ||
      [...document.querySelectorAll('video')].find((x) => x.videoHeight);
    if (!v) return;
    if (v.videoHeight !== t.height && t.height) {
      t.switches.push({ t: Date.now(), from: label(t.height), to: label(v.videoHeight) });
      if (t.switches.length > 30) t.switches.shift();
    }
    t.width = v.videoWidth; t.height = v.videoHeight;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    if (q) { t.dropped = q.droppedVideoFrames; t.total = q.totalVideoFrames; }
  };
  t.snapshot = () => ({ width: t.width, height: t.height, label: label(t.height), codec: t.codec, range: t.range, format: t.format,
    dropped: t.dropped, total: t.total, switches: t.switches.slice(-10) });
  setInterval(t.poll, 1000);
  return t;
}
