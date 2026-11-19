// 50-50 price box (19 Nov 2026, Abbas: "Nawroz's bill still shows 0 in 50-50"): INV-0056 went green with NO price, bills.enc holds 0. The price box is
// now empty and red ("price"), and a typed price can be SAVED into the bill for every phone and Jarvis (stock job op billprice).
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', pos: 3000, name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }, { id: 'c0', idShort: 2, list: 'r', pos: 1000, name: 'SJ-18634 (40) colour = (5) (8/8/8/8/8)', attachments: [] }, { id: 'b9', idShort: 3, list: 'r', pos: 2000, name: 'SJ-18634 (12) colour = (3) (4/4/4)', attachments: [] }] });   // 31 Oct 2026: three READY cards named 18634; from the top of READY: 18634-1 = c0 (40 pcs), 18634-2 = b9 (12 pcs), 18634-3 = c1 (newest = the plain 18634 in the app)
let BL = { bills: [{ ref: 'INV-0056', dev: 'seklcj', st: 'open', t: 1, date: '2026-11-16', name: '#47 Nawroz naif', pcs: 4, sub: 0, total: 0, stock_ok: true, lines: [{ no: '18634', qty: 4, rate: 0, amount: 0 }] }], batches: [] };
const STK = [];
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0];
  if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  if (u === '/bills.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(lock(BL))); }
  const f = path.join(DIR, u.slice(1) || 'memo.html'); if (!/costs?\.enc|costing/.test(u) && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => { try { const b = JSON.parse(r.request().postData() || '{}'); if (b.job === 'stock') { const q = JSON.parse(b.req); STK.push(q);
      if (q.op === 'billprice') BL.bills.forEach(x => { if (x.ref === 'INV-0056') Object.keys(q.rates).forEach(i => { const l = x.lines[+i]; l.rate = q.rates[i]; l.amount = l.qty * l.rate; x.total = x.sub = l.amount; }); }); } } catch (e) {}
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [] }) }); });
  await pg.route(/ntfy\.sh|api\.github|raw\.githubusercontent/, r => r.abort());
  await pg.route(/raw\.githubusercontent\.com\/.*\/jobs\//, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, bill: '1 price(s) saved in the 50-50 bill' }) }));   // after the block: the last route wins
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_owner_pin', '1234');
    localStorage.setItem('sj_costs', JSON.stringify({ d: '2026-11-19', c: { '18634': 100 } })); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  await pg.evaluate(() => document.getElementById('ffbtn').click()); await pg.waitForSelector('#ffbody .ffb', { timeout: 15000 }); await pg.waitForTimeout(300);
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const box = () => pg.$eval('#ffbody input[data-f="rate"][data-i="0"]', e => ({ v: e.value, need: e.classList.contains('need'), ph: e.placeholder }));
  const b0 = await box();
  ok('no price on the bill: the price box is EMPTY and red ("price"), not a "0" (' + JSON.stringify(b0) + ')', b0.v === '' && b0.need && b0.ph === 'price');
  ok('no Save button before a price is typed', !(await pg.$('#ffbody [data-fprice]')));
  await pg.fill('#ffbody input[data-f="rate"][data-i="0"]', '125'); await pg.press('#ffbody input[data-f="rate"][data-i="0"]', 'Tab'); await pg.waitForTimeout(900);
  const sv = await pg.$eval('#ffbody [data-fprice]', e => e.textContent).catch(() => '');
  ok('typed 125: a Save button for every phone and Jarvis (' + sv + ')', /Save SJ-18634 at 125/.test(sv) && /INV-0056/.test(sv));
  await pg.click('#ffbody [data-fprice]'); await pg.waitForTimeout(8000);
  const q = STK.filter(x => x.op === 'billprice')[0] || {};
  ok('the stock job is asked to save 125 into INV-0056 (seklcj)', q.rates && +q.rates['0'] === 125 && JSON.stringify(q.refs) === JSON.stringify([['INV-0056', 'seklcj']]));
  const b1 = await box(), note = await pg.$eval('#ff', e => e.textContent), sv2 = !!(await pg.$('#ffbody [data-fprice]')), ed = await pg.evaluate(() => localStorage.getItem('sj_ff'));
  ok('after saving: the bill is read again — 125 from the bill itself, no red box, no Save button (' + JSON.stringify(b1) + ')', b1.v === '125' && !b1.need && !sv2 && /price saved/.test(note) && !/rate/.test(ed || ''));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
