// A bill that was not sent yet carries TODAY's date (28 Nov 2026). From the shop's sheet: the next receipt is opened the moment the last one
// is sent, so RV-0077 (opened 24 Nov, sent 26 Nov) and RV-0075 went on the customer's statement with an old date. A date typed by hand
// stays; a sent receipt keeps its date.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', pos: 3000, name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const CUSTS = { v: 1, list: [{ name: 'DASTAGIR', country: 'KUWAIT', n: 2, last: '2026-11-14', page: 'dastagir-1114.html' }, { name: 'NASIR (LIBYA)', country: '', n: 3, last: '2026-10-24' }] };
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0];
  if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  if (u === '/cat/customers.json') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(CUSTS)); }
  const f = path.join(DIR, u.slice(1) || 'memo.html'); if (!/\.enc|costing/.test(u) && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  const CATS = []; await pg.route(/script\.google\.com/, r => { let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); if (b.job === 'catalog') CATS.push(JSON.parse(b.req)); } catch (e) {}
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(b.job === 'cust' ? { ok: true, names: ['MATIULLAH', 'DASTAGIR'] } : { ok: true, customers: [], orders: [] }) }); });
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Muhammad'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const today = await pg.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const open = d => pg.evaluate(d => { const B = window.__sj.B(); B.rv = d; window.__sj.setMode('memo'); window.__sj.setMode('rv'); }, d);
  const dv = () => pg.$eval('#bform input[data-k="date"]', e => e.value), bd = () => pg.evaluate(() => window.__sj.B().rv.date);
  await open({ ref: 'RV-0900', date: '2026-11-01', name: 'Somebody New', open: '', amount: '200', modeP: 'Cash' }); await pg.waitForTimeout(300);
  ok('an unsent receipt opened days ago shows today (' + await dv() + ')', await dv() === today && await bd() === today);
  await pg.$eval('#bform input[data-k="date"]', e => { e.value = '2026-11-03'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(200);
  await pg.evaluate(() => { window.__sj.setMode('memo'); window.__sj.setMode('rv'); }); await pg.waitForTimeout(300);
  ok('a date typed by hand stays (' + await dv() + ')', await dv() === '2026-11-03' && await bd() === '2026-11-03');
  await open({ ref: 'RV-0901', date: '2026-11-01', name: 'Somebody New', open: '', amount: '200', modeP: 'Cash', status: 'sent', sentDev: 'zzz' }); await pg.waitForTimeout(300);
  ok('a SENT receipt keeps its own date', await pg.evaluate(() => { const B = window.__sj.B(); return [B.rv.ref, B.rv.date].join(); }) !== 'RV-0901,' + today);
  await pg.evaluate(() => { const B = window.__sj.B(); B.inv = null; B.rn = { ref: 'RET-0900', date: '2026-11-02', name: 'Somebody New', vat: false, inv: '', items: [] }; window.__sj.setMode('rn'); }); await pg.waitForTimeout(300);
  ok('same for an unsent return', await pg.evaluate(() => window.__sj.B().rn.date) === today);
  ok('no page errors (' + errs.join(' | ').slice(0, 200) + ')', !errs.length);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
