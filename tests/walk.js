// Walk through the app like a user, with Google answering after DELAY ms (default 2000 = real relay speed) and phone-speed CPU.
// Prints how long each screen takes until it is usable. Not pass/fail: NODE_PATH=$(npm root -g) node tests/walk.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234', DELAY = +(process.env.DELAY || 2000);
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const thumbs = fs.readdirSync(path.join(DIR, 'thumbs')).filter(f => f.endsWith('.jpg')).map(f => f.replace('.jpg', ''));
const cards = []; for (let i = 0; i < 300; i++) { const nc = 2 + i % 3, q = Array.from({ length: nc }, (_, j) => 4 + ((i + j) % 9)); cards.push({ id: 'c' + String(i).padStart(5, '0'), idShort: i, list: 'r', name: 'SJ-' + (40000 + i) + ' (' + q.reduce((a, b) => a + b, 0) + ') colour = (' + nc + ') (' + q.join('/') + ')', attachments: [{ id: thumbs[i % thumbs.length], mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }); }
const enc = lock({ updated: new Date().toISOString(), cards });
const msgs = []; for (let i = 0; i < 40; i++) msgs.push({ ts: (1760700000 + i * 600) + '.1', who: ['Matiullah', 'Abbas', 'Musalim'][i % 3], text: 'Message number ' + i + (i % 7 === 0 ? ' with a longer line of text so the bubble wraps on the phone screen' : ''), files: [] });
const ORDS = [{ id: 'o1', name: '#50 Matiullah naif', created: Date.now() - 86400000, items: [{ no: '40001', pcs: 8, c: 'C1 8' }, { no: '40002', pcs: 4, c: 'C2 4' }], pcs: 12, steps: { s1: { by: 'M', t: 1 } }, gts: '1760900000.1', cts: '1760900000.2' }];
const BILLS = {}; for (let i = 1; i <= 30; i++) BILLS['INV-' + String(i).padStart(4, '0')] = { ref: 'INV-' + String(i).padStart(4, '0'), type: 'inv', name: 'CUSTOMER ' + i, status: 'included', total: '1,000.00', date: '2026-10-' + (10 + i % 10), updated: '2026-10-18T19:00:00Z', data: JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-' + String(i).padStart(4, '0'), name: 'CUSTOMER ' + i, man: [] }, cols: [] }) };
const posts = [];
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'live') return { ok: true, cards };
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) }; if (req.op === 'get') return Object.assign({ ok: true }, BILLS[req.ref]); return { ok: true, status: req.status }; }
  if (b.job === 'orders') { if (req.op === 'tick') { ORDS[0].steps[req.step] = req.on ? { by: req.by, t: Date.now() } : null; } return { ok: true, orders: ORDS }; }
  if (b.job === 'cchat') { if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [{ k: 'MATIULLAH', name: 'MATIULLAH', last: '1760700000.1', memos: 2, chat: 3, un: 0, tx: '' }], orders: [], gun: {} };
    if (req.op === 'thread') return { ok: true, name: 'MATIULLAH', root: req.root || '1760690000.2', msgs: [{ ts: '1760690000.2', who: 'Order memo', memo: true, text: 'MATIULLAH · 2 designs', files: [] }].concat(msgs).concat(posts.filter(p => p.root === (req.root || '')).map(p => ({ ts: p.ts, who: p.who, text: p.text, files: [] }))) };
    if (req.op === 'post') { posts.push({ root: req.root || '', who: req.who, text: req.text, ts: String(Date.now() / 1000) }); return { ok: true, ts: '1' }; } return { ok: true, customers: [], orders: [] }; }
  if (b.job === 'cust') return { ok: true, list: [], names: [], found: false };
  return { ok: true }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, decodeURIComponent(u.slice(1))); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : u.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'); rs.setHeader('etag', '"w1"'); if (rq.headers['if-none-match'] === '"w1"') { rs.statusCode = 304; return rs.end(); } return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  let bytes = 0; pg.on('response', async r => { try { if (r.status() === 200 && /memo\.html/.test(r.url())) bytes += (await r.body()).length; } catch (e) {} });
  await pg.route(/script\.google\.com/, async r => { await new Promise(x => setTimeout(x, DELAY)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }); });
  await pg.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  const cdp = await pg.context().newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const step = async (label, fn, sel, pred) => { const s = Date.now(); try { await fn(); if (sel) await pg.waitForFunction(([q, p]) => [...document.querySelectorAll(q)].some(e => e.getClientRects().length > 0 && (!p || new RegExp(p).test(e.textContent))), [sel, pred || ''], { timeout: 20000 }); console.log(label.padEnd(40), String(Date.now() - s).padStart(6), 'ms'); } catch (e) { console.log(label.padEnd(40), '  FAIL', e.message.split('\n')[0].slice(0, 60)); } };
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW);
  await step('open app (first visit)', () => pg.reload(), '#feed .design:not([hidden])');
  await pg.waitForTimeout(3500);
  await step('Chats tab → list', () => pg.click('#nav button[data-nv="chats"]'), '.ccrow');
  await step('open a chat → messages', () => pg.click('.ccrow'), '.ccm:not(.memo)');
  await step('send a line → shows', async () => { await pg.fill('#cctxt', 'Ok sending tomorrow'); await pg.click('#ccsend'); }, '.ccm.me', 'Ok sending');
  await step('… line confirmed sent', () => Promise.resolve(), '.ccm.me:not(.pend)', 'Ok sending');
  await step('Orders tab → list', () => pg.click('#nav button[data-nv="orders"]'), '#ordbody [data-ot]');
  await step('open order → screen', () => pg.click('#ordbody [data-ot="o1"]'), '.optiles');
  await step('order chat → messages', () => Promise.resolve(), '#ccbody .ccm:not(.memo)');
  await step('tap step bar → ticks', () => pg.click('[data-ofold]'), '#ccbody .ock[data-ok="s2"]');
  await step('tick a step → tick shows', () => pg.click('#ccbody .ock[data-ok="s2"]'), '#ccbody .ock.on[data-ok="s2"]');
  await step('#customer tab → messages', () => pg.click('.otabs2 [data-och="c"]'), '#ccbody .ccm:not(.memo)');
  await step('back to Orders', () => pg.click('#ccback'), '#ordbody [data-ot]');
  await step('More → Bills → form', async () => { await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); }, '#bform input[data-k="name"]');
  await step('Saved bills → list', () => pg.click('#dsaved'), '.bsrow');
  await step('open a saved bill → form', () => pg.click('.bsrow'), '#bform input[data-k="name"]');
  await step('Stock tab', () => pg.click('#nav button[data-nv="stock"]'), '#feed .design:not([hidden])');
  const b0 = bytes; await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(2500);
  console.log('app comes to the front again: downloaded', Math.round((bytes - b0) / 1024), 'KB');
  await pg.evaluate(() => { localStorage.setItem('sj_me', 'Abbas'); }); const t2 = Date.now(); await pg.reload(); await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 20000 }); console.log('open app (second visit)'.padEnd(40), String(Date.now() - t2).padStart(6), 'ms');
  await step('2nd visit: Chats tab → list', () => pg.click('#nav button[data-nv="chats"]'), '.ccrow');
  await step('2nd visit: open chat → messages', () => pg.click('.ccrow'), '.ccm:not(.memo)');
  await step('2nd visit: Orders → list', () => pg.click('#nav button[data-nv="orders"]'), '#ordbody [data-ot]');
  await step('2nd visit: Saved bills → list', async () => { await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.click('#dsaved'); }, '.bsrow');
  await pg.screenshot({ path: path.join(__dirname, 'shot-walk.png') });
  console.log('page errors', errs.slice(0, 3)); await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
