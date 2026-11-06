// 50-50 screen, a design with variants (6 Nov 2026, Abbas on the iPad: "I change 75308 to 75308-B — when I click on B it still stays the same"):
// each variant is a tap button with its cost; tapping 75308-B uses its cost, the new price follows, the pick stays after the app is opened again.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', pos: 3000, name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }, { id: 'c0', idShort: 2, list: 'r', pos: 1000, name: 'SJ-18634 (40) colour = (5) (8/8/8/8/8)', attachments: [] }, { id: 'b9', idShort: 3, list: 'r', pos: 2000, name: 'SJ-18634 (12) colour = (3) (4/4/4)', attachments: [] }] });   // 31 Oct 2026: three READY cards named 18634; from the top of READY: 18634-1 = c0 (40 pcs), 18634-2 = b9 (12 pcs), 18634-3 = c1 (newest = the plain 18634 in the app)
const bills = lock({ bills: [{ ref: 'INV-0022', dev: 'd1', st: 'open', t: 1, date: '2026-10-21', name: 'Musalim', pcs: 21, sub: 2880, stock_ok: true,
  lines: [{ no: '75308', qty: 6, rate: 75, amount: 450 }, { no: '18634', qty: 12, rate: 150, amount: 1800 }, { no: '18747', qty: 9, rate: 120, amount: 1080 }] },
  { ref: 'INV-0023', dev: 'd1', st: 'open', t: 2, date: '2026-10-22', name: 'Nasir', pcs: 60, sub: 7200, stock_ok: true,
    lines: Array.from({ length: 10 }, (_, i) => ({ no: String(20001 + i), qty: 6, rate: 120, amount: 720 })) }], batches: [] });
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0];
  if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  if (u === '/bills.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(bills)); }
  const f = path.join(DIR, u.slice(1) || 'memo.html'); if (!/costs?\.enc|costing/.test(u) && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const CATS = []; await pg.route(/script\.google\.com/, r => { try { const b = JSON.parse(r.request().postData() || '{}'); if (b.job === 'catalog') CATS.push(JSON.parse(b.req)); } catch (e) {} r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [] }) }); });
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_owner_pin', '1234');
    localStorage.setItem('sj_costs', JSON.stringify({ d: '2026-10-30', c: Object.assign({ '18634': 104.22, '18774': 90, '75308': 108, '75308-B': 60 }, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(20001 + i), 100]))) })); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  await pg.evaluate(() => document.getElementById('ffbtn').click()); await pg.waitForSelector('#ffbody .ffb', { timeout: 15000 }); await pg.waitForTimeout(300);
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const txt = () => pg.$eval('#ffbody', e => e.textContent);
  // 30 Oct 2026 (Abbas, video: "I can't press MAKE BILL — it is hidden down below"): without scrolling, MAKE BILL is on the screen, above the
  const vb = () => pg.$$eval('#ffbody .ffvb', L => L.map(b => (b.classList.contains('on') ? '*' : '') + b.textContent));
  const b0 = await vb(); ok('one button per variant, with its cost (' + b0.join(' | ') + ')', b0.length === 2 && /^\*75308108$/.test(b0[0]) && /^75308-B60$/.test(b0[1]));
  await pg.click('#ffbody .ffvb[data-v="75308-B"]'); await pg.waitForTimeout(500);
  const cost = () => pg.$eval('#ffbody input.ffi[data-i="0"][data-f="cost"]', e => e.value), nw = () => pg.$eval('#ffbody input.ffi[data-i="0"][data-f="nw"]', e => e.value);
  ok('tap 75308-B: its cost 60 is used, new price 68 (60 + half of 15), B is the gold one', await cost() === '60' && await nw() === '68' && (await vb())[1].startsWith('*'));
  ok('the complete bill carries SJ-75308-B', await pg.evaluate(() => /SJ-75308-B/.test(document.querySelector('#ffbody .ffb.all').textContent)));
  await pg.reload(); await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 }); await pg.evaluate(() => document.getElementById('ffbtn').click()); await pg.waitForSelector('#ffbody .ffvb', { timeout: 15000 }); await pg.waitForTimeout(300);
  ok('opened again: still 75308-B, cost 60', await cost() === '60' && (await vb())[1].startsWith('*'));
  await pg.click('#ffbody .ffvb[data-v="75308"]'); await pg.waitForTimeout(500);
  ok('tap 75308 again: back to cost 108', await cost() === '108' && (await vb())[0].startsWith('*'));
  ok('no page errors', !errs.length);
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed'); if (errs.length) console.log(errs);
  await br.close(); srv.close(); if (!out.every(o => o[1])) process.exit(1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
