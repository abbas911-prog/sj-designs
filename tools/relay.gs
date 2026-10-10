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
    if (typeof b.req !== 'string' || b.req.length > 20000) return out({ ok: false, error: 'bad request' });
    if (hex(Utilities.computeHmacSha256Signature(b.req, pw, Utilities.Charset.UTF_8)) !== String(b.sig)) return out({ ok: false, error: 'wrong password' });
    if (b.job === 'live') return live(b.req, P);
    if (b.job === 'orders') return orders(b.req, P);
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
