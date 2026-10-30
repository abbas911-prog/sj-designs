// 50-50 bills screen (owner): the design number of every line can be corrected by hand (30 Oct 2026, Abbas: "always give me options to edit
// the design number — sometimes there is a design number problem"). A corrected number finds its own cost, the new price follows, the
// revised bill and the COMPLETE BILL (MAKE BILL text) carry the corrected number, Reset puts the written one back.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const bills = lock({ bills: [{ ref: 'INV-0022', dev: 'd1', st: 'open', t: 1, date: '2026-10-21', name: 'Musalim', pcs: 21, sub: 2880, stock_ok: true,
  lines: [{ no: '18634', qty: 12, rate: 150, amount: 1800 }, { no: '18747', qty: 9, rate: 120, amount: 1080 }] }], batches: [] });
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0];
  if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  if (u === '/bills.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(bills)); }
  const f = path.join(DIR, u.slice(1) || 'memo.html'); if (!/costs?\.enc|costing/.test(u) && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [] }) }));
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_owner_pin', '1234');
    localStorage.setItem('sj_costs', JSON.stringify({ d: '2026-10-30', c: { '18634': 104.22, '18774': 90 } })); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  await pg.evaluate(() => document.getElementById('ffbtn').click()); await pg.waitForSelector('#ffbody .ffb', { timeout: 15000 }); await pg.waitForTimeout(300);
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const txt = () => pg.$eval('#ffbody', e => e.textContent);
  ok('every design number is an edit box (bill as written + cost)', (await pg.$$('#ffbody .ffno')).length >= 4);
  ok('SJ-18747 has no cost: revised incomplete', /Revised incomplete/.test(await txt()));
  const box = (await pg.$$('#ffbody input.ffno[data-i="1"]'))[0];
  await box.fill('SJ-18774'); await box.press('Tab'); await pg.waitForTimeout(900);
  const t1 = await txt();
  ok('fixed to SJ-18774: its cost 90 is used, new price 105 (90 + half of 30)', await pg.$eval('#ffbody input.ffi[data-i="1"][data-f="cost"]', e => e.value) === '90' && await pg.$eval('#ffbody input.ffi[data-i="1"][data-f="nw"]', e => e.value) === '105');
  ok('the revised bill is complete and carries SJ-18774 (12 × 127 + 9 × 105 = 2,469)', /Revised 2,469 AED/.test(t1) && !/Revised incomplete/.test(t1));
  ok('the change is shown: "changed by you from SJ-18747", box marked', /changed by you from SJ-18747/.test(t1) && (await pg.$$('#ffbody input.ffno.chg')).length >= 1);
  ok('COMPLETE BILL uses SJ-18774 (what MAKE BILL posts)', await pg.evaluate(() => { const c = document.querySelector('#ffbody .ffb.all'); return !!c && /SJ-18774/.test(c.textContent) && !/SJ-18747/.test(c.textContent); }));
  await pg.click('#ffbody button[data-reset]'); await pg.waitForTimeout(500);
  ok('Reset puts the written SJ-18747 back', /Revised incomplete/.test(await txt()) && (await pg.$$('#ffbody input.ffno.chg')).length === 0);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
