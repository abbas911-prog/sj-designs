// Money / stock fixes of 28 Oct 2026 (Abbas: "look at this app, see if you find any problems or bugs"). Every check fails on the old app.
// 1 a return already shared on another phone can't be shared again (customer credited twice, pieces back twice) and shows no put-back button there
// 2 Return & share confirms its number with the relay (one series for the shop, as the invoice)
// 3 the last sold invoice no longer switches the stock check off for the next order / draft
// 4 new picks after a sale open a NEW invoice instead of changing (and auto-saving over) the sold one
// 5 a sold invoice keeps a design whose card sold out since, as a typed line with what it sold
// 6 a mark never jumps to the other card with the same number when its own card leaves READY
// 7 the Notifications screen: an answer arriving after leaving the screen is no page error; 8 its 📋 Copy never claims a refused copy
// 9 the cash box: a line of only signs ("-") no longer stops the preview
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [
  { id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] },
  { id: 'c2', idShort: 2, list: 'r', name: 'SJ-46209 (6) colour = (3) (2/2/2)', attachments: [] },
  { id: 'a9', idShort: 3, list: 'r', name: 'SJ-89057 (8) colour = (2) (4/4)', attachments: [] },       // older card → 89057-2
  { id: 'b9', idShort: 4, list: 'r', name: 'SJ-89057 (6) colour = (2) (3/3)', attachments: [] },       // newest card → plain 89057
  { id: 'c57', idShort: 5, list: 'r', name: 'SJ-57026 (8) colour = (2) (4/4)', attachments: [] }];
const enc = lock({ updated: new Date().toISOString(), cards });
const retData = (ref, extra) => JSON.stringify({ v: 1, k: 'rn', name: 'MAMA BAKHTA', d: Object.assign({ ref, name: 'MAMA BAKHTA', date: '2026-10-27', status: 'included', items: [{ no: '18634', c: '1', pcs: '2', rate: '100', card: 'c1', max: 8 }] }, extra || {}) });
const BILLS = {
  'RET-0007': { ref: 'RET-0007', type: 'rn', name: 'MAMA BAKHTA', status: 'included', total: '200.00', date: '2026-10-27', updated: '2026-10-27T10:00:00Z', dev: 'devA', data: retData('RET-0007', { doneDev: 'devA' }) },
  'RET-0008': { ref: 'RET-0008', type: 'rn', name: 'MAMA BAKHTA', status: 'included', total: '200.00', date: '2026-10-26', updated: '2026-10-26T10:00:00Z', dev: 'devA', data: retData('RET-0008') } };
const custPosts = [], stockReqs = [], nextReqs = [];
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) };
    if (req.op === 'get') return BILLS[req.ref] ? Object.assign({ ok: true }, BILLS[req.ref]) : { ok: false, error: 'not saved' };
    if (req.op === 'next') { nextReqs.push(req); return { ok: true, ref: req.ref }; }
    if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, BILLS[req.ref] || {}, req, { updated: new Date().toISOString() }); return { ok: true, ref: req.ref, status: req.status }; }
    return { ok: true }; }
  if (b.job === 'cust') { if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'MAMA BAKHTA', bal: 0, n: 1 }; } if (req.op === 'list') return { ok: true, list: [{ name: 'MAMA BAKHTA', bal: 100, n: 1, last: '2026-10-18' }] };
    if (req.op === 'get') return { ok: true, found: true, name: req.name, open: 0, odate: '2026-10-01', bal: 100, n: 1, entries: [] }; return { ok: true, names: ['MAMA BAKHTA'] }; }
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
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await pg.route(/script\.google\.com/, async r => { const b = JSON.parse(r.request().postData() || '{}'), q = JSON.parse(b.req || '{}'); if (/ntfy/.test(q.op)) await new Promise(x => setTimeout(x, 1500)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.route(/ntfy\.sh|github/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_dev', 'devB'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const openSaved = async (ref) => { await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300); await pg.$eval('#mode button[data-m="rn"]', e => e.click()); await pg.waitForTimeout(300);
    await pg.click('#dsaved'); await pg.waitForSelector('.bsrow[data-ref="' + ref + '"]', { timeout: 8000 }); await pg.click('.bsrow[data-ref="' + ref + '"]'); await pg.waitForTimeout(1200); };

  // 1 — a return shared on phone A, opened on phone B
  await openSaved('RET-0007');
  const stk7 = await pg.$eval('#stk', e => ({ t: e.textContent, btn: !!e.querySelector('button[data-rn]') }));
  ok('1 return done on another phone: says so, no "put the pieces back" button', /another phone/.test(stk7.t) && !stk7.btn);
  let a0 = alerts.length, c0 = custPosts.length, s0 = stockReqs.length; await pg.click('#dinc'); await pg.waitForTimeout(1500);
  ok('1 Return & share again on phone B is refused: no second credit, no second put-back', alerts.slice(a0).some(x => /already shared/.test(x)) && custPosts.length === c0 && stockReqs.length === s0);
  await pg.click('#nav button[data-nv="stock"]'); await openSaved('RET-0008');   // an older return without the phone mark
  a0 = alerts.length; c0 = custPosts.length; s0 = stockReqs.length; await pg.click('#dinc'); await pg.waitForTimeout(1500);
  ok('1 an older shared return (no phone mark) is refused too', alerts.slice(a0).some(x => /already shared/.test(x)) && custPosts.length === c0 && stockReqs.length === s0);

  // 2 — a new return confirms its number with the relay first
  await pg.evaluate(() => { const S = window.__sj, B = S.B(); B.rn = null; S.setMode('rn'); Object.assign(B.rn, { ref: 'RET-0031', name: 'MAMA BAKHTA', status: 'draft', items: [{ no: '18634', c: '1', pcs: '2', rate: '10', card: 'c1', max: 8 }] }); S.setMode('rn'); });
  const n0 = nextReqs.length; await pg.click('#dinc'); await pg.waitForTimeout(2500);
  ok('2 Return & share asks the relay to confirm RET-0031', nextReqs.slice(n0).some(r => r.type === 'rn' && r.ref === 'RET-0031'));
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300);

  // 3 — after a sale, the next order / draft gets its stock check (46209 colour 1: order says 5, READY has 2)
  await pg.evaluate(() => { const S = window.__sj; window.__mkInv = x => { const B = S.B(); B.inv = null; S.st({}); S.setMode('inv'); Object.assign(B.inv, x); return B.inv; }; });
  const r3 = await pg.evaluate(() => { const S = window.__sj, B = S.B(); window.__mkInv({ ref: 'INV-0040', name: 'X', status: 'included', sold: [{ no: '18634', card: 'c1', c: 1, pcs: 8, rate: 100 }] });
    S.snapApply({ state: { '46209:1': { pcs: 5, sets: 0, all: false } }, cards: { '46209': 'c2' } }); const st = S.st(); return { pcs: (st['46209:1'] || {}).pcs, inv: B.inv && B.inv.ref }; });
  ok('3 order loaded after a sale: 5 pcs cut to the 2 in READY, the sold invoice let go', r3.pcs === 2 && r3.inv !== 'INV-0040');

  // 4 — new picks after a sale → a new invoice; the same picks → the sold invoice stays
  const r4 = await pg.evaluate(() => { const S = window.__sj, B = S.B(); const sold = () => window.__mkInv({ ref: 'INV-0041', name: 'X', status: 'included', sold: [{ no: '18634', card: 'c1', c: 1, pcs: 8, rate: 100 }] });
    sold(); S.st({ '18634:1': { pcs: 8, sets: 0, all: false } }); S.setMode('inv'); const same = B.inv.ref;
    sold(); S.st({ '18634:1': { pcs: 8, sets: 0, all: false }, '46209:2': { pcs: 1, sets: 0, all: false } }); S.setMode('inv'); return { same, other: B.inv.ref, st: B.inv.status }; });
  ok('4 the sold invoice with its own picks stays open', r4.same === 'INV-0041');
  ok('4 new picks after the sale open a new invoice (the sold one is not changed)', r4.other !== 'INV-0041' && r4.st !== 'included');
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300);

  // 5 — the sold invoice's card sells out (its stock job moved it to FINISH): kept as a typed line with what it sold
  const r5 = await pg.evaluate(c => { const S = window.__sj, B = S.B(); window.__mkInv({ ref: 'INV-0042', name: 'X', status: 'included', man: [], sold: [{ no: '57026', card: 'c57', c: 1, pcs: 4, rate: 50 }, { no: '57026', card: 'c57', c: 2, pcs: 4, rate: 50 }] });
    S.st({ '57026:1': { pcs: 4, sets: 0, all: false }, '57026:2': { pcs: 4, sets: 0, all: false } }); S.liveApply(c.filter(x => x.id !== 'c57')); return { st: Object.keys(S.st()), man: B.inv.man }; }, cards);
  ok('5 sold-out design kept on the sold invoice as a typed line: SJ-57026 · C1 4 pcs · C2 4 pcs, 8 × 50', r5.man.some(m => m.fz === '57026' && m.q === '8' && m.r === '50' && /C1 4 pcs · C2 4 pcs/.test(m.d)) && !r5.st.length);

  // 6 — a mark on the newest SJ-89057 card; that card leaves READY → the mark goes, it never lands on the other 89057 card
  await pg.evaluate(c => { const S = window.__sj, B = S.B(); B.inv = null; S.liveApply(c); S.st({ '89057:1': { pcs: 2, sets: 0, all: false } }); }, cards);
  const r6 = await pg.evaluate(c => { const S = window.__sj; S.liveApply(c.filter(x => x.id !== 'b9')); return Object.keys(S.st()); }, cards);
  ok('6 mark of a card that left READY is taken off, not moved to the other SJ-89057 card', r6.indexOf('89057:1') < 0);
  ok('6 the helper never hands a sold line to the other card with the same number', await pg.evaluate(() => window.__sj.cardNo('89057', 'b9') !== '89057'));

  // 7 — Notifications screen: leave before the relay answers
  const e0 = errs.length;
  for (const b of ['#belltest', '#bellon', '#belloff']) { await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(300); await pg.click('#ccbell'); await pg.waitForSelector(b); await pg.click(b); await pg.waitForTimeout(100); await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(100); await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(2200); }
  ok('7 leaving the Notifications screen early: no page error', errs.length === e0);
  // 8 — 📋 Copy on the Notifications screen when the phone refuses the copy: no false "Copied ✓", the topic is shown to copy by hand
  await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(300); await pg.click('#ccbell'); await pg.waitForSelector('#bellcopy');
  const e8 = errs.length; await pg.click('#bellcopy'); await pg.waitForTimeout(800);
  ok('8 refused copy: no "Copied ✓", no page error', !/Copied/.test(await pg.$eval('#bellst', e => e.textContent)) && errs.length === e8);
  // 9 — cash box: a line of only signs no longer stops the preview
  { const r9 = await pg.evaluate(() => { try { window.__sj.cashRead('-'); window.__sj.cashRead(' / '); return 'ok'; } catch (e) { return e.message; } }); if (r9 !== 'ok') console.log('9:', r9); ok('9 cash line "-" reads without an error', r9 === 'ok'); }
  // 10 — "All" is saved as the exact pieces it showed (28 Oct 2026, Abbas: "do whatever you feel is good"); opened when READY has less → cut + alert
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300);
  const r10 = await pg.evaluate(c => { const S = window.__sj, B = S.B(); B.inv = null; S.liveApply(c); S.st({ '46209:1': { sets: 0, all: true }, '18634:1': { sets: 0, all: true } });
    const dr = S.drSnap('md'); S.setMode('inv'); const bs = S.bsSnap('inv'); return { dr: dr.state, bs: bs && bs.state, live: S.st()['46209:1'] }; }, cards);
  ok('10 a saved draft / bill keeps "All" as the pieces it showed (2 and 8), the screen keeps "All"', r10.dr['46209:1'].pcs === 2 && !r10.dr['46209:1'].all && r10.dr['18634:1'].pcs === 8 && r10.bs && r10.bs['18634:1'].pcs === 8 && r10.live.all === true);
  BILLS['DR-0001'] = { ref: 'DR-0001', type: 'md', name: 'X', status: 'draft', total: '', date: '2026-10-28', updated: '2026-10-28T10:00:00Z', data: JSON.stringify(Object.assign({ v: 1, k: 'md', state: r10.dr, prices: {}, cards: { '46209': 'c2', '18634': 'c1' }, name: 'X' })) };
  const c10 = cards.map(x => x.id === 'c2' ? Object.assign({}, x, { name: 'SJ-46209 (5) colour = (3) (1/2/2)' }) : x);
  const a10 = alerts.length; await pg.evaluate(c => { const S = window.__sj; S.st({}); S.liveApply(c); S.drOpen('DR-0001'); }, c10); await pg.waitForTimeout(2000);
  const st10 = await pg.evaluate(() => window.__sj.st());
  ok('10 opened when READY has 1 left: cut 2 → 1 with an alert; 18634 stays 8', st10['46209:1'] && st10['46209:1'].pcs === 1 && st10['18634:1'] && st10['18634:1'].pcs === 8 && alerts.slice(a10).some(x => /Less in READY/.test(x) && /46209 colour 1: 2 → 1/.test(x)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
