// Catalogue screen: "For a customer" or "Anonymous" (23 Nov 2026, Abbas: "an option — is it an anonymous catalogue or an existing one for a
// customer, so we save customers all the time"). Saved customers (cat/customers.json, written by the catalogue job) are offered as buttons;
// a tap fills name + country; a new name is kept on the phone at once; a look-alike asks "did you mean"; no name and not Anonymous = refused;
// Anonymous sends no name and no country.
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
  const out = []; const ok = (n, v) => out.push([n, !!v]); const T = s => pg.$eval(s, e => e.textContent);
  const make = async n => { await pg.$eval('#cmake', e => e.click()); for (let k = 0; k < 24 && CATS.length < n; k++) await pg.waitForTimeout(250); };
  await pg.$eval('#catbtn', e => e.click()); await pg.waitForSelector('#ccsaved button', { timeout: 8000 }).catch(() => {}); await pg.fill('#cnos', '18634 sets'); await pg.waitForTimeout(300);
  ok('the choice is there, "For a customer" is on', await pg.$$eval('#cwho button', b => b.length === 2 && b[0].classList.contains('on') && !b[1].classList.contains('on')).catch(() => false));
  ok('the saved customers are offered as buttons (' + await T('#ccsaved').catch(() => '-') + ')', await pg.$$eval('#ccsaved button', b => b.length === 2 && /DASTAGIR/.test(b[0].textContent) && /KUWAIT/.test(b[0].textContent)).catch(() => false));
  await make(1);
  ok('no name and not Anonymous: nothing is sent, the app asks who it is for', CATS.length === 0 && /Who is it for/.test(await T('#cst')));
  await pg.$eval('#ccsaved button', e => e.click()).catch(() => {}); await pg.waitForTimeout(150);
  ok('a tap on a saved customer fills name + country and says saved', await pg.$eval('#cname', e => e.value) === 'DASTAGIR' && await pg.$eval('#ccountry', e => e.value) === 'KUWAIT' && /Saved customer/.test(await T('#ccnote').catch(() => '')));
  await pg.fill('#cname', 'dastigir'); await pg.waitForTimeout(150);
  ok('a look-alike name asks "did you mean DASTAGIR"', /Did you mean/.test(await T('#ccnote').catch(() => '')) && await pg.$$eval('#ccnote button', b => b.length === 1).catch(() => false));
  await pg.$eval('#ccnote button', e => e.click()).catch(() => {}); await pg.waitForTimeout(150);
  await pg.fill('#cname', ' dastagir '); await make(1);
  ok('a saved customer goes out in his one saved spelling (' + JSON.stringify(CATS[0] && [CATS[0].name, CATS[0].country]) + ')', CATS.length === 1 && CATS[0].name === 'DASTAGIR' && CATS[0].country === 'KUWAIT');
  await pg.waitForTimeout(400); await pg.reload(); await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  await pg.$eval('#catbtn', e => e.click()); await pg.waitForTimeout(600); await pg.fill('#cnos', '18634 sets'); await pg.fill('#cname', 'Abu Yusuf'); await pg.fill('#ccountry', 'OMAN'); await pg.waitForTimeout(150);
  ok('a new name says "New customer — saved by itself"', /New customer/.test(await T('#ccnote').catch(() => '')));
  await make(2); await pg.waitForTimeout(300);
  ok('the new customer is on the list at once, first (' + await T('#ccsaved').catch(() => '-') + ')', CATS.length === 2 && CATS[1].name === 'Abu Yusuf' && await pg.$$eval('#ccsaved button', b => b.length === 3 && /Abu Yusuf/.test(b[0].textContent) && /OMAN/.test(b[0].textContent)).catch(() => false));
  await pg.reload(); await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 }); await pg.$eval('#catbtn', e => e.click()); await pg.waitForTimeout(600);
  ok('… and still there after the app is opened again', await pg.$$eval('#ccsaved button', b => b.length === 3 && /Abu Yusuf/.test(b[0].textContent)).catch(() => false));
  await pg.fill('#cnos', '18634 sets'); await pg.fill('#cname', 'SOMEBODY'); await pg.$eval('#cwho button[data-cw="a"]', e => e.click()).catch(() => {}); await pg.waitForTimeout(150);
  ok('Anonymous hides the name boxes and says no name goes on the page', await pg.$eval('#ccbox', e => e.hidden).catch(() => false) && /NEW COLLECTION/.test(await T('#canon').catch(() => '')));
  await make(3);
  ok('an anonymous catalogue goes out with no name and no country (' + JSON.stringify(CATS[2] && [CATS[2].name, CATS[2].country]) + ')', CATS.length === 3 && CATS[2].name === '' && CATS[2].country === '');
  await pg.waitForTimeout(300);
  ok('nothing is saved for it, and the next catalogue is "For a customer" again', await pg.$$eval('#ccsaved button', b => b.length === 3).catch(() => false) && await pg.$eval('#cwho button', b => b.classList.contains('on')).catch(() => false));
  ok('no page errors (' + errs.join(' | ').slice(0, 200) + ')', !errs.length);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
