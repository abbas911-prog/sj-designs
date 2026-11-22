// 22 Nov 2026 (Abbas, INV-0069: "green is pressed, it even shows green, but nothing came off Trello"): on 21 Nov evening Google's daily limit
// made the relay refuse to start the stock job. The bill must say so (not "pieces taken off Trello"), Try again must work, and the job's
// answer must be saved and shown (it sat inside a comment and never ran).
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234', FILE = process.env.MEMO || 'memo.html';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const jobs = {}, stock = []; let refuse = true;
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'stock') { stock.push(req); if (refuse) return { ok: false, error: 'Service invoked too many times for one day: urlfetch' };
    jobs[req.id] = { id: req.id, op: req.op, ref: req.ref, ok: true, cards: req.lines.map(l => ({ card: 'c1', no: l.no, before: 'x', after: 'SJ-18634 (12) colour = (2) (4/8)', left: 12, lines: ['colour 1: 8 → 4 (−4)'] })) }; return { ok: true }; }
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: [] }; if (req.op === 'put') return { ok: true, ref: req.ref, status: req.status }; if (req.op === 'next') return { ok: true, ref: req.ref }; return { ok: true }; }
  if (b.job === 'cust') { if (req.op === 'get') return { ok: true, found: true, name: req.name, bal: 100, n: 1, entries: [] }; if (req.op === 'post') return { ok: true, name: req.name, bal: 0, n: 2 }; return { ok: true, names: [], list: [] }; }
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [] };
  return { ok: true }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = u === '/memo.html' ? (path.isAbsolute(FILE) ? FILE : path.join(DIR, FILE)) : path.join(DIR, u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [], alerts = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/raw\.githubusercontent\.com\/.*jobs\//, r => { const id = r.request().url().match(/jobs\/([^.?]+)\.json/)[1]; jobs[id] ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(jobs[id]) }) : r.fulfill({ status: 404, body: 'nf' }); });
  await pg.route(/ntfy\.sh|api\.github\.com|costs\.enc|costing\.enc/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.clear(); localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Muhammad'); localStorage.setItem('sj_dev', 'devM'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]); const t = q => pg.$eval(q, e => e.textContent).catch(() => '');
  const saved = () => pg.evaluate(() => { const S = JSON.parse(localStorage.getItem('sj_stock') || '{}'); const k = Object.keys(S)[0]; return k ? S[k].st : ''; });
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { const S = window.__sj, B = S.B(); B.inv = null; S.st({ '18634:1': { pcs: 4, sets: 0, all: false } }); S.setMode('inv'); });
  await pg.fill('#bform input[data-k="name"]', 'Matiullah'); await pg.fill('#bform input[data-p="18634"]', '125'); await pg.waitForTimeout(1500);
  await pg.click('#dinc'); for (let i = 0; i < 40 && !stock.length; i++) await pg.waitForTimeout(250); await pg.waitForTimeout(1200);
  ok('the relay refused to start the stock job: an alert says the pieces were NOT taken off Trello', alerts.some(a => /NOT taken off Trello/.test(a) && /too many times/.test(a)));
  ok('the green mark does not claim "pieces taken off Trello" (' + (await t('#gmstk')) + ')', /NOT taken off Trello/.test(await t('#gmstk')));
  ok('the red box has the reason and Try again', /too many times/.test(await t('#stk')) && !!(await pg.$('#stk [data-stk="sell"]')));
  refuse = false; const n0 = stock.length; await pg.click('#stk [data-stk="sell"]');
  for (let i = 0; i < 60 && (await saved()) !== 'ok'; i++) await pg.waitForTimeout(500);
  ok('Try again starts the job once more', stock.length === n0 + 1 && stock[n0].op === 'sell');
  ok('the job\'s answer is SAVED on the phone (it was lost inside a comment)', (await saved()) === 'ok');
  ok('the box shows it: Trello updated ✓ 4 pcs', /Trello updated ✓ 4 pcs/.test(await t('#stk')));
  ok('the green mark now says: pieces taken off Trello ✓', /taken off Trello ✓/.test(await t('#gmstk')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed');
  if (!out.every(o => o[1])) process.exit(1);
})();
