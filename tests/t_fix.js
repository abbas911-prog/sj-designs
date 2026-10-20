// Checks for the fixes of 2026-10-20c/d: duplicate design numbers (oldest card keeps the plain number), long return on 2 pages, employees see balances (no delete), hidden owner boxes, Undo then Include gets a new number, 🔔 screen stays, return line from a typed line keeps its number.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }];
cards.push({ id: 'a5', idShort: 5, list: 'r', name: 'SJ-55555 (8) colour = (1) (8)', attachments: [] }, { id: 'b5', idShort: 6, list: 'r', name: 'SJ-55555 (4) colour = (1) (4)', attachments: [] });
const enc = lock({ updated: new Date().toISOString(), cards });
const BILLS = { 'INV-0015': { ref: 'INV-0015', type: 'inv', name: 'MAMA BAKHTA', status: 'included', total: '1,600.00', date: '2026-10-18', updated: '2026-10-18T19:00:00Z', data: JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-0015', name: 'MAMA BAKHTA', vat: false, man: [] }, cols: [{ no: '18634', base: '18634', card: 'c1', c: 1, qty: 8, rate: 100 }, { no: '48293', base: '48293', card: 'cGONE', c: 2, qty: 8, rate: 100 }] }) } };
const jobs = {}, custPosts = []; let stockReq = null;
BILLS['INV-0015'].data = JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-0015', name: 'MAMA BAKHTA', vat: false, man: [{ d: 'SJ-77001 · C1 4 pcs', q: 4, r: 50, fz: '77001' }, { d: 'SJ 6668-1 lace', q: 2, r: 10 }] }, cols: [{ no: '18634', base: '18634', card: 'c1', c: 1, qty: 8, rate: 100 }] });
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) }; if (req.op === 'get') return BILLS[req.ref] ? Object.assign({ ok: true }, BILLS[req.ref]) : { ok: false, error: 'not saved' }; if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, req, { updated: new Date().toISOString() }); return { ok: true, status: req.status }; } }
  if (b.job === 'cust') { if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'X', bal: 0, n: 1 }; } if (req.op === 'list') return { ok: true, list: [{ name: 'MAMA BAKHTA', bal: 100, n: 1, last: '2026-10-18' }] }; if (req.op === 'get' && req.name) return { ok: true, found: true, name: req.name, open: 0, odate: '2026-10-01', bal: 100, n: 1, entries: [{ id: 'x1', type: 'inv', ref: 'INV-1', date: '2026-10-18', sale: 100, recv: 0, adj: 0 }] }; return { ok: true, found: false, names: [], list: [] }; }
  if (b.job === 'stock') { stockReq = req; jobs[req.id] = { id: req.id, ok: true, cards: [] }; return { ok: true }; }
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [] };
  return { ok: false, error: 'not in test' }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/raw\.githubusercontent\.com\/.*jobs\//, r => { const id = r.request().url().match(/jobs\/([^.?]+)\.json/)[1]; jobs[id] ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(jobs[id]) }) : r.fulfill({ status: 404, body: 'nf' }); });
  await pg.route(/ntfy\.sh|api\.github\.com/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_dev', 'dev1'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const out = []; const t = q => pg.$eval(q, e => e.textContent.trim()).catch(() => ''); const shown = q => pg.$eval(q, e => getComputedStyle(e).display !== 'none').catch(() => false);
  out.push(['factory password box hidden on a phone without the owner password', !(await shown('#fpw'))]);
  out.push(['cost/sale boxes hidden in a normal design order', !(await shown('#dorcs'))]);
  out.push(['same design twice: the older card keeps 55555, the newer is 55555-2', JSON.stringify(await pg.evaluate(() => window.__memo.designs().filter(d => d.base === '55555').map(d => d.id + '=' + d.no).sort())) === JSON.stringify(['a5=55555', 'b5=55555-2'])]);
  out.push(['photo counter counts each photo once', (await pg.evaluate(() => window.__memo.pstat().bad)) <= 1]);
  // Undo then Include → new number, pieces taken under it
  await pg.click('#feed .design .step button:nth-child(3)'); await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300);
  await pg.$eval('#mode button[data-m="inv"]', e => e.click()); await pg.waitForTimeout(300);
  await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.fill('#bform input[data-p]', '100'); await pg.waitForTimeout(800);
  const R = await pg.evaluate(() => window.__sj.B().inv.ref);
  await pg.evaluate(R => { const s = {}; s['dev1|' + R] = { st: 'returned', op: 'return', ref: R, lines: [], t: Date.now() }; localStorage.setItem('sj_stock', JSON.stringify(s)); }, R);
  await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300);
  await pg.$eval('#mode button[data-m="inv"]', e => e.click()); await pg.waitForTimeout(500);
  const R0 = await pg.evaluate(() => window.__sj.B().inv.ref);
  await pg.click('#dinc'); await pg.waitForFunction(() => /Trello|stock/i.test(document.querySelector('#stk').textContent), null, { timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(1500);
  out.push(['undone invoice is included again under a new number', R0 === R && !!stockReq && stockReq.op === 'sell' && stockReq.ref !== R && /^INV-/.test(stockReq.ref) && stockReq.lines.length === 1]);
  // return from a saved invoice: typed lines keep their design number
  await pg.$eval('#mode button[data-m="rn"]', e => e.click()); await pg.waitForTimeout(300); await pg.click('#dnew'); await pg.waitForTimeout(300);
  await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.click('#rnpick'); await pg.waitForSelector('[data-rninv="INV-0015"]', { timeout: 8000 }); await pg.click('[data-rninv="INV-0015"]'); await pg.waitForSelector('.rnrow', { timeout: 8000 }); await pg.waitForTimeout(400);
  const nos = await pg.evaluate(() => window.__sj.B().rn.items.map(i => i.no)); out.push(['return lines keep numbers 18634 / 77001 / 6668-1', JSON.stringify(nos) === JSON.stringify(['18634', '77001', '6668-1'])]);
  await pg.evaluate(() => { const d = window.__sj.B().rn; d.items = []; for (let i = 0; i < 30; i++) d.items.push({ no: String(10000 + i), c: '1', pcs: '1', rate: '10', max: 1 }); }); await pg.$eval('#mode button[data-m="rv"]', e => e.click()); await pg.$eval('#mode button[data-m="rn"]', e => e.click()); await pg.waitForTimeout(2500);
  out.push(['return with 30 lines prints on 2 pages', (await pg.$$eval('#dprev img', L => L.length)) === 2]);
  // bell screen stays while the chats poll runs
  await pg.$eval('#back', e => e.click()); await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="ccbell"]'); await pg.waitForSelector('#belltp'); await pg.waitForTimeout(14000);
  out.push(['🔔 setup still on screen after the 12 s poll', !!(await pg.$('#belltp'))]);
  // employee phone (catalogue off): Customer balances opens, but no delete / change-opening buttons
  const p2 = await br.newPage({ viewport: { width: 390, height: 844 } }); p2.on('pageerror', e => errs.push(e.message)); p2.on('dialog', d => d.accept());
  await p2.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) })); await p2.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  await p2.goto(URL0); await p2.evaluate(pw => { localStorage.clear(); localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Musalim'); }, PW); await p2.reload(); await p2.waitForSelector('#feed .design', { timeout: 15000 });
  await p2.click('#nav button[data-nv="more"]'); const hasCb = !!(await p2.$('.mgrid button[data-go="cbopen"]')); if (hasCb) await p2.click('.mgrid button[data-go="cbopen"]'); await p2.waitForSelector('.cbrow', { timeout: 8000 }).catch(() => {});
  await p2.click('.cbrow').catch(() => {}); await p2.waitForSelector('#cbcopy', { timeout: 8000 }).catch(() => {});
  out.push(['employee sees customer balances, without delete buttons', hasCb && !!(await p2.$('#cbcopy')) && !(await p2.$('#cbdel')) && !(await p2.$('#cbopenbal')) && !(await p2.$('[data-cbx]'))]);
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log('errors:', errs.slice(0, 5));
  await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
