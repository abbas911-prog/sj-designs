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
  const ss = { getId: () => 'ss1', getName: () => 'fake', getUrl: () => 'http://x', getSheets: () => Object.values(sheets), getSheetByName: n => Object.values(sheets).find(x => x.getName() === n) || null, insertSheet: n => (sheets[n] = mk(n)) }; sheets.Sheet1 = mk('Sheet1'); return ss; }
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
    if (b.job === 'cust') return r.fulfill({ contentType: 'application/json', body: relay.post(body) });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [], names: [] }) }); });
  await ctx.route(/ntfy\.sh|github/, r => r.abort());
  const dlg = []; let refuse = null;
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { dlg.push(d.message()); if (refuse && refuse.test(d.message())) d.dismiss(); else d.accept(); });
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
  const look = () => pg.evaluate(() => { const b = window.__sj.B().rv || {}; const a = document.querySelector('#bform input[data-k="amount"]'), n = document.querySelector('#bform input[data-k="name"]'); return { st: b.status || '', ref: b.ref, amt: b.amount, name: b.name, ed: !!b.editing, a: !!a && a.disabled, n: !!n && n.disabled, lock: !!document.querySelector('#vlock'), nb: !!document.querySelector('#vlock [data-vnew]'), fb: !!document.querySelector('#vlock [data-vfix]'), t: document.querySelector('#bform').textContent }; });
  const ent = () => { const sh = SS.ss1.getSheetByName('ENTRIES'); return sh ? sh.rows.filter(r => /^rv:/.test(r[0]) && !r[12]) : []; };
  const sent = await look();
  ok('a sent receipt is locked: name and amount cannot be changed (' + sent.ref + ' ' + sent.st + ')', sent.st === 'sent' && sent.a && sent.n && sent.lock && /was sent/.test(sent.t));
  ok('…and it offers two clear buttons: New receipt, Correct this receipt', sent.nb && sent.fb);
  const e1 = ent().filter(r => r[4] === sent.ref);
  ok('its line is on the customer\'s statement (5,000)', e1.length === 1 && +e1[0][7] === 5000 && /ISLAMUDIN/i.test(e1[0][2]));
  // 12 Nov 2026 (Abbas: "my employee was trying to make a receipt and wanted to edit it — he could not"): the sent receipt stayed on the screen, greyed out.
  // Coming back to the Receipt tab now gives the NEXT receipt
  await pg.$eval('#mode button[data-m="pv"]', e => e.click()); await pg.waitForTimeout(300); await pg.$eval('#mode button[data-m="rv"]', e => e.click()); await pg.waitForTimeout(600);
  const fresh = await look();
  ok('leave the Receipt tab and come back: a new receipt, open to type (' + sent.ref + ' → ' + fresh.ref + ')', !fresh.a && !fresh.st && !fresh.lock && +fresh.ref.slice(3) === +sent.ref.slice(3) + 1 && !fresh.amt);
  // the app starting again with a sent receipt in its saved work
  await pg.addInitScript(() => { const t = localStorage.getItem('test_work'); if (t) { localStorage.setItem('sj_work', t); localStorage.removeItem('test_work'); } });
  await pg.evaluate(r => { const w = JSON.parse(localStorage.getItem('sj_work')); w.rv = { ref: r, date: '2026-11-09', name: 'ISLAMUDIN', open: '0', note: '', amount: '5000', modeP: 'Cash', chq: '', disc: '', status: 'sent' }; w.open = 'rv'; localStorage.setItem('test_work', JSON.stringify(w)); }, sent.ref);
  await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(3000);
  const boot = await look();
  ok('the app opened again with that sent receipt saved on the phone: a new receipt, not the old one greyed out (' + boot.ref + ')', !boot.lock && !boot.a && boot.st !== 'sent' && +String(boot.ref).slice(3) > +sent.ref.slice(3));
  // the sent one is in Saved bills; a mistake in it can be corrected, and it stays the same receipt
  await pg.evaluate(r => window.__sj.bsOpen(r), sent.ref); await pg.waitForTimeout(2500);
  const again = await look();
  ok('opened from Saved bills it is locked, with the buttons (' + again.ref + ')', again.ref === sent.ref && again.lock && again.fb && again.a);
  dlg.length = 0; await pg.click('#vlock [data-vfix]'); await pg.waitForTimeout(600);
  const ed = await look();
  ok('Correct this receipt (asked first): the boxes open', dlg.some(m => /Correct RV-/.test(m)) && ed.ed && !ed.a && !ed.n && /Correcting/.test(ed.t));
  await pg.fill('#bform input[data-k="amount"]', '4500'); await pg.waitForTimeout(600); await pg.click('#dsend'); await pg.waitForTimeout(4500);
  const fixed = await look(), e2 = ent().filter(r => r[4] === sent.ref), allIsl = ent().filter(r => /ISLAMUDIN/i.test(r[2]));
  ok('Send: the same receipt, now 4,500 — one line on the statement, not two (' + allIsl.map(r => r[4] + '=' + r[7]).join(', ') + ')', fixed.ref === sent.ref && fixed.st === 'sent' && fixed.lock && e2.length === 1 && +e2[0][7] === 4500 && allIsl.length === 1);
  const rowsRef = sheet().filter(r => r[0] === sent.ref && r[3] !== 'deleted');
  ok('…and one saved bill with that number', rowsRef.length === 1 && rowsRef[0][3] === 'sent');
  // changing the customer on a correction asks first
  dlg.length = 0; await pg.click('#vlock [data-vfix]'); await pg.waitForTimeout(500); await pg.fill('#bform input[data-k="name"]', 'MATIULLAH'); await pg.waitForTimeout(1800);
  refuse = /was sent for/; await pg.click('#dsend'); await pg.waitForTimeout(2500); refuse = null;
  const e3 = ent().filter(r => r[4] === sent.ref);
  ok('a correction that changes the customer asks first; Cancel = nothing changes on the statement', dlg.some(m => /was sent for ISLAMUDIN/.test(m)) && e3.length === 1 && /ISLAMUDIN/i.test(e3[0][2]) && +e3[0][7] === 4500);
  await pg.click('#vedit [data-vundo]'); await pg.waitForTimeout(500);
  const back = await look();
  ok('Leave it as it was: back to the sent receipt, locked', back.lock && back.name === 'ISLAMUDIN' && String(back.amt) === '4500' && !back.ed);
  await pg.click('#vlock [data-vnew]'); await pg.waitForTimeout(600);
  const nw = await look();
  ok('＋ New receipt: the next number, open to type (' + nw.ref + ')', !nw.lock && !nw.a && !nw.st && +nw.ref.slice(3) > +sent.ref.slice(3));
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed'); if (errs.length) console.log('errors', errs.slice(0, 3));
  await br.close(); srv.close(); if (!out.every(o => o[1])) process.exit(1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
