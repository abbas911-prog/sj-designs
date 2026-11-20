// Photos / videos in the SJ Stock chats (20 Nov 2026 — Abbas: "sometimes the videos and photos we send on the chats do not go through; Muhammad
// complained many times"). A file goes phone -> Slack's upload address (straight, or through the fast lane), the relay only hands out the
// address (upurl) and posts the message (up + fids). It is kept on the phone until Slack has it: a reload does not lose it, a file that will
// not go never holds back the lines after it and is never thrown away (Try again / Remove), a big video is not refused, and the app does not
// update itself over a picked file. Fake relay + fake Slack upload address + fake fast lane; no real service is touched.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234', FAST = 'https://sj-fast.test';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const ROOT = '1792600000.000100', KEY = crypto.createHash('sha256').update('sjfast|' + PW).digest('hex');
const S = { files: {}, posts: [], b64: 0, upurl: 0, old: false, fast: false, down: false, hold: false, refuse: false, lose: 0, slackHits: 0, fastHits: 0, fastKeys: [], msgs: [{ ts: '1792600001.000100', who: 'Abbas', app: true, text: 'Send me the video of 48188', files: [] }] };
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'orders') return { ok: true, orders: [] }; if (b.job === 'bills') return { ok: true, bills: [] }; if (b.job === 'timo') return { ok: true, data: null, at: 0 };
  if (b.job !== 'cchat') return { ok: false, error: 'not in test' };
  if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [], orders: [], gun: {}, dms: [{ k: 'D' + ROOT, name: /^abbas/i.test(req.who) ? 'Muhammad' : 'Abbas', root: ROOT, un: 0, tx: '', last: '1792600001.000100' }], live: '', nt: false, ev: false };
  if (req.op === 'thread') return { ok: true, root: req.root, msgs: S.msgs };
  if (req.op === 'seen') return { ok: true };
  const put = (o) => { S.posts.push(o); S.msgs = S.msgs.concat([{ ts: '17926' + String(10000 + S.posts.length) + '.000100', who: req.who, app: true, text: req.text || '📎', files: (o.names || []).map((n, i) => ({ id: 'F' + S.posts.length + i, name: n, type: /mp4/.test(n) ? 'video/mp4' : 'image/jpeg' })) }]); };
  if (req.op === 'post') { const was = S.posts.find(p => p.rid === req.rid); if (!was) put({ kind: 'text', text: req.text, rid: req.rid, ch: req.ch, root: req.root }); return { ok: true, ts: '1', root: req.root }; }
  if (req.op === 'upurl') { S.upurl++; if (S.old) return { ok: false, error: 'the relay does not know "upurl" yet - Abbas must deploy the new version' };
    return { ok: true, fast: S.fast ? FAST : '', urls: req.files.map(f => { const id = 'F' + crypto.randomBytes(5).toString('hex').toUpperCase(); S.files[id] = { name: f.name, want: f.size, got: 0 }; return { id, url: 'https://files.slack.com/upload/' + id }; }) }; }
  if (req.op === 'up') { const was = S.posts.find(p => p.rid === req.rid); if (was) return { ok: true, root: req.root, files: 1 };
    if (Array.isArray(req.fids)) { for (let i = 0; i < req.fids.length; i++) { const f = S.files[req.fids[i]]; if (!f || !f.got) return { ok: false, error: 'Slack said file_not_found' }; if (f.got < f.want) return { ok: false, error: 'upload incomplete (' + f.got + ' of ' + f.want + ' bytes)' }; }
      put({ kind: 'fids', names: req.fids.map(x => S.files[x].name), sizes: req.sizes, got: req.fids.map(x => S.files[x].got), rid: req.rid, ch: req.ch, root: req.root, text: req.text }); return { ok: true, root: req.root, files: req.fids.length }; }
    S.b64++; put({ kind: 'b64', names: (req.files || []).map(f => f.name), bytes: (req.files || []).map(f => Buffer.from(f.b64, 'base64').length), rid: req.rid, ch: req.ch, root: req.root, text: req.text }); return { ok: true, root: req.root, files: (req.files || []).length }; }
  return { ok: false, error: 'the relay does not know "' + req.op + '"' }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } if (/costs?\.enc|costing\.enc/.test(u)) { rs.statusCode = 404; return rs.end('nf'); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } console.log('   (timed out: ' + what + ')'); return false; }
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const errs = [], dialogs = []; const out = []; const ok = (n, v) => out.push([n, !!v]);
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/script\.google\.com/, async (route) => { const b = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await ctx.route(/ntfy\.sh/, r => r.abort());
  await ctx.route(/files\.slack\.com\/upload\//, async (route) => { S.slackHits++; if (S.down) return route.abort('failed'); while (S.hold) await sleep(100);
    const id = route.request().url().split('/upload/')[1].split(/[?#]/)[0], f = S.files[id], n = (route.request().postDataBuffer() || Buffer.alloc(0)).length;
    if (S.lose > 0) S.lose--; else if (f) f.got = n; route.fulfill({ status: 200, body: 'OK', headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {}); });
  await ctx.route(/sj-fast\.test/, async (route) => { const rq = route.request(), H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H }); S.fastHits++; const u = new URL(rq.url()); S.fastKeys.push(u.searchParams.get('k'));
    if (S.refuse) return route.fulfill({ status: 200, headers: H, contentType: 'application/json', body: JSON.stringify({ ok: false, status: 413, text: '<html>Request Entity Too Large</html>' }) });
    const id = String(u.searchParams.get('u')).split('/upload/')[1], f = S.files[id]; if (f) f.got = (rq.postDataBuffer() || Buffer.alloc(0)).length;
    route.fulfill({ status: 200, headers: H, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 200, text: 'OK' }) }); });
  const boot = async (me) => { const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
    await pg.goto(URL0); await pg.evaluate(a => { localStorage.clear(); localStorage.setItem('sj_memo_pw', a.pw); localStorage.setItem('sj_me', a.me); try { indexedDB.deleteDatabase('sj-cc-outbox'); } catch (e) {} }, { pw: PW, me }); await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); return pg; };
  const openChat = async (pg) => { await pg.click('#nav button[data-nv="chats"]'); await pg.waitForSelector('.ccrow[data-ch="direct"]', { timeout: 10000 }); await pg.click('.ccrow[data-ch="direct"]'); await pg.waitForSelector('.ccm', { timeout: 8000 }); };
  const pick = (pg, name, mb, type) => pg.setInputFiles('#ccfile', { name, mimeType: type || (/mp4$/.test(name) ? 'video/mp4' : 'image/jpeg'), buffer: Buffer.alloc(Math.round(mb * 1024 * 1024), 7) });
  const post = name => S.posts.find(p => (p.names || []).includes(name));
  const q = pg => pg.evaluate(() => window.__cco.CCO().q.map(x => ({ rid: x.rid, tries: x.tries || 0, stuck: !!x.stuck, files: x.files ? x.files.length : 0, err: x.err || '' })));

  // 1. a 25-MB video: not refused, original bytes straight to Slack, nothing through Google as base64
  const pg = await boot('Muhammad'); await openChat(pg);
  await pick(pg, 'VID_25.mp4', 25); await sleep(300);
  ok('a 25-MB video is taken (no "too big" message)', !dialogs.some(d => /too big|18 MB/i.test(d)) && (await pg.$$eval('#ccpend span', L => L.length)) === 1);
  await pg.click('#ccsend'); await until(() => !!post('VID_25.mp4'), 30000, 'video posted');
  const p1 = post('VID_25.mp4') || {};
  ok('the video reached Slack in full, straight from the phone', p1.kind === 'fids' && p1.sizes[0] === 25 * 1024 * 1024 && p1.got[0] >= 25 * 1024 * 1024 && p1.ch === 'direct' && p1.root === ROOT);
  ok('nothing went through the relay as base64', S.b64 === 0);
  await until(async () => (await q(pg)).length === 0, 8000, 'outbox empty'); ok('the outbox is empty after it', (await q(pg)).length === 0);
  await until(() => pg.evaluate(() => ![...document.querySelectorAll('.ccm')].some(e => e.classList.contains('pend'))), 8000, 'no pending bubble'); ok('its bubble is no longer "sending"', await pg.evaluate(() => ![...document.querySelectorAll('.ccm')].some(e => e.classList.contains('pend'))));

  // 2. the page is reloaded while a photo is on its way (app update / the phone closed the page): it is still sent
  S.hold = true; const hits0 = S.slackHits; await pick(pg, 'IMG_RELOAD.jpg', 4); await pg.click('#ccsend'); await until(() => S.slackHits > hits0, 10000, 'upload started'); await sleep(400);
  await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); S.hold = false;
  ok('after a reload the photo is still in the outbox', (await until(async () => (await q(pg)).some(x => x.files === 1) || !!post('IMG_RELOAD.jpg'), 6000, 'outbox reloaded')));
  await until(() => !!post('IMG_RELOAD.jpg'), 30000, 'photo posted after reload'); const p2 = post('IMG_RELOAD.jpg') || {};
  ok('… and it reaches Slack by itself, once, in full', p2.kind === 'fids' && p2.got[0] >= 4 * 1024 * 1024 && S.posts.filter(p => (p.names || []).includes('IMG_RELOAD.jpg')).length === 1);

  // 3. a video that will not go does not hold back a text; after 6 tries it waits with Try again / Remove, never thrown away
  await openChat(pg); S.down = true; await pick(pg, 'VID_DOWN.mp4', 20); await pg.click('#ccsend'); await sleep(1200);
  await pg.fill('#cctxt', 'text after the video'); await pg.click('#ccsend');
  ok('a text written after a stuck video still goes', await until(() => S.posts.some(p => p.kind === 'text' && p.text === 'text after the video'), 15000, 'text posted'));
  ok('the video is still in the outbox (not thrown away)', (await q(pg)).some(x => x.files === 1));
  await pg.evaluate(() => { const v = window.__cco.CCO().q.find(x => x.files); v.tries = 5; v.next = 0; return window.__cco.run(true); }); await until(async () => (await q(pg)).some(x => x.stuck), 20000, 'stuck');
  ok('after 6 tries it waits in the chat with the reason and two buttons', (await pg.$$('.ccm.pend [data-ccretry]')).length === 1 && (await pg.$$('.ccm.pend [data-ccdrop]')).length === 1 && /line dropped during the upload \(20 MB\)/.test(await pg.$eval('.ccm.pend .ccwhy', e => e.textContent).catch(() => '')));
  ok('no "Not sent" pop-up threw it away', !dialogs.some(d => /^Not sent/.test(d)));
  S.down = false; await pg.click('.ccm.pend [data-ccretry]'); ok('Try again sends it', await until(() => !!post('VID_DOWN.mp4'), 30000, 'video posted after Try again'));
  // Remove
  S.down = true; await pick(pg, 'VID_DROP.mp4', 19); await pg.click('#ccsend'); await sleep(800); await pg.evaluate(() => { const v = window.__cco.CCO().q.find(x => x.files); v.tries = 5; v.next = 0; return window.__cco.run(true); }); await pg.waitForSelector('.ccm.pend [data-ccdrop]', { timeout: 20000 }).catch(() => {});
  await pg.click('.ccm.pend [data-ccdrop]').catch(() => {}); await sleep(500); S.down = false;
  ok('Remove takes it out of the outbox and the chat', (await q(pg)).length === 0 && !(await pg.evaluate(() => [...document.querySelectorAll('.ccm')].some(e => /VID_DROP/.test(e.textContent)))) && !post('VID_DROP.mp4'));

  // 4. bytes that never arrived (the answer looked fine): the relay refuses, the phone uploads again by itself
  S.lose = 1; await pick(pg, 'IMG_LOST.jpg', 3); await pg.click('#ccsend');
  ok('an upload that got lost is sent again by itself', await until(() => !!post('IMG_LOST.jpg'), 30000, 'photo posted after a lost upload') && (post('IMG_LOST.jpg') || {}).got[0] >= 3 * 1024 * 1024);

  // 5. through the fast lane when the relay names one: Slack's real answer comes back
  S.fast = true; const fh = S.fastHits; await pick(pg, 'IMG_FAST.jpg', 2); await pg.click('#ccsend'); await until(() => !!post('IMG_FAST.jpg'), 20000, 'fast photo');
  ok('with a fast lane the file goes through it, exact bytes, with the phone key', S.fastHits === fh + 1 && (post('IMG_FAST.jpg') || {}).got[0] === 2 * 1024 * 1024 && S.fastKeys[S.fastKeys.length - 1] === KEY);
  S.refuse = true; await pick(pg, 'VID_413.mp4', 6); await pg.click('#ccsend');
  ok('Slack refusing the upload is said in words in the bubble', await until(async () => /Slack answered 413/.test(await pg.$eval('#ccbody', e => e.textContent)), 15000, '413 shown'));
  S.refuse = false; await pg.evaluate(() => { window.__cco.CCO().q.forEach(x => { x.next = 0; }); return window.__cco.run(true); }); ok('… and it goes once Slack takes uploads again', await until(() => !!post('VID_413.mp4'), 20000, 'video after 413'));
  S.fast = false;

  // 6. the app does not update itself over a picked file (coming back from the gallery used to reload the page)
  await ctx.route(/memo\.html\?t=/, route => route.fulfill({ status: 200, contentType: 'text/html', body: "<script>var VER = '2099-01-01a';</script>" }));
  await pick(pg, 'IMG_PICKED.jpg', 1); await pg.evaluate(() => { window.__cco.checkVer(); }); await sleep(1500);
  ok('a newer app version does not reload the page while a photo is picked', !/v=2099/.test(pg.url()) && (await pg.$$eval('#ccpend span', L => L.length)) === 1);
  await pg.click('#ccpend span'); await pg.evaluate(() => { window.__cco.checkVer(); }); ok('… and it does update once nothing is waiting', await until(() => /v=2099/.test(pg.url()), 8000, 'reloaded to the new version'));
  await ctx.unroute(/memo\.html\?t=/); await pg.waitForSelector('#feed .design', { timeout: 15000 });

  // 7. an old relay (no upurl yet): a small photo still goes the old way; a big video says why and comes back to the box
  S.old = true; await openChat(pg); const b0 = S.b64; await pick(pg, 'IMG_OLD.jpg', 2); await pg.click('#ccsend'); await until(() => !!post('IMG_OLD.jpg'), 20000, 'old-way photo');
  ok('old relay: a small photo still goes (the old way)', S.b64 === b0 + 1 && (post('IMG_OLD.jpg') || {}).bytes[0] === 2 * 1024 * 1024);
  await pick(pg, 'VID_OLD.mp4', 25); await pg.click('#ccsend');
  ok('old relay: a big video says the relay must be updated and comes back to the box', await until(() => dialogs.some(d => /new relay version/.test(d)), 15000, 'message') && (await pg.$$eval('#ccpend span', L => L.length)) === 1);
  S.old = false;

  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
