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

  // 4b. Catch up walks the unread chats one by one, Next → next chat, Finish → back
  F.postSlack(S, 'C0GODN0001', { text: 'Packed, 215 pcs', user: 'U1', thread_ts: pick.ts }); F.postSlack(FW, 'C09S552KD7T', { text: '*Rifat:* Lace mil gayi', bot_id: 'B1', thread_ts: card.ts });
  CACHE.forEach((v, k) => { if (/^H_|^R_/.test(k)) CACHE.delete(k); }); await pg.click('#nav button[data-v="catch"]'); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await pg.waitForFunction(() => document.querySelectorAll('#clist .card').length >= 2, null, { timeout: 15000 }); const nq = await pg.$$eval('#clist .card', L => L.length);
  await pg.click('#gocu'); await pg.waitForSelector('#chat .m', { timeout: 8000 });
  ok('Catch up → first unread chat opens, header says 1 of N', /Catch up 1 of/.test(await t(pg, '#cs')) && await pg.isVisible('#cnext'));
  const first = await t(pg, '#ct'); await pg.click('#cnext'); await pg.waitForTimeout(600);
  ok('Next → the second chat (different), 2 of N', /Catch up 2 of/.test(await t(pg, '#cs')) && (await t(pg, '#ct')) !== first);
  for (let i = 2; i < nq; i++) { await pg.click('#cnext'); await pg.waitForTimeout(400); }
  ok('last one says Finish', (await t(pg, '#cnext')) === 'Finish ✓'); await pg.click('#cnext'); await pg.waitForTimeout(400);
  ok('Finish → back to the list, every chat read', await pg.isHidden('#chat'));
  // 4c. Ask: local commands
  await pg.click('#nav button[data-v="ask"]'); await pg.fill('#atxt', 'send Lace ordered, 20 m to #cash'); await pg.click('#ago'); await pg.waitForSelector('#aYes');
  ok('Ask: "send … to #cash" asks to confirm first', /Send to/.test(await t(pg, '#aout')) && /#cash/.test(await t(pg, '#aout')));
  await pg.click('#aYes'); await pg.waitForTimeout(800); ok('…and sends it', FW.slack.ch.C0CASH00001.msgs.some(m => m.text === '*Abbas:* Lace ordered, 20 m'));
  await pg.fill('#atxt', 'open 48188'); await pg.click('#ago'); await pg.waitForSelector('#chat:not([hidden])'); ok('Ask: "open 48188" opens the card chat', /48188/.test(await t(pg, '#ct'))); await pg.click('#cback');
  await pg.fill('#atxt', 'forward last photo of 48188 to whatsapp'); await pg.click('#ago'); await pg.waitForSelector('#fwgo', { timeout: 8000 });
  ok('Ask: "forward last photo of 48188 to whatsapp" finds the photo and opens the WhatsApp sheet', /WhatsApp/.test(await t(pg, '#sheetb')) && (await pg.$$('#sheetb .prev img')).length === 1); await pg.click('#sheetb [data-x]');
  await pg.fill('#atxt', 'kitna maal ready hai?'); await pg.click('#ago'); await pg.waitForSelector('#aCl'); ok('Ask: a real question → hands over to Claude', await pg.isVisible('#aCl'));
  await pg.click('#nav button[data-v="catch"]');
  // 4d. Keep unread: open a chat, tap 🔔, leave → it comes back in Catch-up with the same lines, until read without 🔔
  F.postSlack(FW, 'C09S552KD7T', { text: '*Rifat:* Thread chahiye, 2 cone', bot_id: 'B1', thread_ts: card.ts }); CACHE.forEach((v, k) => { if (/^H_|^R_/.test(k)) CACHE.delete(k); });
  await pg.click('#nav button[data-v="catch"]'); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForFunction(() => /Thread chahiye/.test(document.querySelector('#clist').textContent), null, { timeout: 15000 });
  await pg.click('.card:has-text("SJ-48188") [data-open]'); await pg.waitForSelector('#chat .m'); await pg.click('#ckeep'); ok('🔔 → "Stays unread"', /Stays unread/.test(await t(pg, '#ckeep'))); await pg.click('#cback'); await pg.waitForTimeout(1500);
  ok('left with 🔔 → the chat is back in Catch-up with Rifat\'s line', /Thread chahiye/.test(await t(pg, '#clist')) && (await pg.$$('.card:has-text("SJ-48188")')).length === 1);
  await pg.reload(); await pg.waitForFunction(() => document.querySelectorAll('#clist .card').length >= 1, null, { timeout: 15000 });
  ok('…and still after the app is opened again (kept in the script)', /Thread chahiye/.test(await t(pg, '#clist')));
  await pg.click('.card:has-text("SJ-48188") [data-open]'); await pg.waitForSelector('#chat .m'); await pg.click('#cback'); CACHE.forEach((v, k) => { if (/^H_|^R_/.test(k)) CACHE.delete(k); }); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500);
  ok('read normally → gone from Catch-up', !/Thread chahiye/.test(await t(pg, '#clist')));
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

  // 7. EMAIL (25 Oct): a fake Gmail appears (the script allowed Gmail) → one chat per thread, reply in the thread, attachment forwarded to Slack, new mail to an address
  const SENT = [], REPLIES = [];
  const mkMsg = (id, from, date, body, atts) => ({ getId: () => id, getFrom: () => from, getDate: () => new Date(date), getPlainBody: () => body, getBody: () => body,
    getAttachments: () => (atts || []).map(a => ({ getName: () => a.name, getContentType: () => a.type, getSize: () => a.bytes.length, getBytes: () => sbytes(a.bytes) })), reply: (txt, o) => { REPLIES.push({ id, txt, atts: ((o || {}).attachments || []).map(b => b._n) }); } });
  const TH = { 'abc123def456': { subj: 'Lace shipment — 40 cartons', msgs: [mkMsg('m1a2b3c4d5', 'Saruj Lace <saruj@lace.cn>', Date.now() - 3600e3, 'Dear Abbas,\nThe 40 cartons left Guangzhou today. Invoice attached.\n\nOn Fri Saruj wrote:\n> old stuff', [{ name: 'invoice.png', type: 'image/png', bytes: PNG }])] },
    'ffe0112233445': { subj: 'Re: VAT return Q3', msgs: [mkMsg('m2b2b3c4d5', 'Abbas <abbassayed033@gmail.com>', Date.now() - 7200e3, 'Sending the files now.'), mkMsg('m3c2b3c4d5', 'Arqam <arqam@tax.ae>', Date.now() - 600e3, 'Received, thanks. One question: السلام عليكم — is the October figure final?')] } };
  const thOf = id => ({ getId: () => id, getFirstMessageSubject: () => TH[id].subj, getMessages: () => TH[id].msgs.slice() });
  ctx.GmailApp = { search: () => Object.keys(TH).map(thOf), getThreadById: id => (TH[id] ? thOf(id) : null), getMessageById: id => Object.values(TH).flatMap(t => t.msgs).find(m => m.getId() === id) || null,
    sendEmail: (to, subj, txt, o) => { SENT.push({ to, subj, txt, atts: ((o || {}).attachments || []).map(b => b._n) }); } };
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => 'abbassayed033@gmail.com' }) };
  await pg.click('#nav button[data-v="catch"]'); await pg.waitForFunction(() => /Lace shipment/.test(document.querySelector('#clist').textContent), null, { timeout: 15000 }).catch(() => {});
  const cl = await t(pg, '#clist');
  ok('email thread is a Catch-up card: Lace shipment · Saruj Lace', /Lace shipment/.test(cl) && /Saruj/.test(cl) && /40 cartons left/.test(cl));
  ok('quoted old mail cut off', !/old stuff/.test(cl));
  ok('my own mail not counted, Arqam\'s reply is', /VAT return/.test(cl) && /Arqam/.test(cl) && !/Sending the files now/.test(cl));
  ok('Email stat + chip shown', await pg.isVisible('#ste') && !(await pg.$eval('#chipe', e => e.hidden)) && (await t(pg, '#se')) === '2');
  await pg.click('.card:has-text("VAT return") [data-open]'); await pg.waitForFunction(() => /October figure/.test(document.querySelector('#cbody').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('email chat opens: both mails, mine on the right', /Sending the files now/.test(await t(pg, '#cbody')) && !!(await pg.$('#cbody .m.me')) && (await pg.getAttribute('#ctxt', 'placeholder')) === 'Reply by email…');
  await pg.fill('#ctxt', 'Yes, final. Abbas'); await pg.click('#csend'); await pg.waitForFunction(() => !document.querySelector('#cbody .m.pend'), null, { timeout: 8000 }).catch(() => {});
  ok('reply → Gmail reply in that thread', REPLIES.length === 1 && REPLIES[0].id === 'm3c2b3c4d5' && /final/.test(REPLIES[0].txt));
  await pg.click('#cback'); await pg.click('.card:has-text("Lace shipment") [data-open]'); await pg.waitForSelector('#cbody img[data-f]', { timeout: 8000 }).catch(() => {});
  await pg.waitForFunction(() => { const i = document.querySelector('#cbody img[data-f]'); return i && i.src; }, null, { timeout: 8000 }).catch(() => {});
  ok('email attachment loads as a photo', !!(await pg.$('#cbody img[src^="blob:"]')));
  await pg.click('#cbody [data-fw]'); await pg.waitForSelector('#plist', { timeout: 5000 }); await pg.fill('#pq', 'cash'); await pg.click('#plist [data-pk]:has-text("#cash")');
  await pg.waitForSelector('#fwgo', { timeout: 8000 }).catch(async () => { console.log('SHEET:', await t(pg, '#sheetb')); }); await pg.fill('#fwnote', 'Saruj invoice'); await pg.click('#fwgo'); await pg.waitForTimeout(1500);
  ok('email attachment forwarded to Slack #cash with its file', FW.slack.ch.C0CASH00001.msgs.some(m => /Saruj invoice/.test(m.text) && (m.files || []).length === 1));
  await pg.click('#tgtb'); await pg.waitForSelector('#plist', { timeout: 5000 }); await pg.click('#plist [data-pk="em"]'); await pg.waitForSelector('#emto', { timeout: 5000 });
  await pg.fill('#emto', 'nadeem@lais.cn'); await pg.fill('#emsub', 'Photo'); await pg.click('#emgo'); await pg.fill('#ctxt', 'See attached'); await pg.click('#csend'); await pg.waitForTimeout(1500);
  ok('Send to → Email address → a new mail from the script', SENT.length === 1 && SENT[0].to === 'nadeem@lais.cn' && SENT[0].subj === 'Photo' && /attached/.test(SENT[0].txt));
  await pg.click('#cback'); await pg.click('#nav button[data-v="ask"]'); await pg.fill('#atxt', 'send invoice ready to arqam@tax.ae'); await pg.click('#ago'); await pg.waitForSelector('#aYes', { timeout: 5000 });
  ok('Ask: send … to an email address → asks first', /arqam@tax\.ae/.test(await t(pg, '#aout')));
  await pg.click('#aYes'); await pg.waitForTimeout(1200); ok('… then mails it', SENT.length === 2 && SENT[1].to === 'arqam@tax.ae');
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
