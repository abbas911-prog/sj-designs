// 30 Oct 2026 (Abbas): (1) "Nasir's order: I add more designs (Open as memo → send again) — when I go back it does not show the complete photos":
// the Complete order picture held at most 12 designs and, after a change, the screen kept the OLD saved picture. Now the phone draws it from
// every line of the order and draws it again when the order changes. (2) "I want the bill to be a visible photo, like the catalogue":
// Send / Include & share go out as JPEG pictures of the bill pages; 📄 PDF switches back.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const zlib = require('zlib');
// a 600×400 plain JPEG made here (no image library): a tiny baseline JPEG would need an encoder, so the photo is a PNG served as the thumb
function png(w, h) { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 180; raw[o + 1] = 60; raw[o + 2] = 90; } }
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); }
const PH = png(600, 400);
const DIR = require('path').join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = Array.from({ length: 15 }, (_, i) => ({ id: 'c' + (i + 1), idShort: i + 1, list: 'r', name: 'SJ-' + (30001 + i) + ' (16) colour = (2) (8/8)', attachments: [{ id: 'a' + (i + 1), mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }));
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
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (/^\/(thumbs|keep)\/.*\.jpg$/.test(u)) { rs.setHeader('content-type', 'image/jpeg'); return rs.end(PH); } if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });

(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  await pg.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async o => { window.__shared.push((o.files || []).map(f => f.name + ' ' + f.type)); }; });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  const pick = async n => { const ds = await pg.$$('#feed .design'); await (await ds[n].$('.step button:nth-child(3)')).click(); await pg.waitForTimeout(120); };
  const pic = () => pg.evaluate(async () => { const d = document.querySelector('#ccbody details.ofull'); if (d) d.open = true; const i = document.querySelector('#ccbody .opvbig'); if (!i) return null;
    if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); }); return { src: i.src.slice(0, 5), w: i.naturalWidth, h: i.naturalHeight }; });
  await pg.fill('#name', 'NASIR'); for (const n of [0, 1]) await pick(n);
  await pg.click('#ok'); await pg.waitForFunction(() => !document.querySelector('#sendg').disabled, null, { timeout: 20000 });
  await pg.click('#sendg'); await pg.waitForFunction(() => !document.querySelector('#cc').hidden && document.querySelector('.otabs2'), null, { timeout: 30000 });
  await pg.click('[data-ofold]'); await pg.waitForTimeout(2000);
  const p1 = await pic(); ok('order of 2 designs: the Complete order picture is drawn on the phone (1 column) ' + JSON.stringify(p1), p1 && p1.src === 'blob:' && p1.w === 880);
  // Open as memo → add 12 more designs → send again → back on the order screen
  await pg.click('[data-obill="memo"]'); await pg.waitForTimeout(1500); await pg.click('#back'); await pg.waitForTimeout(400);
  for (let n = 2; n < 14; n++) await pick(n);
  await pg.click('#ok'); await pg.waitForFunction(() => !document.querySelector('#sendg').disabled, null, { timeout: 20000 });
  await pg.click('#sendc'); await pg.waitForTimeout(3500);
  const oid = Object.keys(ORDS).find(k => k !== 'oold');
  ok('the order now has 14 designs', ORDS[oid].items.length === 14 && (await pg.$$('#ccbody .optile img')).length === 14);
  if (!(await pg.$('#ccbody details.ofull'))) { await pg.click('[data-ofold]'); } await pg.waitForTimeout(2500);
  const p2 = await pic(); ok('after adding designs, the picture shows ALL 14 (3 columns × 5 rows, drawn again) ' + JSON.stringify(p2), p2 && p2.src === 'blob:' && p2.w === 1200 && p2.h >= 1500);
  // the bill goes out as photos
  await pg.evaluate(() => { const c = document.getElementById('ccx') || document.querySelector('#cc .ccback'); if (c) c.click(); });
  await pg.evaluate(() => { if (window.navCloseAll) navCloseAll(); }); await pg.$eval('#ok', e => e.click()); await pg.waitForTimeout(800);
  await pg.$eval('#mode button[data-m="inv"]', e => e.click()); await pg.waitForTimeout(500);
  for (const i of await pg.$$('#bform input[data-p]')) await i.fill('100'); await pg.waitForTimeout(1200);
  ok('📷 Photo is the default, button says "Send photo"', (await pg.$eval('#dfmt button.on', e => e.dataset.sa).catch(() => '')) === 'photo' && /Send photo/.test(await pg.$eval('#dsend', e => e.textContent)));
  await pg.$eval('#dsend', e => e.click()); await pg.waitForFunction(() => window.__shared.length === 1, null, { timeout: 15000 }).catch(() => {});
  const s1 = await pg.evaluate(() => window.__shared[0] || []);
  ok('Send = the bill pages as JPEG pictures ' + JSON.stringify(s1), s1.length >= 1 && s1.every(x => /^INV-\S+\.jpg image\/jpeg$/.test(x)));
  await pg.$eval('#dfmt [data-sa="pdf"]', e => e.click()).catch(() => {}); await pg.$eval('#dsend', e => e.click()); await pg.waitForFunction(() => window.__shared.length === 2, null, { timeout: 15000 }).catch(() => {});
  const s2 = await pg.evaluate(() => window.__shared[1] || []);
  ok('📄 PDF switch = one PDF, as before ' + JSON.stringify(s2), s2.length === 1 && /\.pdf application\/pdf$/.test(s2[0]) && /Send PDF/.test(await pg.$eval('#dsend', e => e.textContent)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await br.close(); srv.close();
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
