// the fast-lane worker in a thread of its own, so the (waiting) relay can call it - see makeSyncWorker in fakes.js
'use strict';
const { workerData } = require('worker_threads'), F = require('./fakes');
(async () => {
  const W = F.makeWorld(), relay = F.makeRelay(W, workerData.props), worker = await F.makeWorker(W, relay, workerData.env), port = workerData.port, flag = workerData.flag;
  port.on('message', async m => {
    if (m.url === 'ctl://x') { Object.assign(W, JSON.parse(m.body)); port.postMessage({ status: 200, text: '{}' }); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); return; }   // test controls (e.g. pushStatus)
    let out; try { const r = await worker.fetch(new Request(m.url, { method: 'POST', body: m.body })); out = { status: r.status, text: await r.text() }; }
    catch (e) { out = { status: 500, text: JSON.stringify({ ok: false, error: 'TEST WORKER CRASH ' + e.message }) }; }
    out.pushes = (W.pushes || []).splice(0).map(x => ({ url: x.url, headers: x.headers, body: new Uint8Array(x.body) }));
    port.postMessage(out); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0);
  });
})();
