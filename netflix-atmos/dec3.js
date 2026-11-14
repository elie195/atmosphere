// Reads the audio description from an MP4 *init segment* (the header Netflix
// appends when an audio stream starts): codec, channel count, and for Dolby
// Digital Plus the "dec3" box that says whether the stream carries Atmos (JOC).
// Pure metadata: audio samples are never read. Returns null for media segments.
function __dolbyInspectInit(data) {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (u8.length < 16) return null;
  const fourcc = (i) => String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
  // Init segments start with ftyp or moov; media segments start with styp/sidx/moof.
  const find = (cc, from = 4, limit = u8.length) => {
    const c = [...cc].map((ch) => ch.charCodeAt(0));
    for (let i = from; i < Math.min(limit, u8.length) - 4; i++)
      if (u8[i] === c[0] && u8[i + 1] === c[1] && u8[i + 2] === c[2] && u8[i + 3] === c[3]) return i;
    return -1;
  };
  const first = fourcc(4);
  if (first !== 'ftyp' && first !== 'moov') {
    const moov = find('moov', 4, 8192), moof = find('moof', 4, 8192);
    if (moov < 0 || (moof >= 0 && moof < moov)) return null;
  }

  // Sample entry: clear codecs, or 'enca' (encrypted) whose real codec is in 'frma'.
  let entry = -1, codecCC = null, encrypted = false;
  for (const cc of ['ec-3', 'ac-3', 'mp4a', 'enca']) {
    const i = find(cc);
    if (i > 0 && (entry < 0 || i < entry)) { entry = i; codecCC = cc; }
  }
  if (entry < 0) return null;
  if (codecCC === 'enca') {
    encrypted = true;
    const f = find('frma', entry);
    codecCC = f > 0 ? fourcc(f + 4) : 'unknown';
  }
  // AudioSampleEntry: fourcc, 6 reserved, data_reference_index(2), 8 reserved, channelcount(2)
  const chPos = entry + 4 + 6 + 2 + 8;
  const channelCount = chPos + 1 < u8.length ? (u8[chPos] << 8) | u8[chPos + 1] : null;

  const out = {
    codec: codecCC === 'ec-3' ? 'eac3' : codecCC === 'ac-3' ? 'ac3' : codecCC === 'mp4a' ? 'aac' : codecCC,
    channels: channelCount,
    jocFlag: 0,
    sampleEntry: encrypted ? 'enca (encrypted)' : codecCC + ' (clear)',
    scheme: ['cbcs', 'cenc', 'cbc1', 'cens'].find((s) => find(s) >= 0) || 'none',
  };

  const d = find('dec3');
  if (d > 0) {
    const size = (u8[d - 4] << 24 | u8[d - 3] << 16 | u8[d - 2] << 8 | u8[d - 1]) >>> 0;
    const end = d - 4 + size;
    let bit = (d + 4) * 8;
    const read = (n) => { let v = 0; for (let i = 0; i < n; i++, bit++) v = (v << 1) | ((u8[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
    out.dataRateKbps = read(13);
    const nInd = read(3) + 1;
    out.substreams = [];
    for (let i = 0; i < nInd; i++) {
      const s = { fscod: read(2), bsid: read(5) };
      read(1); s.asvc = read(1); s.bsmod = read(3); s.acmod = read(3); s.lfeon = read(1);
      read(3); s.numDepSub = read(4);
      if (s.numDepSub > 0) s.chanLoc = read(9); else read(1);
      out.substreams.push(s);
    }
    if (bit + 16 <= end * 8) {
      read(7);
      out.jocFlag = read(1);         // flag_ec3_extension_type_a: 1 = Atmos (JOC)
      if (out.jocFlag) out.complexityIndex = read(8);
    }
    // acmod 7 + LFE = 5.1; acmod 2 = stereo
    const s0 = out.substreams[0];
    if (s0) out.channels = ({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5 }[s0.acmod] || out.channels) + (s0.lfeon ? 1 : 0);
  }

  // Bitrate for non-Dolby streams, from the optional btrt box (avgBitrate).
  if (out.dataRateKbps == null) {
    const b = find('btrt');
    if (b > 0) out.dataRateKbps = Math.round((((u8[b + 12] << 24) | (u8[b + 13] << 16) | (u8[b + 14] << 8) | u8[b + 15]) >>> 0) / 1000) || undefined;
  }

  const layout = out.channels === 6 ? '5.1' : out.channels === 8 ? '7.1' : out.channels === 2 ? 'stereo' : out.channels === 1 ? 'mono' : (out.channels ? out.channels + 'ch' : '');
  out.label = out.jocFlag ? 'Dolby Atmos'
    : out.codec === 'eac3' ? `Dolby Digital Plus ${layout}`.trim()
    : out.codec === 'ac3' ? `Dolby Digital ${layout}`.trim()
    : out.codec === 'aac' ? `AAC ${layout}`.trim()
    : `${out.codec} ${layout}`.trim();
  return out;
}
