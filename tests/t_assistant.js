// Assistant (assistant.html, 24 Oct 2026): one Catch-up for SJ Stock + AL MUTAGADED, open any chat, reply with text / photo / voice note,
// forward a photo to another chat or to WhatsApp (phone share sheet). Fake relay (cchat / orders / fac), no Slack, no Trello.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = Math.floor(Date.now() / 1000), T = s => String(NOW - s) + '.000100';
const ORDERS = [{ id: 'o1', name: 'NASIR (LIBYA)', gts: T(5000), cts: T(5100), pcs: 215, steps: {}, created: (NOW - 6000) * 1000 }];
const calls = [];
let ordMsgs = [{ ts: T(5100), who: 'Order memo', memo: true, text: '24 Oct 2026 · 6 designs · 215 pcs', files: [] }, { ts: T(600), who: 'Muhammad', app: true, text: 'Kal tak bhej denge, Insha Allah', files: [] }];
let cardMsgs = [{ ts: T(9000), who: 'SJ', root: true, text: 'SJ-48188 order', files: [] }, { ts: T(300), who: 'Rifat', app: true, text: 'Lace short, 20 meter aur chahiye', files: [{ id: 'FPHOTO1', name: 'lace.jpg', type: 'image/jpeg', img: true }] },
  { ts: T(200), who: '', sys: true, text: '→ *CUTTING* · Ibrahim', files: [] }];
function sig(req, k) { return crypto.createHmac('sha256', k).update(req).digest('hex'); }
function relay(b) {
  const req = JSON.parse(b.req); calls.push({ job: b.job, req });
  if (b.sig !== sig(b.req, PW)) return { ok: false, error: 'wrong password' };
  if (b.job === 'orders') return { ok: true, orders: ORDERS };
  if (b.job === 'cchat') {
    if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [], live: '', nt: false, ev: false, dms: [{ k: 'D' + T(9999), name: 'Imran', root: T(9999), un: 0, tx: '', last: T(4000) }],
      orders: [{ k: 'O' + T(5100), ts: T(5100), name: 'NASIR (LIBYA)', head: '24 Oct 2026 · 6 designs · 215 pcs', chat: 1, last: T(600), un: req.look ? 0 : 1, tx: 'Muhammad: Kal tak bhej denge, Insha Allah' }],
      gun: { ['G' + T(5000)]: { n: 2, last: T(100), tx: 'Imran: Picking started' } } };
    if (req.op === 'thread' && req.ch === 'godown') return { ok: true, root: req.root, msgs: [{ ts: T(5000), who: 'Godown pick list', memo: true, text: 'Pick: SJ-20713', files: [] }, { ts: T(100), who: 'Imran', text: 'Picking started', files: [] }] };
    if (req.op === 'thread') return { ok: true, root: req.root, msgs: ordMsgs };
    if (req.op === 'post') { ordMsgs = ordMsgs.concat([{ ts: String(NOW + 1) + '.000100', who: req.who, app: true, text: req.text, files: [] }]); return { ok: true, ts: String(NOW + 1) + '.000100', root: req.root }; }
    if (req.op === 'up') return { ok: true, root: req.root, files: req.files.length };
    if (req.op === 'file') return { ok: true, b64: PNG.toString('base64'), type: 'image/png', name: 'x.png' };
  }
  if (b.job === 'fac') {
    if (req.op === 'list' || req.op === 'ping') return { ok: true, live: '', lists: [['CUTTING', 'L1']], cards: req.op === 'list' ? [{ id: 'c48188', name: 'SJ-48188 (172) pcs colours = (4)', l: 'L1' }, { id: 'cold', name: 'SJ-1111 old', l: 'L1' }] : undefined,
      th: { c48188: { n: 1, last: T(300), tx: 'Rifat: Lace short, 20 meter aur chahiye' } }, act: { c48188: T(200), cold: T(90000) }, dm: { ch: 'C1', name: 'trello' }, rooms: [{ k: 'cash', ch: 'C2', name: 'cash', title: '💵 #cash' }] };
    if (req.op === 'thread') return { ok: true, ch: 'C9', ts: T(9000), msgs: cardMsgs };
    if (req.op === 'media') return { ok: true, b64: PNG.toString('base64'), type: 'image/jpeg', name: 'lace.jpg' };
    if (req.op === 'post' || req.op === 'up') return { ok: true, ts: String(NOW + 2) + '.000100' };
  }
  return { ok: false, error: 'not in test: ' + b.job + ' ' + req.op };
}
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0]; const f = path.join(DIR, u === '/' ? 'assistant.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', /\.html$/.test(f) ? 'text/html' : /\.png$/.test(f) ? 'image/png' : 'application/json'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/assistant.html';
  const br = await chromium.launch(); const errs = []; const out = []; const ok = (n, v) => out.push([n, !!v]);
  const page = async (store) => { const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); pg.on('pageerror', e => errs.push(e.message));
    await pg.route(/script\.google\.com/, r => { const b = JSON.parse(r.request().postData() || '{}'); r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); }); await pg.route(/ntfy\.sh/, r => r.abort());
    await pg.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push({ n: (d.files || []).length, names: (d.files || []).map(f => f.name), text: d.text || '' }); }; });
    await pg.goto(URL0); await pg.evaluate(s => { localStorage.clear(); Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); }, store); await pg.reload(); return pg; };
  const t = (pg, q) => pg.$eval(q, e => e.textContent.trim()).catch(() => null);
  const last = (job, op) => calls.filter(c => c.job === job && c.req.op === op).pop();

  // 1. no sign-in on this phone → asks once; a wrong password is refused, the right one opens the app
  const p0 = await page({});
  ok('no password on the phone → sign-in screen', await p0.isVisible('#login'));
  await p0.fill('#lpw', 'nope'); await p0.click('#lgo'); await p0.waitForFunction(() => /did not work/.test(document.querySelector('#lerr').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('wrong password → "did not work"', /did not work/.test(await t(p0, '#lerr')));
  await p0.fill('#lpw', PW); await p0.click('#lgo'); await p0.waitForSelector('#clist .row', { timeout: 10000 }).catch(() => {});
  ok('right password → Catch-up shows', !(await p0.isVisible('#login')) && (await p0.$$('#clist .row')).length > 0);
  await p0.close();

  // 2. Abbas's phone already signed in to SJ Stock (same site) → Catch-up straight away, both apps
  const pg = await page({ sj_memo_pw: PW, sj_me: 'Abbas', 'timo-state': JSON.stringify({ acts: [{ id: 'b1', name: 'Factory round', icon: '🏭', start: 0, dur: 1439, repeat: 'daily', date: '2020-01-01', items: ['Check 48188'] }], done: {}, checks: {} }) });
  await pg.waitForFunction(() => document.querySelectorAll('#clist .row').length >= 3, null, { timeout: 12000 }).catch(() => {});
  const rows = await pg.$$eval('#clist .row', L => L.map(e => e.textContent));
  ok('Catch-up: SJ Stock order chat with its new line', rows.some(r => /NASIR/.test(r) && /customer order/.test(r) && /Kal tak bhej denge/.test(r)));
  ok('Catch-up: #godown chat of the same order (2 new)', rows.some(r => /NASIR/.test(r) && /godown/.test(r) && /Picking started/.test(r)));
  ok('Catch-up: factory card chat SJ-48188 with Rifat\'s line', rows.some(r => /SJ-48188/.test(r) && /Rifat: Lace short/.test(r)));
  ok('badge = 4 new messages', (await t(pg, '#nb')) === '4');
  ok('Timo block shown on top (NOW)', /Factory round/.test(await t(pg, '#today1') || ''));
  ok('nothing old in the new list (SJ-1111 only under "Latest elsewhere")', (await pg.$$eval('#clist .sec', L => L.map(e => e.textContent))).some(s => /Latest/.test(s)));

  // 3. open the SJ Stock order chat → read with look:1, reply in text
  await pg.click('#clist .row:has-text("customer order")'); await pg.waitForSelector('#chat .m', { timeout: 8000 });
  ok('order chat opened, marks seen (look:1, root)', last('cchat', 'thread').req.look === 1 && !!last('cchat', 'thread').req.root);
  ok('shows who said what', /Muhammad/.test(await t(pg, '#cbody')) && /Kal tak bhej denge/.test(await t(pg, '#cbody')));
  await pg.fill('#ctxt', 'Theek hai, kal 5 baje tak'); await pg.click('#csend');
  await pg.waitForFunction(() => [...document.querySelectorAll('.m.me')].some(e => /kal 5 baje/.test(e.textContent) && !e.classList.contains('pend')), null, { timeout: 10000 }).catch(() => {});
  const ps = last('cchat', 'post');
  ok('reply posted in that order chat as Abbas', ps && ps.req.root === T(5100) && ps.req.who === 'Abbas' && ps.req.text === 'Theek hai, kal 5 baje tak' && !!ps.req.rid);
  ok('reply shows as my line (not stuck on sending)', await pg.$$eval('.m.me', L => L.some(e => /kal 5 baje/.test(e.textContent) && !e.classList.contains('pend'))));
  // photo from the camera / gallery into the same chat
  await pg.setInputFiles('#ffile', { name: 'fabric.png', mimeType: 'image/png', buffer: PNG });
  ok('photo waits in the box before sending', (await pg.$$('#atts span')).length === 1);
  await pg.click('#csend'); await pg.waitForFunction(() => document.querySelectorAll('#atts span').length === 0, null, { timeout: 5000 }).catch(() => {});
  await pg.waitForTimeout(800); const up = last('cchat', 'up');
  ok('photo sent in original bytes to the order chat', up && up.req.root === T(5100) && up.req.files.length === 1 && Buffer.from(up.req.files[0].b64, 'base64').equals(PNG));
  await pg.click('#cback');

  // 4. factory card chat: photo from Rifat → forward to the godown chat of NASIR, with a line
  await pg.click('#clist .row:has-text("SJ-48188")'); await pg.waitForSelector('#chat .m img', { timeout: 8000 });
  ok('factory card chat opened (card id), photo loads', last('fac', 'thread').req.card === 'c48188' && await pg.$eval('#chat .m img', e => !!e.src));
  ok('move line shown as a system line', (await pg.$$('.m.sys')).length === 1);
  await pg.click('.m:has-text("Lace short") .fw'); await pg.waitForSelector('#plist .row', { timeout: 5000 });
  await pg.click('#plist .row:has-text("godown")'); await pg.waitForSelector('#fwgo', { timeout: 8000 });
  await pg.fill('#fwnote', 'Is lace ka 20 meter order karo'); await pg.click('#fwgo'); await pg.waitForTimeout(1200);
  const fup = calls.filter(c => c.job === 'cchat' && c.req.op === 'up').pop();
  ok('forward: original photo fetched in full from the factory chat', calls.some(c => c.job === 'fac' && c.req.op === 'media' && c.req.file === 'FPHOTO1' && c.req.full === 1));
  ok('forward: sent to the #godown chat of NASIR with the line', fup && fup.req.ch === 'godown' && fup.req.root === T(5000) && fup.req.text === 'Is lace ka 20 meter order karo' && fup.req.files.length === 1);
  // the same photo to WhatsApp → phone share sheet with the file
  await pg.click('.m:has-text("Lace short") .fw'); await pg.waitForSelector('#plist .row', { timeout: 5000 });
  await pg.click('#plist [data-pk="wa"]'); await pg.waitForSelector('#fwgo', { timeout: 8000 }); await pg.fill('#fwnote', 'Saruj bhai, ye lace 20 meter chahiye'); await pg.click('#fwgo'); await pg.waitForTimeout(400);
  const sh = await pg.evaluate(() => window.__shared);
  ok('WhatsApp: share sheet gets the photo + the line', sh.length === 1 && sh[0].n === 1 && /20 meter/.test(sh[0].text));
  // write in the factory chat but send to another chat ("Send to …")
  await pg.click('#tgtb'); await pg.waitForSelector('#plist .row'); await pg.click('#plist .row:has-text("#cash")');
  ok('target line says #cash', /cash/.test(await t(pg, '#tgtb')));
  await pg.fill('#ctxt', '20 m lace 400 AED'); await pg.click('#csend'); await pg.waitForTimeout(800);
  const cp = calls.filter(c => c.job === 'fac' && c.req.op === 'post').pop();
  ok('typed line went to #cash, not to the card chat', cp && cp.req.card === 'cash' && cp.req.text === '20 m lace 400 AED');
  await pg.click('#cback');

  // 5. All chats: search
  await pg.click('#nav button[data-v="chats"]'); await pg.fill('#q', 'imran');
  ok('All chats → search finds the Imran direct chat', (await pg.$$eval('#alist .row', L => L.map(e => e.textContent))).some(r => /Imran/.test(r) && /direct/.test(r)));
  await pg.click('#nav button[data-v="today"]'); ok('Today tab lists the Timo block', /Factory round/.test(await t(pg, '#tday') || ''));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
