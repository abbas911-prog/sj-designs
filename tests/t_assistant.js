// Assistant (assistant.html + its OWN script tools/assistant.gs, 24 Oct 2026). The real assistant.gs runs in Node with fake Apps Script services and
// two fake Slack workspaces (SJTC + factory, picked by the bot token). Checks: setup, Catch-up (who said what, both workspaces), reply, photo,
// forward a photo to another chat and to WhatsApp, "send to" another channel, mark done, and that the SJ relay is never called.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const F = require('../tools/test/fakes');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const DIR = path.join(__dirname, '..'), URLX = 'https://script.google.com/macros/s/TESTASSIST/exec', PW = 'secret123';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---- two Slack workspaces ----
const S = F.makeWorld(), FW = F.makeWorld();
S.slack.ch = {}; ['C0CUST0001:customer', 'C0GODN0001:godown'].forEach(x => { const [id, name] = x.split(':'); S.slack.ch[id] = { id, name, msgs: [], member: true, priv: true }; });
Object.values(FW.slack.ch).forEach(c => { c.member = true; });
const memo = F.postSlack(S, 'C0CUST0001', { text: '*ORDER MEMO* — NASIR (LIBYA)\n24 Oct 2026 · 6 designs · 215 pcs', bot_id: 'B9' });
F.postSlack(S, 'C0CUST0001', { text: '*Muhammad:* Kal tak bhej denge, Insha Allah', bot_id: 'B9', thread_ts: memo.ts });
const pick = F.postSlack(S, 'C0GODN0001', { text: '*GODOWN PICK LIST* — NASIR (LIBYA)\nPick: SJ-20713', bot_id: 'B9' });
F.postSlack(S, 'C0GODN0001', { text: 'Picking started', user: 'U1', thread_ts: pick.ts });
FW.slack.files.FPH1 = { id: 'FPH1', name: 'lace.jpg', mimetype: 'image/jpeg', size: PNG.length, bytes: PNG, url_private: 'https://files.slack.com/dl/FPH1', url_private_download: 'https://files.slack.com/dl/FPH1' };
const card = F.postSlack(FW, 'C09S552KD7T', { text: 'SJ-48188 (172) pcs colours = (4) <https://trello.com/c/abc>', bot_id: 'B1' });
F.postSlack(FW, 'C09S552KD7T', { text: '*Rifat:* Lace short, 20 meter aur chahiye', bot_id: 'B1', thread_ts: card.ts, files: [FW.slack.files.FPH1] });
F.postSlack(FW, 'C09S552KD7T', { text: '→ *CUTTING* · Ibrahim', bot_id: 'B1', thread_ts: card.ts });
F.postSlack(FW, 'C0CASH00001', { text: 'Paid 400 AED to the lace man', user: 'U1' });

// ---- the real assistant.gs with fake Apps Script ----
function bytesOf(x) { if (Buffer.isBuffer(x)) return x; if (Array.isArray(x)) return Buffer.from(x.map(b => b & 255)); return Buffer.from(String(x), 'utf8'); }
function sbytes(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function blob(buf, type, name) { const b = { _b: bytesOf(buf), _t: type || 'application/octet-stream', _n: name || '' }; b.getBytes = () => sbytes(b._b); b.getContentType = () => b._t; return b; }
const P = {}, CACHE = new Map(), SLACKCALLS = [];
const cget = k => { const e = CACHE.get(k); if (!e || e.exp < Date.now()) return null; return e.v; };
const cache = { get: cget, put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('Argument too large'); CACHE.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); }, putAll: (o, ttl) => Object.keys(o).forEach(k => cache.put(k, o[k], ttl)),
  getAll: ks => { const r = {}; ks.forEach(k => { const v = cget(k); if (v != null) r[k] = v; }); return r; }, remove: k => CACHE.delete(k) };
const props = { getProperty: k => (k in P ? P[k] : null), setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large'); P[k] = String(v); return props; }, getProperties: () => Object.assign({}, P) };
const fetchSync = (url, o) => { o = o || {}; const auth = String((o.headers || {}).Authorization || ''), W = /xoxb-fac/.test(auth) ? FW : S; let body = o.payload; if (body && body._b) body = body._b;
  if (/slack\.com\/api\/auth\.test/.test(url)) { const ok = /xoxb-(sjtc|fac)/.test(auth); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(ok ? { ok: true, team: W === FW ? 'AL MUTAGADED' : 'SJTC' } : { ok: false, error: 'invalid_auth' }) }; }
  if (/slack\.com\/api\//.test(url)) SLACKCALLS.push(url.split('/api/')[1].split('?')[0]);
  const r = F.handle(W, o.method || 'get', url, body, o.headers || {}); return { getResponseCode: () => r.status, getContentText: () => r.body.toString(), getBlob: () => blob(r.body, r.type) }; };
const ctx = vm.createContext({ PropertiesService: { getScriptProperties: () => props }, CacheService: { getScriptCache: () => cache }, UrlFetchApp: { fetch: fetchSync },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => { const x = { getContent: () => s, setMimeType: () => x }; return x; } },
  Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => sbytes(crypto.createHmac('sha256', bytesOf(k)).update(bytesOf(v)).digest()), base64Encode: x => bytesOf(x).toString('base64'),
    base64Decode: s => sbytes(Buffer.from(String(s), 'base64')), sleep: () => {}, newBlob: (b, t, n) => blob(b, t, n) }, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, encodeURIComponent });
vm.runInContext(fs.readFileSync(path.join(DIR, 'tools/assistant.gs'), 'utf8'), ctx, { filename: 'assistant.gs' });
const bodies = [];

const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0], f = path.join(DIR, u === '/' ? 'assistant.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', /\.html$/.test(f) ? 'text/html' : /\.png$/.test(f) ? 'image/png' : 'text/plain'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const BASE = 'http://localhost:' + srv.address().port + '/';
  const br = await chromium.launch(); const errs = [], out = [], ok = (n, v) => out.push([n, !!v]);
  const page = async (store) => { const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); pg.on('pageerror', e => errs.push(e.message));
    await pg.route(/script\.google\.com/, r => { const rq = r.request(); let txt; if (rq.method() === 'GET') txt = ctx.doGet().getContent(); else { bodies.push(rq.postData()); txt = ctx.doPost({ postData: { contents: rq.postData() } }).getContent(); } r.fulfill({ contentType: 'application/json', body: txt }); });
    await pg.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async d => { window.__shared.push({ n: (d.files || []).length, text: d.text || '' }); }; });
    await pg.goto(BASE + 'assistant.html'); await pg.evaluate(s => { localStorage.clear(); Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); }, store || {}); await pg.reload(); return pg; };
  const t = (pg, q) => pg.$eval(q, e => e.textContent.trim()).catch(() => '');
  const replies = (W, ch, root) => W.slack.ch[ch].msgs.filter(m => m.thread_ts === root && m.ts !== root);

  // 1. setup: link → first time → password + tokens
  const pg = await page();
  ok('fresh phone → setup screen', await pg.isVisible('#setup #surl'));
  await pg.fill('#surl', 'https://example.com/x'); await pg.click('#schk'); ok('wrong kind of link refused', /Apps Script link/.test(await t(pg, '#serr')));
  await pg.fill('#surl', URLX); await pg.click('#schk'); await pg.waitForSelector('#sts', { timeout: 8000 });
  ok('new script → asks for password + both tokens', await pg.isVisible('#stf'));
  await pg.fill('#spw', '123'); await pg.click('#sgo'); ok('short password refused', /6 letters/.test(await t(pg, '#serr2')));
  await pg.fill('#spw', PW); await pg.fill('#sts', 'xoxb-bad'); await pg.click('#sgo'); await pg.waitForFunction(() => /invalid_auth/.test(document.querySelector('#serr2').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('a bad token is refused with Slack\'s reason', /invalid_auth/.test(await t(pg, '#serr2')));
  await pg.fill('#sts', 'xoxb-sjtc-test'); await pg.fill('#stf', 'xoxb-fac-test'); await pg.click('#sgo');
  await pg.waitForFunction(() => document.querySelectorAll('#clist .card').length >= 4, null, { timeout: 15000 }).catch(() => {});
  ok('set up → tokens kept in the script only', P.AS_TOK_s === 'xoxb-sjtc-test' && P.AS_TOK_f === 'xoxb-fac-test' && P.AS_PW === PW);
  ok('the phone keeps the link + password, never the tokens', await pg.evaluate(() => !JSON.stringify(localStorage).includes('xoxb')));

  // 2. Catch-up: who said what, both workspaces
  const cards = await pg.$$eval('#clist .card', L => L.map(e => e.textContent));
  ok('order memo NASIR: Muhammad said "Kal tak bhej denge"', cards.some(c => /NASIR/.test(c) && /order memo/.test(c) && /Muhammad/.test(c) && /Kal tak bhej denge/.test(c)));
  ok('godown pick list NASIR: ibrahim said "Picking started"', cards.some(c => /NASIR/.test(c) && /godown/.test(c) && /ibrahim/.test(c) && /Picking started/.test(c)));
  ok('factory SJ-48188: Rifat\'s line, move line left out', cards.some(c => /SJ-48188/.test(c) && /Rifat/.test(c) && /Lace short/.test(c) && !/CUTTING · Ibrahim/.test(c)));
  ok('factory #cash channel post', cards.some(c => /#cash/.test(c) && /Paid 400/.test(c)));
  ok('stats: SJTC 2 chats, Factory 2 chats', (await t(pg, '#ss')) === '2' && (await t(pg, '#sf')) === '2');

  // 3. open the NASIR order chat → reply
  await pg.click('.card:has-text("order memo") [data-open]'); await pg.waitForSelector('#chat .m', { timeout: 8000 });
  ok('chat shows the memo + Muhammad', /Muhammad/.test(await t(pg, '#cbody')) && /ORDER MEMO/.test(await t(pg, '#cbody')));
  await pg.fill('#ctxt', 'Theek hai, kal 5 baje tak'); await pg.click('#csend');
  await pg.waitForFunction(() => [...document.querySelectorAll('.m.me')].some(e => /kal 5 baje/.test(e.textContent) && !e.classList.contains('pend')), null, { timeout: 10000 }).catch(() => {});
  ok('reply in the order thread as "*Abbas:* …" (SJ Stock shows it as Abbas)', replies(S, 'C0CUST0001', memo.ts).some(m => m.text === '*Abbas:* Theek hai, kal 5 baje tak'));
  ok('my reply shows on the right, sent', await pg.$$eval('.m.me', L => L.some(e => /kal 5 baje/.test(e.textContent) && !e.classList.contains('pend'))));
  await pg.setInputFiles('#ffile', { name: 'fabric.png', mimeType: 'image/png', buffer: PNG }); await pg.fill('#ctxt', 'Ye fabric dekho'); await pg.click('#csend'); await pg.waitForTimeout(1200);
  const ph = replies(S, 'C0CUST0001', memo.ts).filter(m => m.files).pop();
  ok('photo + line in the same thread, full size', ph && ph.text === '*Abbas:* Ye fabric dekho' && ph.files[0].want === PNG.length);
  await pg.click('#cback'); await pg.waitForTimeout(300);

  // 4. factory chat: forward Rifat's photo to the NASIR godown thread, then to WhatsApp
  await pg.click('.card:has-text("SJ-48188") [data-open]'); await pg.waitForSelector('#chat .m img[src]', { timeout: 8000 }).catch(() => {});
  ok('factory card chat: photo loads, move line as a system line', await pg.$('#chat .m img[src]') && (await pg.$$('.m.sys')).length === 1);
  await pg.click('.m:has-text("Lace short") .fw'); await pg.waitForSelector('#plist .row'); await pg.fill('#pq', 'godown'); await pg.click('#plist .row:has-text("NASIR")');
  await pg.waitForSelector('#fwgo'); await pg.fill('#fwnote', 'Is lace ka 20 meter order karo'); await pg.click('#fwgo'); await pg.waitForTimeout(1200);
  const fw = replies(S, 'C0GODN0001', pick.ts).filter(m => m.files).pop();
  ok('forward: the photo + line landed in the godown thread (other workspace)', fw && fw.text === '*Abbas:* Is lace ka 20 meter order karo' && fw.files[0].want === PNG.length);
  await pg.click('.m:has-text("Lace short") .fw'); await pg.waitForSelector('#plist .row'); await pg.click('#plist [data-pk="wa"]'); await pg.waitForSelector('#fwgo');
  await pg.fill('#fwnote', 'Saruj bhai, ye lace 20 meter chahiye'); await pg.click('#fwgo'); await pg.waitForTimeout(400);
  const sh = await pg.evaluate(() => window.__shared); ok('WhatsApp: share sheet gets the photo + the line', sh.length === 1 && sh[0].n === 1 && /20 meter/.test(sh[0].text));
  // send to another channel from here
  await pg.click('#tgtb'); await pg.waitForSelector('#plist .row'); await pg.click('#plist .row:has-text("#cash")'); ok('target says #cash', /cash/.test(await t(pg, '#tgtb')));
  await pg.fill('#ctxt', '20 m lace 400 AED'); await pg.click('#csend'); await pg.waitForTimeout(800);
  ok('typed line went to #cash (top level), not the card thread', FW.slack.ch.C0CASH00001.msgs.some(m => m.text === '*Abbas:* 20 m lace 400 AED' && !m.thread_ts) && !replies(FW, 'C09S552KD7T', card.ts).some(m => /400 AED/.test(m.text)));
  await pg.click('#cback');

  // 5. read chats are not "new" any more; Mark all done clears the rest (kept in the script)
  F.postSlack(FW, 'C09S552KD7T', { text: '*Ibrahim:* Lace aa gayi, cutting shuru', bot_id: 'B1', thread_ts: card.ts });   // a new line arrives meanwhile
  CACHE.forEach((v, k) => { if (/^H_|^R_/.test(k)) CACHE.delete(k); });
  await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500);
  const left = await pg.$$eval('#clist .card h3', L => L.map(e => e.textContent));
  ok('read chats left Catch-up (order memo NASIR)', !left.some(x => /NASIR/.test(x) && /👤/.test(x)));
  ok('a new line comes back in at once: SJ-48188 · Ibrahim', /Ibrahim/.test(await t(pg, '.card:has-text("SJ-48188")')) && /Lace aa gayi/.test(await t(pg, '.card:has-text("SJ-48188")')));
  await pg.click('#allread'); await pg.waitForTimeout(800);
  ok('Mark all done → all caught up', /caught up/.test(await t(pg, '#clist')) && Object.keys(P).some(k => /^SN_/.test(k)));
  await pg.click('#nav button[data-v="chats"]'); await pg.fill('#q', 'cash'); ok('Chats → search finds #cash', /#cash/.test(await t(pg, '#alist')));

  // 6. a second phone: same link, wrong then right password
  const p2 = await page({ as2_url: URLX }); await p2.click('#schk'); await p2.waitForSelector('#spw'); ok('script already set up → only asks the password', !(await p2.$('#sts')));
  await p2.fill('#spw', 'wrongpass'); await p2.click('#sgo'); await p2.waitForFunction(() => /did not work/.test(document.querySelector('#serr2').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('wrong password refused', /did not work/.test(await t(p2, '#serr2')));
  await p2.fill('#spw', PW); await p2.click('#sgo'); await p2.waitForSelector('#app:not([hidden])', { timeout: 8000 }).catch(() => {}); ok('right password → app', await p2.isVisible('#app'));

  ok('never talked to the SJ relay (no "job" request)', bodies.length > 10 && bodies.every(b => !/"job"/.test(b)));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
