// Bill numbers (9 Nov 2026, Abbas: "invoice and receipt numbers go high and low randomly") — real relay.gs + fake Sheet + real memo.html:
// (1) an iPad with SJ Stock open in several places, each restoring the same old empty receipt RV-0021 of 23 Oct, reserved one number per copy
// again and again (RV-0026 … RV-0064 on 8 Nov); (2) a SENT receipt stayed open, was changed to another customer and sent again under its old
// number — it replaced Islamudin's line; (3) numbers typed by hand (RV-00, RV-001).
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), F = require(require('path').join(__dirname, '..', 'tools', 'test', 'fakes'));
const PW = 'shop-test-pw';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const W = F.makeWorld(), relay = F.makeRelay(W, { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-t' });
function fakeSS(){ const sheets = {}; const mk = name => { const rows = []; const sh = { rows, getName: () => name, setName: n => { name = n; return sh; }, appendRow: r => { rows.push(r.map(x => String(x == null ? '' : x))); return sh; }, setFrozenRows: () => sh,
    getRange: (a, b, c, d) => { if (typeof a === 'string') return { setNumberFormat: () => {} }; const r0 = a - 1, c0 = b - 1; return { setValue: v => { rows[r0][c0] = String(v); }, setValues: vs => { vs.forEach((vr, i) => { rows[r0 + i] = rows[r0 + i] || []; vr.forEach((v, j) => { rows[r0 + i][c0 + j] = String(v == null ? '' : v); }); }); }, setNumberFormat: () => {} }; },
    getDataRange: () => ({ getDisplayValues: () => rows.map(r => r.slice()) }), getLastRow: () => rows.length }; return sh; };
  const ss = { getId: () => 'ss1', getName: () => 'fake', getUrl: () => 'http://x', getSheets: () => Object.values(sheets), getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mk(n)) }; sheets.Sheet1 = mk('Sheet1'); return ss; }
const SS = {}; relay.ctx.SpreadsheetApp = { openById: id => SS[id], create: () => { const ss = fakeSS(); SS.ss1 = ss; return ss; } };
const call = (dev, o) => { const req = JSON.stringify(Object.assign({ t: Date.now(), dev, by: 'T' }, o)); return JSON.parse(relay.post(JSON.stringify({ job: 'bills', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
// the shop: receipts up to RV-0025 SENT by the employee's phone, plus the old stale drafts of this device
for (let n = 1; n <= 25; n++) call('emp', { op: 'put', type: 'rv', ref: 'RV-' + String(n).padStart(4, '0'), name: 'C' + n, status: 'sent', total: '100', date: '2026-11-01', data: '{"v":1}' });
const sheet = () => SS.ss1.getSheetByName('BILLS').rows;
let nexts = 0; const log = [];
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/javascript'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }); const errs = [];
  await ctx.route(/script\.google\.com/, async r => { const body = r.request().postData() || '{}'; let b = {}; try { b = JSON.parse(body); } catch (e) {}
    if (b.job === 'bills') { const q = JSON.parse(b.req); if (q.op === 'next') { nexts++; log.push(q.ref); } await new Promise(z => setTimeout(z, 400)); return r.fulfill({ contentType: 'application/json', body: relay.post(body) }); }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [], names: [] }) }); });
  await ctx.route(/ntfy\.sh|github/, r => r.abort());
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.goto(URL0);
  await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'ABBAS'); localStorage.setItem('sj_dev', '9plzku');
    localStorage.setItem('sj_work', JSON.stringify({ t: Date.now(), state: {}, prices: {}, name: '', rv: { ref: 'RV-0021', date: '2026-10-23', name: '', open: '', note: '', amount: '', modeP: 'Cash', chq: '', disc: '' }, open: 'rv' })); }, PW);
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  await pg.evaluate(() => { const w = JSON.parse(localStorage.getItem('sj_work')); w.open = 'rv'; localStorage.setItem('sj_work', JSON.stringify(w)); });
  const pgs = [pg]; for (let k = 0; k < 2; k++) { const p = await ctx.newPage(); p.on('dialog', d => d.accept()); pgs.push(p); }
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await Promise.all(pgs.map(p => p.goto(URL0))); await pg.waitForTimeout(6000);
    seen.push((await Promise.all(pgs.map(p => p.evaluate(() => (window.__sj.B().rv || {}).ref)))).join(','));
    await Promise.all(pgs.map(p => p.evaluate(() => window.dispatchEvent(new Event('pagehide')))));
  }
  const rows9 = sheet().filter(r => r[1] === 'rv' && r[8] === '9plzku' && r[3] === 'draft');
  ok('three copies of the app with the same old receipt: one number, the same on all, no number reserved (' + seen.join(' | ') + ', next calls ' + nexts + ')', nexts === 0 && rows9.length === 0 && seen.every(x => x === 'RV-0026,RV-0026,RV-0026'));
  for (const p of pgs.slice(1)) await p.close();
  // a sent receipt is locked; the number box is never typed in
  await pg.addInitScript(() => { window.navigator.canShare = () => false; }); await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(2500);
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(800);
  await pg.$eval('#mode button[data-m="rv"]', e => e.click()); await pg.waitForTimeout(500);
  ok('the number box cannot be typed in', await pg.$eval('#bform input[data-k="ref"]', e => e.readOnly));
  await pg.fill('#bform input[data-k="name"]', 'ISLAMUDIN'); await pg.waitForTimeout(1500); await pg.fill('#bform input[data-k="amount"]', '5000'); await pg.waitForTimeout(800);
  await pg.click('#dsend'); await pg.waitForTimeout(4000);
  const sent = await pg.evaluate(() => { const b = window.__sj.B().rv; const a = document.querySelector('#bform input[data-k="amount"]'), n = document.querySelector('#bform input[data-k="name"]'); return { st: b.status, ref: b.ref, a: !!a && a.disabled, n: !!n && n.disabled, t: document.querySelector('#bform').textContent }; });
  ok('a sent receipt is locked: name and amount cannot be changed (' + sent.ref + ' ' + sent.st + ')', sent.st === 'sent' && sent.a && sent.n && /was sent — it cannot be changed/.test(sent.t));
  await pg.click('#dnew'); await pg.waitForTimeout(600);
  const fresh = await pg.evaluate(() => { const b = window.__sj.B().rv; const a = document.querySelector('#bform input[data-k="amount"]'); return { ref: b.ref, st: b.status || '', a: !!a && !a.disabled }; });
  ok('New number: a fresh receipt after it, open to type (' + fresh.ref + ')', fresh.a && !fresh.st && fresh.ref !== sent.ref && +fresh.ref.slice(3) > +sent.ref.slice(3));
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed'); if (errs.length) console.log('errors', errs.slice(0, 3));
  await br.close(); srv.close(); if (!out.every(o => o[1])) process.exit(1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
