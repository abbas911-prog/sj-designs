// 20 Nov 2026 (Abbas: "the app is changing the opening balances of the customers every time"): a staff phone must never make an "… adjust" line.
// Staff: the old-balance box of a known customer is locked and follows the app; a stale figure kept in a draft is replaced. Owner: can still type (asked).
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234', FILE = process.env.MEMO || 'memo.html';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
let custPosts = [], BAL = 5000; const BILLS = {};
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: Object.values(BILLS) }; if (req.op === 'put') { BILLS[req.ref] = req; return { ok: true, status: req.status }; } if (req.op === 'next') return { ok: true, ref: req.ref }; return { ok: true }; }
  if (b.job === 'cust') { if (req.op === 'get') return /MATIULLAH/i.test(req.name) ? { ok: true, found: true, name: 'MATIULLAH', bal: BAL, n: 3 } : { ok: true, found: false };
    if (req.op === 'post') { custPosts.push(req); return { ok: true, name: 'MATIULLAH', bal: BAL, n: 4 }; } return { ok: true, names: ['MATIULLAH'] }; }
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [] };
  return { ok: false, error: 'not in test' }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = u === '/memo.html' ? (path.isAbsolute(FILE) ? FILE : path.join(DIR, FILE)) : path.join(DIR, u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
async function phone(br, URL0, owner) {
  const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const dl = [];
  pg.on('dialog', d => { dl.push(d.message()); d.accept(); });
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  await pg.route(/costs\.enc|costing\.enc/, r => r.fulfill({ status: 404, body: 'nf' }));
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(a => { localStorage.clear(); localStorage.setItem('sj_memo_pw', a[0]); localStorage.setItem('sj_me', a[1] ? 'Abbas' : 'Muhammad'); if (a[1]) { localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_owner_pin', '1234'); localStorage.setItem('sj_costs', JSON.stringify({ d: '2026-11-20', c: { '18634': 100 } })); } }, [PW, owner]); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(300);
  await pg.click('#mode button[data-m="rv"]'); await pg.waitForTimeout(400);
  return { pg, dl }; }
const openV = pg => pg.$eval('#bform input[data-k="open"]', e => e.value);
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const out = [];
  // ---- staff phone
  let { pg, dl } = await phone(br, URL0, false);
  await pg.fill('#bform input[data-k="name"]', 'Matiullah'); await pg.waitForFunction(() => document.querySelector('#bform input[data-k="open"]').value === '5000', null, { timeout: 8000 }).catch(() => {});
  out.push(['staff: the opening balance fills from the app (5000)', (await openV(pg)) === '5000']);
  out.push(['staff: the box is locked for a known customer', await pg.$eval('#bform input[data-k="open"]', e => e.readOnly)]);
  // what the old app allowed: the box typed over from the paper book
  await pg.evaluate(() => { const i = document.querySelector('#bform input[data-k="open"]'); i.readOnly = false; i.value = '9999'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.fill('#bform input[data-k="amount"]', '1000'); await pg.waitForTimeout(900);
  await pg.click('#dsend'); await pg.waitForTimeout(2500);
  if (!custPosts.length) { await pg.click('#dsend'); await pg.waitForTimeout(3000); }
  out.push(['staff: a typed 9999 never makes an adjust line (' + custPosts.map(p => p.type + ':' + (p.adj || p.recv)).join(', ') + ')', custPosts.length > 0 && !custPosts.some(p => /adjust/.test(p.ref || ''))]);
  out.push(['staff: the receipt itself is posted (1000 received)', custPosts.some(p => p.type === 'rv' && p.recv === 1000)]);
  out.push(['staff: the bill shows the app balance, not 9999', !custPosts.some(p => p.open === 9999)]);
  // a draft kept from days ago: the balance moved on meanwhile
  custPosts = []; BAL = 7500;
  await pg.evaluate(() => { const B = window.__sj.B(); B.rv = { ref: 'RV-0900', date: '2026-11-20', name: 'Matiullah', open: '5000', amount: '200', modeP: 'Cash', openTyped: true, cust: { found: true, name: 'MATIULLAH', bal: 5000, n: 3 } }; window.__sj.setMode('rv'); });
  await pg.waitForFunction(() => document.querySelector('#bform input[data-k="open"]').value === '7500', null, { timeout: 8000 }).catch(() => {});
  out.push(['staff: an old draft opened again takes today\'s balance (7500, was 5000)', (await openV(pg)) === '7500']);
  await pg.close();
  // ---- owner phone: may still change a balance, and is asked
  custPosts = []; BAL = 5000; ({ pg, dl } = await phone(br, URL0, true));
  await pg.fill('#bform input[data-k="name"]', 'Matiullah'); await pg.waitForFunction(() => document.querySelector('#bform input[data-k="open"]').value === '5000', null, { timeout: 8000 }).catch(() => {});
  out.push(['owner: the box is open', !(await pg.$eval('#bform input[data-k="open"]', e => e.readOnly))]);
  await pg.fill('#bform input[data-k="open"]', '6000'); await pg.fill('#bform input[data-k="amount"]', '1000'); await pg.waitForTimeout(900);
  await pg.click('#dsend'); await pg.waitForTimeout(3000);
  out.push(['owner: asked first, then an adjust line of +1000', dl.some(m => /change their balance/.test(m)) && custPosts.some(p => /adjust/.test(p.ref || '') && p.adj === 1000)]);
  await br.close(); srv.close();
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed');
  if (!out.every(o => o[1])) process.exit(1);
})();
