const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] },
  { id: 'c5', idShort: 5, list: 'r', name: 'SJ-47168 (20) colour = (5) (4/4/4/4/4)', attachments: [] }];
const enc = lock({ updated: new Date().toISOString(), cards });
const BILLS = { 'INV-0015': { ref: 'INV-0015', type: 'inv', name: 'MAMA BAKHTA', status: 'included', total: '1,600.00', date: '2026-10-18', updated: '2026-10-18T19:00:00Z', data: JSON.stringify({ v: 1, k: 'inv', d: { ref: 'INV-0015', name: 'MAMA BAKHTA', vat: false, man: [] }, cols: [{ no: '18634', base: '18634', card: 'c1', c: 1, qty: 8, rate: 100 }, { no: '48293', base: '48293', card: 'cGONE', c: 2, qty: 8, rate: 100 }] }) } };
const jobs = {}, custPosts = []; let stockReq = null, hangCust = false;
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) }; if (req.op === 'get') return Object.assign({ ok: true }, BILLS[req.ref]); if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, req, { updated: new Date().toISOString() }); return { ok: true, status: req.status }; } }
  if (b.job === 'cust') { if (req.op === 'get') return { ok: true, found: true, name: 'MAMA BAKHTA', bal: 5000, n: 3 }; if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'MAMA BAKHTA', bal: 5000 + (req.adj || 0), n: 4 }; } return { ok: true, names: [] }; }
  if (b.job === 'stock') { stockReq = req; jobs[req.id] = { id: req.id, ok: true, cards: req.lines.map(l => ({ card: l.card || 'cX', no: l.no, before: 'x', after: 'y', left: 9, lines: ['colour ' + l.c + ': 8 → ' + (8 + l.pcs) + ' (+' + l.pcs + ')'], moved: l.card === 'cGONE' ? 'moved back to READY' : '' })) }; return { ok: true }; }
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [] };
  return { ok: false, error: 'not in test' }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => { const b = JSON.parse(r.request().postData() || '{}'); if (hangCust && b.job === 'cust' && JSON.parse(b.req).op === 'post') return; r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.route(/raw\.githubusercontent\.com\/.*jobs\//, r => { const id = r.request().url().match(/jobs\/([^.?]+)\.json/)[1]; jobs[id] ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(jobs[id]) }) : r.fulfill({ status: 404, body: 'nf' }); });
  await pg.route(/ntfy\.sh|api\.github\.com/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const out = []; const t = q => pg.$eval(q, e => e.textContent.trim()).catch(() => '');
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300);
  await pg.click('#mode button[data-m="rn"]'); await pg.waitForTimeout(400);
  out.push(['return tab opens', (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'rn' && (await pg.$eval('#bform input[data-k="ref"]', e => e.value)).startsWith('RET-')]);
  out.push(['button says Return & share', (await t('#dinc')).indexOf('Return') === 0]);
  await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.click('#rnpick'); await pg.waitForSelector('[data-rninv]', { timeout: 8000 });
  await pg.click('[data-rninv="INV-0015"]'); await pg.waitForSelector('.rnrow', { timeout: 8000 }); await pg.waitForTimeout(400);
  out.push(['invoice lines loaded colour by colour', (await pg.$$eval('.rnrow', L => L.length)) === 2 && (await t('.rnfrom')).indexOf('INV-0015') >= 0]);
  const pcs = await pg.$$('input[data-f="pcs"]'); await pcs[0].fill('3'); await pcs[1].fill('2'); await pg.waitForTimeout(900);
  out.push(['total 500', (await t('#btot')).indexOf('500.00') >= 0]);
  await pg.click('#dinc'); await pg.waitForFunction(() => /Back on Trello/.test(document.querySelector('#stk').textContent), null, { timeout: 30000 }).catch(() => {});
  out.push(['stock job retbill with colours', !!stockReq && stockReq.op === 'retbill' && JSON.stringify(stockReq.lines) === JSON.stringify([{ card: 'c1', no: '18634', c: 1, pcs: 3 }, { card: 'cGONE', no: '48293', c: 2, pcs: 2 }])]);
  out.push(['result shown', (await t('#stk')).indexOf('Back on Trello ✓ 5 pcs') >= 0]);
  out.push(['balance credited -500', custPosts.some(p => p.type === 'adj' && p.adj === -500 && /return/.test(p.ref))]);
  await pg.waitForTimeout(3000); const rnSaved = Object.values(BILLS).find(b => b.type === 'rn'); out.push(['saved as included return', !!rnSaved && rnSaved.status === 'included']);
  // 7 Nov 2026 (RET-0006: the shared return was edited afterwards and saved over — line wiped, total 0.00): once shared, the return is locked
  out.push(['a shared return is locked: its lines cannot be changed or removed', await pg.evaluate(() => { const f = document.querySelector('#bform'); const pcs = f.querySelector('input[data-f="pcs"]'), rm = f.querySelector('[data-rmi]'), add = f.querySelector('#addri');
    return !!pcs && pcs.disabled && !!rm && rm.disabled && !!add && add.disabled && /cannot be changed/.test(f.textContent) && !!(window.__sj.B().rn.done && window.__sj.B().rn.done.total === 500); })]);
  // hand line + new number
  await pg.click('#dnew'); await pg.waitForTimeout(300); await pg.click('#addri'); const ins = await pg.$$('.rnrow input'); await ins[0].fill('6668-1'); await ins[1].fill('2'); await ins[2].fill('4'); await ins[3].fill('50'); await pg.waitForTimeout(700);
  out.push(['hand line total 200', (await t('#btot')).indexOf('200.00') >= 0]);
  // 7 Nov 2026 (Abbas: "make it ask for a customer name first"): no name → stopped with a message, nothing goes to Trello or a statement
  const msgs = []; const onD = d => msgs.push(d.message()); pg.on('dialog', onD); const s0 = stockReq, p0 = custPosts.length;
  await pg.click('#dinc'); await pg.waitForTimeout(1200); pg.off('dialog', onD);
  out.push(['no customer name: Return & share stops and asks for it', msgs.some(m => /customer's name first/.test(m)) && stockReq === s0 && custPosts.length === p0 && await pg.evaluate(() => document.activeElement && document.activeElement.dataset.k === 'name')]);
  await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.dispatchEvent('#bform input[data-k="name"]', 'change'); await pg.waitForTimeout(1500);
  await pg.click('#dinc'); await pg.waitForFunction(() => /Back on Trello/.test(document.querySelector('#stk').textContent), null, { timeout: 30000 }).catch(() => {});
  out.push(['hand line sent by number', stockReq.lines.length === 1 && stockReq.lines[0].card === '' && stockReq.lines[0].no === '6668-1' && stockReq.lines[0].c === 2]);
  // colour picker from the card + colour names refused
  await pg.click('#dnew'); await pg.waitForTimeout(300); await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.waitForTimeout(500); await pg.click('#addri'); let r3 = await pg.$$('.rnrow input'); await r3[0].fill('18634'); await r3[0].dispatchEvent('change'); await pg.waitForTimeout(500);
  out.push(['colour picker shows the card colours', (await pg.$$eval('.rncols button[data-ric]', L => L.length)) === 2]);
  r3 = await pg.$$('.rnrow input'); await r3[1].fill('BLACK'); await r3[2].fill('2'); await r3[3].fill('100'); await pg.waitForTimeout(700); const before = stockReq;
  await pg.click('#dinc'); await pg.waitForTimeout(1500); out.push(['colour name refused (no Trello job)', stockReq === before]);
  await pg.click('.rncols button[data-c="2"]'); await pg.waitForTimeout(400); r3 = await pg.$$('.rnrow input'); await r3[2].fill('2'); await pg.waitForTimeout(700);
  await pg.click('#dinc'); await pg.waitForFunction(() => /Back on Trello/.test(document.querySelector('#stk').textContent), null, { timeout: 30000 }).catch(() => {});
  out.push(['picked colour goes to the card', stockReq !== before && stockReq.lines.length === 1 && stockReq.lines[0].card === 'c1' && stockReq.lines[0].c === 2 && stockReq.lines[0].pcs === 2]);
  // 4 Nov: one design, 5 colours x 4 pcs back -> tap All (or each colour) = one line per colour, same pcs + rate
  await pg.click('#dnew'); await pg.waitForTimeout(300); await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.waitForTimeout(500); await pg.click('#addri'); let r5 = await pg.$$('.rnrow input'); await r5[0].fill('47168'); await r5[0].dispatchEvent('change'); await pg.waitForTimeout(500);
  r5 = await pg.$$('.rnrow input'); await r5[2].fill('4'); await r5[3].fill('105'); await pg.waitForTimeout(300);
  out.push(['All button for a 5-colour design', (await pg.$$('.rncols .rnall')).length === 1]);
  if (await pg.$('.rncols .rnall')) { await pg.click('.rncols .rnall'); await pg.waitForTimeout(400); }
  const tot5 = () => pg.$eval('#btot', e => e.textContent).catch(() => '');
  out.push(['All = 5 lines, 20 pcs, 2,100', (await pg.$$('.rnrow')).length === 5 && /Return \(20 pcs\)/.test(await tot5()) && /2,100\.00/.test(await tot5())]);
  if (await pg.$('.rncols button[data-c="3"]')) { await pg.click('.rncols button[data-c="3"]'); await pg.waitForTimeout(400); }
  out.push(['tap a picked colour = its line goes', (await pg.$$('.rnrow')).length === 4 && /Return \(16 pcs\)/.test(await tot5())]);
  if (await pg.$('.rncols button[data-c="3"]')) { await pg.click('.rncols button[data-c="3"]'); await pg.waitForTimeout(400); }
  r5 = await pg.$$('.rnrow input'); await r5[2].fill('5'); await r5[2].dispatchEvent('input'); await pg.waitForTimeout(500);
  out.push(['pcs on the first line carries to the others', /Return \(25 pcs\)/.test(await tot5())]);
  r5 = await pg.$$('.rnrow input'); await r5[2].fill('4'); await r5[2].dispatchEvent('input'); await pg.waitForTimeout(700); const before5 = stockReq;
  await pg.click('#dinc'); await pg.waitForFunction(() => /Back on Trello/.test(document.querySelector('#stk').textContent), null, { timeout: 30000 }).catch(() => {}); await pg.waitForTimeout(300);
  const L5 = (stockReq && stockReq.lines) || [];
  out.push(['5 colours go back to the card, 4 pcs each', stockReq !== before5 && L5.length === 5 && L5.every(l => l.card === 'c5' && l.pcs === 4) && L5.map(l => l.c).sort().join() === '1,2,3,4,5']);
  // 7 Nov 2026 (Abbas: a 720 return shared on Muhammad's phone never reached Matiullah's statement and Trello): the phone must remember the statement
  // line BEFORE it sends it (a page lost right after the WhatsApp share sent nothing and failed nothing, so nothing was kept), and a return shared but
  // never confirmed — or shared on another phone — can be repaired from any phone with both buttons, with the first phone's ids
  await pg.click('#dnew'); await pg.waitForTimeout(300); await pg.fill('#bform input[data-k="name"]', 'MAMA'); await pg.waitForTimeout(500); await pg.click('#addri'); const iq = await pg.$$('.rnrow input'); await iq[0].fill('6668-1'); await iq[1].fill('2'); await iq[2].fill('4'); await iq[3].fill('50'); await pg.waitForTimeout(700);
  hangCust = true; await pg.click('#dinc'); await pg.waitForTimeout(1200);
  out.push(['the statement line is kept on the phone while the shop has not answered', await pg.evaluate(() => (JSON.parse(localStorage.getItem('sj_custq') || '[]')).some(x => /^rn:RET-\d+:/.test(x.id) && x.adj === -200))]);
  hangCust = false;
  const nP = custPosts.length, nS = stockReq && stockReq.id;
  await pg.evaluate(() => { window.__sj.B().rn = { ref: 'RET-0099', date: '2026-11-04', name: 'MAMA', open: '5000', note: '', vat: false, inv: '', items: [{ no: '18634', c: '1', pcs: '4', rate: '180', card: 'c1', hand: 1 }], status: 'included', doneDev: 'otherphone' }; window.__sj.setMode('rn'); });
  await pg.waitForTimeout(500);
  const bx = await t('#stk');
  out.push(['a return shared on another phone offers both repair buttons', /was shared on another phone/.test(bx) && !!(await pg.$('#stk button[data-rn="stmt"]')) && !!(await pg.$('#stk button[data-rn="again"]')) && /720\.00/.test(bx)]);
  await pg.click('#stk button[data-rn="stmt"]'); await pg.waitForTimeout(900);
  const mine = custPosts.slice(nP).filter(p => /RET-0099/.test(p.ref || ''));
  out.push(['Add to statement: -720 under the first phone\'s id (rn:RET-0099:otherphone)', mine.length === 1 && mine[0].id === 'rn:RET-0099:otherphone' && mine[0].adj === -720]);
  await pg.click('#stk button[data-rn="stmt"]'); await pg.waitForTimeout(900);
  const again = custPosts.slice(nP).filter(p => /RET-0099/.test(p.ref || ''));
  out.push(['pressing it twice sends the same id (the shop replaces the line, never counts it twice)', again.length === 2 && again[0].id === again[1].id]);
  await pg.click('#stk button[data-rn="again"]'); await pg.waitForTimeout(1500);
  out.push(['Put the pieces back: the Trello job carries the first phone\'s dev (so it skips what it did)', !!stockReq && stockReq.id !== nS && stockReq.dev === 'otherphone' && stockReq.ref === 'RET-0099' && stockReq.lines.length === 1 && stockReq.lines[0].pcs === 4 && stockReq.lines[0].c === 1]);
  // RET-0006 as it is now: shared on Muhammad's phone (no `done` kept — older app), its line since wiped to a bare "91289", total 0.00
  const nW = custPosts.length;
  await pg.evaluate(() => { window.__sj.B().rn = { ref: 'RET-0006', date: '2026-11-04', name: 'MAMA', open: '281503', note: '', vat: false, inv: '', items: [{ no: '91289', c: '', pcs: '', rate: '', card: '' }], status: 'included', doneDev: 'seklcj' }; window.__sj.setMode('rn'); });
  await pg.waitForTimeout(500);
  const wmsg = []; const onW = d => wmsg.push(d.message()); pg.on('dialog', onW);
  await pg.click('#stk button[data-rn="stmt"]'); await pg.waitForTimeout(700);
  out.push(['wiped return (0.00): Add to statement says to type the line again, sends nothing', wmsg.some(m => /shows 0\.00/.test(m)) && custPosts.length === nW]);
  const wi = await pg.$$('.rnrow input'); out.push(['… and that older return can still be typed (it kept nothing to lock)', wi.length >= 4 && !(await wi[2].evaluate(e => e.disabled))]);
  await wi[1].fill('3'); await wi[2].fill('4'); await wi[3].fill('180'); await wi[3].dispatchEvent('input'); await pg.waitForTimeout(700);
  await pg.click('#stk button[data-rn="stmt"]'); await pg.waitForTimeout(1200); pg.off('dialog', onW);
  const w6 = custPosts.slice(nW).filter(p => /RET-0006/.test(p.ref || ''));
  out.push(['typed again: -720 goes on the statement under the first phone\'s id, then the return is locked', w6.length === 1 && w6[0].id === 'rn:RET-0006:seklcj' && w6[0].adj === -720 && await pg.evaluate(() => { const i = document.querySelector('#bform input[data-f="pcs"]'); return !!i && i.disabled; })]);
  await pg.screenshot({ path: path.join(__dirname, 'shot-rn.png'), fullPage: false });
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log('errors:', errs.slice(0, 5));
  await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
