// 50-50 bills screen (owner): the design number of every line can be corrected by hand (30 Oct 2026, Abbas: "always give me options to edit
// the design number — sometimes there is a design number problem"). A corrected number finds its own cost, the new price follows, the
// revised bill and the COMPLETE BILL (MAKE BILL text) carry the corrected number, Reset puts the written one back.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const bills = lock({ bills: [{ ref: 'INV-0022', dev: 'd1', st: 'open', t: 1, date: '2026-10-21', name: 'Musalim', pcs: 21, sub: 2880, stock_ok: true,
  lines: [{ no: '18634', qty: 12, rate: 150, amount: 1800 }, { no: '18747', qty: 9, rate: 120, amount: 1080 }] },
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
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [] }) }));
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_owner_pin', '1234');
    localStorage.setItem('sj_costs', JSON.stringify({ d: '2026-10-30', c: Object.assign({ '18634': 104.22, '18774': 90 }, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(20001 + i), 100]))) })); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  await pg.evaluate(() => document.getElementById('ffbtn').click()); await pg.waitForSelector('#ffbody .ffb', { timeout: 15000 }); await pg.waitForTimeout(300);
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const txt = () => pg.$eval('#ffbody', e => e.textContent);
  ok('every design number is an edit box (bill as written + cost)', (await pg.$$('#ffbody .ffno')).length >= 4);
  ok('SJ-18747 has no cost: revised incomplete', /Revised incomplete/.test(await txt()));
  // 30 Oct 2026 (Abbas, video: "I can't press MAKE BILL — it is hidden down below"): without scrolling, MAKE BILL is on the screen, above the
  // bottom tab bar, and a tap on it lands on it (on the old app it sat at the end of the long list, under the bar)
  const tapOk = () => pg.evaluate(() => { const b = document.getElementById('ffmake'), n = document.getElementById('nav'); if (!b) return 'no button'; const r = b.getBoundingClientRect(), nt = n.getBoundingClientRect().top;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= nt && !!hit && (hit === b || b.contains(hit)) ? true : 'top ' + Math.round(r.top) + ' bottom ' + Math.round(r.bottom) + ' bar ' + Math.round(nt) + ' hit ' + (hit && (hit.id || hit.className || hit.tagName)); });
  const t0 = await tapOk(); ok('MAKE BILL on screen above the bottom bar without scrolling (phone) ' + (t0 === true ? '' : t0), t0 === true);
  await pg.setViewportSize({ width: 1180, height: 820 }); await pg.waitForTimeout(300); const t1i = await tapOk(); ok('… and on the iPad held sideways ' + (t1i === true ? '' : t1i), t1i === true);
  await pg.evaluate(() => { const i = document.querySelector('#ff .in'); i.scrollTop = i.scrollHeight; }); await pg.waitForTimeout(200);
  ok('scrolled to the end, the last line is not hidden behind the buttons', await pg.evaluate(() => { const c = document.querySelector('#ffbody .ffb.all'), r = c.getBoundingClientRect(), q = document.querySelector('.ffpin'); if (!q) return false; const p = q.getBoundingClientRect(); return r.bottom <= p.top; }));
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.evaluate(() => { document.querySelector('#ff .in').scrollTop = 0; }); await pg.waitForTimeout(200);
  const box = (await pg.$$('#ffbody input.ffno[data-i="1"]'))[0];
  await box.fill('SJ-18774'); await box.press('Tab'); await pg.waitForTimeout(900);
  const t1 = await txt();
  ok('fixed to SJ-18774: its cost 90 is used, new price 105 (90 + half of 30)', await pg.$eval('#ffbody input.ffi[data-i="1"][data-f="cost"]', e => e.value) === '90' && await pg.$eval('#ffbody input.ffi[data-i="1"][data-f="nw"]', e => e.value) === '105');
  ok('the revised bill is complete and carries SJ-18774 (12 × 127 + 9 × 105 = 2,469)', /Revised 2,469 AED/.test(t1) && !/Revised incomplete/.test(t1));
  ok('the change is shown: "changed by you from SJ-18747", box marked', /changed by you from SJ-18747/.test(t1) && (await pg.$$('#ffbody input.ffno.chg')).length >= 1);
  ok('COMPLETE BILL uses SJ-18774 (what MAKE BILL posts)', await pg.evaluate(() => { const c = document.querySelector('#ffbody .ffb.all'); return !!c && /SJ-18774/.test(c.textContent) && !/SJ-18747/.test(c.textContent); }));
  await pg.click('#ffbody button[data-reset]'); await pg.waitForTimeout(500);
  ok('Reset puts the written SJ-18747 back', /Revised incomplete/.test(await txt()) && (await pg.$$('#ffbody input.ffno.chg')).length === 0);
  // 30 Oct 2026 (Abbas, video): 12 lines in the COMPLETE BILL = ONE table, heading once, TOTAL last (was a heading every 8 lines)
  ok('COMPLETE BILL on screen: one table, the heading once, 12 lines + TOTAL', await pg.evaluate(() => { const c = document.querySelector('#ffbody .ffb.all'); const t = c.querySelectorAll('table'); return t.length === 1 && t[0].querySelectorAll('th').length === 4 && t[0].querySelectorAll('tr').length === 14 && /TOTAL/.test(t[0].rows[13].textContent); }));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
