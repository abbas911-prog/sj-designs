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
S.slack.ch = {}; ['C0CUST0001:customer', 'C0GODN0001:godown', 'C0SALE0001:sales-new'].forEach(x => { const [id, name] = x.split(':'); S.slack.ch[id] = { id, name, msgs: [], member: true, priv: true }; });
Object.values(FW.slack.ch).forEach(c => { c.member = true; });
const memo = F.postSlack(S, 'C0CUST0001', { text: '*ORDER MEMO* — NASIR (LIBYA)\n24 Oct 2026 · 6 designs · 215 pcs', bot_id: 'B9' });
F.postSlack(S, 'C0CUST0001', { text: '*Muhammad:* Kal tak bhej denge, Insha Allah', bot_id: 'B9', thread_ts: memo.ts });
S.slack.files.FINV1 = { id: 'FINV1', name: 'INV-0007.jpg', mimetype: 'image/jpeg', size: PNG.length, bytes: PNG, url_private: 'https://files.slack.com/dl/FINV1', url_private_download: 'https://files.slack.com/dl/FINV1' };
F.postSlack(S, 'C0SALE0001', { text: 'INVOICE INV-0003 — MATIULLAH NAIF — 1,850 AED', user: 'U1' }); F.postSlack(S, 'C0SALE0001', { text: 'INVOICE INV-0005 — RUSA — 900 AED', user: 'U1' });
F.postSlack(S, 'C0SALE0001', { text: 'INVOICE INV-0007 — MATIULLAH NAIF — 4,200 AED', user: 'U1', files: [S.slack.files.FINV1] });
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
const P = {}, CACHE = new Map(), SLACKCALLS = [], AICALLS = [];
const cget = k => { const e = CACHE.get(k); if (!e || e.exp < Date.now()) return null; return e.v; };
const cache = { get: cget, put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('Argument too large'); CACHE.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); }, putAll: (o, ttl) => Object.keys(o).forEach(k => cache.put(k, o[k], ttl)),
  getAll: ks => { const r = {}; ks.forEach(k => { const v = cget(k); if (v != null) r[k] = v; }); return r; }, remove: k => CACHE.delete(k) };
const props = { getProperty: k => (k in P ? P[k] : null), setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large'); P[k] = String(v); return props; }, getProperties: () => Object.assign({}, P), deleteProperty: k => { delete P[k]; return props; } };
const fetchSync = (url, o) => { o = o || {}; const auth = String((o.headers || {}).Authorization || ''), W = /xoxb-fac/.test(auth) ? FW : S; let body = o.payload; if (body && body._b) body = body._b;
  if (/slack\.com\/api\/auth\.test/.test(url)) { const ok = /xoxb-(sjtc|fac)/.test(auth); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(ok ? { ok: true, team: W === FW ? 'AL MUTAGADED' : 'SJTC' } : { ok: false, error: 'invalid_auth' }) }; }
  if (/api\.anthropic\.com/.test(url)) { const rq = JSON.parse(body), last = rq.messages[rq.messages.length - 1]; AICALLS.push(rq); const key = (o.headers || {})['x-api-key'];
    if (key !== 'sk-ant-test') return { getResponseCode: () => 401, getContentText: () => JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }) };
    let content; const q = typeof last.content === 'string' ? last.content : '';
    if (/^Say OK/.test(q)) content = [{ type: 'text', text: 'OK' }];
    else if (/status of 48188/i.test(q)) content = [{ type: 'tool_use', id: 'tu1', name: 'read_chat', input: { chat: '48188' } }];
    else if (Array.isArray(last.content) && last.content[0].type === 'tool_result' && /Lace short/.test(last.content[0].content)) content = [{ type: 'text', text: 'SJ-48188: Rifat says lace is short, 20 metres more needed; cutting with Ibrahim.' }, { type: 'tool_use', id: 'tu2', name: 'open_chat', input: { chat: '48188' } }];
    else if (/tell rifat/i.test(q)) content = [{ type: 'text', text: 'Ready to send to SJ-48188 — say yes.' }, { type: 'tool_use', id: 'tu3', name: 'send_message', input: { chat: 'SJ-48188', text: 'Rifat, 20 m lace ordered, aa raha hai.' } }];
    else if (/invoices of matiullah/i.test(q)) content = [{ type: 'tool_use', id: 'tu5', name: 'find_messages', input: { chat: '#sales-new', text: 'matiullah', n: 2 } }, { type: 'tool_use', id: 'tu6', name: 'customer', input: { name: 'Matiullah' } }];
    else if (Array.isArray(last.content) && last.content.some(c => /Found 2 in #sales-new/.test(c.content))) content = [{ type: 'text', text: 'Two invoices of Matiullah: INV-0007 (4,200) and INV-0003 (1,850). Balance 12,650 AED.' }];
    else if (/balance of nadeem/i.test(q)) content = [{ type: 'tool_use', id: 'tu7', name: 'ledger', input: { name: 'nadeem' } }];
    else if (Array.isArray(last.content) && last.content.some(c => /LEDGER NADEEM/.test(c.content))) content = [{ type: 'text', text: 'Nadeem: balance 1,100 AED; last line 14 Sep purchase bill 1,100.' }];
    else if (/where is 48188/i.test(q)) content = [{ type: 'tool_use', id: 'tu8', name: 'trello_card', input: { design: '48188' } }];
    else if (Array.isArray(last.content) && last.content.some(c => /CARD "SJ-48188/.test(c.content))) content = [{ type: 'text', text: 'SJ-48188 is in IRON CHECKING.' }];
    else if (/one by one|go through/i.test(q)) content = [{ type: 'text', text: 'Going through them now.' }, { type: 'tool_use', id: 'tw1', name: 'walk_start', input: {} }];
    else if (/^reply (.+)/i.test(q)) content = [{ type: 'text', text: 'Ready — say yes.' }, { type: 'tool_use', id: 'tw2', name: 'send_message', input: { text: /^reply (.+)/i.exec(q)[1] } }];
    else if (/^next$/i.test(q)) content = [{ type: 'text', text: 'Next.' }, { type: 'tool_use', id: 'tw3', name: 'next_chat', input: {} }];
    else if (/going on in the factory/i.test(q)) content = [{ type: 'tool_use', id: 'tw4', name: 'factory_status', input: { hours: 24 } }];
    else if (Array.isArray(last.content) && last.content.some(c => /TRELLO \(last/.test(c.content))) content = [{ type: 'text', text: 'Factory: ' + last.content[0].content.slice(0, 120) }];
    else if (Array.isArray(last.content) && last.content.some(c => /chats with new messages — the phone/.test(c.content))) content = [{ type: 'text', text: 'Opening them one by one.' }];
    else if (Array.isArray(last.content) && last.content.some(c => /done on the phone|queued|the phone plays/.test(c.content))) content = [{ type: 'text', text: 'Okay.' }];
    else if (/remind me/i.test(q)) content = [{ type: 'text', text: 'Ready to add to Timo — say yes.' }, { type: 'tool_use', id: 'tu9', name: 'timo_add', input: { text: 'pay Nadeem 1000 today' } }];
    else if (/remember/i.test(q)) content = [{ type: 'tool_use', id: 'tu4', name: 'remember', input: { text: 'keep 48188 at 100' } }, { type: 'text', text: 'Noted.' }];
    else if (Array.isArray(last.content) && last.content[0].type === 'tool_result') content = [{ type: 'text', text: 'Opened.' }];
    else content = [{ type: 'text', text: 'Nothing new.' }];
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content, stop_reason: content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn' }) }; }
  if (/api\.trello\.com/.test(url)) { if (!/key=tk1&token=tt1/.test(url)) return { getResponseCode: () => 401, getContentText: () => 'invalid key' }; if (/members\/me/.test(url)) return { getResponseCode: () => 200, getContentText: () => '{"username":"abbas"}' };
    if (/\/lists/.test(url)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ id: 'L1', name: 'IRON CHECKING' }, { id: 'L2', name: 'READY' }]) };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ name: 'SJ-48188 (172) pcs', idList: 'L1', labels: [{ name: 'COUNT' }], dateLastActivity: '2026-10-24T10:00:00Z', shortUrl: 'https://trello.com/c/x' }, { name: 'SJ-20713', idList: 'L2', labels: [], dateLastActivity: '', shortUrl: '' }]) }; }
  if (/slack\.com\/api\//.test(url)) SLACKCALLS.push(url.split('/api/')[1].split('?')[0]);
  const r = F.handle(W, o.method || 'get', url, body, o.headers || {}); return { getResponseCode: () => r.status, getContentText: () => r.body.toString(), getBlob: () => blob(r.body, r.type) }; };
const SHEETS = { '1SdVRWsmmZSdBMXFCfBlxRNQftT59mIAzzPj-ohOQr5c': { MASTER: [['x']], NADEEM: [['NADEEM'], ['Date', 'Description', 'Amount (AED)', 'Balance (AED)'], ['17/07/26', 'Opening Balance', '', '-2915'], ['14/09/26', 'Purchase bill - Fuzhong', '1100', '1100']] },
  '1TJfwlodlnFslGDMzXZMtNnkn4ZoQOY1X4x2SOdaY3GI': { CUSTOMERS: [['KEY', 'CUSTOMER', 'OPENING', 'OPENING DATE', 'ADDED', 'BY'], ['MATIULLAH NAIF', 'Matiullah naif', '10000', '1/10/26', '', 'Abbas']],
    ENTRIES: [['ID', 'KEY', 'CUSTOMER', 'TYPE', 'REF', 'DATE', 'SALE', 'RECEIVED', 'ADJUST', 'BY', 'DEVICE', 'SAVED', 'VOID'], ['inv:INV-0003:p1', 'MATIULLAH NAIF', 'Matiullah naif', 'inv', 'INV-0003', '12/10/26', '1850', '', '', 'Abbas', 'p1', 'x', ''], ['inv:INV-0007:p1', 'MATIULLAH NAIF', 'Matiullah naif', 'inv', 'INV-0007', '18/10/26', '4200', '', '', 'Abbas', 'p1', 'x', ''], ['rv:RV-0002:p1', 'MATIULLAH NAIF', 'Matiullah naif', 'rv', 'RV-0002', '20/10/26', '', '3400', '', 'Abbas', 'p1', 'x', '']],
    BILLS: [['REF', 'TYPE', 'CUSTOMER', 'STATUS', 'TOTAL', 'DATE', 'UPDATED', 'BY', 'DEVICE'], ['INV-0007', 'invoice', 'MATIULLAH NAIF', 'included', '4200', '18/10/26', '2026-10-18', 'Abbas', 'p1'], ['INV-0003', 'invoice', 'MATIULLAH NAIF', 'included', '1850', '12/10/26', '2026-10-12', 'Abbas', 'p1']] } };
const fakeSheet = (name, rows) => ({ getName: () => name, getDataRange: () => ({ getDisplayValues: () => rows.map(r => r.concat(Array(13).fill('')).slice(0, 13)) }) });
const SpreadsheetApp = { openById: id => { const b = SHEETS[id]; if (!b) throw new Error('no such sheet'); return { getSheets: () => Object.keys(b).map(n => fakeSheet(n, b[n])), getSheetByName: n => (b[n] ? fakeSheet(n, b[n]) : null) }; } };
const ctx = vm.createContext({ SpreadsheetApp, PropertiesService: { getScriptProperties: () => props }, CacheService: { getScriptCache: () => cache }, UrlFetchApp: { fetch: fetchSync },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => { const x = { getContent: () => s, setMimeType: () => x }; return x; } },
  Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => sbytes(crypto.createHmac('sha256', bytesOf(k)).update(bytesOf(v)).digest()), base64Encode: x => bytesOf(x).toString('base64'),
    base64Decode: s => sbytes(Buffer.from(String(s), 'base64')), sleep: () => {}, formatDate: (d, tz, f) => d.toISOString().slice(0, 16), newBlob: (b, t, n) => blob(b, t, n) }, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, encodeURIComponent });
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
  ok('stats: SJTC 3 chats, Factory 2 chats', (await t(pg, '#ss')) === '3' && (await t(pg, '#sf')) === '2');

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

  // 8. AI brain (25 Oct): key in ⚙️ Settings (checked with a test call), free-text questions read chats and open them with a summary, sends are queued until yes, notebook
  await pg.click('#nav button[data-v="ask"]'); ok('no key yet → Ask warns', !(await pg.$eval('#aikey', e => e.hidden)));
  await pg.click('#gear'); await pg.waitForSelector('#skey', { timeout: 5000 }); await pg.fill('#skey', 'sk-ant-wrong'); await pg.click('#skgo'); await pg.waitForFunction(() => /check the key|AI said/.test(document.querySelector('#skerr').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('a bad key is refused', /check the key/.test(await t(pg, '#skerr')) && !P.AS_AI);
  await pg.fill('#skey', 'sk-ant-test'); await pg.click('#skgo'); await pg.waitForFunction(() => /Key works/.test(document.querySelector('#skerr').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('the key is tested and kept in the script only', P.AS_AI === 'sk-ant-test' && (await pg.evaluate(() => localStorage.getItem('as2_ai'))) === '1' && !(await pg.evaluate(() => Object.values(localStorage).some(v => /sk-ant/.test(v)))));
  await pg.fill('#sbrain', 'Abbas test brain'); await pg.click('#sbgo'); await pg.waitForTimeout(400); ok('brain saved', P.AS_BRAIN === 'Abbas test brain'); await pg.click('#sheet [data-x]');
  await pg.fill('#atxt', 'status of 48188'); await pg.click('#ago'); await pg.waitForSelector('#chat:not([hidden])', { timeout: 10000 }).catch(() => {});
  ok('"status of 48188" → the AI read the card chat → opened it with a summary on top', await pg.isVisible('#csum') && /lace is short/.test(await t(pg, '#csumt')) && /SJ-48188/.test(await t(pg, '#ct')));
  const sys = AICALLS[AICALLS.length - 1].system; ok('the brain, chat list and new lines go with every ask', /Abbas test brain/.test(sys) && /SJ-48188 \[/.test(sys) && /CHATS/.test(sys));
  await pg.click('#cback'); await pg.fill('#atxt', 'tell Rifat 20 m lace ordered'); await pg.click('#ago'); await pg.waitForSelector('#aYes', { timeout: 10000 });
  const before = replies(FW, 'C09S552KD7T', card.ts).length; ok('a send is queued, not sent, until yes', /aa raha hai/.test(await t(pg, '#aout')) && replies(FW, 'C09S552KD7T', card.ts).length === before);
  await pg.click('#aYes'); await pg.waitForTimeout(1500); ok('yes → sent to the card thread as Abbas', replies(FW, 'C09S552KD7T', card.ts).some(m => /\*Abbas:\* Rifat, 20 m lace ordered/.test(m.text)));
  await pg.fill('#atxt', 'remember keep 48188 at 100'); await pg.click('#ago'); await pg.waitForFunction(() => /Noted/.test(document.querySelector('#aout').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('remember → notebook in the script', /keep 48188 at 100/.test(P.AS_NOTES || ''));

  // 9. lookups (25 Oct): invoices from #sales-new shown with their photo, customer balance from the sheet, vendor ledger, Trello card stage, Timo add
  await pg.fill('#atxt', 'show me the last two invoices of Matiullah'); await pg.click('#ago'); await pg.waitForFunction(() => /Two invoices/.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  const ans = await t(pg, '#aout .ans'); ok('"last two invoices of Matiullah" → answer + the two #sales-new posts shown', /Two invoices/.test(ans) && /INV-0007/.test(ans) && /INV-0003/.test(ans) && !/INV-0005/.test(ans) && (await pg.$$('#aout .ans .sh')).length === 2);
  await pg.waitForFunction(() => { const i = document.querySelector('#aout .ans .sh img'); return i && i.src; }, null, { timeout: 8000 }).catch(() => {}); ok('the invoice photo loads in the answer', !!(await pg.$('#aout .ans .sh img[src^="blob:"]')));
  const tr = AICALLS[AICALLS.length - 1].messages.filter(m => Array.isArray(m.content)).flatMap(m => m.content).filter(c => c.type === 'tool_result').map(c => c.content).join('\n');
  ok('customer tool: balance 10000+1850+4200-3400 = 12650 and the saved bills', /balance now 12650/.test(tr) && /INV-0007 \| invoice \| included \| 4200/.test(tr));
  await pg.fill('#atxt', 'balance of Nadeem'); await pg.click('#ago'); await pg.waitForFunction(() => /Nadeem: balance/.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  const tr2 = AICALLS[AICALLS.length - 1].messages.filter(m => Array.isArray(m.content)).flatMap(m => m.content).filter(c => c.type === 'tool_result').map(c => c.content).join('\n');
  ok('ledger tool reads the NADEEM tab: balance 1100, last lines', /LEDGER NADEEM — balance now: 1100/.test(tr2) && /Purchase bill - Fuzhong/.test(tr2));
  await pg.fill('#atxt', 'where is 48188'); await pg.click('#ago'); await pg.waitForFunction(() => /No Trello key|IRON CHECKING/.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  await pg.click('#gear'); await pg.waitForSelector('#stk', { timeout: 5000 }); await pg.fill('#stk', 'tk1'); await pg.fill('#stt', 'bad'); await pg.click('#stgo'); await pg.waitForFunction(() => /refused|connected/.test(document.querySelector('#sterr').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('bad Trello token refused', /refused/.test(await t(pg, '#sterr')) && !P.AS_TRELLO_TOKEN);
  await pg.fill('#stt', 'tt1'); await pg.click('#stgo'); await pg.waitForFunction(() => /connected/.test(document.querySelector('#sterr').textContent), null, { timeout: 8000 }).catch(() => {}); ok('Trello key/token kept in the script', P.AS_TRELLO_TOKEN === 'tt1'); await pg.click('#sheet [data-x]');
  await pg.fill('#atxt', 'where is 48188'); await pg.click('#ago'); await pg.waitForFunction(() => /IRON CHECKING/.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  ok('trello_card → list name of the card', /IRON CHECKING/.test(await t(pg, '#aout .ans')));
  await pg.evaluate(() => localStorage.setItem('timo-state', JSON.stringify({ acts: [], todos: [], done: {}, checks: {}, stepAt: {}, at: Date.now() })));
  await pg.fill('#atxt', 'remind me to pay Nadeem 1000 today'); await pg.click('#ago'); await pg.waitForSelector('#aYes', { timeout: 10000 });
  ok('timo_add is queued until yes', /Add to Timo/.test(await t(pg, '#aout .ans')));
  await pg.click('#aYes'); await pg.waitForFunction(() => /To-do|added|Added|put in/i.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  const ts = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state') || '{}')); ok('yes → Timo (in its frame) took the task', /To-do|put in/i.test(await t(pg, '#aout')) && ((ts.todos || []).some(x => /pay Nadeem 1000/.test(x.title)) || (ts.acts || []).some(x => /pay Nadeem 1000/.test(x.title))));

  // 10. Talk mode (25 Oct): one tap → a conversation screen; it greets, takes a typed/spoken line, answers in the log, queued sends get Yes / No there
  await pg.click('#tkopen'); await pg.waitForSelector('#talk:not([hidden])', { timeout: 5000 });
  ok('Talk opens and greets', /Abbas/.test(await t(pg, '#tklog')) && /What do you need/.test(await t(pg, '#tklog')));
  await pg.fill('#tktxt', 'tell Rifat 20 m lace ordered'); await pg.click('#tksend'); await pg.waitForSelector('#tkyn:not([hidden])', { timeout: 12000 }).catch(() => {});
  ok('a send asked by voice/typing waits for Yes on the Talk screen', !(await pg.$eval('#tkyn', e => e.hidden)) && /aa raha hai/.test(await t(pg, '#tklog')));
  await pg.click('#tkno'); ok('No → cancelled', (await pg.$eval('#tkyn', e => e.hidden)) && /Cancelled/.test(await t(pg, '#tklog')));
  await pg.click('#tkx'); ok('Close leaves Talk', await pg.$eval('#talk', e => e.hidden));

  // 11. the walk (25 Oct): "go one by one" in Talk opens each unread chat on screen with a mini bar, reads it, "reply …" queues a reply, "next" moves on
  F.postSlack(FW, 'C09S552KD7T', { text: '*Rifat:* Lace aa gayi, cutting kal', bot_id: 'B1', thread_ts: card.ts }); F.postSlack(S, 'C0CUST0001', { text: '*Muhammad:* Bhej diya', bot_id: 'B9', thread_ts: memo.ts });
  await pg.click('#nav button[data-v="catch"]'); await pg.waitForFunction(() => /Lace aa gayi|Bhej diya/.test(document.querySelector('#clist').textContent), null, { timeout: 60000 }).catch(() => {});
  await pg.click('#tkopen'); await pg.waitForSelector('#talk:not([hidden])', { timeout: 5000 }); await pg.fill('#tktxt', 'go one by one'); await pg.click('#tksend'); await pg.waitForSelector('#chat:not([hidden])', { timeout: 8000 }).catch(() => {});
  ok('walk: first unread chat opens with the mini talk bar, Talk overlay hidden', await pg.isVisible('#chat') && await pg.isVisible('#tkmini') && (await pg.$eval('#talk', e => e.hidden)));
  const lg = await t(pg, '#tklog'); ok('walk: it reads the chat aloud (1 of N, who says what)', /1 of \d/.test(lg) && /says:/.test(lg));
  await pg.evaluate(() => __tk('reply ok, noted')); await pg.waitForFunction(() => !document.querySelector('#tkyn').hidden, null, { timeout: 10000 }).catch(() => {}); ok('"reply …" queues a reply to the open chat and waits for yes', !(await pg.$eval('#tkyn', e => e.hidden)) && /ok, noted/.test(await t(pg, '#tklog')));
  const openTitle = await t(pg, '#ct'); ok('the AI is told which chat is on screen', /SCREEN: the chat/.test(AICALLS[AICALLS.length - 1].system)); await pg.evaluate(() => __tk('yes')); await pg.waitForTimeout(1500);
  const all = [...FW.slack.ch.C09S552KD7T.msgs, ...S.slack.ch.C0CUST0001.msgs]; ok('yes → the reply is posted as Abbas in that chat', all.some(m => /\*Abbas:\* ok, noted/.test(m.text)));
  await pg.evaluate(() => __tk('next')); await pg.waitForTimeout(800); const t2 = await t(pg, '#ct'); ok('"next" → the next chat (or back to Talk when done)', t2 !== openTitle || (await pg.$eval('#talk', e => !e.hidden)));
  await pg.evaluate(() => { if (!document.querySelector('#chat').hidden) document.querySelector('#cback').click(); }); await pg.waitForTimeout(300); await pg.click('#tkx').catch(() => {}); await pg.waitForTimeout(300);
  await pg.click('#nav button[data-v="ask"]'); await pg.fill('#atxt', 'what is going on in the factory'); await pg.click('#ago'); await pg.waitForFunction(() => /Factory:/.test(document.querySelector('#aout').textContent), null, { timeout: 12000 }).catch(() => {});
  ok('factory_status → Trello moves + factory Slack lines', /Factory: TRELLO/.test(await t(pg, '#aout .ans')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
