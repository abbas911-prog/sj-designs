const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }, { id: 'c2', idShort: 2, list: 'r', name: 'SJ-46209 (24) colour = (3) (8/8/8)', attachments: [{ id: 'a2', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'y.jpg' }] }];
const enc = lock({ updated: new Date().toISOString(), cards });
const BILLS = {}, ORDS = { oold: { id: 'oold', name: '#50 Matiullah naif', created: Date.now() - 86400000, items: [{ no: '18634', pcs: 8, c: 'C1 8', loc: 'g' }], pcs: 8, steps: { s1: { by: 'M', t: 1 } } } }, posts = [], slack = []; let gun = {};
const CUST = [{ name: '#50 Matiullah naif', bal: 279799, n: 3, last: '2026-10-18' }, { name: '#29 Mama bakhta', bal: -135, n: 5, last: '2026-10-19' }, { name: 'Musalim', bal: 0, n: 1, last: '2026-10-10' }];
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(x => Object.assign({}, x, { data: undefined })) }; if (req.op === 'get') return BILLS[req.ref] ? Object.assign({ ok: true }, BILLS[req.ref]) : { ok: false, error: 'not saved' }; if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, req, { updated: new Date().toISOString() }); return { ok: true, status: req.status }; } if (req.op === 'del') { delete BILLS[req.ref]; return { ok: true }; } }
  if (b.job === 'orders') { const o = ORDS[req.id];
    if (req.op === 'add') ORDS[req.id] = Object.assign(o || { id: req.id, created: Date.now(), steps: {} }, { name: req.name, items: req.items, pcs: req.pcs, dl: req.dl, by: req.by });
    if (req.op === 'tick') o.steps[req.step] = req.on ? { by: req.by, t: Date.now() } : null;
    if (req.op === 'link') { ['gts', 'cts', 'bill'].forEach(f => { if (req[f]) o[f] = req[f]; }); }
    return { ok: true, orders: Object.values(ORDS) }; }
  if (b.job === 'slackpdf2') { if (req.op === 'file') return { ok: true, fid: 'F1' }; slack.push(req); return { ok: true, file: 'F2', to: req.to, ts: req.to === 'godown' ? '1760900000.1' : '1760900000.2' }; }
  if (b.job === 'cust') { if (req.op === 'list') return { ok: true, list: CUST, sheet: '' }; if (req.op === 'get') return { ok: true, found: true, name: req.name, open: 0, odate: '2026-10-01', bal: 279799, n: 1, entries: [{ id: 'x', type: 'inv', ref: 'INV-1', date: '2026-10-18', sale: 279799, recv: 0, adj: 0 }] }; return { ok: true, found: false, names: [] }; }
  if (b.job === 'cchat') {
    if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [], orders: [], gun: gun };
    if (req.op === 'thread' && req.ch === 'godown') return { ok: true, root: req.root, msgs: [{ ts: req.root, root: true, memo: true, who: 'Godown pick list', text: 'Pick: SJ-18634', files: [] }].concat(posts.filter(p => p.ch === 'godown').map(p => ({ ts: p.ts, who: p.who, text: p.text, files: [] }))) };
    if (req.op === 'thread') return { ok: true, root: req.root, msgs: [{ ts: req.root, memo: true, who: 'Order memo', text: 'memo', files: [] }].concat(posts.filter(p => p.ch !== 'godown' && p.root === req.root).map(p => ({ ts: p.ts, who: p.who, text: p.text, files: [] }))) };
    if (req.op === 'post' || req.op === 'up') { posts.push({ ch: req.ch || '', root: req.root, who: req.who, text: req.text, op: req.op, files: (req.files || []).length, ts: String(Date.now() / 1000) }); return { ok: true, ts: '1' }; }
    if (req.op === 'findroot') return { ok: true, gts: req.name === '#50 Matiullah naif' ? '1760800000.5' : '', cts: '' };
    if (req.op === 'mkroot') { slack.push({ mk: req.ch, text: req.text }); return { ok: true, ts: '1760900000.9' }; }
  }
  if (b.job === 'stock') return { ok: true };
  return { ok: false, error: 'not in test ' + b.job + ' ' + req.op }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const out = []; const t = q => pg.$eval(q, e => e.textContent.trim()).catch(() => ''); const vis = q => pg.$eval(q, e => !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0).catch(() => false);
  // pick two colours, name
  await pg.fill('#name', 'MATIULLAH'); await pg.click('#feed .design .step button:nth-child(3)'); await pg.waitForTimeout(300);
  out.push(['Memo/drafts button beside OK', await vis('#drbtn')]); await pg.screenshot({ path: path.join(__dirname, 'shot-bar.png') }); console.log('hit:', await pg.evaluate(() => { const r = document.querySelector('#drbtn').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e.id + ' ' + e.className + ' ' + e.tagName; }), await pg.evaluate(() => { const r = document.querySelector('#ok').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e.id; }));
  await pg.$eval('#drbtn', e => e.click()); await pg.waitForSelector('#drs:not([hidden])'); await pg.click('[data-drs="od"]'); await pg.waitForFunction(() => document.querySelectorAll('[data-dro]').length === 1, null, { timeout: 8000 }).catch(() => {});
  out.push(['order draft saved', Object.values(BILLS).some(b => b.type === 'od' && b.name === 'MATIULLAH')]);
  await pg.click('[data-drs="bd"]'); await pg.waitForTimeout(800); out.push(['bill draft saved too', Object.values(BILLS).filter(b => b.type === 'od' || b.type === 'bd').length === 2]);
  await pg.click('#drx'); await pg.evaluate(() => { window.confirm = () => true; }); await pg.$eval('#clr', e => e.click()); await pg.waitForTimeout(300);
  out.push(['cleared', await pg.$eval('#ok', e => e.disabled)]);
  await pg.$eval('#drbtn', e => e.click()); await pg.waitForSelector('[data-dro]'); const odRef = Object.values(BILLS).find(b => b.type === 'od').ref;
  await pg.click('[data-dro="' + odRef + '"]'); await pg.waitForTimeout(1500);
  out.push(['order draft reopens on the memo', await vis('#done') && (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'memo' && (await pg.$eval('#name', e => e.value)) === 'MATIULLAH' && !(await pg.$eval('#ok', e => e.disabled))]);
  // send to godown
  await pg.waitForFunction(() => !document.querySelector('#sendg').disabled, null, { timeout: 20000 }).catch(() => {});
  await pg.click('#sendg'); await pg.waitForFunction(() => !document.querySelector('#cc').hidden && document.querySelector('.otabs2'), null, { timeout: 30000 }).catch(() => {});
  const oid = Object.keys(ORDS).find(k => k !== 'oold');
  out.push(['godown post linked to the order', !!oid && ORDS[oid].gts === '1760900000.1']);
  out.push(['order draft removed after sending', !Object.values(BILLS).some(b => b.type === 'od')]);
  out.push(['order snapshot kept', !!BILLS['ORD-' + oid]]);
  out.push(['order screen opens on #godown', (await t('.otabs2 button.on')).indexOf('#godown') >= 0 && (await t('#cct')).indexOf('#godown') >= 0]);
  out.push(['order preview with photo tiles at the top', (await pg.$$eval('#ccbody .optile', L => L.length)) === 1 && (await t('.ophead')).indexOf('MATIULLAH') >= 0]);
  await pg.click('[data-ofold]'); await pg.waitForTimeout(300);
  out.push(['steps with ticks on the order screen', (await pg.$$eval('#ccbody .ock', L => L.length)) === 6]);
  await pg.waitForSelector('.ccm.memo', { timeout: 8000 }).catch(() => {}); out.push(['pick list shown as first message', (await t('.ccm.memo')).indexOf('GODOWN PICK LIST') >= 0]);
  await pg.click('#ccbody .ock[data-ok="s2"]'); await pg.waitForTimeout(600); out.push(['tick saved', !!ORDS[oid].steps.s2]);
  await pg.fill('#cctxt', 'Row 3 please'); await pg.click('#ccsend'); await pg.waitForFunction(() => [...document.querySelectorAll('.ccm.me')].some(e => /Row 3/.test(e.textContent) && !e.classList.contains('pend')), null, { timeout: 15000 }).catch(() => {});
  out.push(['line posted into #godown thread', posts.some(p => p.ch === 'godown' && p.root === '1760900000.1' && p.text === 'Row 3 please')]);
  await pg.setInputFiles('#ccfile', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 0, 1, 2, 3]) }); await pg.click('#ccsend'); await pg.waitForTimeout(2500);
  out.push(['photo posted into #godown thread', posts.some(p => p.ch === 'godown' && p.op === 'up' && p.files === 1)]);
  // customer tab -> start chat
  await pg.click('.otabs2 [data-och="c"]'); await pg.waitForTimeout(500); out.push(['customer tab: start chat button', !!(await pg.$('[data-mkroot="c"]'))]);
  await pg.click('[data-mkroot="c"]'); await pg.waitForFunction(() => /#customer/.test(document.querySelector('#cct').textContent) && !document.querySelector('[data-mkroot]'), null, { timeout: 10000 }).catch(() => {});
  out.push(['customer chat started + linked', ORDS[oid].cts === '1760900000.9' && slack.some(s => s.mk === 'customer')]);
  // unread on godown shows on tab
  gun = { ['G1760900000.1']: { n: 2, tx: 'Godown: done', last: '1760900001.1' } }; await pg.evaluate(() => window.__sj && 0); await pg.waitForTimeout(13000);
  out.push(['godown unread badge on tab', (await t('.otabs2 [data-och="g"]')).indexOf('2') >= 0]);
  gun = {};
  // make bill
  if (!(await pg.$('[data-obill="new"]'))) { await pg.click('[data-ofold]'); await pg.waitForTimeout(300); }
  await pg.click('[data-obill="new"]'); await pg.waitForTimeout(1500);
  out.push(['make bill opens invoice with the order', await vis('#done') && (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'inv' && (await pg.$eval('#bform input[data-k="name"]', e => e.value)) === 'MATIULLAH' && (await t('#blines')).indexOf('SJ-18634') >= 0]);
  await pg.fill('#bform input[data-p]', '100'); await pg.waitForTimeout(4500);
  out.push(['invoice linked to the order', !!ORDS[oid].bill && /^INV-/.test(ORDS[oid].bill)]);
  await pg.click('#back'); await pg.waitForTimeout(1200);
  if (!(await pg.$('[data-obill="cont"]'))) { await pg.click('[data-ofold]'); await pg.waitForTimeout(300); }
  out.push(['back returns to the order', await vis('#cc') && !!(await pg.$('[data-obill="cont"]'))]);
  await pg.click('[data-obill="cont"]'); await pg.waitForTimeout(1500);
  out.push(['continue bill reopens it', (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'inv' && (await pg.$eval('#bform input[data-p]', e => e.value)) === '100']);
  // orders list tap
  await pg.click('#nav button[data-nv="orders"]'); await pg.waitForTimeout(500); await pg.click('#ordbody [data-ot="' + oid + '"]'); await pg.waitForTimeout(800);
  out.push(['orders list tap opens order chat', await vis('#cc') && !!(await pg.$('.otabs2'))]);
  await pg.click('#ccback'); await pg.waitForTimeout(500); out.push(['back goes to Orders list', await vis('#ords')]);
  await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(800); out.push(['Chats tab lists the order', (await pg.$$eval('.ccrow[data-oid]', L => L.length)) >= 1]);
  await pg.click('#nav button[data-nv="orders"]'); await pg.waitForTimeout(500); await pg.click('#ordbody [data-ot="oold"]'); await pg.waitForTimeout(1800);
  out.push(['old order finds its #godown post', ORDS.oold.gts === '1760800000.5' && !(await pg.$('[data-mkroot="g"]')) && (await t('.ccm.memo')).indexOf('GODOWN') >= 0]);
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300); await pg.evaluate(() => { localStorage.setItem('sj_owner', '1'); document.querySelector('#cbopen').click(); }); await pg.waitForSelector('.cbrow', { timeout: 8000 }).catch(() => {});
  out.push(['balances: totals owe / advance', (await t('.cbsum')).indexOf('279,799.00') >= 0 && (await t('.cbsum .adv')).indexOf('135.00') >= 0]);
  await pg.fill('#cbq', '50'); await pg.waitForTimeout(300); out.push(['search by number 50', (await pg.$$eval('.cbrow', L => L.length)) === 1 && (await t('.cbrow')).indexOf('Matiullah') >= 0]);
  await pg.fill('#cbq', 'mama bak'); await pg.waitForTimeout(300); out.push(['search by words', (await pg.$$eval('.cbrow', L => L.length)) === 1]);
  await pg.fill('#cbq', ''); await pg.click('[data-cbf="adv"]'); await pg.waitForTimeout(200); out.push(['filter advance', (await pg.$$eval('.cbrow', L => L.length)) === 1]);
  await pg.click('[data-cbf="all"]'); await pg.click('[data-cbs="big"]'); await pg.waitForTimeout(200); out.push(['sort highest first', (await t('.cbrow')).indexOf('Matiullah') >= 0]);
  await pg.screenshot({ path: path.join(__dirname, 'shot-cb.png') });
  await pg.click('.cbrow'); await pg.waitForSelector('.cbact', { timeout: 8000 }).catch(() => {}); await pg.click('[data-cbnew="rv"]'); await pg.waitForTimeout(600);
  out.push(['new receipt from the customer', (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'rv' && (await pg.$eval('#bform input[data-k="name"]', e => e.value)).indexOf('Matiullah') >= 0]);
  await pg.screenshot({ path: path.join(__dirname, 'shot-chatlist.png') });
  await pg.evaluate(() => { document.querySelector('#cb').hidden = true; }); await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(500); await pg.click('.ccrow[data-oid]'); await pg.waitForTimeout(1200); await pg.screenshot({ path: path.join(__dirname, 'shot-ord.png') });
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log('errors:', errs.slice(0, 5));
  await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
