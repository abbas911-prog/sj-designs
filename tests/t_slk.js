// 20 Nov 2026 (Abbas: "when he presses the green button, post it to #sales-new automatically; a receipt goes to #receipts-new").
// Part 1: the app (fake relay). Part 2: the real relay.gs with the fake Slack.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234', FILE = process.env.MEMO || 'memo.html', F = require(path.join(DIR, 'tools', 'test', 'fakes'));
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const slk = [], BILLS = {}; let slkAnswer = () => ({ ok: true });
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'slackpdf2') { slk.push(req); return slkAnswer(req); }
  if (b.job === 'bills') { if (req.op === 'list') return { ok: true, bills: [] }; if (req.op === 'put') { BILLS[req.ref] = req; return { ok: true, ref: req.ref, status: req.status }; } if (req.op === 'next') return { ok: true, ref: req.ref }; return { ok: true }; }
  if (b.job === 'cust') { if (req.op === 'get') return { ok: true, found: true, name: req.name, bal: 100, n: 1, entries: [] }; if (req.op === 'post') return { ok: true, name: req.name, bal: 0, n: 2 }; return { ok: true, names: [], list: [] }; }
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [] };
  return { ok: true }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = u === '/memo.html' ? (path.isAbsolute(FILE) ? FILE : path.join(DIR, FILE)) : path.join(DIR, u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/ntfy\.sh|github|costs\.enc|costing\.enc/, r => r.abort());
  await pg.addInitScript(() => { window.navigator.canShare = () => false; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.clear(); localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Muhammad'); localStorage.setItem('sj_dev', 'devM'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]); const wait = async n => { for (let i = 0; i < 60 && slk.length < n; i++) await pg.waitForTimeout(250); };
  await pg.click('#nav button[data-nv="more"]'); await pg.click('.mgrid button[data-go="bills"]'); await pg.waitForTimeout(400);
  // invoice: green button
  await pg.evaluate(() => { const S = window.__sj, B = S.B(); B.inv = null; S.st({ '18634:1': { pcs: 4, sets: 0, all: false } }); S.setMode('inv'); });
  await pg.fill('#bform input[data-k="name"]', 'Matiullah'); await pg.fill('#bform input[data-p="18634"]', '125'); await pg.waitForTimeout(1500);
  ok('nothing goes to Slack before the green button', slk.length === 0);
  await pg.click('#dinc'); await wait(1); await pg.waitForTimeout(800);
  const s1 = slk[0] || {};
  ok('green button: the bill goes to #sales-new by itself (' + (s1.text || '') + ')', s1.to === 'sales' && /INVOICE INV-\d+/.test(s1.text || '') && /Matiullah/.test(s1.text) && /500\.00 AED/.test(s1.text) && /4 pcs/.test(s1.text) && /by Muhammad/.test(s1.text));
  ok('…as the bill\'s PDF, with a once-only id', /\.pdf$/.test(s1.name || '') && Buffer.from(s1.pdf || '', 'base64').slice(0, 4).toString() === '%PDF' && /^inv:INV-/.test(s1.once || ''));
  ok('the bill says so: Posted to #sales-new ✓', /Posted to #sales-new/.test(await pg.$eval('#gmark', e => e.textContent).catch(() => '')));
  // receipt: Send; Slack refuses first (bot not in the channel) -> reason on the receipt + a button, which posts it
  slkAnswer = () => ({ ok: false, error: 'Slack said not_in_channel - open #receipts-new in Slack and type /invite @SJ Memo' });
  await pg.click('#mode button[data-m="rv"]'); await pg.waitForTimeout(500);
  await pg.fill('#bform input[data-k="name"]', 'Matiullah'); await pg.fill('#bform input[data-k="amount"]', '2000'); await pg.waitForTimeout(1500);
  await pg.click('#dsend'); await wait(2); await pg.waitForTimeout(1500);
  const s2 = slk[slk.length - 1] || {};
  ok('receipt Send: goes to #receipts-new by itself (' + (s2.text || '') + ')', s2.to === 'receipts' && /RECEIPT VOUCHER RV-\d+/.test(s2.text || '') && /2,000\.00 AED/.test(s2.text));
  const lk = await pg.$eval('#vlock', e => e.textContent).catch(() => '');
  ok('Slack refused: the receipt shows the reason and a button', /Not posted to #receipts-new/.test(lk) && /invite @SJ Memo/.test(lk) && !!(await pg.$('#vlock [data-slk]')));
  slkAnswer = () => ({ ok: true }); const n0 = slk.length; await pg.click('#vlock [data-slk]'); await wait(n0 + 1); await pg.waitForTimeout(800);
  ok('the button posts it; the receipt then says Posted ✓', slk.length === n0 + 1 && slk[n0].to === 'receipts' && /Posted to #receipts-new/.test(await pg.$eval('#vlock', e => e.textContent).catch(() => '')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  // ---- the real relay
  const RPW = 'shop-test-pw', W = F.makeWorld(), R = F.makeRelay(W, { MEMO_PASSWORD: RPW, SLACK_BOT_TOKEN: 'xoxb-t' });
  W.slack.ch.C09DZDVA9S6 = { id: 'C09DZDVA9S6', name: 'sales-new', member: true, msgs: [] }; W.slack.ch.C09DX2R1N13 = { id: 'C09DX2R1N13', name: 'receipts-new', member: true, msgs: [] };
  const call = o => { const req = JSON.stringify(Object.assign({ t: Date.now(), dev: 'd' }, o)); return JSON.parse(R.post(JSON.stringify({ job: 'slackpdf2', req, sig: crypto.createHmac('sha256', RPW).update(req).digest('hex') }))); };
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(300, 65)]).toString('base64');
  let r = call({ to: 'sales', name: 'INV-0070-Matiullah.pdf', text: 'INVOICE INV-0070 · Matiullah · 500.00 AED', pdf, once: 'inv:INV-0070:d:1' });
  ok('relay: the invoice PDF lands in #sales-new with its text', r.ok && W.slack.ch.C09DZDVA9S6.msgs.length === 1 && /INV-0070/.test(W.slack.ch.C09DZDVA9S6.msgs[0].text) && (W.slack.ch.C09DZDVA9S6.msgs[0].files || []).length === 1);
  r = call({ to: 'sales', name: 'INV-0070-Matiullah.pdf', text: 'INVOICE INV-0070 · Matiullah · 500.00 AED', pdf, once: 'inv:INV-0070:d:1' });
  ok('relay: the same bill sent again (a retry) is NOT posted twice', r.ok && r.dup && W.slack.ch.C09DZDVA9S6.msgs.length === 1);
  r = call({ to: 'receipts', name: 'RV-0080-Matiullah.pdf', text: 'RECEIPT VOUCHER RV-0080 · Matiullah · 2,000.00 AED', pdf, once: 'rv:RV-0080:d:1' });
  ok('relay: a receipt lands in #receipts-new, not in #sales-new', r.ok && W.slack.ch.C09DX2R1N13.msgs.length === 1 && W.slack.ch.C09DZDVA9S6.msgs.length === 1);
  ok('relay: an unknown channel is still refused', !call({ to: 'cash', name: 'x.pdf', text: 'x', pdf }).ok);
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed');
  if (!out.every(o => o[1])) process.exit(1);
})();
