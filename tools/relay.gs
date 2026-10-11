/**
 * SJ order memo — relay (Google Apps Script web app).
 * memo.html cannot hold the GitHub key, so it asks this small script to start the two GitHub jobs:
 *   memo-stock.yml   — takes sold pieces off Trello when an invoice is sent
 *   memo-catalog.yml — builds a customer catalogue page
 * Every request must be signed with the shop password, or it is refused.
 *
 * Script properties (Project Settings → Script properties) — typed in by Abbas, never in this code:
 *   GH             the GitHub token (sj-designs only, Actions: read and write)
 *   MEMO_PASSWORD  the shop password (same as the GitHub secret)
 *   TRELLO         a Trello token (read is enough) — for the LIVE LIST (job "live") and the READY watcher below
 * Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone.
 *
 * ORDER TRACKER (job "orders") keeps the 4-step checklist of every memo order — see orders() below.
 *
 * SMALL VENDORS (job "vault") keeps the owner-locked ledger of the small office vendors — see vault() below.
 *
 * ORDER MEMO PDF (job "slackpdf") posts every order memo PDF to #godown and #customer — see slackPdf() below.
 *
 * DESIGN ORDERS (job "dorder", owner only) build the Trello card and post the order to the factory Slack — see dorder() below.
 *
 * READY WATCHER (7 Oct 2026: "if you see any changes in Trello let it trigger right away"):
 * every minute it looks at the READY list (one small Trello call). When a card is added, removed, renamed or gets a new photo,
 * it starts memo-thumbs at once, so the order memo shows it 2–3 minutes later. Run setupWatch() once to switch it on.
 */
var REPO = 'abbas911-prog/sj-designs';
var JOBS = { stock: 'memo-stock.yml', catalog: 'memo-catalog.yml' };

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    var P = PropertiesService.getScriptProperties();
    var pw = P.getProperty('MEMO_PASSWORD'), gh = P.getProperty('GH');
    if (!pw) return out({ ok: false, error: 'Relay not set up (script properties missing)' });
    if (typeof b.req !== 'string' || b.req.length > (b.job === 'slackpdf' || b.job === 'dorder' ? 25000000 : 20000)) return out({ ok: false, error: 'bad request' });   // a memo PDF can be a few MB
    if (hex(Utilities.computeHmacSha256Signature(b.req, pw, Utilities.Charset.UTF_8)) !== String(b.sig)) return out({ ok: false, error: 'wrong password' });
    if (b.job === 'live') return live(b.req, P);
    if (b.job === 'orders') return orders(b.req, P);
    if (b.job === 'vault') return vault(b.req, P);
    if (b.job === 'slackpdf') return slackPdf(b.req, P);
    if (b.job === 'dorder') return dorder(b.req, P);
    var wf = JOBS[b.job];
    if (!wf) return out({ ok: false, error: 'bad request' });
    if (!gh) return out({ ok: false, error: 'Relay not set up (script properties missing)' });
    var r = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + wf + '/dispatches', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + gh, Accept: 'application/vnd.github+json' },
      payload: JSON.stringify({ ref: 'main', inputs: { req: b.req, sig: b.sig } })
    });
    var code = r.getResponseCode();
    return out(code === 204 ? { ok: true } : { ok: false, error: 'GitHub said ' + code + ': ' + r.getContentText().slice(0, 200) });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}
// LIVE LIST (Abbas, 9 Oct 2026: "I want the process to be instant ... anybody could be searching at a specific moment how many
// quantity or colors are remaining"). The memo asks for the READY + SAMPLES cards right now; this reads them from Trello with the
// TRELLO script property (a read token, typed in by Abbas) and returns the same card shape as memo-data.enc. Only a request signed
// with the shop password gets an answer, and only if it is less than 10 minutes old. The Trello key never leaves Google.
var LIVE_LISTS = { r: '66254dc6f8ade3c3a0c9b7d4', s: '6824cdd97bb99de098f1b7ae' };
function live(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var tok = P.getProperty('TRELLO');
  if (!tok) return out({ ok: false, error: 'the relay has no TRELLO key yet' });
  var q = '/cards?fields=name,pos,idShort&attachments=true&attachment_fields=id,name,mimeType,date&key=' + TKEY + '&token=' + tok;
  var rs = UrlFetchApp.fetchAll([LIVE_LISTS.r, LIVE_LISTS.s].map(function (id) { return { url: 'https://api.trello.com/1/lists/' + id + q, muteHttpExceptions: true }; }));
  var cards = [];
  for (var i = 0; i < rs.length; i++) {
    if (rs[i].getResponseCode() !== 200) return out({ ok: false, error: 'Trello said ' + rs[i].getResponseCode() });
    JSON.parse(rs[i].getContentText()).forEach(function (c) {
      var o = { id: c.id, name: c.name, pos: c.pos, idShort: c.idShort, attachments: (c.attachments || []).filter(function (a) { return /^image\//.test(a.mimeType || ''); })
        .map(function (a) { return { id: a.id, name: a.name || '', mimeType: a.mimeType || '', date: a.date || '' }; }) };
      if (i === 1) o.list = 's';
      cards.push(o);
    });
  }
  return out({ ok: true, t: new Date().toISOString(), cards: cards });
}
// ORDER TRACKER (Abbas, 10 Oct 2026: "four processes for a sale to be done ... checkers, in which I click ... I get to know that
// this order has been processed by my employee completely"). Each order sent from the memo is kept here (script properties,
// one per order, ORD_<id>) with 4 steps: 1 memo to godown, 2 goods in office, 3 packed, 4 sent = bill made + delivery note +
// sent to customer. Every tick records who and when. Only requests signed with the shop password get in (checked above).
// No prices are stored - only customer, designs and pieces.
var ORD_STEPS = ['s1', 's2', 's3', 'bill', 'dn', 'sent'];
function orders(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var op = req.op || 'list', now = Date.now();
  if (op !== 'list') {
    var lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      var id = String(req.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (!id) return out({ ok: false, error: 'no order id' });
      var key = 'ORD_' + id, o = JSON.parse(P.getProperty(key) || 'null'), by = String(req.by || '').slice(0, 40);
      if (op === 'add') {
        var items = (Array.isArray(req.items) ? req.items : []).slice(0, 60).map(function (x) { return { no: String(x.no || '').slice(0, 20), pcs: +x.pcs || 0, c: String(x.c || '').slice(0, 80), row: String(x.row || '').slice(0, 20) }; });
        if (!o) o = { id: id, created: now, by: by, steps: {} };
        o.name = String(req.name || '').slice(0, 80); o.items = items; o.pcs = +req.pcs || 0; o.dl = String(req.dl || '').slice(0, 160); o.upd = now; o.del = 0;
        if (req.s1 && !o.steps.s1) o.steps.s1 = { by: by, t: now };
      } else if (op === 'tick') {
        if (!o) return out({ ok: false, error: 'that order is not on the list any more' });
        if (ORD_STEPS.indexOf(req.step) < 0) return out({ ok: false, error: 'bad step' });
        o.steps[req.step] = req.on ? { by: by, t: now, n: String(req.note || '').slice(0, 60) } : null; o.upd = now;
        o.done = ORD_STEPS.every(function (k) { return o.steps[k]; }) ? (o.done || now) : 0;
      } else if (op === 'del') {
        if (!o) return out({ ok: true, orders: ordList(P) });
        o.del = now; o.delby = by; o.upd = now;
      } else return out({ ok: false, error: 'bad request' });
      P.setProperty(key, JSON.stringify(o));
    } finally { lock.releaseLock(); }
  }
  return out({ ok: true, orders: ordList(P) });
}
function ordList(P) {
  var all = P.getProperties(), list = [], now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('ORD_') !== 0) return;
    var o; try { o = JSON.parse(all[k]); } catch (e) { return; }
    // tidy up: deleted orders after 7 days, completed ones after 60 days
    if ((o.del && now - o.del > 7 * 864e5) || (o.done && now - o.done > 60 * 864e5)) { P.deleteProperty(k); return; }
    if (!o.del) list.push(o);
  });
  return list.sort(function (a, b) { return b.created - a.created; });
}
// SMALL VENDORS (Abbas, 10 Oct 2026: small office-expense vendors kept OUT of the main SJ vendor list, "I don't want it to be lost.
// It should stay there as cloud based"). The memo locks the whole ledger with the OWNER password on the phone (AES-GCM) and keeps
// the locked box here; Google never sees the names or amounts. Only a request carrying the owner key-check can read or replace it
// (staff know the shop password but not the owner password). The previous version is kept as a spare copy.
function vault(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var chk = String(req.chk || ''); if (chk.length < 32) return out({ ok: false, error: 'owner password missing' });
  var h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chk, Utilities.Charset.UTF_8));
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var have = P.getProperty('VAULT_CHK');
    if (have && have !== h) return out({ ok: false, error: 'owner password does not match the one used before' });
    var cur = vRead(P, 'VAULT');
    if (req.op === 'get') return out({ ok: true, box: cur ? cur.box : null, v: cur ? cur.v : 0 });
    if (req.op !== 'put') return out({ ok: false, error: 'bad request' });
    var curV = cur ? cur.v : 0;
    if ((+req.base || 0) !== curV) return out({ ok: false, conflict: true, box: cur ? cur.box : null, v: curV });   // someone saved in between - the phone merges and tries again
    if (!req.box || typeof req.box.ct !== 'string' || req.box.ct.length > 400000) return out({ ok: false, error: 'bad box' });
    if (cur) vWrite(P, 'VAULTP', cur);        // spare copy of the previous version
    var v = curV + 1; vWrite(P, 'VAULT', { v: v, box: req.box });
    if (!have) P.setProperty('VAULT_CHK', h);
    return out({ ok: true, v: v });
  } finally { lock.releaseLock(); }
}
function vWrite(P, pre, o) {      // one property holds 9 KB at most, so the box is split into pieces
  var s = JSON.stringify(o), n = Math.ceil(s.length / 8000), old = +(P.getProperty(pre + '_N') || 0), m = {};
  for (var i = 0; i < n; i++) m[pre + '_' + i] = s.slice(i * 8000, (i + 1) * 8000);
  m[pre + '_N'] = String(n); P.setProperties(m);
  for (var j = n; j < old; j++) P.deleteProperty(pre + '_' + j);
}
function vRead(P, pre) {
  var n = +(P.getProperty(pre + '_N') || 0); if (!n) return null; var s = '';
  for (var i = 0; i < n; i++) s += P.getProperty(pre + '_' + i) || '';
  try { return JSON.parse(s); } catch (e) { return null; }
}
// ORDER MEMO PDF TO SLACK (Abbas, 10 Oct 2026: "whenever an order memo is being sent through PDF, automatically send it to two
// Slack groups: #godown and #customer"). The memo sends its PDF here; this uploads it with the SJ Memo bot to both channels.
// The channels are fixed here - a request cannot send a file anywhere else. Needs the SLACK_BOT_TOKEN script property (typed in by
// Abbas, never in this code), the bot's files:write permission, and the bot invited to both channels.
var MEMO_PDF_CHANNELS = ['C08EDKV94SV', 'C0BP6DSUHSA'];   // #godown, #customer
function slackPdf(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return out({ ok: false, error: 'the relay has no SLACK_BOT_TOKEN yet' });
  var bytes = Utilities.base64Decode(String(req.pdf || '')); if (bytes.length < 100 || bytes.length > 18000000) return out({ ok: false, error: 'bad PDF' });
  var name = String(req.name || 'SJ-memo.pdf').replace(/[^\w.\- ]+/g, '-').slice(0, 80); if (!/\.pdf$/i.test(name)) name += '.pdf';
  var H = { Authorization: 'Bearer ' + tok };
  var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: H, muteHttpExceptions: true,
    payload: { filename: name, length: String(bytes.length) } }).getContentText());
  if (!a.ok) return out({ ok: false, error: 'Slack said ' + a.error + (a.error === 'missing_scope' ? ' (the SJ Memo app needs files:write)' : '') });
  var up = UrlFetchApp.fetch(a.upload_url, { method: 'post', payload: Utilities.newBlob(bytes, 'application/pdf', name), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) return out({ ok: false, error: 'Slack upload said ' + up.getResponseCode() });
  var c = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: H, muteHttpExceptions: true,
    payload: { files: JSON.stringify([{ id: a.file_id, title: name.replace(/\.pdf$/i, '') }]), channels: MEMO_PDF_CHANNELS.join(','), initial_comment: String(req.text || '').slice(0, 3000) } }).getContentText());
  if (!c.ok) return out({ ok: false, error: 'Slack said ' + c.error + (c.error === 'not_in_channel' || c.error === 'channel_not_found' ? ' (invite @SJ Memo to #godown and #customer)' : '') });
  return out({ ok: true, file: a.file_id });
}
// DESIGN ORDERS FROM THE APP (Abbas, 11 Oct 2026: "the #order-2 process ... I want this process to be built in the app ... just for me").
// Replaces posting in #order-2 and waiting for the 22:30 laptop run. From the memo (owner phone only) the relay:
//   'find'  - the newest ALM card for a design (what will be copied)       'mint' - a fresh unused SJ-/US- number
//   'card'  - builds the Trello card (ALM START copy or a fresh /N card - plus the same card on USMAN HAND WORK when the order
//             includes Usman hand work - or an outsourced US- card)
//   'file'  - one photo / voice note / video: onto the Trello card (<=10 MB) and uploaded to the factory Slack
//   'send'  - one factory message with every file (#cutting [+ #usmancutting] or #emaan) and "<SJ-no> SAMPLE" in #samplesneed
// Rules are the ones in "Design Number Card Workflow": copy keeps custom fields + attachments + cover, no labels, pictures added
// after the cover removed, the ten person fields cleared, RATE + HISAAB on /N, the design cover always goes to Slack.
// Needs (typed in by Abbas): TRELLO_W (a Trello token with write access; TRELLO is used if it is missing),
// SLACK_FACTORY_TOKEN (bot of the "chatgpt" workspace: chat:write, files:write, channels:read, groups:read) and SLACK_BOT_TOKEN.
// Owner only: every call carries the owner key-check (same as the small-vendor ledger).
var DOX = { ALM: '6527c52485d9627f63157296', START: '6527c572b12b208471c080cb', USB: '6997597dabbc8a1e680a1ca4', USORDER: '699deb314dd19c63d32daba9',
  RATE: '67ffad51347f511e61753a4d', HISAAB: '6784f21c3443b5c32dc30c33', COST: '699fa5819d3d15268e325694', SALE: '699fa58c31c495f46676f7e7',
  TEN: ['6a8629369e5acecd9d32161e', '6a86294212411acfd6b242e8', '6a862961d555a85cfa20f5a6', '6a8629740cfd2fbb02940ccb', '6a86297ea870d5e5d95d9915',
        '6a86298786371037d218c02b', '6a86298e8af0a7af3f0eabda', '6a862997069f7fc999a3784a', '6a8f0add4dd96589b353d1b6', '6a8f0ae17f378caf885b3e9a'],
  CUTTING: 'C09S552KD7T', USMANCUT: 'C0BP61A2EF8', SAMPLESNEED: 'C0BV24ULLBD', TRELLO_MAX: 10 * 1024 * 1024 };
function ownerOk(P, chk) {
  chk = String(chk || ''); if (chk.length < 32) return false;
  var h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chk, Utilities.Charset.UTF_8)), have = P.getProperty('VAULT_CHK');
  if (have && have !== h) return false; if (!have) P.setProperty('VAULT_CHK', h); return true;
}
function trApi(method, path, params, tok, body, raw) {
  var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  var o = { method: method, muteHttpExceptions: true };
  if (body !== undefined) { if (raw) o.payload = body; else { o.contentType = 'application/json'; o.payload = JSON.stringify(body); } }
  var r = UrlFetchApp.fetch('https://api.trello.com/1' + path + '?key=' + TKEY + '&token=' + tok + (q ? '&' + q : ''), o), c = r.getResponseCode(), t = r.getContentText();
  if (c >= 300) throw new Error('Trello said ' + c + (c === 401 ? ' (the relay\'s Trello key cannot change cards - add TRELLO_W)' : '') + ': ' + t.slice(0, 120));
  try { return JSON.parse(t); } catch (e) { return t; }
}
function trWho(P, tok) {                                   // which Trello key the relay uses, and whether it may change cards
  var key = P.getProperty('TRELLO_W') ? 'TRELLO_W' : 'TRELLO', c = CacheService.getScriptCache(), ck = 'TW_' + key + '_' + String(tok).slice(-6), have = c.get(ck);
  if (have) return JSON.parse(have);
  var w = { key: key, write: null };
  try { var t = trApi('get', '/tokens/' + tok, { fields: 'permissions' }, tok); w.write = (t.permissions || []).some(function (p) { return p.write && p.modelType === 'Board'; }); } catch (e) {}
  c.put(ck, JSON.stringify(w), 600); return w;
}
function idTime(id) { return parseInt(String(id).slice(0, 8), 16) * 1000; }
function doFindCard(no, tok) {
  var n = String(no).replace(/^SJ-?/i, '').trim(); if (!n) return null;
  var esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp('(^|[^0-9A-Za-z])' + esc + '(?![0-9A-Za-z])', 'i'), all = [];
  [n, 'SJ-' + n].forEach(function (qq) {
    var r = trApi('get', '/search', { query: qq, idBoards: DOX.ALM, modelTypes: 'cards', cards_limit: 100, card_fields: 'name,closed,idList,shortUrl', partial: 'false' }, tok);
    (r.cards || []).forEach(function (c) { if (!all.some(function (x) { return x.id === c.id; })) all.push(c); });
  });
  var ok = all.filter(function (c) {
    if (c.closed || !re.test(c.name) || /^\s*combine/i.test(c.name)) return false;
    var nums = (c.name.match(/\d{4,6}/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
    return nums.length <= 1;                       // a card carrying two design numbers belongs to neither
  }).sort(function (a, b) { return idTime(b.id) - idTime(a.id); });
  return ok[0] || null;
}
function doMint(prefix, tok) {
  for (var k = 0; k < 20; k++) {
    var n = String(10000 + Math.floor(Math.random() * 90000));
    var r = trApi('get', '/search', { query: n, modelTypes: 'cards', cards_limit: 20, card_fields: 'name', partial: 'false' }, tok);
    if (!(r.cards || []).some(function (c) { return c.name.indexOf(n) >= 0; })) return prefix + n;
  }
  throw new Error('could not find a free number');
}
function doLabel(board, name, tok) {
  var ls = trApi('get', '/boards/' + board + '/labels', { fields: 'name', limit: 1000 }, tok), want = String(name).trim().toUpperCase();
  var hit = ls.filter(function (l) { return String(l.name || '').trim().toUpperCase() === want; })[0];
  return hit ? hit.id : trApi('post', '/labels', { name: want, color: 'sky', idBoard: board }, tok).id;
}
function doClearField(cardId, fid, tok) {
  var tries = [{ value: '' }, { value: {} }, { idValue: '', value: '' }];
  for (var i = 0; i < tries.length; i++) { try { trApi('put', '/cards/' + cardId + '/customField/' + fid + '/item', {}, tok, tries[i]); return true; } catch (e) {} }
  return false;
}
function slackUp(tok, name, bytes) {
  var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
    payload: { filename: name, length: String(bytes.length) } }).getContentText());
  if (!a.ok) throw new Error('Slack said ' + a.error + (a.error === 'missing_scope' ? ' (the bot needs files:write)' : ''));
  var up = UrlFetchApp.fetch(a.upload_url, { method: 'post', payload: Utilities.newBlob(bytes, 'application/octet-stream', name), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) throw new Error('Slack upload said ' + up.getResponseCode());
  return a.file_id;
}
function slackShare(tok, fileIds, channels, text) {
  var r = fileIds.length
    ? UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
        payload: { files: JSON.stringify(fileIds.map(function (f) { return { id: f }; })), channels: channels.join(','), initial_comment: text } })
    : null;
  if (r) { var j = JSON.parse(r.getContentText()); if (!j.ok) throw new Error('Slack said ' + j.error + (j.error === 'not_in_channel' || j.error === 'channel_not_found' ? ' (invite the bot to the channel)' : '')); return; }
  channels.forEach(function (ch) {
    var j2 = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
      contentType: 'application/json', payload: JSON.stringify({ channel: ch, text: text }) }).getContentText());
    if (!j2.ok) throw new Error('Slack said ' + j2.error);
  });
}
function factoryChannel(P, tok, name) {
  var key = 'FCH_' + name, have = P.getProperty(key); if (have) return have;
  var cur = '';
  for (var k = 0; k < 10; k++) {
    var j = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/users.conversations?types=public_channel,private_channel&limit=1000' + (cur ? '&cursor=' + encodeURIComponent(cur) : ''),
      { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }).getContentText());
    if (!j.ok) throw new Error('Slack said ' + j.error + ' while looking for #' + name);
    var c = (j.channels || []).filter(function (x) { return x.name === name; })[0];
    if (c) { P.setProperty(key, c.id); return c.id; }
    cur = j.response_metadata && j.response_metadata.next_cursor; if (!cur) break;
  }
  throw new Error('#' + name + ' not found - invite the factory bot to #' + name);
}
function dorder(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  if (!ownerOk(P, req.chk)) return out({ ok: false, error: 'owner password does not match' });
  var tok = P.getProperty('TRELLO_W') || P.getProperty('TRELLO'); if (!tok) return out({ ok: false, error: 'the relay has no Trello key' });
  var op = req.op;
  try {
    if (op === 'find') { var f = doFindCard(req.no, tok); return out({ ok: true, w: trWho(P, tok), card: f ? { id: f.id, name: f.name, url: f.shortUrl, made: idTime(f.id) } : null }); }
    if (op === 'mint') return out({ ok: true, no: doMint(req.prefix === 'US-' ? 'US-' : '', tok) });
    if (op === 'list') return out({ ok: true, log: JSON.parse(P.getProperty('DOLOG') || '[]') });
    var oid = String(req.oid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); if (!oid) return out({ ok: false, error: 'no order id' });
    var key = 'DO_' + oid, st = JSON.parse(P.getProperty(key) || '{}'), save = function () { P.setProperty(key, JSON.stringify(st)); };
    var FT = P.getProperty('SLACK_FACTORY_TOKEN'), ST = P.getProperty('SLACK_BOT_TOKEN');
    if (op === 'card') {
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN yet' });
      var mode = req.mode === 'out' ? 'out' : 'alm', name = String(req.name || '').slice(0, 300), notes = st.notes || [], card;
      var usman = mode !== 'out' && !!(req.usman || req.mode === 'hand');   // Abbas 11 Oct 2026: a hand-work order goes on ALM AND on USMAN HAND WORK
      if (!st.card) {                                         // a retry never makes a second card
      st.mode = mode; st.usman = usman; st.no = String(req.no || ''); st.files = []; st.notes = notes;
      if (mode === 'out') {                                   // outsourced hand-work: US- card on USMAN HAND WORK, his label, COST / SALE
        var lid = doLabel(DOX.USB, req.person || 'ALI', tok);
        card = trApi('post', '/cards', { idList: DOX.USORDER, name: name, pos: 'top', idLabels: lid }, tok);
        [[DOX.COST, req.cost], [DOX.SALE, req.sale]].forEach(function (x) {
          if (x[1] === '' || x[1] == null) return;
          try { trApi('put', '/cards/' + card.id + '/customField/' + x[0] + '/item', {}, tok, { value: { number: String(+x[1]) } }); } catch (e) { notes.push('COST/SALE not set: ' + e.message.slice(0, 80)); }
        });
        st.newCard = true;
      } else if (req.fresh) {                                 // /N with nothing to copy: a plain card with RATE + HISAAB
        var labs = [DOX.RATE, DOX.HISAAB]; if (req.customer) labs.push(doLabel(DOX.ALM, req.customer, tok));
        card = trApi('post', '/cards', { idList: DOX.START, name: name, pos: 'top', idLabels: labs.join(',') }, tok);
        st.newCard = true;
      } else {                                                // the normal order: a real COPY of the newest ALM card
        var src = req.src ? trApi('get', '/cards/' + req.src, { fields: 'name,closed,idAttachmentCover,shortUrl' }, tok) : doFindCard(req.no, tok);
        if (!src) return out({ ok: false, error: 'no ALM card found for ' + req.no + ' - mark it /N if it is a new fabric' });
        if (!src.idAttachmentCover && src.idAttachmentCover !== null) src = trApi('get', '/cards/' + src.id, { fields: 'name,idAttachmentCover,shortUrl' }, tok);
        var hand = false, toList = DOX.START;
        card = trApi('post', '/cards', { idList: toList, idCardSource: src.id, keepFromSource: 'attachments,customFields', name: name, pos: 'top' }, tok);
        var sa = trApi('get', '/cards/' + src.id + '/attachments', { fields: 'id,name,date,mimeType,bytes' }, tok);
        var isImg = function (a) { return /^image\//.test(a.mimeType || '') || /\.(jpe?g|png|webp|heic|gif)$/i.test(a.name || ''); };
        var ci = sa.map(function (a) { return a.id; }).indexOf(src.idAttachmentCover); if (ci < 0) ci = sa.map(isImg).indexOf(true);
        var cover = ci >= 0 ? sa[ci] : null, kill = [];
        if (cover) sa.forEach(function (a, i) { if (i !== ci && isImg(a) && new Date(a.date) > new Date(cover.date)) kill.push(i); });   // pictures added after the design cover
        var na = trApi('get', '/cards/' + card.id + '/attachments', { fields: 'id,name,bytes' }, tok);
        var same = na.length === sa.length && na.every(function (a, i) { return a.name === sa[i].name; });
        if (!same) notes.push('attachments on the copy did not line up - pictures left as copied');
        else {
          kill.forEach(function (i) { try { trApi('delete', '/cards/' + card.id + '/attachments/' + na[i].id, {}, tok); } catch (e) { notes.push('could not remove ' + na[i].name); } });
          if (ci >= 0) try { trApi('put', '/cards/' + card.id, { idAttachmentCover: na[ci].id }, tok); } catch (e) {}
        }
        var items = trApi('get', '/cards/' + card.id + '/customFieldItems', {}, tok) || [];
        var bad = items.filter(function (it) { return DOX.TEN.indexOf(it.idCustomField) >= 0; }).filter(function (it) { return !doClearField(card.id, it.idCustomField, tok); });
        if (bad.length) notes.push(bad.length + ' person field(s) could not be cleared');
        var labs2 = []; if (!hand && (req.rate)) labs2.push(DOX.RATE); if (!hand && (req.hisaab)) labs2.push(DOX.HISAAB);
        if (req.customer) labs2.push(doLabel(hand ? DOX.USB : DOX.ALM, req.customer, tok));
        labs2.forEach(function (l) { trApi('post', '/cards/' + card.id + '/idLabels', { value: l }, tok); });
        if (cover) {                                          // the design cover always goes to Slack
          var dl = UrlFetchApp.fetch('https://api.trello.com/1/cards/' + src.id + '/attachments/' + cover.id + '/download/' + encodeURIComponent(cover.name),
            { headers: { Authorization: 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + tok + '"' }, muteHttpExceptions: true });
          if (dl.getResponseCode() === 200) {
            var cb = dl.getBlob().getBytes(), cname = 'SJ-' + st.no + '-design.' + ((cover.name.match(/\.(\w+)$/) || [, 'jpg'])[1]);
            st.coverF = slackUp(FT, cname, cb);
            if (ST) try { st.sampleF = slackUp(ST, cname, cb); } catch (e) { notes.push('#samplesneed photo: ' + e.message.slice(0, 80)); }
          } else notes.push('design cover could not be downloaded (' + dl.getResponseCode() + ')');
        } else notes.push('the copied card has no design picture');
      }
      st.card = { id: card.id, url: card.shortUrl, name: card.name };
      save();
      }
      if (st.usman && !st.ucard) {                             // the same order on USMAN HAND WORK -> ORDER (top): same name, same pictures
        var uc, ulabs = [];
        if (req.customer) ulabs.push(doLabel(DOX.USB, req.customer, tok));
        if (st.newCard) uc = trApi('post', '/cards', { idList: DOX.USORDER, name: st.card.name, pos: 'top', idLabels: ulabs.join(',') }, tok);
        else {
          uc = trApi('post', '/cards', { idList: DOX.USORDER, idCardSource: st.card.id, keepFromSource: 'attachments', name: st.card.name, pos: 'top' }, tok);
          try {
            var ac = trApi('get', '/cards/' + st.card.id, { fields: 'idAttachmentCover' }, tok).idAttachmentCover;
            var aa = trApi('get', '/cards/' + st.card.id + '/attachments', { fields: 'id,name' }, tok), ua = trApi('get', '/cards/' + uc.id + '/attachments', { fields: 'id,name' }, tok);
            var ix = aa.map(function (a) { return a.id; }).indexOf(ac);
            if (ix >= 0 && ua.length === aa.length) trApi('put', '/cards/' + uc.id, { idAttachmentCover: ua[ix].id }, tok);
          } catch (e) { notes.push('USMAN card cover not set: ' + String(e.message).slice(0, 80)); }
          ulabs.forEach(function (l) { trApi('post', '/cards/' + uc.id + '/idLabels', { value: l }, tok); });
        }
        st.ucard = { id: uc.id, url: uc.shortUrl, name: uc.name }; st.notes = notes; save();
      }
      return out({ ok: true, card: st.card, ucard: st.ucard || null, notes: st.notes || [] });
    }
    if (op === 'file') {
      if (!st.card) return out({ ok: false, error: 'build the card first' });
      var i = +req.i; st.files = st.files || [];
      var done = st.files.filter(function (x) { return x.i === i; })[0]; if (done) return out({ ok: true, file: done, again: true });
      var bytes = Utilities.base64Decode(String(req.b64 || '')), fname = String(req.name || ('file-' + i)).replace(/[^\w.\- ]+/g, '-').slice(0, 80), mime = String(req.mime || 'application/octet-stream');
      var rec = { i: i, kind: req.kind, name: fname, size: bytes.length };
      if (bytes.length <= DOX.TRELLO_MAX) {
        try { trApi('post', '/cards/' + st.card.id + '/attachments', { name: fname, setCover: req.design && st.newCard ? 'true' : 'false', mimeType: mime }, tok, { file: Utilities.newBlob(bytes, mime, fname) }, true); rec.trello = true; }
        catch (e) { rec.trelloErr = e.message.slice(0, 100); }
        if (st.ucard) try { trApi('post', '/cards/' + st.ucard.id + '/attachments', { name: fname, setCover: req.design && st.newCard ? 'true' : 'false', mimeType: mime }, tok, { file: Utilities.newBlob(bytes, mime, fname) }, true); rec.utrello = true; }
        catch (e) { rec.utrelloErr = e.message.slice(0, 100); }
      }
      rec.slack = slackUp(FT, fname, bytes);
      if (req.design && st.newCard && st.mode !== 'out' && ST && !st.sampleF) try { st.sampleF = slackUp(ST, fname, bytes); } catch (e) { (st.notes = st.notes || []).push('#samplesneed photo: ' + e.message.slice(0, 80)); }
      st.files.push(rec); save(); return out({ ok: true, file: rec });
    }
    if (op === 'send') {
      if (!st.card) return out({ ok: false, error: 'build the card first' });
      var text = String(req.text || '').slice(0, 3500);
      if (!st.factory) {
        var chans = st.mode === 'out' ? [factoryChannel(P, FT, 'emaan')] : st.usman ? [DOX.CUTTING, DOX.USMANCUT] : [DOX.CUTTING];
        var ids = (st.coverF ? [st.coverF] : []).concat((st.files || []).map(function (x) { return x.slack; }));
        slackShare(FT, ids, chans, text); st.factory = Date.now(); save();
      }
      if (st.mode !== 'out' && !st.samples) {
        if (!ST) throw new Error('the relay has no SLACK_BOT_TOKEN for #samplesneed');
        slackShare(ST, st.sampleF ? [st.sampleF] : [], [DOX.SAMPLESNEED], String(req.sample || ('SJ-' + st.no + ' SAMPLE')));
        st.samples = Date.now(); save();
      }
      var log = JSON.parse(P.getProperty('DOLOG') || '[]').filter(function (x) { return x.oid !== oid; });
      log.unshift({ oid: oid, t: Date.now(), name: st.card.name, url: st.card.url, mode: st.mode, usman: !!st.usman, files: (st.files || []).length, notes: st.notes || [] });
      P.setProperty('DOLOG', JSON.stringify(log.slice(0, 25)));
      return out({ ok: true, card: st.card, notes: st.notes || [] });
    }
    return out({ ok: false, error: 'bad request' });
  } catch (e) {
    var msg = String(e.message || e).slice(0, 300);
    if (/Trello said 401/.test(msg)) { var w = trWho(P, tok); msg += ' [key used: ' + w.key + (w.write === false ? ', read-only' : '') + ']'; }
    return out({ ok: false, error: msg });
  }
}
function doGet() { return out({ ok: true, relay: 'sj-memo' }); }
function hex(bytes) { return bytes.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join(''); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

var READY = '66254dc6f8ade3c3a0c9b7d4', TKEY = '83fea3748717dd1e3fe28a15f2371759';
function watchTrello() {
  var P = PropertiesService.getScriptProperties(), tok = P.getProperty('TRELLO'), gh = P.getProperty('GH');
  if (!tok || !gh) return;
  var r = UrlFetchApp.fetch('https://api.trello.com/1/lists/' + READY + '/cards?fields=id,name,dateLastActivity&attachments=true&attachment_fields=id&key=' + TKEY + '&token=' + tok, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) { console.log('Trello said ' + r.getResponseCode()); return; }
  var cards = JSON.parse(r.getContentText());
  var sig = cards.map(function (c) { return c.id + '|' + c.name + '|' + (c.attachments || []).map(function (a) { return a.id; }).join(','); }).sort().join('\n');
  var h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sig, Utilities.Charset.UTF_8));
  if (h === P.getProperty('READY_SIG')) return;
  var g = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/memo-thumbs.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + gh, Accept: 'application/vnd.github+json' }, payload: JSON.stringify({ ref: 'main' })
  });
  if (g.getResponseCode() === 204) { P.setProperty('READY_SIG', h); console.log('READY changed (' + cards.length + ' cards) - memo-thumbs started'); }
  else console.log('GitHub said ' + g.getResponseCode() + ': ' + g.getContentText().slice(0, 200));
}
function setupWatch() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'watchTrello') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('watchTrello').timeBased().everyMinutes(1).create();
  watchTrello();
}

// RELIABLE 10-MINUTE UPDATE (7 Oct 2026). GitHub's own */20 timer is skipped for an hour or more at a time
// (16:31 -> 17:40 UTC that day, while Abbas waited on his SJ-12985 edits). This timer simply starts memo-thumbs every 10 minutes.
// It needs only the GH property (already there) - no Trello key. Run setupTimer() once and allow the permission.
function kick() {
  var gh = PropertiesService.getScriptProperties().getProperty('GH'); if (!gh) return;
  var g = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/memo-thumbs.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + gh, Accept: 'application/vnd.github+json' }, payload: JSON.stringify({ ref: 'main' })
  });
  console.log(g.getResponseCode() === 204 ? 'memo-thumbs started' : 'GitHub said ' + g.getResponseCode() + ': ' + g.getContentText().slice(0, 200));
}
function setupTimer() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kick').timeBased().everyMinutes(10).create();
  kick();
}
