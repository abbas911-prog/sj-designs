// Green button marks (19 Nov 2026, Abbas: "why are Nawroz's 4 pieces not on his balance? 50-50 shows 0; give me a mark so I know a bill was pressed
// green"). INV-0056 (SJ-65082 C3, 4 pcs) went through the green button with NO price: statement 0, 50-50 0; then a price typed into the sold bill made
// the bill say 500 while the statement and 50-50 stayed 0. Checks: a no-price line asks first; the sold bill is marked and locked; Saved bills and the
// order screen say "green pressed" / "not green". (Harness as in t_money.js.)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }, { id: 'c65', idShort: 2, list: 'r', name: 'SJ-65082 (20) colour = (5) (4/4/4/4/4)', attachments: [] }];
const enc = lock({ updated: new Date().toISOString(), cards });
const invData = (ref, extra) => JSON.stringify({ v: 1, k: 'inv', d: Object.assign({ ref, date: '2026-11-16', name: '#47 Nawroz naif', open: '5185', note: '', vat: false, extras: [{ d: '', a: '' }], disc: '', paid: '', man: [], nophoto: false, cat: false }, extra || {}), state: { '65082:3': { sets: 0, all: false, pcs: 4 } }, prices: { '65082': 125 }, cards: { '65082': 'c65' } });
const BILLS = {
  'INV-0056': { ref: 'INV-0056', type: 'inv', name: '#47 Nawroz naif', status: 'included', total: '500', date: '2026-11-16', updated: '2026-11-19T11:07:29Z', dev: 'seklcj', data: invData('INV-0056', { status: 'included', sold: [{ no: '65082', card: 'c65', c: 3, pcs: 4, rate: 0 }] }) },
  'INV-0057': { ref: 'INV-0057', type: 'inv', name: 'X', status: 'draft', total: '0', date: '2026-11-18', updated: '2026-11-18T08:15:57Z', dev: 'seklcj', data: invData('INV-0057', { name: 'X' }) } };
const custPosts = [], stockReqs = [], nextReqs = []; let refuse = null;
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) };
    if (req.op === 'get') return BILLS[req.ref] ? Object.assign({ ok: true }, BILLS[req.ref]) : { ok: false, error: 'not saved' };
    if (req.op === 'next') { nextReqs.push(req); return { ok: true, ref: req.ref }; }
    if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, BILLS[req.ref] || {}, req, { updated: new Date().toISOString() }); return { ok: true, ref: req.ref, status: req.status }; }
    return { ok: true }; }
  if (b.job === 'cust') { if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'MAMA BAKHTA', bal: 0, n: 1 }; } if (req.op === 'list') return { ok: true, list: [{ name: 'MAMA BAKHTA', bal: 100, n: 1, last: '2026-10-18' }] };
    if (req.op === 'get') return /labiya|new shop/i.test(req.name) ? { ok: true, found: false } : { ok: true, found: true, name: req.name, open: 0, odate: '2026-10-01', bal: 100, n: 1, entries: [] }; return { ok: true, names: ['MAMA BAKHTA', 'NASIR (LIBYA)', '#47 Nawroz naif'] }; }
  if (b.job === 'stock') { stockReqs.push(req); return { ok: true }; }
  if (b.job === 'cchat') { if (/ntfy/.test(req.op)) return { ok: true }; return { ok: true, customers: [{ k: 'M', name: 'M', last: '1', memos: 1, chat: 1, un: 0, tx: '' }], orders: [] }; }
  if (b.job === 'orders') return { ok: true, orders: [] };
  if (b.job === 'live') return { ok: true, cards };
  return { ok: true }; }
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  const f = path.join(DIR, u.slice(1) || 'memo.html'); if (!/costs?\.enc|costing/.test(u) && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [], alerts = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { alerts.push(d.message()); if (refuse && refuse.test(d.message())) d.dismiss(); else d.accept(); });
  await pg.route(/script\.google\.com/, async r => { const b = JSON.parse(r.request().postData() || '{}'), q = JSON.parse(b.req || '{}'); if (/ntfy/.test(q.op)) await new Promise(x => setTimeout(x, 1500)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_dev', 'devB'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  // 1 — a new bill with no price on SJ-18634: the green button asks first; Cancel = nothing sent
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { const S = window.__sj, B = S.B(); B.inv = null; S.st({ '18634:1': { pcs: 4, sets: 0, all: false } }); S.setMode('inv'); B.inv.name = 'TEST NO PRICE'; B.inv.cust = { found: false }; });
  await pg.waitForTimeout(500);
  let a0 = alerts.length, c0 = custPosts.length, s0 = stockReqs.length; refuse = /NO PRICE/; await pg.click('#dinc'); await pg.waitForTimeout(2500); refuse = null;
  ok('1 green button with no price: asks first, names the design (' + (alerts.slice(a0).find(x => /NO PRICE/.test(x)) || '').slice(0, 40) + ')', alerts.slice(a0).some(x => /NO PRICE on SJ-18634/.test(x)));
  ok('1 Cancel: nothing on the statement, nothing taken off Trello, not marked sold', custPosts.length === c0 && stockReqs.length === s0 && (await pg.evaluate(() => window.__sj.B().inv.status)) !== 'included');
  // 2 — with a price: no question, it goes; the bill is marked green and locked, and knows who/when
  await pg.fill('#bform input[data-p="18634"]', '100'); await pg.waitForTimeout(600);
  a0 = alerts.length; c0 = custPosts.length; await pg.click('#dinc'); await pg.waitForTimeout(3500);
  const g2 = await pg.evaluate(() => { const d = window.__sj.B().inv, m = document.querySelector('#gmark'), p = document.querySelector('#bform input[data-p="18634"]'); return { st: d.status, at: d.soldAt, by: d.soldBy, dev: d.soldDev, mark: m ? m.textContent : '', lock: !!p && p.disabled }; });
  ok('2 with a price: no "no price" question, on the statement with its amount', !alerts.slice(a0).some(x => /NO PRICE/.test(x)) && custPosts.slice(c0).some(p => p.type === 'inv' && +p.sale === 400));
  ok('2 the bill now carries who / when / which phone pressed green (' + g2.by + ')', g2.st === 'included' && g2.at > 0 && g2.by === 'Abbas' && g2.dev === 'devB');
  ok('2 the bill shows the green mark and its price box is locked', /green button pressed/.test(g2.mark) && g2.lock);
  // 3 — INV-0056 as it is on the sheet: sold at 0, a price typed later
  await pg.evaluate(() => window.__sj.bsOpen('INV-0056')); await pg.waitForTimeout(2500);
  const g3 = await pg.evaluate(() => { const m = document.querySelector('#gmark'), p = document.querySelector('#bform input[data-p="65082"]'); return { mark: m ? m.textContent : '', lock: !p || p.disabled }; });
  ok('3 INV-0056 opened: marked green, and says it was sold with NO PRICE (statement / 50-50 at 0)', /green button pressed/.test(g3.mark) && /Sold with NO PRICE: SJ-65082 C3 · 4 pcs/.test(g3.mark));
  ok('3 its price cannot be typed in any more (the bill would say 500 while the statement says 0)', g3.lock);
  // 4 — Saved bills and the order screen
  await pg.evaluate(() => window.__sj.bsList && window.__sj.bsList()); await pg.click('#dsaved').catch(() => {}); await pg.waitForSelector('.bsrow[data-ref="INV-0056"]', { timeout: 8000 }).catch(() => {});
  const rows = await pg.evaluate(() => { const t = r => { const e = document.querySelector('.bsrow[data-ref="' + r + '"] .bst'); return e ? e.textContent : ''; }; return { a: t('INV-0056'), b: t('INV-0057') }; });
  ok('4 Saved bills: INV-0056 "✅ green pressed", the draft INV-0057 "not green" (' + rows.a + ' / ' + rows.b + ')', /green pressed/.test(rows.a) && /not green/.test(rows.b));
  const op = await pg.evaluate(() => { const P = window.__sj.ordPanel; try { return { a: P({ id: 'o1', name: '#47 Nawroz naif', bill: 'INV-0056', items: [] }), b: P({ id: 'o2', name: 'X', bill: 'INV-0057', items: [] }) }; } catch (e) { return { err: e.message }; } });
  ok('4 order screen (step bar, always visible): "✅ INV-0056 green pressed" / "INV-0057 · not green"' + (op.err ? ' (' + op.err + ')' : ''), /✅ INV-0056 green pressed/.test(op.a || '') && /INV-0057 · not green/.test(op.b || '') && !/green pressed/.test(op.b || ''));
  // 5 — Nasir: "Nasir labiya" is not a customer, NASIR (LIBYA) is (INV-0058 went to a new customer with Nasir's balance as its opening)
  await pg.evaluate(() => { const S = window.__sj, B = S.B(); B.inv = null; S.st({ '18634:1': { pcs: 2, sets: 0, all: false } }); S.setMode('inv'); });
  await pg.waitForTimeout(600); await pg.fill('#bform input[data-k="name"]', 'Nasir labiya'); await pg.waitForTimeout(2500);
  const h5 = await pg.$eval('#bcust', e => ({ t: e.textContent, use: !!e.querySelector('[data-cuse="NASIR (LIBYA)"]') }));
  ok('5 a name that is not a customer but looks like one: "Did you mean NASIR (LIBYA)?" with a Use button', /Did you mean NASIR \(LIBYA\)/.test(h5.t) && h5.use);
  await pg.fill('#bform input[data-p="18634"]', '100'); await pg.waitForTimeout(400);
  a0 = alerts.length; c0 = custPosts.length; await pg.click('#dinc'); await pg.waitForTimeout(2500);
  const n5 = await pg.evaluate(() => window.__sj.B().inv.name);
  ok('5 the green button asks "Did you mean NASIR (LIBYA)?"; OK = the bill is for NASIR (LIBYA), nothing sent yet', alerts.slice(a0).some(x => /"Nasir labiya" is NOT a customer yet/.test(x)) && n5 === 'NASIR (LIBYA)' && custPosts.length === c0);
  await pg.fill('#bform input[data-k="name"]', 'New Shop'); await pg.waitForTimeout(2500);
  ok('5 a really new name (nothing like it): no "did you mean"', !/Did you mean/.test(await pg.$eval('#bcust', e => e.textContent)));
  // 6 — the green mark on the order's step bar opens the bill (it only folded the steps)
  ok('6 the step-bar mark is a button to the bill', /data-obill="cont">✅ INV-0056 green pressed/.test(op.a || ''));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
