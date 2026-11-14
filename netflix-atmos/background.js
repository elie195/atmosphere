// Debug log sink: content scripts send log lines here (only while Debug mode is on),
// and this forwards them in batches to a log receiver on this Mac (tools/log-server.py).
// Nothing is sent anywhere else. If the receiver isn't running, lines are dropped.
const SINK = 'http://127.0.0.1:47123/log';
let queue = [];
let timer = null;

async function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  try {
    await fetch(SINK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
  } catch (e) { /* receiver not running */ }
}

browser.runtime.onMessage.addListener((m) => {
  if (!m || !m.atmosLog) return;
  queue.push({ t: Date.now(), ...m.atmosLog });
  if (queue.length > 500) queue = queue.slice(-500);
  if (!timer) timer = setTimeout(flush, 400);
});
