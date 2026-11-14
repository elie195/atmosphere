# WebKit bug report

Filed as https://bugs.webkit.org/show_bug.cgi?id=331672

**Product / Component:** WebKit / Media
**Title:** [macOS] MSE playback of E-AC-3 JOC (Dolby Atmos) outputs "Multichannel", not Atmos, until an Atmos file has played via a src= media element

## Environment
- macOS 27 (Darwin 27.0), Safari 27.0.1
- Output: AirPods Pro with Spatial Audio enabled (Control Center → Sound shows the active format)

## Steps to reproduce
1. Quit Safari completely (⌘Q) and relaunch it.
2. Open the test case below and click **MSE**. It appends Dolby's public DD+ JOC test file to a `SourceBuffer` (`audio/mp4; codecs="ec-3"`) and plays it.
3. While it plays, open Control Center → Sound.
4. Quit and relaunch Safari. Open the test case, click **Direct** (`<audio src>` with the same file), and check Control Center.
5. Without quitting, click **MSE** again (or play MSE content in another tab).

## Results
- Step 3: Control Center shows **Multichannel**.
- Step 4: Control Center shows **Dolby Atmos**.
- Step 5: MSE playback now also shows **Dolby Atmos**, and keeps doing so (including in other tabs) until Safari quits.

## Expected
MSE playback of E-AC-3 JOC should engage Dolby Atmos rendering on its own, the same as `src=` playback. At the moment it only does so after a `src=` element has played Atmos in the same Safari session.

## Notes
- The init segment's `dec3` box declares JOC (flag_ec3_extension_type_a = 1, complexity_index_type_a = 16).
- `navigator.mediaCapabilities.decodingInfo({ type: 'media-source', audio: { contentType: 'audio/mp4; codecs="ec-3"', channels: '16/JOC', spatialRendering: true, ... } })` returns `supported: true`.
- Playing video and audio together through MSE behaves the same as audio alone.
- This affects streaming sites that deliver DD+ Atmos through MSE: they play as Multichannel on a fresh Safari launch.
- Workaround: play a short Atmos clip through a `src=` element first.

## Test case
```html
<!doctype html>
<button id="direct">Direct</button> <button id="mse">MSE</button>
<audio id="a" controls></audio>
<script>
const URL_ = 'https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/DASH/OnDemand_MPD/Fragment_Audio/ChID_voices_Atmos_6ch_640kbps_ddp_joc.mp4';
const a = document.getElementById('a');
document.getElementById('direct').onclick = () => { a.src = URL_; a.play(); };
document.getElementById('mse').onclick = async () => {
  const buf = await (await fetch(URL_)).arrayBuffer();
  const ms = new MediaSource();
  a.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  const sb = ms.addSourceBuffer('audio/mp4; codecs="ec-3"');
  sb.addEventListener('updateend', () => { ms.endOfStream(); a.play(); }, { once: true });
  sb.appendBuffer(buf);
};
</script>
```
(The test file is served with `Access-Control-Allow-Origin: *`. Serve the page over http(s); from `file://` the fetch fails.)
