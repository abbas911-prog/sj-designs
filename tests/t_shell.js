// Headless test of memo.html 2026-10-17c: bottom bar, memo pill, chats with new-messages box / catch up / outbox / badge, more sheet.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [
  { id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] },
  { id: 'c2', idShort: 2, list: 'r', name: 'SJ-46209 (24) colour = (3) (8/8/8)', attachments: [{ id: 'a2', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'y.jpg' }] }
];
const enc = lock({ updated: new Date().toISOString(), cards });
// fake relay state
let seenMatiullah = false, seenOrder = false; const posts = []; let threadReads = 0; const BILLS = {}; const ORD = { k: 'O1760650000.5', ts: '1760650000.5', name: 'MATIULLAH', head: '17 Oct 2026 · 2 designs · 16 pcs', chat: 1, last: '1760700000.1' };
const customers = () => [{ k: 'MATIULLAH', name: 'MATIULLAH', last: '1760700000.1', memos: 2, chat: 3, un: seenMatiullah ? 0 : 2, tx: seenMatiullah ? '' : 'Matiullah: send me the new designs' }, { k: 'AHMAD AL WASTA', name: 'AHMAD AL WASTA', last: '1760600000.1', memos: 1, chat: 0, un: 0, tx: '' }];
const orders = () => [Object.assign({}, ORD, { un: seenOrder ? 0 : 1, tx: seenOrder ? '' : 'Matiullah: when will it come?' })];
function relay(body) {
  const req = JSON.parse(body.req);
  if (body.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS).map(b => ({ ref: b.ref, type: b.type, name: b.name, status: b.status, total: b.total, date: b.date, updated: b.updated, by: b.by, dev: b.dev })) };
    if (req.op === 'put') { BILLS[req.ref] = Object.assign({}, req, { updated: new Date().toISOString() }); return { ok: true, ref: req.ref, status: req.status }; }
    if (req.op === 'get') { const b = BILLS[req.ref]; return b ? Object.assign({ ok: true }, b) : { ok: false, error: 'not saved' }; } return { ok: false, error: 'bad op' }; }
  if (body.job === 'slackpdf2') return { ok: true, file: 'F1', to: req.to, ts: '1760800000.9' };
  if (body.job !== 'cchat') return { ok: false, error: 'not in test' };
  if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: customers(), orders: orders(), live: '', nt: false, ev: false };
  if (req.op === 'thread' && req.root) { threadReads++; if (req.look && req.root === ORD.ts) seenOrder = true; return { ok: true, name: 'MATIULLAH', root: req.root, head: ORD.head, msgs: [{ ts: req.root, who: 'Order memo', memo: true, text: ORD.head + '\nSJ-18634 · SJ-46209', files: [] }, { ts: '1760700000.1', who: 'Matiullah', text: 'when will it come?', files: [] }].concat(posts.filter(p => p.root === req.root).map(p => ({ ts: p.ts, who: p.who, text: p.text, files: [] }))) }; }
  if (req.op === 'thread') { threadReads++; if (req.look) seenMatiullah = true; const base = [{ ts: '1760690000.1', who: 'Order memo', memo: true, text: 'MATIULLAH · 2 designs', files: [] }, { ts: '1760700000.1', who: 'Matiullah', text: 'send me the new designs', files: [] }]; return { ok: true, name: req.name, root: '1760690000.2', msgs: base.concat(posts.filter(p => p.name === req.name).map(p => ({ ts: p.ts, who: p.who, text: p.text, files: [] }))) }; }
  if (req.op === 'post') { if (posts.some(p => p.rid === req.rid)) return { ok: true, ts: 'dup' }; posts.push({ name: req.name, root: req.root || '', who: req.who, text: req.text, rid: req.rid, ts: String(Date.now() / 1000) }); return { ok: true, ts: '1' }; }
  return { ok: false, error: 'the relay does not know "' + req.op + '" yet' };
}
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, URL0 = 'http://localhost:' + port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.route(/script\.google\.com/, async (route) => { const b = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.route(/ntfy\.sh/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const t = (q) => pg.$eval(q, e => e.textContent.trim()).catch(() => null);
  const vis = (q) => pg.$eval(q, e => !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0).catch(() => false);
  const out = [];
  out.push(['bar visible', await vis('#nav')]); out.push(['old buttons hidden', !(await vis('#ccbtn')) && !(await vis('#bills')) && !(await vis('#ordbtn'))]);
  out.push(['pill hidden when nothing picked', await pg.$eval('#bar', e => e.classList.contains('empty'))]);
  // pick a colour → pill + memo badge
  await pg.click('#feed .design .step button:nth-child(3)'); await pg.waitForTimeout(300);
  out.push(['pill shows after a pick', !(await pg.$eval('#bar', e => e.classList.contains('empty')))]); out.push(['memo badge = 1', (await t('#nvm')) === '1']);
  // chats tab: unread badge after the first poll
  await pg.waitForFunction(() => document.querySelector('#nvc').textContent === '3', null, { timeout: 8000 }).catch(() => {}); out.push(['chats badge 3 (2 general + 1 order)', (await t('#nvc')) === '3']);
  out.push(['title (3)', (await pg.title()).startsWith('(3)')]);
  await pg.click('#nav button[data-nv="chats"]'); await pg.waitForSelector('.ccnew', { timeout: 8000 });
  out.push(['new-messages box', (await t('.ccnh b')).indexOf('New messages · 3') >= 0]); out.push(['order row in list', (await pg.$$eval('.ccrow.ord', L => L.length)) === 1 && (await t('.ccrow.ord .t > small:last-child')).indexOf('when will it come') >= 0]); out.push(['row shows last line', (await t('.ccrow.un:not(.ord) .t > small:last-child')).indexOf('send me the new designs') >= 0]);
  out.push(['nav on chats', await pg.$eval('#nav button[data-nv="chats"]', e => e.classList.contains('on'))]);
  // catch up → opens Matiullah, marks seen, finish → back to list with no box
  await pg.click('#cccatch'); await pg.waitForSelector('#cccu:not([hidden])'); out.push(['catch-up strip 1 / 2', (await t('#cccu')).indexOf('1 / 2') >= 0]);
  await pg.waitForSelector('.ccm'); await pg.touchscreen.tap(200, 400).catch(() => {}); await pg.mouse.click(200, 400); await pg.waitForTimeout(400);
  await pg.evaluate(() => window.__cc && window.__cc()); await pg.waitForFunction(() => document.querySelector('#nvc').textContent === '1', null, { timeout: 12000 }).catch(() => {});
  out.push(['badge 3 → 1 after looking at the general chat', (await t('#nvc')) === '1']);
  // send a line → outbox → appears
  await pg.fill('#cctxt', 'Ok sending tomorrow'); await pg.click('#ccsend'); await pg.waitForTimeout(200); out.push(['pending bubble at once', (await pg.$$eval('.ccm', L => L.some(e => e.textContent.indexOf('sending') >= 0 || e.classList.contains('me'))))]);
  await pg.waitForFunction(() => [...document.querySelectorAll('.ccm.me')].some(e => e.textContent.indexOf('Ok sending tomorrow') >= 0 && !e.classList.contains('pend')), null, { timeout: 12000 }).catch(() => {});
  out.push(['line posted once', posts.length === 1 && posts[0].text === 'Ok sending tomorrow' && posts[0].who === 'Abbas']);
  out.push(['date/time above message', !!(await pg.$('.ccm .w em'))]);
  await pg.click('#ccnext'); await pg.waitForTimeout(500); out.push(['next → the order chat', (await t('#cct')).indexOf('order of') >= 0 && (await pg.$$eval('.ccm.memo', L => L.length)) === 1]);
  await pg.fill('#cctxt', 'Goods come Tuesday'); await pg.click('#ccsend'); await pg.waitForFunction(() => [...document.querySelectorAll('.ccm.me')].some(e => e.textContent.indexOf('Goods come Tuesday') >= 0 && !e.classList.contains('pend')), null, { timeout: 12000 }).catch(() => {});
  out.push(['order line posted under the order root', posts.length === 2 && posts[1].root === ORD.ts && posts[1].text === 'Goods come Tuesday']);
  await pg.mouse.click(200, 400); await pg.waitForTimeout(400); await pg.evaluate(() => window.__cc && window.__cc()); await pg.waitForFunction(() => document.querySelector('#nvc').textContent === '', null, { timeout: 12000 }).catch(() => {}); out.push(['order unread cleared', (await t('#nvc')) === '']);
  await pg.click('#ccnext'); await pg.waitForTimeout(300); out.push(['finish → list, no box', !(await pg.$('.ccnew')) && !(await vis('#cccu'))]);
  // send-to-customer opens the order chat at once
  await pg.evaluate(() => window.__sj.ccOpenOrder({ name: 'NEW GUY', ts: '1760800000.9' })); await pg.waitForTimeout(400); out.push(['after send → order chat open', (await t('#cct')).indexOf('NEW GUY') >= 0 && (await t('#cct')).indexOf('order of') >= 0]);
  // more sheet
  await pg.click('#nav button[data-nv="more"]'); await pg.waitForSelector('#more:not([hidden])'); out.push(['more sheet', (await pg.$$eval('.mgrid button', L => L.length)) >= 3]);
  await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300); out.push(['more → bills opens', await vis('#done') && await pg.$eval('#mode button.on', e => e.dataset.m) !== 'memo']);
  await pg.fill('#bform input[data-k="name"]', 'MATIULLAH'); await pg.fill('#bform input[data-p]', '120'); await pg.waitForFunction(() => /saved/.test(document.querySelector('#bsv').textContent), null, { timeout: 12000 }).catch(() => {});
  const ref0 = await pg.evaluate(() => window.__sj.B().inv.ref); out.push(['invoice autosaved as draft', /✓ saved/.test(await t('#bsv')) && !!BILLS[ref0] && BILLS[ref0].status === 'draft' && BILLS[ref0].name === 'MATIULLAH']);
  await pg.click('#dnew'); await pg.waitForTimeout(300); const ref1 = await pg.evaluate(() => window.__sj.B().inv.ref); out.push(['new number after saving', ref1 !== ref0]);
  await pg.click('#dsaved'); await pg.waitForSelector('.bsrow', { timeout: 8000 }); out.push(['saved bills list shows it', (await pg.$$eval('.bsrow', L => L.map(e => e.dataset.ref))).indexOf(ref0) >= 0]);
  await pg.click('.bsrow[data-ref="' + ref0 + '"]'); await pg.waitForTimeout(600); out.push(['reopen puts the bill back in the form', (await pg.evaluate(() => window.__sj.B().inv.ref)) === ref0 && (await pg.$eval('#bform input[data-k="name"]', e => e.value)) === 'MATIULLAH' && (await pg.$eval('#bform input[data-p]', e => e.value)) === '120' && !(await vis('#bsaved'))]);
  await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(200); out.push(['stock closes screens', !(await vis('#done')) && !(await vis('#cc'))]);
  await pg.click('#nav button[data-nv="memo"]'); await pg.waitForTimeout(800); out.push(['memo tab opens the memo', await vis('#done') && (await pg.$eval('#mode button.on', e => e.dataset.m)) === 'memo']);
  await pg.click('#nav button[data-nv="orders"]'); await pg.waitForTimeout(300); out.push(['orders tab', await vis('#ords')]);
  // bell sheet
  await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(300); await pg.click('#ccbell'); await pg.waitForSelector('.bell'); out.push(['bell sheet with topic', (await t('#belltp')).indexOf('sjstock-') === 0]);
  // deep link
  await pg.goto('about:blank'); await pg.goto(URL0 + '#chat=MATIULLAH'); await pg.waitForSelector('#cccomp:not([hidden])', { timeout: 15000 }); out.push(['deep link opens the chat', (await t('#cct')).indexOf('MATIULLAH') >= 0]);
  await pg.screenshot({ path: path.join(__dirname, 'shot-chat.png') }); await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(__dirname, 'shot-stock.png') });
  await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(__dirname, 'shot-chats.png') });
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log('errors:', errs.filter(e => !/memo-roles|roles.json|thumbs\/|favicon|net::ERR/.test(e)).slice(0, 8));
  await br.close(); srv.close();
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
