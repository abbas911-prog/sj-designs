// Boots factory.html in Chromium (Playwright) against the fake world: relay = real relay.gs, fast lane = real fast-worker.js.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const F = require('./fakes');
const PW_PATH = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright';
const { chromium } = require(PW_PATH);
const FASTURL = 'https://sj-fast.test.workers.dev';
const PROPS = { MEMO_PASSWORD: 'shop-test-pw', FACTORY_PASSWORD: 'fac-test-pw', TRELLO: 'tr-read', TRELLO_W: 'tr-write', SLACK_FACTORY_TOKEN: 'xoxb-factory-test', SLACK_BOT_TOKEN: 'xoxb-memo-test' };

function serve(T) {
  return new Promise(ok => { const s = http.createServer((q, r) => { if (T && T.offline) { q.socket.destroy(); return; } const p = path.join(F.ROOT, decodeURIComponent(q.url.split('?')[0]));
    const ov = T && T.override && T.override(q.url.split('?')[0]); if (ov != null) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); r.end(ov); return; }
    if (!p.startsWith(F.ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end('no'); return; }
    r.writeHead(200, { 'Content-Type': /\.html$/.test(p) ? 'text/html; charset=utf-8' : /\.jpg$/.test(p) ? 'image/jpeg' : /\.png$/.test(p) ? 'image/png' : /\.js$/.test(p) ? 'text/javascript' : /\.webmanifest$/.test(p) ? 'application/manifest+json' : 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(r); });
    s.listen(0, '127.0.0.1', () => ok(s)); });
}

// opts: { fast: bool (fast lane on), setup(W) }
async function boot(opts) {
  opts = opts || {};
  const W = F.makeWorld(); if (opts.setup) opts.setup(W);
  const props = Object.assign({}, PROPS, opts.fast ? { FAC_FAST: FASTURL } : {}, opts.props || {});
  if (opts.push) W.fastSync = F.makeSyncWorker(props, { SLACK_TOKEN: 'xoxb-factory-test', TRELLO_TOKEN: 'tr-write' });   // the relay -> worker calls (Web Push)
  const relay = F.makeRelay(W, props);
  const worker = await F.makeWorker(W, relay, { SLACK_TOKEN: 'xoxb-factory-test', TRELLO_TOKEN: 'tr-write' });
  const T0 = {}, srv = await serve(T0), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = opts.browser || await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: opts.sw ? 'allow' : 'block' });
  const T = Object.assign(T0, { W, relay, worker, base, browser, ctx, errors: [], relayCalls: [], sse: {}, trace: [] });
  if (opts.init) await ctx.addInitScript(opts.init);
  await ctx.route('https://script.google.com/**', async route => { const body = route.request().postData() || '';
    let op = '', rq = {}; try { rq = JSON.parse(JSON.parse(body).req); op = rq.op; } catch (e) {}
    T.trace.push([Date.now(), 'send', op, rq.look, rq.since || rq.ts || '']);
    if (T.relayDown) { await route.abort('failed'); return; }
    T.relayCalls.push(op); if (opts.relayDelay) await new Promise(r => setTimeout(r, opts.relayDelay));
    T.trace.push([Date.now(), 'run', op, rq.look]); let txt; try { txt = relay.post(body); } catch (e) { txt = JSON.stringify({ ok: false, error: 'TEST RELAY CRASH ' + e.message }); T.errors.push('relay crash: ' + e.stack); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: txt }); });
  await ctx.route(FASTURL + '/**', async route => { const rq = route.request();
    if (T.fastDown) { await route.abort('failed'); return; }
    const r = await worker.fetch(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: ['GET', 'HEAD'].includes(rq.method()) ? undefined : rq.postDataBuffer() }));
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); await route.fulfill({ status: r.status, headers: h, body: Buffer.from(await r.arrayBuffer()) }); });
  await ctx.route('https://ntfy.sh/**', async route => { const u = new URL(route.request().url()), m = u.pathname.match(/^\/([\w-]+)\/sse$/);
    if (m) { const topic = m[1], from = T.sse[topic] || 0, evs = W.ntfy.filter((e, i) => i >= from && e.topic === topic); T.sse[topic] = W.ntfy.length;
      if (!evs.length) { await new Promise(r => setTimeout(r, 1500)); }
      const evs2 = W.ntfy.filter((e, i) => i >= from && e.topic === topic); T.sse[topic] = W.ntfy.length;
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' }, body: 'retry: 300\n\n' + evs2.map(e => 'data: ' + JSON.stringify({ event: 'message', message: e.body }) + '\n\n').join('') }); return; }
    F.handle(W, route.request().method(), route.request().url(), route.request().postData() || ''); await route.fulfill({ status: 200, body: '{}', headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await ctx.route('https://files.slack.com/**', async route => { const rq = route.request(), r = F.handle(W, rq.method(), rq.url(), rq.postDataBuffer() || Buffer.alloc(0)); await route.fulfill({ status: r.status, body: r.body, headers: { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*' } }); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  T.open = async function (signIn) {
    const page = await ctx.newPage(); T.page = page;
    page.on('pageerror', e => T.errors.push('page error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) T.errors.push('console: ' + m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(base + 'factory.html');
    if (signIn !== false && await page.locator('#login').isVisible()) { await page.fill('#lpw', PROPS.FACTORY_PASSWORD); await page.fill('#lname', opts.who || 'Abbas'); await page.click('#lgo'); }
    await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length, null, { timeout: 15000 });
    return page;
  };
  T.close = async () => { await ctx.close(); if (!opts.browser) await browser.close(); srv.close(); if (W.fastSync) await W.fastSync.stop(); };
  return T;
}

// a little test runner
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log('  ✓ ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { results.push([false, name, e]); console.log('  ✗ ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
function ok(c, msg) { if (!c) throw new Error('expected: ' + msg); }
async function until(fn, ms, what) { const t0 = Date.now(); let last; while (Date.now() - t0 < (ms || 8000)) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise(r => setTimeout(r, 100)); } throw new Error('timed out waiting for ' + (what || 'condition') + (last instanceof Error ? ' (' + last.message + ')' : '')); }
module.exports = { boot, test, ok, until, results, F, PROPS, FASTURL, chromium };
