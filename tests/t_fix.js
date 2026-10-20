// Checks for the fixes of 2026-10-20c/d: duplicate design numbers (oldest card keeps the plain number), long return on 2 pages, employees see balances (no delete), chat colours + bubbles kept, no page re-download, instant tick, included bill keeps its lines, lag: live update keeps unchanged designs, chats/orders shown from the phone, hidden owner boxes, Undo then Include gets a new number, 🔔 screen stays, return line from a typed line keeps its number.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }];
cards.push({ id: 'c2', idShort: 2, list: 'r', name: 'SJ-46209 (24) colour = (3) (8/8/8)', attachments: [] }, { id: 'a5', idShort: 5, list: 'r', name: 'SJ-55555 (8) colour = (1) (8)', attachments: [] }, { id: 'b5', idShort: 6, list: 'r', name: 'SJ-55555 (4) colour = (1) (4)', attachments: [] });
const enc = lock({ updated: new Date().toISOString(), cards }); let LIVE = cards;
const BILLS = { 'INV-0015': { ref: 'INV-0015', type: 'inv', name: 'MAMA BAKHTA', status: 'included', total: '1,600.00', date: '2026-10-18', updated: '2026-10-18T19:00:00Z', data: JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-0015', name: 'MAMA BAKHTA', vat: false, man: [] }, cols: [{ no: '18634', base: '18634', card: 'c1', c: 1, qty: 8, rate: 100 }, { no: '48293', base: '48293', card: 'cGONE', c: 2, qty: 8, rate: 100 }] }) } };
const jobs = {}, custPosts = []; let stockReq = null;
BILLS['INV-0015'].data = JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-0015', name: 'MAMA BAKHTA', vat: false, man: [{ d: 'SJ-77001 · C1 4 pcs', q: 4, r: 50, fz: '77001' }, { d: 'SJ 6668-1 lace', q: 2, r: 10 }] }, cols: [{ no: '18634', base: '18634', card: 'c1', c: 1, qty: 8, rate: 100 }] });
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) }; if (req.op === 'get') return BILLS[req.ref] ? Object.assign({ ok: true }, BILLS[req.ref]) : { ok: false, error: 'not saved' }; if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, req, { updated: new Date().toISOString() }); return { ok: true, status: req.status }; } }
  if (b.job === 'cust') { if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'X', bal: 0, n: 1 }; } if (req.op === 'list') return { ok: true, list: [{ name: 'MAMA BAKHTA', bal: 100, n: 1, last: '2026-10-18' }] }; if (req.op === 'get' && req.name) return { ok: true, found: true, name: req.name, open: 0, odate: '2026-10-01', bal: 100, n: 1, entries: [{ id: 'x1', type: 'inv', ref: 'INV-1', date: '2026-10-18', sale: 100, recv: 0, adj: 0 }] }; return { ok: true, found: false, names: [], list: [] }; }
  if (b.job === 'stock') { stockReq = req; jobs[req.id] = { id: req.id, ok: true, cards: [] }; return { ok: true }; }
  if (b.job === 'orders') { if (req.op === 'tick') ORDS[0].steps[req.step] = req.on ? { by: req.by, t: Date.now() } : null; return { ok: true, orders: ORDS }; }
  if (b.job === 'cchat') { if (req.op === 'thread') return { ok: true, name: 'MAMA BAKHTA', root: '1760690000.2', msgs: [{ ts: '1760690000.2', who: 'Order memo', memo: true, text: 'memo', files: [] }, { ts: '1760700000.1', who: 'Matiullah', text: 'one', files: [] }, { ts: '1760700001.1', who: 'Abbas', text: 'two', files: [] }, { ts: '1760700002.1', who: 'Musalim', text: 'three', files: [] }, { ts: '1760700003.1', who: 'Matiullah', text: 'four', files: [] }] }; return { ok: true, customers: [{ k: 'MAMA BAKHTA', name: 'MAMA BAKHTA', last: '1760700003.1', memos: 1, chat: 4, un: 0, tx: '' }], orders: [] }; }
  if (b.job === 'live') return { ok: true, cards: LIVE };
  return { ok: false, error: 'not in test' }; }

let HTML_SENT = 0; const ORDS = [{ id: 'o1', name: '#5 Test', created: Date.now(), items: [{ no: '18634', pcs: 8, c: 'C1 8' }], pcs: 8, steps: {} }];
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); rs.setHeader('etag', '"e1"'); if (rq.headers['if-none-match'] === '"e1"') { rs.statusCode = 304; return rs.end(); } if (/memo\.html$/.test(f)) HTML_SENT++; return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
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
  // chats: each person has their own colour (me orange on the right), same person = same colour; a redraw keeps the bubbles
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300); await pg.click('#nav button[data-nv="chats"]'); await pg.waitForSelector('.ccrow', { timeout: 8000 }); await pg.click('.ccrow'); await pg.waitForSelector('.ccm:not(.memo)', { timeout: 8000 }); await pg.waitForTimeout(300);
  const cols = await pg.$$eval('.ccm:not(.memo)', L => L.map(e => ({ who: (() => { const w = e.querySelector('.w').cloneNode(true); w.querySelectorAll('i,em').forEach(x => x.remove()); return w.textContent.trim(); })(), c: (e.className.match(/\bp\d\b/) || [''])[0], me: e.classList.contains('me') })));
  const byWho = {}; cols.forEach(x => { byWho[x.who] = byWho[x.who] || new Set(); byWho[x.who].add(x.c); });
  out.push(['chat: own colour per person, me orange on the right', cols.length === 4 && Object.keys(byWho).length === 3 && Object.values(byWho).every(s => s.size === 1) && new Set(cols.map(x => x.c)).size === 3 && cols.find(x => x.who === 'Abbas').c === 'p4' && cols.find(x => x.who === 'Abbas').me && !cols.find(x => x.who === 'Musalim').me]);
  await pg.evaluate(() => { document.querySelectorAll('.ccm')[1].__keep = 1; }); await pg.evaluate(() => window.__sj.ccDraw && window.__sj.ccDraw()); await pg.waitForTimeout(300);
  out.push(['chat: a refresh keeps the bubbles (no flicker)', await pg.evaluate(() => document.querySelectorAll('.ccm')[1].__keep === 1)]);
  // coming back to the app: the page is not downloaded again when nothing changed (ETag)
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500); const h0 = HTML_SENT;
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500);
  out.push(['coming back to the app does not re-download the page', HTML_SENT === h0]);
  // a step tick shows at once even when Google takes 2 s, and stays
  await pg.route(/script\.google\.com/, async r => { const b = JSON.parse(r.request().postData() || '{}'); if (b.job === 'orders') await new Promise(x => setTimeout(x, 2000)); r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.click('#nav button[data-nv="orders"]'); await pg.waitForSelector('#ordbody [data-ot="o1"]', { timeout: 8000 }); await pg.click('#ordbody [data-ot="o1"]'); await pg.waitForSelector('.optiles', { timeout: 8000 }); await pg.click('[data-ofold]'); await pg.waitForSelector('#ccbody .ock[data-ok="s2"]', { timeout: 8000 });
  const t0 = Date.now(); await pg.click('#ccbody .ock[data-ok="s2"]'); const quick = await pg.waitForSelector('#ccbody .ock.on[data-ok="s2"]', { timeout: 900 }).then(() => Date.now() - t0, () => -1); await pg.waitForTimeout(3000);
  out.push(['tick shows at once (Google slow) and stays', quick >= 0 && quick < 900 && !!(await pg.$('#ccbody .ock.on[data-ok="s2"]'))]);
  await pg.unroute(/script\.google\.com/); await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  // lag fixes: a live update keeps the designs that did not change; chats + orders show at once from the phone while Google is slow
  await pg.evaluate(() => { document.querySelector('#feed .design[data-no="18634"]').__keep = 1; document.querySelector('#feed .design[data-no="55555"]').__keep = 1; });
  LIVE = cards.map(c => c.id === 'a5' ? Object.assign({}, c, { name: 'SJ-55555 (7) colour = (1) (7)' }) : c);
  await pg.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); }); await pg.waitForFunction(() => /7 pcs/.test((document.querySelector('#feed .design[data-no="55555"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  out.push(['live update: unchanged design kept, changed one redrawn', await pg.evaluate(() => document.querySelector('#feed .design[data-no="18634"]').__keep === 1 && !document.querySelector('#feed .design[data-no="55555"]').__keep && /7 pcs/.test(document.querySelector('#feed .design[data-no="55555"]').textContent))]);
  const p3 = await br.newPage({ viewport: { width: 390, height: 844 } }); p3.on('pageerror', e => errs.push(e.message));
  await p3.route(/script\.google\.com/, r => { const b = JSON.parse(r.request().postData() || '{}'); if (b.job === 'cchat' || b.job === 'orders') return; r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });   // Google never answers chats / orders
  await p3.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  await p3.goto(URL0); await p3.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas');
    localStorage.setItem('sj_c_list', JSON.stringify({ c: [{ k: 'MATIULLAH', name: 'MATIULLAH', last: '1760700000.1', memos: 1, chat: 2, un: 0, tx: '' }], o: [] }));
    localStorage.setItem('sj_c_ord', JSON.stringify([{ id: 'o9', name: '#9 Cached order', created: Date.now(), items: [{ no: '18634', pcs: 8, c: 'C1 8' }], pcs: 8, steps: {} }])); }, PW);
  await p3.reload(); await p3.waitForSelector('#feed .design', { timeout: 15000 });
  await p3.click('#nav button[data-nv="chats"]'); const chatsAt = await p3.waitForSelector('.ccrow', { timeout: 1500 }).then(() => true, () => false);
  await p3.click('#nav button[data-nv="orders"]'); const ordAt = await p3.waitForSelector('#ordbody [data-ot="o9"]', { timeout: 1500 }).then(() => true, () => false);
  out.push(['chats + orders show at once from the phone (Google slow)', chatsAt && ordAt]); await p3.close();
  // a bill that took its pieces off Trello keeps its lines when opened again, even when READY now shows those colours at 0 (SJ-85974, 21 Oct 2026)
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300); await pg.evaluate(() => { window.confirm = () => true; const c = document.querySelector('#clr'); if (c) c.click(); });
  const pcs3 = await pg.$$('#feed .design[data-no="46209"] input.pc'); for (const i of pcs3) await i.fill('4'); await pg.waitForTimeout(500);
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300); await pg.$eval('#mode button[data-m="inv"]', e => e.click()); await pg.waitForTimeout(300);
  await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.fill('#bform input[data-p]', '100'); await pg.waitForTimeout(900); const R2 = await pg.evaluate(() => window.__sj.B().inv.ref);
  out.push(['bill of 3 colours × 4 pcs = 1,200', (await t('#btot')).indexOf('1,200.00') >= 0]);
  await pg.click('#dinc'); await pg.waitForFunction(R => { try { return JSON.parse(localStorage.getItem('sj_stock'))['dev1|' + R].st === 'ok'; } catch (e) { return false; } }, R2, { timeout: 40000 }).catch(() => {}); await pg.waitForTimeout(1500);
  LIVE = cards.map(c => c.id === 'c2' ? Object.assign({}, c, { name: 'SJ-46209 (4) colour = (3) (4/0/0)' }) : c);
  await pg.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); }); await pg.waitForFunction(() => /^4 pcs/.test((document.querySelector('#feed .design[data-no="46209"] .meta') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await pg.click('#dsaved'); await pg.waitForSelector('.bsrow[data-ref="' + R2 + '"]', { timeout: 8000 }); await pg.click('.bsrow[data-ref="' + R2 + '"]'); await pg.waitForTimeout(1200);
  out.push(['included bill opened again after the sale still says 1,200 (12 pcs)', !!BILLS[R2] && BILLS[R2].status === 'included' && (await t('#btot')).indexOf('1,200.00') >= 0]);
  const sv = JSON.parse(BILLS[R2].data); sv.state = { '46209:1': { sets: 0, all: false, pcs: 4 } }; BILLS[R2].data = JSON.stringify(sv);   // the saved copy lost two colours (what happened to INV-0021)
  await pg.click('#dsaved'); await pg.waitForSelector('.bsrow[data-ref="' + R2 + '"]', { timeout: 8000 }); await pg.click('.bsrow[data-ref="' + R2 + '"]'); await pg.waitForTimeout(1500);
  out.push(['the phone that sold repairs a bill whose saved copy lost lines → 1,200 again', (await t('#btot')).indexOf('1,200.00') >= 0]);
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
