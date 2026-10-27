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
 * FACTORY APP (job "fac") - factory.html: live ALM production cards, photo, Done -> next stage, card chat = the card's #cutting thread,
 *   Telegram buzz to the factory phone (facWatch, 1-min timer via setupFacWatch; TG_FACTORY_TOKEN). Signed with FACTORY_PASSWORD (or the shop password).
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
    // 15 Oct 2026: Slack's Event Subscriptions point here. The event is only a nudge ("something was written in a channel"): it makes every
    // phone's next poll re-read Slack at once. Nothing in it is trusted or stored, so a fake one can only cause an extra re-read.
    if (b.type === 'url_verification' && b.challenge) return ContentService.createTextOutput(String(b.challenge)).setMimeType(ContentService.MimeType.TEXT);
    if (b.type === 'event_callback') { var cE = CacheService.getScriptCache(), eid = String(b.event_id || '').slice(0, 40); if (eid && cE.get('FEV_' + eid)) return out({ ok: true }); if (eid) cE.put('FEV_' + eid, '1', 3600); try { var evc = b.event || {}; if (evc.type === 'message') facNudge(P, facCardOf(P, evc)); } catch (x) {} try { facBump(); cE.put('FAC_EV_AT', String(Date.now()), 900); if (!P.getProperty('FAC_EVENTS_ON')) P.setProperty('FAC_EVENTS_ON', String(Date.now())); } catch (x) {} try { var evm = b.event || {}; if (evm.type === 'message' && evm.channel === CC_CH) { var cEE = CacheService.getScriptCache(); cEE.put('CC_EV_AT', String(Date.now()), 900); bigDrop(cEE, 'CC_HIST'); var rk = ''; try { var hh = ccHist(P.getProperty('SLACK_BOT_TOKEN'), true).filter(function (m) { return m.ts === (evm.thread_ts || evm.ts); })[0]; rk = hh ? ccKey(ccName(hh.text)) : ''; } catch (x) {} ccNudge(P, rk); if (evm.thread_ts) ccNudge(P, 'O' + evm.thread_ts); ccNotifyScan(P, 'event'); } else if (evm.type === 'message' && evm.channel === GD_CH) { var cEG = CacheService.getScriptCache(); cEG.put('CC_EV_AT', String(Date.now()), 900); bigDrop(cEG, 'GD_HIST'); ccNudge(P, 'G' + (evm.thread_ts || evm.ts)); ccNotifyScan(P, 'event'); } else if (evm.type === 'message' && dmIsCh(P, evm.channel)) { var cED = CacheService.getScriptCache(); cED.put('CC_EV_AT', String(Date.now()), 900); cED.remove('DM_HIST_' + evm.channel); ccNudge(P, 'D' + (evm.thread_ts || evm.ts)); ccNotifyScan(P, 'event'); } } catch (x) {} try { if ((b.event || {}).type === 'message') facNotifyScan(P, 'event'); } catch (x) {} try { facWarm(P, b.event || {}); } catch (x) {} return out({ ok: true }); }
    var pw = P.getProperty('MEMO_PASSWORD'), gh = P.getProperty('GH');
    if (!pw) return out({ ok: false, error: 'Relay not set up (script properties missing)' });
    if (b.job === 'fastchk') {                                // 16 Oct 2026: the FAST LANE worker (Cloudflare) asks "is this phone key right?" - key = sha256("sjfast|" + password)
      var fcC = CacheService.getScriptCache(), fcN = +(fcC.get('FASTCHK_N') || 0); if (fcN > 30) return out({ ok: false, error: 'slow down' });
      var fk = String(b.k || ''), okk = [P.getProperty('FACTORY_PASSWORD'), pw].some(function (k) { return k && hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sjfast|' + k, Utilities.Charset.UTF_8)) === fk; });
      if (!okk) fcC.put('FASTCHK_N', String(fcN + 1), 60); return out({ ok: okk });
    }
    if (b.job === 'fac') {                                    // FACTORY APP (12 Oct 2026): its own password (FACTORY_PASSWORD), or the shop password
      if (typeof b.req !== 'string' || b.req.length > 25000000) return out({ ok: false, error: 'bad request' });
      var fpw = P.getProperty('FACTORY_PASSWORD'), sg = String(b.sig), okf = [fpw, pw].some(function (k) { return k && hex(Utilities.computeHmacSha256Signature(b.req, k, Utilities.Charset.UTF_8)) === sg; });
      return okf ? fac(b.req, P) : out({ ok: false, error: 'wrong password' });
    }
    if (typeof b.req !== 'string' || b.req.length > (b.job === 'slackpdf' || b.job === 'slackpdf2' || b.job === 'dorder' || b.job === 'cash' || b.job === 'cchat' || b.job === 'bills' ? 25000000 : b.job === 'timo' ? 2000000 : 20000)) return out({ ok: false, error: 'bad request' });   // a memo PDF can be a few MB
    if (hex(Utilities.computeHmacSha256Signature(b.req, pw, Utilities.Charset.UTF_8)) !== String(b.sig)) return out({ ok: false, error: 'wrong password' });
    if (b.job === 'live') return live(b.req, P);
    if (b.job === 'orders') return orders(b.req, P);
    if (b.job === 'vault') return vault(b.req, P);
    if (b.job === 'slackpdf') return slackPdf(b.req, P);
    if (b.job === 'slackpdf2') return slackPdf(b.req, P, true);   // 12 Oct 2026: one channel per call, chosen by the ticks
    if (b.job === 'dorder') return dorder(b.req, P);
    if (b.job === 'cust') return cust(b.req, P);
    if (b.job === 'cash') return cashPost(b.req, P);
    if (b.job === 'cchat') return cchat(b.req, P);
    if (b.job === 'bills') return bills(b.req, P);           // 18 Oct 2026: saved bills (drafts a phone can reopen and change)
    if (b.job === 'timo') return timo(b.req, P);         // 19 Oct 2026: Timo planner (owner phones) - one saved copy, synced between his phone and iPad
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
// ---------- FACTORY APP (Abbas, 12 Oct 2026: "a remote control" for the factory — one place like the memo is for the office) ----------
// Step 1: the live ALM production cards by stage, each card's photo and fields, and "Done -> next stage" which moves the real Trello
// card (and leaves a comment). Step 2 (the card chat = the card's Slack #cutting thread) comes next.
var RELAY_VER = '2026-10-27a';   // shown on relaycode.html and sent to the factory app (rv) - bump it with every relay change
var FAC = { SAMPLES_CH: 'C09T1BGHC6L', SAMPLE_LISTS: ['65f8c9fd96d90dda4b355f0a', '65a121d2829a36ccacd05593', '68b77a221eef6fbb9a305e0e'],   // #samples-discuss (ChatGPT workspace): sample cards chat THERE, not in #cutting (Abbas 13 Oct)
  BOARD: '6527c52485d9627f63157296', LISTS: [                 // in the order Abbas wants them shown (13 Oct 2026)
  ['SAMPLES', '65f8c9fd96d90dda4b355f0a'], ['SAMPLE DONE', '65a121d2829a36ccacd05593'],
  ['START', '6527c572b12b208471c080cb'], ['Cutting///START', '6ae07f38a77a2321736ef9da'], ['CUTTING', '6527c57751007e81a43f55a6'], ['IN LINE', '6527c57cd7e267fbf2a602b4'],   // 27 Oct 2026 (Abbas): Cutting///START = the cutting has started
  ['READY FOR HAND WORK', '6527c585b9300f804906d9bd'], ['IN HAND WORK', '6527c59b796865bd9639b0c3'], ['CAME FROM HAND WORK', '6602ad25e74db40a25ab0296'],
  ['IN LINE (2)', '6527c5a3964596815651a97f'], ['IRON/CHECKING', '6527c5a93db4d8b8e91a8be9'], ['READY', '6527c5b13129a9ba37acd3ad'],
  ['READY 2', '699b35ceb77292db0289c473'], ['FINISH', '6527c5b41e630c094b619f5e'], ['FINISH SAMPLES', '68b77a221eef6fbb9a305e0e']],
  // every list is shown; the three "done" lists hold hundreds of cards, so only their newest 60 are sent
  LIMIT: { '65a121d2829a36ccacd05593': 60, '6527c5b41e630c094b619f5e': 60, '68b77a221eef6fbb9a305e0e': 60 } };
// 16 Oct 2026 (Abbas: a return should be "just like a card … exactly like the START list"): two lists on the ALM board, RETURNS and RETURNS
// BACK, made once by the relay (found by name if they already exist) and shown in the app after FINISH SAMPLES. Ids kept in FRET_LISTS.
function facRetLists(P, wtok, make) {
  var have = JSON.parse(P.getProperty('FRET_LISTS') || 'null');
  var rcc = CacheService.getScriptCache(); if (!have && make && wtok && (!rcc.get('FRET_TRY') || make === 2)) { rcc.put('FRET_TRY', '1', 3600); try {
    var ls = trApi('get', '/boards/' + FAC.BOARD + '/lists', { fields: 'name,closed', filter: 'open' }, wtok) || [], by = {};
    ls.forEach(function (l) { by[String(l.name).trim().toUpperCase()] = l.id; });
    var r1 = by['RETURNS'] || trApi('post', '/lists', { name: 'RETURNS', idBoard: FAC.BOARD, pos: 'bottom' }, wtok).id;
    var r2 = by['RETURNS BACK'] || trApi('post', '/lists', { name: 'RETURNS BACK', idBoard: FAC.BOARD, pos: 'bottom' }, wtok).id;
    if (r1 && r2) { have = { ret: r1, back: r2 }; P.setProperty('FRET_LISTS', JSON.stringify(have)); }
  } catch (e) {} }
  if (have && !FAC.LISTS.some(function (l) { return l[1] === have.ret; })) { FAC.LISTS.push(['RETURNS', have.ret], ['RETURNS BACK', have.back]); FAC.LIMIT[have.back] = 60; }
  return have;
}
function facCf(tok) {                                         // custom-field names of the ALM board (cached 6 h)
  var c = CacheService.getScriptCache(), h = c.get('FAC_CF'); if (h) return JSON.parse(h);
  var m = {}; (trApi('get', '/boards/' + FAC.BOARD + '/customFields', {}, tok) || []).forEach(function (f) { m[f.id] = f.name; });
  c.put('FAC_CF', JSON.stringify(m), 21600); return m;
}
function slackApi(tok, method, args, get) {            // one Slack Web API call with the bot token
  var r = get ? UrlFetchApp.fetch('https://slack.com/api/' + method + '?' + Object.keys(args).map(function (k) { return k + '=' + encodeURIComponent(args[k]); }).join('&'), { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true })
              : UrlFetchApp.fetch('https://slack.com/api/' + method, { method: 'post', headers: { Authorization: 'Bearer ' + tok }, contentType: 'application/json', payload: JSON.stringify(args), muteHttpExceptions: true });
  return JSON.parse(r.getContentText());
}
function facThread(P, FT, card, rtok, make) {                 // the #cutting message a card's chat lives under: remembered, else found by the card link, else made
  var key = 'FTH_' + card, have = P.getProperty(key); if (have) return JSON.parse(have);
  var c = trApi('get', '/cards/' + card, { fields: 'name,shortUrl,shortLink,idList' }, rtok);
  var CH = FAC.SAMPLE_LISTS.indexOf(c.idList) >= 0 ? FAC.SAMPLES_CH : DOX.CUTTING;        // sample cards live in #samples-discuss
  if (CH === DOX.CUTTING) { var uh = facUsmanOf(P, FT, [{ id: card, url: c.shortUrl }], false); if (uh[card]) return uh[card]; }   // 17 Oct 2026: Usman hand-work cards chat in #usmancutting
  var hist = slackApi(FT, 'conversations.history', { channel: CH, limit: 200 }, true);
  if (hist.ok) {
    var hit = (hist.messages || []).filter(function (m) { return String(m.text || '').indexOf(c.shortLink) >= 0 || String(m.text || '').indexOf(c.shortUrl) >= 0; }).sort(function (a, b) { return +a.ts - +b.ts; })[0];
    if (hit) { var t = { ch: CH, ts: hit.thread_ts || hit.ts }; P.setProperty(key, JSON.stringify(t)); return t; }
  } else if (hist.error === 'missing_scope') throw new Error('the factory Slack app needs channels:history + groups:history (then Reinstall)');
  else throw new Error('Slack is busy - trying again in a few seconds');   // never start a second chat because Slack did not answer
  if (!make) return null;
  var p = slackApi(FT, 'chat.postMessage', { channel: CH, text: (CH === FAC.SAMPLES_CH ? '⭐ ' : '🧵 ') + c.name + '\n' + c.shortUrl + '\n_card chat · factory app_' });
  if (!p.ok) throw new Error('Slack said ' + p.error + (p.error === 'not_in_channel' ? ' (invite the factory bot to ' + (CH === FAC.SAMPLES_CH ? '#samples-discuss' : '#cutting') + ')' : ''));
  var t2 = { ch: CH, ts: p.ts }; P.setProperty(key, JSON.stringify(t2)); return t2;
}
// ---- 15 Oct 2026 (Abbas: "my guy messaged me, I got the Slack notification, refreshed, closed the app - still no catch up. Make it work properly
// and the message appear as instant as possible"). Causes found: (1) the unread check looked at most 8 threads per call and threads whose only new
// lines were system lines (moves) or the person's own lines were re-checked on EVERY poll, so they used up the 8 and a real new message was never
// reached; (2) every phone re-asked Slack every few seconds -> Slack rate limits (conversations.replies ~50/min) -> errors were swallowed and the
// badge came back EMPTY; (3) only the newest 200 #cutting messages were scanned. Now: one shared, compact history per channel (2 pages = 400),
// each thread's answer cached by its latest reply (Slack is asked again only when that thread really changes), last good answer kept when Slack
// refuses, and Slack's own push (Event Subscriptions -> this doPost) marks "something changed" so the next poll (every 4 s) picks it up at once.
// 15 Oct 2026 (2nd): after the deploy the chat did not open for minutes - the unread count asked Slack for up to 25 threads on EVERY 4-s ping
// (first pass, nothing cached yet), Slack answered "ratelimited" (~50 thread reads a minute), failures were not remembered, so every ping
// tried again and the chat itself (same Slack method) was refused too. Now the background count has a small budget (15 thread reads a minute,
// shared by all phones) and stops for 30 s when Slack says "slow down"; the open chat always goes first.
function facBudget() {
  var c = CacheService.getScriptCache(); if (c.get('FAC_RL')) return false;
  var k = 'FAC_RB_' + Math.floor(Date.now() / 60000), used = +(c.get(k) || 0); if (used >= 15) return false;
  c.put(k, String(used + 1), 120); return true;
}
function facSlow(j) { if (j && j.error === 'ratelimited') CacheService.getScriptCache().put('FAC_RL', '1', 30); }
// ---- 15 Oct 2026 (Abbas: "I need a work around for a notification for this app"): a web page cannot buzz a locked iPhone, so the relay
// sends a real phone notification through ntfy (free app on the App Store, no account). Each person turns it on from 🔔 in the factory
// app: the app makes a secret topic name, the relay keeps it (FNTFY = {NAME: topic}), and whenever Slack tells the relay something was
// written (Event Subscriptions) - or every minute from a timer as a fallback - the relay works out each person's NEW unread messages
// (same rules as Catch up) and sends "SJ-17841 · Mohammod: …" with a link that opens that card. Already-sent ones are remembered (FNOTE_<NAME>).
// 20 Oct 2026 (Abbas): "when a card is moved from one list to another, write it down in the chat - and treat it as a notification as well".
// A move line ("→ *CUTTING* · Usman", also edits / photos / delete lines that start with →) now counts as NEW for everyone except the person
// who did it (the name after " · "). Moves made straight in Trello (not from the app) are written into the card's chat by facTrelloMoves.
function facNote(mm, who) { if (!mm || !mm.sys) return false; var t = String(mm.text || '').replace(/\*/g, ''); if (!/^→ /.test(t)) return false;
  var w1 = function (x) { return facWho1(x) || nrmName(String(x || '').trim().split(/\s+/)[0]); };
  var act = w1((t.split(' · ')[1] || '').split(/\s+(?:changed|added|opened|linked|copied|made|deleted)\b/)[0]), me = w1(who);
  return !(act && me && (act === me || (act.length >= 3 && me.length >= 3 && (act.indexOf(me) === 0 || me.indexOf(act) === 0)))); }
function facLine(mm) { var t = String(mm.text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim(); if (mm.sys) return t.replace(/^→ /, '🔀 ').slice(0, 160); if (!t && (mm.files || []).length) t = mm.files.map(function (f) { return f.audio ? '🎤 voice note' : f.img ? '📷 photo' : f.video ? '🎬 video' : '📎 ' + f.name; }).join(' · '); return (mm.who ? mm.who + ': ' : '') + t.slice(0, 160); }
function facNtfy(topic, o) {
  try { var r = UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ topic: topic, title: o.title, message: o.msg, click: o.click, tags: ['speech_balloon'], priority: 4 }) }); return r.getResponseCode() === 200; } catch (e) { return false; }
}
// ---- 20 Oct 2026 (Abbas: "do all" - notifications without the ntfy app): WEB PUSH. A phone that has the app on its Home Screen turns it on
// from 🔔; its push address is kept per person (FWP_<NAME>, up to 4 phones). Google cannot do the push encryption, so the fast-lane worker
// does it: the relay hands it the addresses + the VAPID key pair (made once by the worker, kept in FAC_VAPID, never shown to a phone except
// the public half). ntfy keeps working exactly as before, side by side.
function facFastKey(P) { var pw = P.getProperty('FACTORY_PASSWORD') || P.getProperty('MEMO_PASSWORD'); return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'sjfast|' + pw, Utilities.Charset.UTF_8)); }
function facWorker(P, body) {
  var fu = P.getProperty('FAC_FAST'); if (!fu) throw new Error('phone notifications need the fast lane (status line -> Fast lane)');
  body.k = facFastKey(P);
  var r = UrlFetchApp.fetch(fu + '/', { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true }), j = null;
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (!j) throw new Error('the fast lane answered ' + r.getResponseCode());
  if (j.error === 'unknown op') throw new Error('paste the new tools/fast-worker.js into Cloudflare and press Deploy first');
  return j;
}
function facVapid(P) {
  var v = JSON.parse(P.getProperty('FAC_VAPID') || 'null'); if (v) return v;
  var j = facWorker(P, { op: 'vapidnew' }); if (!j.ok || !j.pub || !j.priv) throw new Error(j.error || 'the fast lane made no key');
  v = { pub: j.pub, priv: j.priv }; P.setProperty('FAC_VAPID', JSON.stringify(v)); return v;
}
function facWpSubs(P, nm) { try { return JSON.parse(P.getProperty('FWP_' + nm) || '[]') || []; } catch (e) { return []; } }
function facWpSend(P, nm, o) {                                   // true when at least one phone of this person took it
  var subs = facWpSubs(P, nm); if (!subs.length) return false;
  var j = facWorker(P, { op: 'push', vapid: facVapid(P), subs: subs, msg: { title: o.title, body: o.msg, url: o.click, tag: o.tag || '' } });
  var gone = (j.res || []).filter(function (x) { return x.gone; }).map(function (x) { return x.ep; });
  if (gone.length) { subs = subs.filter(function (s) { return gone.indexOf(s.endpoint) < 0; }); if (subs.length) P.setProperty('FWP_' + nm, JSON.stringify(subs)); else P.deleteProperty('FWP_' + nm); }
  return (j.res || []).some(function (x) { return x.ok; });
}
function facNotifyScan(P, why) {
  var map = JSON.parse(P.getProperty('FNTFY') || '{}'), wpn = Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('FWP_') === 0; }).map(function (k) { return k.slice(4); });
  var names = Object.keys(map).concat(wpn.filter(function (n) { return !map[n]; })); if (!names.length) return 0;
  var FT = P.getProperty('SLACK_FACTORY_TOKEN'); if (!FT) return 0;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(200)) return 0;          // one scan at a time - never two notifications for one message
  var sent = 0;
  try {
    var c = CacheService.getScriptCache(), lc = bigGet(c, 'FAC_LIST_L') || bigGet(c, 'FAC_LIST'), cards = lc ? JSON.parse(lc).cards : [], byId = {};
    if (!cards.length) cards = Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('FTH_') === 0; }).map(function (k) { return { id: k.slice(4) }; });
    cards.forEach(function (x) { byId[x.id] = x; });
    var dm = null; try { dm = facDm(P, FT); } catch (e) {}
    names.forEach(function (nm) {
      var un = {}; try { un = facUnread(P, FT, cards, nm, false); } catch (e) { return; }
      var nk = 'FNOTE_' + nm.toUpperCase().slice(0, 40), noted = JSON.parse(P.getProperty(nk) || '{}'), changed = false;
      Object.keys(un).forEach(function (id) {
        var u = un[id]; if (!u || !u.n || !u.last || +noted[id] >= +u.last) return;
        var card = byId[id], ttl = id === 'dm' ? '💬 Direct chat' + (dm ? ' #' + dm.name : '') : isXRoom(id) ? FAC_XROOMS.filter(function (x) { return x.k === id; })[0].title : (card && card.name ? (String(card.name).match(/\d{3,6}/) ? 'SJ-' + String(card.name).match(/\d{3,6}/)[0] : String(card.name).slice(0, 40)) : 'Card chat');
        var note = { title: ttl + (u.n > 1 ? ' · ' + u.n + ' new' : ''), msg: u.tx || 'New message', click: 'https://abbas911-prog.github.io/sj-designs/factory.html#card=' + id, tag: id }, took = false;
        if (map[nm] && facNtfy(map[nm], note)) took = true;
        if (wpn.indexOf(nm) >= 0) { try { if (facWpSend(P, nm, note)) took = true; } catch (e) {} }   // 20 Oct 2026: Web Push too
        if (took) { sent++; noted[id] = u.last; changed = true; }
      });
      if (changed) { facFit(noted, []); try { P.setProperty(nk, JSON.stringify(noted)); } catch (e) {} }
    });
  } finally { lock.releaseLock(); }
  return sent;
}
function facNotifyTick() {                                       // the fallback timer (every minute): when Slack's push is on, only every 5th minute
  var P = PropertiesService.getScriptProperties(); try { facDailyTick(P); } catch (e) {}   // 22 Oct 2026: the daily closing report at 10 pm
  if (P.getProperty('FAC_EVENTS_ON') && new Date().getMinutes() % 5) return;
  try { facNotifyScan(P, 'tick'); } catch (e) {}
}
function setupFacNotify() {                                      // Abbas can also run this once from the editor (▶ Run) if the 🔔 screen says the timer could not start
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'facNotifyTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('facNotifyTick').timeBased().everyMinutes(1).create(); return true;
}
// 15 Oct 2026 (Abbas: voice notes "still taking a lot of time"): a file fetched once is kept in the relay's cache for 6 h (in pieces, up to
// ~1.5 MB), so every other phone gets it without Slack; and a voice note is fetched INTO that cache the moment Slack says it was posted.
function facMedia(FT, mf, full) {
  var c = CacheService.getScriptCache(), key = 'FAC_MD_' + mf + (full ? 'F' : 'T'), hit = bigGet(c, key); if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var fi = slackApi(FT, 'files.info', { file: mf }, true); if (!fi.ok) return { ok: false, error: 'Slack said ' + fi.error + (fi.error === 'missing_scope' ? ' (the factory bot needs files:read)' : '') };
  var f = fi.file || {}, mu = (full ? null : (f.thumb_720 || f.thumb_480 || f.thumb_360)) || f.url_private_download || f.url_private;
  if ((f.size || 0) > 20 * 1024 * 1024 && full) return { ok: false, error: 'file too big', link: f.permalink || '' };   // 13 Oct 2026: a big video opens in Slack instead
  var mr = UrlFetchApp.fetch(mu, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + FT } });
  if (mr.getResponseCode() !== 200) return { ok: false, error: 'Slack file said ' + mr.getResponseCode(), link: f.permalink || '' };
  var mb = mr.getBlob(), by = mb.getBytes(); if (by.length > 20 * 1024 * 1024) return { ok: false, error: 'file too big', link: f.permalink || '' };
  var res = { ok: true, b64: Utilities.base64Encode(by), type: mb.getContentType() || f.mimetype || '', name: f.name || '' };
  if (res.b64.length < 1500000) { try { bigPut(c, key, JSON.stringify(res), 21600); } catch (e) {} }
  return res;
}
function facWarm(P, ev) {                                        // a message with a voice note (or photo) just arrived: get it ready for the phones
  var FT = P.getProperty('SLACK_FACTORY_TOKEN'); if (!FT) return;
  (ev.files || []).slice(0, 3).forEach(function (f) { var mt = String(f.mimetype || ''), nm = String(f.name || '');
    if ((/^audio\//.test(mt) || /\.(m4a|webm|ogg|opus|mp3|aac)$/i.test(nm)) && (+f.size || 0) <= 1100000) { try { facMedia(FT, f.id, true); } catch (e) {} }
    else if (/^image\//.test(mt)) { try { facMedia(FT, f.id, false); } catch (e) {} } });
}
// ---- 15 Oct 2026 (Abbas: "just make my existing chats more flawless somehow" - no Firebase, no cost): LIVE NUDGE. The relay cannot push to
// a phone, so it rings a free doorbell instead: the moment Slack says something was written (or a phone posts / moves a card), the relay
// sends a tiny "card X changed" (no text, no names) to a private ntfy.sh topic. Every open app listens on that topic and pulls that chat
// at once - a message shows on the other phone in about a second instead of up to 4-10 s of polling. If the doorbell is down, polling still works.
function facLive(P) { var t = P.getProperty('FAC_LIVE'); if (!t) { t = 'sjlive-' + Utilities.getUuid().replace(/-/g, '').slice(0, 22); P.setProperty('FAC_LIVE', t); } return t; }
function facNudge(P, card) { try { UrlFetchApp.fetch('https://ntfy.sh/' + facLive(P), { method: 'post', payload: 'c=' + String(card || ''), headers: { 'Cache': 'no', 'Firebase': 'no' }, muteHttpExceptions: true }); } catch (e) {} }
function facCardOf(P, ev) {                                     // which card (or 'dm' / '') a Slack message belongs to
  var ch = String(ev.channel || ''), ts = String(ev.thread_ts || ev.ts || ''); if (!ch) return '';
  var dm = JSON.parse(P.getProperty('FAC_DM') || 'null'); if (dm && dm.ch === ch) return 'dm';
  var lr = JSON.parse(P.getProperty('FAC_LAIS2') || 'null'); if (lr && lr.ch === ch) return 'lais';
  for (var xi = 0; xi < FAC_XROOMS.length; xi++) { var xr = JSON.parse(P.getProperty('FAC_ROOM_' + FAC_XROOMS[xi].k) || 'null'); if (xr && xr.ch === ch) return FAC_XROOMS[xi].k; }
  var all = P.getProperties(), hit = ''; Object.keys(all).some(function (k) { if (k.indexOf('FTH_') === 0 && all[k].indexOf('"' + ts + '"') >= 0) { hit = k.slice(4); return true; } return false; });
  return hit;
}
function facRets(P, withDone) {                                 // every return: open ones + those closed in the last 45 days (older closed ones are tidied away)
  var all = P.getProperties(), outr = [], cut = Date.now() - 45 * 86400000;
  Object.keys(all).forEach(function (k) { if (k.indexOf('FRT_') !== 0 || k === 'FRT_N') return; var r; try { r = JSON.parse(all[k]); } catch (e) { return; }
    if (r.done && r.done < cut) { P.deleteProperty(k); return; } if (!withDone && r.done) return; outr.push(r); });
  return outr.sort(function (a, b) { return b.id - a.id; });
}
function facAct(P, FT, cards) {                                // card id -> ts of the last line in its chat (for the app's Chats tab); from the cached thread index
  if (!FT) return {}; var th = facThreads(P, FT, cards, false), r = {}; Object.keys(th).forEach(function (k) { r[k] = th[k].last; }); return r;
}
function facRefs(P) {                                           // card id -> [channel, thread ts] of its chat, for the FAST LANE (the phone reads Slack through the worker)
  var all = P.getProperties(), r = {}; Object.keys(all).forEach(function (k) { if (k.indexOf('FTH_') !== 0) return; try { var v = JSON.parse(all[k]); if (v && v.ch && v.ts) r[k.slice(4)] = [v.ch, v.ts]; } catch (e) {} }); return r;
}
function facRetSum(P) {                                         // the home-screen line: open returns, pieces still at the factory, the oldest
  var r = facRets(P, false), pcs = 0, old = 0; r.forEach(function (x) { if (x.st === 'cancel') return; pcs += x.pcs - x.back; if (!old || x.at < old) old = x.at; });
  return { n: r.filter(function (x) { return x.st !== 'cancel'; }).length, pcs: pcs, old: old };
}
function facBump() { CacheService.getScriptCache().put('FAC_GEN', String(Date.now()), 21600); CacheService.getScriptCache().remove('FAC_LATE'); }
function facGen() { return CacheService.getScriptCache().get('FAC_GEN') || '0'; }   // bumped by every Slack event: all "what's new" caches start again
function facTtl(P) { return CacheService.getScriptCache().get('FAC_EV_AT') ? 45 : 10; }   // Slack push seen in the last 15 min -> slower fallback re-scan               // with Slack pushing changes, the fallback re-scan can be slow
function facHist(P, FT, CH, fresh) {                            // newest 400 top-level messages of a channel, compact {t, rc, lr, l}; shared by every phone
  var c = CacheService.getScriptCache(), g = facGen(), k = 'FAC_H_' + CH + '_' + g, h = fresh ? null : c.get(k); if (h) return JSON.parse(h);
  var cut = function (m) { var lk = String(m.text || '').match(/trello\.com\/c\/([A-Za-z0-9]+)/); return { t: m.ts, rc: m.reply_count || 0, lr: m.latest_reply || '', l: lk ? lk[1] : '' }; };
  var j = slackApi(FT, 'conversations.history', { channel: CH, limit: 200 }, true);
  if (!j.ok) { facSlow(j); if (j.error === 'missing_scope') throw new Error('the factory Slack app needs channels:history + groups:history (then Reinstall)'); var lg = c.get('FAC_H_' + CH + '_L'); if (lg) return JSON.parse(lg); throw new Error('Slack said ' + j.error); }
  var ms = (j.messages || []).map(cut), k2 = 'FAC_H2_' + CH, h2 = c.get(k2), older = [];
  if (h2) older = JSON.parse(h2); else if (j.has_more && j.response_metadata && j.response_metadata.next_cursor) {   // the older page changes rarely: re-read once a minute
    var j2 = slackApi(FT, 'conversations.history', { channel: CH, limit: 200, cursor: j.response_metadata.next_cursor }, true);
    if (j2.ok) { older = (j2.messages || []).map(function (m) { var x = cut(m); x.o = 1; return x; }); try { c.put(k2, JSON.stringify(older), 60); } catch (e) {} }
  }
  var all = ms.concat(older); try { c.put(k, JSON.stringify(all), facTtl(P)); c.put('FAC_H_' + CH + '_L', JSON.stringify(all), 3600); } catch (e) {}
  return all;
}
// 17 Oct 2026 (Abbas: "whichever card has USMAN hand work involved - give me the chat not for #cutting under that card, but #usmancutting"):
// a card whose Trello link was posted in #usmancutting (the hand-work order goes to #cutting AND #usmancutting) chats in its #usmancutting
// thread - reading, sending, unread, moves, live. A card that was first linked to its #cutting thread is switched over once (oldest post wins).
function facUsmanOf(P, FT, cards, fresh) {
  var byLink = {}, out = {}; cards.forEach(function (c) { if (c.url) byLink[String(c.url).split('/').pop()] = c.id; });
  var h = []; try { h = facHist(P, FT, DOX.USMANCUT, fresh); } catch (e) { return out; }
  var all = h.length ? P.getProperties() : {};
  h.slice().sort(function (a, b) { return +a.t - +b.t; }).forEach(function (m) { var id = m.l && byLink[m.l]; if (!id || out[id]) return;
    var cur = all['FTH_' + id], t = { ch: DOX.USMANCUT, ts: m.t }; out[id] = t;
    if (!cur || JSON.parse(cur).ch !== DOX.USMANCUT) P.setProperty('FTH_' + id, JSON.stringify(t)); });
  return out;
}
function facThreads(P, FT, cards, fresh) {                    // for every card with a chat: {n replies, last: newest reply ts}
  var cache = CacheService.getScriptCache(), g = facGen(), hit = fresh ? null : cache.get('FAC_TH_' + g); if (hit) return JSON.parse(hit);
  facUsmanOf(P, FT, cards, fresh);
  var all = P.getProperties(), byTs = {}, byLink = {}, outm = {};
  cards.forEach(function (c) { var v = all['FTH_' + c.id]; if (v) byTs[JSON.parse(v).ts] = c.id; else if (c.url) byLink[c.url.split('/').pop()] = c.id; });
  var usp = P.getProperty('FAC_USMP'), chs = [DOX.CUTTING, FAC.SAMPLES_CH, DOX.USMANCUT]; if (usp) try { chs.push(JSON.parse(usp).ch); } catch (e) {}
  chs.forEach(function (CH) {                     // #cutting for production cards, #samples-discuss for sample cards, #usmancutting for hand-work cards
    var hh = []; try { hh = facHist(P, FT, CH, fresh); } catch (e) { if (CH === DOX.CUTTING || CH === FAC.SAMPLES_CH) throw e; }
    hh.forEach(function (m) {
      var id = byTs[m.t];
      if (!id && (CH === DOX.CUTTING || CH === FAC.SAMPLES_CH) && m.l && byLink[m.l]) { id = byLink[m.l]; delete byLink[m.l]; P.setProperty('FTH_' + id, JSON.stringify({ ch: CH, ts: m.t })); }   // an order message from before: remembered from now on
      if (id) outm[id] = { n: m.rc, last: m.lr || m.t };
    });
  });
  try { cache.put('FAC_TH_' + g, JSON.stringify(outm), facTtl(P)); } catch (e) {} return outm;
}
function facFit(rec, keep) {                                  // trim {key: ts} records (oldest first) until they fit a script property comfortably
  var ks = Object.keys(rec).filter(function (x) { return keep.indexOf(x) < 0; }).sort(function (a, b) { return +rec[a] - +rec[b]; });
  while (JSON.stringify(rec).length > 7500 && ks.length) delete rec[ks.shift()];
  return rec;
}
function facSeen(P, who, card, ts) {                           // FSEEN_<who> = { _t0: first use, <cardId>: last ts seen } - shared by every phone that person signs in on
  who = String(who || '').trim(); if (!who || !card) return;
  var k = 'FSEEN_' + who.toUpperCase().slice(0, 40), rec = JSON.parse(P.getProperty(k) || '{}'); if (!rec._t0) rec._t0 = String(Date.now() / 1000);
  if (!(+rec[card] >= +ts)) { rec[card] = String(ts); rec._v = (rec._v || 0) + 1; if (+rec._t0 < Date.now() / 1000 - 30 * 86400) rec._t0 = String(Date.now() / 1000 - 30 * 86400); facFit(rec, ['_t0', '_v', 'dm', 'lais', 'cash', 'exp']); try { P.setProperty(k, JSON.stringify(rec)); } catch (e) { return; } CacheService.getScriptCache().remove('FAC_UN_' + who.toUpperCase().slice(0, 20)); }
}
// the board list is often > 100 KB (Google's cap per cache value) - so it is cached in 90 KB pieces (13 Oct 2026: 'the app is very laggy' - an uncached list meant a full Trello read on every poll of every phone)
function bigPut(cache, key, js, ttl) { var o = {}, n = 0; for (var i = 0; i < js.length; i += 90000) o[key + '_' + (n++)] = js.slice(i, i + 90000); o[key + '_N'] = String(n); cache.putAll(o, ttl); }
function bigGet(cache, key) { var n = +(cache.get(key + '_N') || 0); if (!n) return null; var ks = []; for (var i = 0; i < n; i++) ks.push(key + '_' + i); var m = cache.getAll(ks), out = ''; for (i = 0; i < n; i++) { if (m[key + '_' + i] == null) return null; out += m[key + '_' + i]; } return out; }
function bigDrop(cache, key) { cache.remove(key + '_N'); }
function facLater(P, who) {                                   // FLATER_<who> = { <cardId>: when pinned } - "read it, cannot do it now, keep it in front of me" (Abbas 13 Oct: like Slack's Catch up)
  who = String(who || '').trim(); if (!who) return {};
  return JSON.parse(P.getProperty('FLATER_' + who.toUpperCase().slice(0, 40)) || '{}');
}
// ---- 14 Oct 2026 (Abbas): "one chat at the main page for me to have a direct conversation with the employee" - a Slack channel of the
// ChatGPT workspace (his words: the Mohammod chat, "trello") shown as ONE direct chat at the top of the factory app; its new messages count in Catch up
function facDm(P, FT) {                                         // {ch, name} of the direct-chat channel: remembered, else the bot's channel whose name says trello / mohammod
  var have = P.getProperty('FAC_DM'); if (have) return JSON.parse(have);
  if (!FT) return null;
  var cs = facChans(FT).filter(function (c) { return c.member; }), pick = cs.filter(function (c) { return /trello/i.test(c.name); })[0] || cs.filter(function (c) { return /moham/i.test(c.name); })[0];
  if (!pick) return null;
  var d = { ch: pick.id, name: pick.name }; P.setProperty('FAC_DM', JSON.stringify(d)); return d;
}
// 18 Oct 2026 (Abbas): "add #laisfactory in this app as well .. only me and the people in #laisfactory can see the chats in the app".
// A second channel chat like the Direct chat (key 'lais'). Who may see it: Abbas, and anyone whose sign-in first name matches a member of
// #laisfactory in Slack (real name / display name / handle, Md-type prefixes skipped). Members cached 10 min.
function facLais(P, FT) {                                       // #laisfactory lives in the SJTC workspace (private, C05UEHLGK9U) - read and written by the SJ Memo bot (SLACK_BOT_TOKEN), which must be invited
  var have = P.getProperty('FAC_LAIS2'); if (have) return JSON.parse(have);
  var ST = P.getProperty('SLACK_BOT_TOKEN'), c = CacheService.getScriptCache(); if (!ST || c.get('FAC_LAIS_TRY')) return null;
  var j = slackApi(ST, 'conversations.info', { channel: 'C05UEHLGK9U' }, true);
  if (!j.ok || !j.channel || j.channel.is_member === false) { c.put('FAC_LAIS_TRY', String(j.error || 'not a member'), 120); return null; }
  var d = { ch: j.channel.id, name: j.channel.name || 'laisfactory', ws: 'sjtc' }; P.setProperty('FAC_LAIS2', JSON.stringify(d)); return d;
}
// 21 Oct 2026 (Abbas): "#cash and #expenses of the ChatGPT workspace in this app" - two more channel chats like the Direct chat (keys 'cash'
// and 'exp'), found by name among the factory bot's channels (a public one is joined; a private one needs /invite @SJ Orders first) and
// remembered in FAC_ROOM_<k>. Money talk: only Abbas (sign-in name Abbas…) gets them - other phones never see that they exist.
var FAC_XROOMS = [{ k: 'cash', re: /^cash$|^cash[-_ ]/i, title: '💵 #cash' }, { k: 'exp', re: /^expenses?$|^expenses?[-_ ]/i, title: '🧾 #expenses' }];
function isXRoom(k) { return FAC_XROOMS.some(function (x) { return x.k === k; }); }
function facOwner(who) { return /^abbas/.test(facWho1(who)); }
function facXRoom(P, FT, k) {
  var x = FAC_XROOMS.filter(function (r) { return r.k === k; })[0]; if (!x) return null;
  var have = P.getProperty('FAC_ROOM_' + k); if (have) return JSON.parse(have); if (!FT) return null;
  var c = CacheService.getScriptCache(); if (c.get('FAC_ROOM_TRY_' + k)) return null;
  var hits = facChans(FT).filter(function (ch) { return x.re.test(ch.name); }).sort(function (a, b) { return (b.member ? 1 : 0) - (a.member ? 1 : 0) || a.name.length - b.name.length; }), pick = hits[0];
  if (!pick) { c.put('FAC_ROOM_TRY_' + k, '1', 300); return null; }
  if (!pick.member) { var jn = slackApi(FT, 'conversations.join', { channel: pick.id }); if (!jn.ok) { c.put('FAC_ROOM_TRY_' + k, '1', 300); return null; } c.remove('FAC_CHANS'); }
  var r = { ch: pick.id, name: pick.name }; P.setProperty('FAC_ROOM_' + k, JSON.stringify(r)); return r;
}
function facXRoomsFor(P, FT, who) { if (!facOwner(who)) return []; return FAC_XROOMS.map(function (x) { try { var r = facXRoom(P, FT, x.k); return r ? { k: x.k, ch: r.ch, name: r.name, title: x.title } : null; } catch (e) { return null; } }).filter(Boolean); }
function isRoom(k) { return k === 'dm' || k === 'lais' || isXRoom(k); }
function facRoom(P, FT, k) { return k === 'dm' ? facDm(P, FT) : k === 'lais' ? facLais(P, FT) : isXRoom(k) ? facXRoom(P, FT, k) : null; }
function roomTok(P, k, FT) { return k === 'lais' ? P.getProperty('SLACK_BOT_TOKEN') : FT; }   // the token of the workspace a room lives in
function facWho1(who) { return String(who || '').toLowerCase().split(/[\s._-]+/).map(nrmName).filter(function (w) { return w && !/^(md|mohd|mohammad|mohammed|muhammad|mohammod)$/.test(w); })[0] || ''; }
function facLaisOk(P, FT, who) {
  var w = facWho1(who); if (w.length < 2) return false; if (/^abbas/.test(w)) return true;
  var L = facLais(P, FT), ST = P.getProperty('SLACK_BOT_TOKEN'); if (!L || !ST) return false;
  var c = CacheService.getScriptCache(), h = c.get('FAC_LAISM_' + L.ch), names;
  if (h) names = JSON.parse(h); else {
    var mj = slackApi(ST, 'conversations.members', { channel: L.ch, limit: 200 }, true); if (!mj.ok) return false;
    names = [];
    (mj.members || []).forEach(function (id) { var u = facUser(P, ST, id);
      [u.n].concat(u.wn || []).forEach(function (n) { String(n || '').toLowerCase().split(/[\s._-]+/).forEach(function (pt) { pt = nrmName(pt); if (pt.length >= 3 && !/^(md|mohd|mohammad|mohammed|muhammad|mohammod)$/.test(pt)) names.push(pt); }); }); });
    try { c.put('FAC_LAISM_' + L.ch, JSON.stringify(names), 600); } catch (e) {}
  }
  return names.some(function (n) { return n === w || (w.length >= 3 && (n.indexOf(w) === 0 || w.indexOf(n) === 0)); });
}
// 18 Oct 2026 (Abbas): "create a list just like the chats - each card has a picture and a chat - for lais factory: when 48188's order goes to
// lais factory, a card 48188 appears in the chats; me and the one in lais factory speak there - each order is a chat in itself".
// Every top-level post in #laisfactory that names a design ("Design: SJ-48188 ...") is an ORDER; its chat is that post's Slack thread.
// Ids 'L<ts>'. The #laisfactory room chat itself shows only the top-level posts (no order replies).
function isLaisOrder(k) { return /^L\d+\.\d+$/.test(String(k || '')); }
function facLaisTop(P, LT, L, fresh) {
  var c = CacheService.getScriptCache(), k = 'FAC_LAIST_' + L.ch + '_' + facGen(), h = fresh ? null : c.get(k); if (h) return JSON.parse(h);
  var j = slackApi(LT, 'conversations.history', { channel: L.ch, limit: 100 }, true);
  if (!j.ok) throw new Error('Slack said ' + j.error + (j.error === 'not_in_channel' || j.error === 'channel_not_found' ? ' (invite @SJ Memo to #laisfactory)' : ''));
  var ms = (j.messages || []).filter(function (m) { return !m.subtype || m.subtype === 'bot_message' || m.subtype === 'file_share' || m.subtype === 'thread_broadcast'; })
    .map(function (m) { return { ts: m.ts, text: String(m.text || ''), user: m.user, bot_id: m.bot_id, username: m.username, subtype: m.subtype, rc: m.reply_count || 0, lr: m.latest_reply || '',
      files: (m.files || []).map(function (f) { return { id: f.id, name: f.name, mimetype: f.mimetype, size: f.size }; }) }; }).sort(function (a, b) { return +a.ts - +b.ts; });
  try { c.put(k, JSON.stringify(ms), 15); } catch (e) {} return ms;
}
function facLaisOrders(P, who, fresh) {                          // the order cards for this person (null if they may not see #laisfactory)
  var L = facLaisFor(P, null, who), LT = P.getProperty('SLACK_BOT_TOKEN'); if (!L || !LT) return null;
  try { return facLaisTop(P, LT, L, fresh).filter(function (m) { return /S[JH]\s*[-=:]?\s*\**\(?\s*\d{3,6}/i.test(m.text.split('\n').slice(0, 2).join(' ')); }).reverse().slice(0, 60).map(function (m) {
    var t = m.text.replace(/[*_~`]/g, ''), no = (t.match(/S[JH]\s*[-=:]?\s*\(?\s*(\d{3,6}(?:-[A-Z0-9]{1,3})?)/i) || [])[1] || '', q = (t.match(/Total Quantity:\s*([^\n]+)/i) || [])[1] || t.split('\n')[1] || '';
    return { id: 'L' + m.ts, ts: m.ts, no: no, sub: q.slice(0, 80), lr: m.lr, rc: m.rc }; }); } catch (e) { return []; }
}
function facLaisFor(P, FT, who) { try { return facLaisOk(P, FT, who) ? facLais(P, FT) : null; } catch (e) { return null; } }
function facChans(FT) {                                        // every open channel the bot can see (needs channels:read + groups:read, which it has); cached 2 min
  var c = CacheService.getScriptCache(), h = c.get('FAC_CHANS'); if (h) return JSON.parse(h);
  var outc = [], cur = '';
  for (var i = 0; i < 5; i++) {
    var j = slackApi(FT, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: 200, cursor: cur }, true);
    if (!j.ok) { if (j.error === 'missing_scope') throw new Error('the factory Slack app needs channels:read + groups:read'); break; }
    (j.channels || []).forEach(function (ch) { outc.push({ id: ch.id, name: ch.name, member: !!ch.is_member, priv: !!ch.is_private }); });
    cur = (j.response_metadata || {}).next_cursor || ''; if (!cur) break;
  }
  outc.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  try { c.put('FAC_CHANS', JSON.stringify(outc), 120); } catch (e) {}
  return outc;
}
// 18 Oct 2026 (Abbas): "if it's a new card for samples that I'm making [with the USMAN tick], it has to go to #usman sample" - the factory
// workspace's Usman-samples channel, found by name (usman + sample), remembered in FAC_USMP. The bot joins it if it is public; a private one
// must have @SJ Orders invited first (a bot cannot see private channels it is not in).
function facUsmSampleCh(P, FT) {
  var have = P.getProperty('FAC_USMP'); if (have) return JSON.parse(have);
  var hits = facChans(FT).filter(function (c) { var n = nrmName(c.name); return n.indexOf('usman') >= 0 && n.indexOf('sample') >= 0 && n.indexOf('done') < 0; })
    .sort(function (a, b) { return (b.member ? 1 : 0) - (a.member ? 1 : 0) || a.name.length - b.name.length; });
  var pick = hits[0]; if (!pick) return null;
  if (!pick.member) { var jn = slackApi(FT, 'conversations.join', { channel: pick.id }); if (!jn.ok) throw new Error('the factory bot is not in #' + pick.name + ' - open it in Slack and type /invite @SJ Orders'); }
  var r = { ch: pick.id, name: pick.name }; P.setProperty('FAC_USMP', JSON.stringify(r)); return r;
}
// 18 Oct 2026 (Abbas): "whenever I add a new cutting, the card goes to #samplesneed (the sample they need in the godown, so they don't make a
// mistake) - when that picture is posted in #samplesneed, make a card out of it and label it SAMPLE, on the board where the returns sit".
// Every new post with a picture (or "... SAMPLE" text) in #samplesneed (SJTC, read with the SJ Memo bot) becomes a card at the top of
// RETURNS on the ALM board, label SAMPLE, the picture(s) attached (first = cover). Checked at most once a minute, on the factory app's ping.
// First run only notes "now" (no flood of old posts). SNEED_LAST = ts of the last post handled.
function facSampleLabel(P, wtok) {
  var have = P.getProperty('FSAMPLE_LBL'); if (have) return have;
  var ls = trApi('get', '/boards/' + FAC.BOARD + '/labels', { fields: 'name,color', limit: 1000 }, wtok) || [];
  var hit = ls.filter(function (l) { return String(l.name || '').trim().toUpperCase() === 'SAMPLE'; })[0];
  var id = hit ? hit.id : trApi('post', '/labels', { name: 'SAMPLE', color: 'purple', idBoard: FAC.BOARD }, wtok).id;
  if (id) P.setProperty('FSAMPLE_LBL', id); return id;
}
function snDate(d, full) { var u = new Date(+d + 4 * 3600000), M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][u.getUTCMonth()]; return u.getUTCDate() + ' ' + M + (full ? ' ' + u.getUTCFullYear() + ' ' + ('0' + u.getUTCHours()).slice(-2) + ':' + ('0' + u.getUTCMinutes()).slice(-2) : ''); }   // Dubai time
function facSampleNeed(P, wtok) {
  var ST = P.getProperty('SLACK_BOT_TOKEN'); if (!ST || !wtok) return;
  var c = CacheService.getScriptCache(); if (c.get('SNEED_AT')) return; c.put('SNEED_AT', '1', 60);
  var lock = LockService.getScriptLock(); if (!lock.tryLock(200)) return;
  try {
    var last = P.getProperty('SNEED_LAST');
    if (!last) { P.setProperty('SNEED_LAST', String(Date.now() / 1000)); return; }
    var h = slackApi(ST, 'conversations.history', { channel: DOX.SAMPLESNEED, oldest: last, limit: 30 }, true);
    if (!h.ok) { c.put('SNEED_ERR', String(h.error), 21600); return; }
    var ms = (h.messages || []).filter(function (m) { return +m.ts > +last && (!m.thread_ts || m.thread_ts === m.ts) && !/^channel_/.test(m.subtype || ''); }).sort(function (a, b) { return +a.ts - +b.ts; });
    if (!ms.length) return;
    var rl = facRetLists(P, wtok, 1); if (!rl) return;
    var lab = ''; try { lab = facSampleLabel(P, wtok); } catch (e) {}
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], imgs = (m.files || []).filter(function (f) { return /^image\//.test(f.mimetype || ''); }), txt = String(m.text || '').replace(/[*_~`]/g, '').replace(/<[^>|]*\|([^>]*)>/g, '$1').replace(/<[^>]*>/g, '').trim();
      if (!imgs.length && !/sample/i.test(txt)) { P.setProperty('SNEED_LAST', m.ts); continue; }
      var tk = 'SNEED_TRY_' + m.ts, tries = +(c.get(tk) || 0); if (tries >= 3) { P.setProperty('SNEED_LAST', m.ts); continue; } c.put(tk, String(tries + 1), 21600);
      var no = (txt.match(/S[JH]\s*[-=:]?\s*\**\(?\s*(\d{3,6}(?:-[A-Z0-9]{1,3})?)/i) || [])[1], d = new Date(+m.ts * 1000);
      var name = no ? 'SJ-' + no + ' SAMPLE' : (txt.split('\n')[0].slice(0, 80) || 'SAMPLE · ' + snDate(d, false));
      var card = trApi('post', '/cards', { idList: rl.ret, name: name, pos: 'top', idLabels: lab, desc: (txt ? txt + '\n\n' : '') + '_From #samplesneed · ' + snDate(d, true) + '_' }, wtok);
      for (var k = 0; k < imgs.length && k < 6; k++) { try {
        var fr = UrlFetchApp.fetch(imgs[k].url_private_download || imgs[k].url_private, { headers: { Authorization: 'Bearer ' + ST }, muteHttpExceptions: true });
        if (fr.getResponseCode() !== 200) continue; var bl = fr.getBlob(); if (/text\/html/.test(String(bl.getContentType() || '')) || bl.getBytes().length > 10 * 1024 * 1024) continue;
        var fn = String(imgs[k].name || 'sample.jpg').replace(/[^\w.\-]/g, '_').slice(0, 60);
        UrlFetchApp.fetch('https://api.trello.com/1/cards/' + card.id + '/attachments?key=' + TKEY + '&token=' + wtok, { method: 'post', muteHttpExceptions: true, payload: { file: bl.setName ? bl.setName(fn) : bl, name: fn, setCover: k === 0 ? 'true' : 'false' } });
      } catch (e) {} }
      try { trApi('post', '/cards/' + card.id + '/actions/comments', { text: '📌 SAMPLE NEEDED · from #samplesneed (made by the factory app relay)' }, wtok); } catch (e) {}
      P.setProperty('SNEED_LAST', m.ts); c.remove(tk);
      bigDrop(c, 'FAC_LIST'); try { facNudge(P, 'list:' + card.id); } catch (e) {}
    }
  } catch (e) { c.put('SNEED_ERR', String(e.message || e).slice(0, 200), 21600); } finally { lock.releaseLock(); }
}
// 20 Oct 2026: moves made straight in Trello (or by anyone not using the app) are written into the card's chat too - "→ *CUTTING* · Name · in Trello".
// Checked at most every 45 s on the factory app's ping: one Trello call for the board's list moves + comments since the last check. Moves made by
// the app already wrote their own line (and left the Trello comment "→ LIST · who (factory app)"), so those are skipped. Only cards that already
// have a chat get the line (no new #cutting posts). First run only notes "now".
function facTrelloMoves(P, wtok, FT) {
  if (!wtok || !FT) return; var c = CacheService.getScriptCache(); if (c.get('FMV_AT')) return; c.put('FMV_AT', '1', 45);
  var last = P.getProperty('FMOVE_LAST'); if (!last) { P.setProperty('FMOVE_LAST', new Date().toISOString()); return; }
  var lock = LockService.getScriptLock(); if (!lock.tryLock(200)) return;
  try {
    var acts = trApi('get', '/boards/' + FAC.BOARD + '/actions', { filter: 'updateCard:idList,commentCard', since: last, limit: 200 }, wtok) || [], cut = Date.now() - 20000, app = {}, newest = last;
    acts.forEach(function (a) { if (a.type === 'commentCard' && /^→ |\(factory app\)|^SOLD|SOLD SAMPLE/.test(String((a.data || {}).text || '')) && !/^(👷|📊)/.test(String((a.data || {}).text || ''))) { var cid = ((a.data || {}).card || {}).id; (app[cid] = app[cid] || []).push(Date.parse(a.date)); } });
    acts.filter(function (a) { return a.type === 'updateCard' && a.data && a.data.listAfter && a.data.card && Date.parse(a.date) < cut; })
      .sort(function (x, y) { return Date.parse(x.date) - Date.parse(y.date); }).forEach(function (a) {
        if (Date.parse(a.date) > Date.parse(newest)) newest = a.date;
        if (c.get('FMV_D_' + a.id)) return; c.put('FMV_D_' + a.id, '1', 86400);
        if (/^(FINISH|FINISH SAMPLES)$/.test(String(a.data.listAfter.name || ''))) { try { facReport(P, wtok, FT, a.data.card.id, false); } catch (e) {} }   // 21 Oct 2026: report once, whoever moved it
        var cid = a.data.card.id, t = Date.parse(a.date); if ((app[cid] || []).some(function (d) { return d >= t - 5000 && d <= t + 120000; })) return;   // the app (or the stock job) already wrote it
        var th = P.getProperty('FTH_' + cid); if (!th) return; th = JSON.parse(th);
        var who = String(((a.memberCreator || {}).fullName) || 'Trello').slice(0, 40), to = String(a.data.listAfter.name || '?'), fr = String((a.data.listBefore || {}).name || '');
        var pr = slackApi(FT, 'chat.postMessage', { channel: th.ch, thread_ts: th.ts, text: '→ *' + to + '* · ' + who + ' · in Trello' + (fr ? ' (from ' + fr + ')' : '') + ' · 🕒 ' + facWhen(t) });   // 24 Oct 2026 (Abbas): the time with every move
        if (pr.ok) { try { facNudge(P, cid); facNudge(P, 'list:' + cid); } catch (e) {} }
      });
    P.setProperty('FMOVE_LAST', newest); if (newest !== last) { bigDrop(c, 'FAC_LIST'); facBump(); }
  } finally { lock.releaseLock(); }
}
// ===== 21 Oct 2026 (Abbas): WORK PER WORKER + PRODUCTION REPORT =====
// (1) "whichever design goes in line: inside the card give me the names of all the employees, beside it the number of pieces I put in; when
//     they get the pieces the timer starts, when it goes out we stop it - which person made how many pieces a day".
//     The workers = the 10 worker fields of the ALM board (DOX.TEN: TASLEEM, IRFAN ALI, HASHIM ...). Every "given" / "done" is written as a
//     Trello comment on the card ("👷 IN · TASLEEM · 20 pcs · Abbas (factory app)" / "👷 OUT · TASLEEM · 18 pcs · 1 d 4 h · ...") - Trello keeps
//     it for ever, the comment's own date is the time - plus a line in the card chat and the worker's field on the card ("18 ✓"). Nothing is
//     kept in script properties. The app reads the batches back from the comments (op "work"); "workrep" sums them up per worker over N days.
// (2) "when the card goes to FINISH give me a complete report in the chat: how many days it stayed in START, CUTTING, IN LINE, hand work,
//     IRON/CHECKING ... until READY". Built from Trello's own move history (so moves made in Trello count too), posted ONCE per card as a chat
//     line + a Trello comment "#report" - by the app's move, by the 45-s Trello-moves check (worker / Trello moves), or by hand (op "report").
//     The day-count badge on the cards is untouched.
// 21 Oct 2026 (Abbas: "messed up the worker's names - those are Usman hand-work's people"): the machine workers are the people of the
// AL MUTAGADED GARMENTS sheet (the "W - Name" tabs), kept here as FAC_WORKERS (changed from the app: More → Workers → ✏️ Edit the list).
// Until the list is changed from the app, this is the list from the sheet on 21 Oct 2026. A worker who also has a Trello field of the same
// name gets his pieces written into it; the others simply have no field.
// 23 Oct 2026 (Abbas): "Ibrahim is management, not a worker; Ram is checking; Arif is the iron man; Waris left". A list entry can carry a
// ROLE in brackets - "Ram (checking)", "Arif (iron)": such a person is on attendance and salary like everyone, but is not a machine worker
// (listed after the machine workers in the WORK box, never counted as "free"). The old 19-name list is brought up to date once (FAC_WORKERS_V).
var FAC_WORKERS_DEFAULT = ['Darmindar', 'Dildar', 'Islam', 'Mamun', 'Mohsin', 'Moshtaq', 'Nahid', 'Rifat', 'Rubindar', 'Sajjad', 'Shadab', 'Shamim', 'Shoab', 'Shohan', 'Shuman', 'Ram (checking)', 'Arif (iron)'];
function facWorkerSplit(n) { var m = String(n || '').trim().match(/^(.*?)\s*\(([^()]+)\)\s*$/); return m ? { name: m[1].trim().slice(0, 30), role: m[2].trim().toLowerCase().slice(0, 20) } : { name: String(n || '').trim().slice(0, 30), role: '' }; }
function facWorkersMigrate(P, names) {                            // once: drop Ibraheem / Ibrahim and Waris, tag Ram = checking and Arif = iron (Abbas, 23 Oct 2026)
  if (P.getProperty('FAC_WORKERS_V') === '2') return names;
  var out = names.map(function (n) { var w = facWorkerSplit(n), k = w.name.toUpperCase(); if (/^(IBRAHEEM|IBRAHIM|WARIS)$/.test(k)) return null; if (!w.role && k === 'RAM') return 'Ram (checking)'; if (!w.role && k === 'ARIF') return 'Arif (iron)'; return n; }).filter(Boolean);
  var mach = out.filter(function (n) { return !facWorkerSplit(n).role; }), rest = out.filter(function (n) { return facWorkerSplit(n).role; }); out = mach.concat(rest);
  try { P.setProperty('FAC_WORKERS', JSON.stringify(out)); P.setProperty('FAC_WORKERS_V', '2'); } catch (e) {} return out;
}
function facRoles(P, tok) { var r = {}; facWorkers(P, tok).forEach(function (w) { if (w.role) r[w.name.toUpperCase()] = w.role; }); return r; }   // {NAME: role} for the app
function facWorkers(P, tok) {
  var names = null; try { names = JSON.parse(P.getProperty('FAC_WORKERS') || 'null'); } catch (e) {} if (!Array.isArray(names) || !names.length) names = FAC_WORKERS_DEFAULT.slice();
  names = facWorkersMigrate(P, names);
  var byName = {}; try { var cf = facCf(tok); Object.keys(cf).forEach(function (id) { byName[String(cf[id]).trim().toUpperCase()] = id; }); } catch (e) {}
  return names.map(function (n) { var w = facWorkerSplit(n); return w.name ? { id: byName[w.name.toUpperCase()] || '', name: w.name, role: w.role } : null; }).filter(Boolean);
}
function facActs(tok, cid) {                                   // the card's history, oldest first: moves, creation, comments
  var a = trApi('get', '/cards/' + cid + '/actions', { filter: 'updateCard:idList,createCard,copyCard,moveCardToBoard,convertToCardFromCheckItem,commentCard', limit: 1000 }, tok) || [];
  return a.slice().sort(function (x, y) { return Date.parse(x.date) - Date.parse(y.date); });
}
function facDur(ms) { ms = Math.max(0, ms); var h = Math.floor(ms / 3600000), d = Math.floor(h / 24); if (d >= 1) return d + ' d' + (h % 24 ? ' ' + (h % 24) + ' h' : ''); if (h >= 1) return h + ' h' + (Math.floor(ms / 60000) % 60 ? ' ' + Math.floor(ms / 60000) % 60 + ' min' : ''); return Math.max(1, Math.floor(ms / 60000)) + ' min'; }
// 21 Oct 2026 (Abbas): "the duties are 8 a.m. to 10 p.m., Friday 8 a.m. to 12 p.m." - pieces per day are counted over WORKING hours
// (Dubai time; Sat-Thu 08:00-22:00 = 14 h = one work day, Friday 08:00-12:00), not the clock: a batch given at 8 pm and back at 10 am
// next morning is 4 working hours, not 14; a Friday afternoon and every night count for nothing.
// 22 Oct 2026 (Abbas): breaks 09:00-09:20, 13:00-14:00 (lunch), 19:00-19:20 count for nothing either (Friday: only the 9 o'clock one falls
// inside 8-12). One work day = 14 h - 1 h 40 min = 12 h 20 min net.
var WORK_FROM = 8, WORK_TO = 22, WORK_TO_FRI = 12, WORK_BREAKS = [[9, 0, 9, 20], [13, 0, 14, 0], [19, 0, 19, 20]];
var WORK_DAY_MS = (WORK_TO - WORK_FROM) * 3600000 - WORK_BREAKS.reduce(function (a, b) { return a + ((b[2] * 60 + b[3]) - (b[0] * 60 + b[1])) * 60000; }, 0);
function facWorkMs(a, b) {                                     // ms of working time between two moments (shift hours minus the breaks)
  if (!(b > a)) return 0; var tz = 4 * 3600000, t = a + tz, end = b + tz, tot = 0;
  while (t < end) { var day = Math.floor(t / 86400000) * 86400000, fri = new Date(day).getUTCDay() === 5, s0 = day + WORK_FROM * 3600000, s1 = day + (fri ? WORK_TO_FRI : WORK_TO) * 3600000, lo = Math.max(t, s0), hi = Math.min(end, s1);
    if (hi > lo) { tot += hi - lo; WORK_BREAKS.forEach(function (br) { var b0 = day + (br[0] * 60 + br[1]) * 60000, b1 = day + (br[2] * 60 + br[3]) * 60000; tot -= Math.max(0, Math.min(hi, b1) - Math.max(lo, b0)); }); }
    t = day + 86400000; }
  return tot;
}
function facRate(pcs, workMs) { return Math.round(pcs / Math.max(0.25, workMs / WORK_DAY_MS)); }   // pieces per work day (12 h 20 net); a tiny batch counts as a quarter day at least
function facWorkDur(ms) { var h = ms / 3600000; return h < 1 ? Math.max(1, Math.round(ms / 60000)) + ' min work' : (h >= 10 ? (Math.round(h / (WORK_TO - WORK_FROM) * 10) / 10) + ' work days' : (Math.round(h * 10) / 10) + ' work h'); }
function facWhen(ms) { var u = new Date(ms + 4 * 3600000); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][u.getUTCDay()] + ' ' + facDay(ms) + ' ' + ('0' + u.getUTCHours()).slice(-2) + ':' + ('0' + u.getUTCMinutes()).slice(-2); }   // "Tue 21 Oct 14:05" Dubai
function facDay(ms) { var u = new Date(ms + 4 * 3600000); return u.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][u.getUTCMonth()]; }   // Dubai
var WK_RE = /^👷 (IN|OUT|PART) · (.+?) · (\d+) pcs(?: · ([^·]+?))? · (.+?) \(factory app\)/;   // 23 Oct 2026: PART = some pieces came back, the rest stays with him
function facWkParse(acts) {                                    // comments -> { WORKER: [{in, out, g, d, by, hid}] } (oldest first)
  var out = {};
  acts.forEach(function (a) { if (a.type !== 'commentCard') return; var m = String((a.data || {}).text || '').match(WK_RE); if (!m) return;
    var w = m[2].trim().toUpperCase(), t = Date.parse(a.date), L = out[w] = out[w] || [];
    if (m[1] === 'IN') { var oi = null; for (var k = L.length - 1; k >= 0; k--) if (!L[k].out) { oi = L[k]; break; }
      if (oi) { oi.g += +m[3]; oi.adds = (oi.adds || []).concat([+m[3]]); oi.addT = (oi.addT || []).concat([t]); } else L.push({ in: t, g: +m[3], by: m[5].trim(), id: a.id }); }   // 21 Oct 2026: more pieces of the same design to a worker who still has some = added to his open batch (the 6th colour that came later)
    else if (m[1] === 'PART') { var op = null; for (var j = L.length - 1; j >= 0; j--) if (!L[j].out) { op = L[j]; break; } if (op) { op.pd = (op.pd || 0) + +m[3]; op.parts = (op.parts || []).concat([{ t: t, n: +m[3] }]); } else L.push({ in: t, out: t, g: +m[3], d: +m[3], by: m[5].trim(), id: a.id }); }   // 23 Oct 2026 (Abbas: "20 given, 2 done, 18 remaining"): a part delivery; the batch stays open
    else { var o = null; for (var i = L.length - 1; i >= 0; i--) if (!L[i].out) { o = L[i]; break; } if (o) { o.out = t; o.d = (o.pd || 0) + +m[3]; o.outBy = m[5].trim(); } else L.push({ in: t, out: t, g: +m[3], d: +m[3], by: m[5].trim(), id: a.id }); } });
  return out;
}
// ===== 22 Oct 2026 (Abbas: "a complete factory app - everything happens here; add new things as options") =====
// The card SHEET: cut / rejected / packed / to hand work / back from hand work / first piece approved - Trello comments like the work batches
// ("📋 CUT · 196 pcs · who (factory app)"), read back from the card's comments (op "work" returns them as "sheet"); the due date is Trello's own
// due field (set from the app, op "sheetset" kind "due"). CUT and PACK = the last number written (a correction wins); REJ / HWOUT / HWIN add up.
var SH_RE = /^📋 (CUT|REJ|PACK|HWOUT|HWIN|FIRST) · (\d+) pcs · (.+?) \(factory app\)/, SH_KINDS = { cut: 'CUT', rej: 'REJ', pack: 'PACK', hwout: 'HWOUT', hwin: 'HWIN', first: 'FIRST' };
var SH_LABEL = { cut: ['📐 Cut', 'কাটা হয়েছে'], rej: ['✗ Rejected', 'বাতিল'], pack: ['📦 Packed', 'প্যাক করা'], hwout: ['🧵 To hand work', 'হ্যান্ড ওয়ার্কে গেল'], hwin: ['🧵 Back from hand work', 'হ্যান্ড ওয়ার্ক থেকে ফেরত'], first: ['✅ First piece approved', 'প্রথম পিস ঠিক আছে'] };
function facSheetParse(acts) {
  var s = { cut: 0, rej: 0, pack: 0, hwout: 0, hwin: 0, first: null, lines: [] };
  acts.forEach(function (a) { if (a.type !== 'commentCard') return; var m = String((a.data || {}).text || '').match(SH_RE); if (!m) return; var k = m[1], n = +m[2], t = Date.parse(a.date), by = m[3].trim();
    if (k === 'CUT') s.cut = n; else if (k === 'PACK') s.pack = n; else if (k === 'REJ') s.rej += n; else if (k === 'HWOUT') s.hwout += n; else if (k === 'HWIN') s.hwin += n; else if (k === 'FIRST') s.first = { t: t, by: by };
    s.lines.push({ k: k, n: n, t: t, by: by }); });
  return s;
}
function facYmd(ms) { var u = new Date(ms + 4 * 3600000); return u.getUTCFullYear() + '-' + ('0' + (u.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + u.getUTCDate()).slice(-2); }   // the Dubai date, "2026-10-22"
// Attendance: one small record per day (FAC_ATT_<date> = {NAME: 1 present / 0 absent}), marked by anyone in the app; the week is sent to the dashboard.
// 22 Oct 2026 (Abbas: "whenever a worker comes in we click his name = logged in as working; when he leaves we press again; at the end of the
// month I give the salaries and we see what to pay"): FAC_ATT_<date> = {NAME: rec}; rec = {in: ms, out: ms, late: minutes late} (clocked),
// {p: 1} (present, no times - the old ✓), {a: 1} (absent). Shift = 08:00 - 22:00 Dubai, Friday 08:00 - 12:00; "late" = in after 08:00 + 15 min.
var ATT_GRACE_MIN = 15;
function facAtt(P, ymd) { var r = null; try { r = JSON.parse(P.getProperty('FAC_ATT_' + ymd) || 'null'); } catch (e) {} if (!r || typeof r !== 'object') return {}; Object.keys(r).forEach(function (k) { r[k] = facAttRec(r[k]); if (!r[k]) delete r[k]; }); return r; }
function facAttRec(v) { return v && typeof v === 'object' ? v : v === 1 ? { p: 1 } : v === 0 ? { a: 1 } : null; }
function facAttWeek(P) { var o = {}; for (var i = 0; i < 7; i++) { var d = facYmd(Date.now() - i * 86400000); o[d] = facAtt(P, d); } return o; }
function facShift(ymd) { var day0 = Date.parse(ymd + 'T00:00:00Z') - 4 * 3600000, fri = new Date(day0 + 4 * 3600000).getUTCDay() === 5; return { start: day0 + WORK_FROM * 3600000, end: day0 + (fri ? WORK_TO_FRI : WORK_TO) * 3600000, fri: fri, day0: day0 }; }
function facAtMs(ymd, hhmm) { var m = String(hhmm || '').match(/^(\d{1,2}):(\d\d)$/); if (!m) return 0; return facShift(ymd).day0 + (+m[1]) * 3600000 + (+m[2]) * 60000; }   // "08:05" on that day (Dubai) -> ms
function facNetMs(a, b) { if (!(b > a)) return 0; var tz = 4 * 3600000, t = a + tz, end = b + tz, tot = end - t; while (t < end) { var day = Math.floor(t / 86400000) * 86400000; WORK_BREAKS.forEach(function (br) { var b0 = day + (br[0] * 60 + br[1]) * 60000, b1 = day + (br[2] * 60 + br[3]) * 60000; tot -= Math.max(0, Math.min(end, b1) - Math.max(t, b0)); }); t = day + 86400000; } return tot; }   // clock time minus the breaks (whatever the shift)
function facAttHours(rec, ymd) {                                  // hours on the clock for one record; a missing OUT counts until the shift end (or now), flagged
  if (!rec || !rec.in) return { h: 0, open: false, noOut: false }; var sh = facShift(ymd), now = Date.now(), out = rec.out || Math.min(now, sh.end), open = !rec.out && now < sh.end;
  return { h: Math.max(0, facNetMs(rec.in, out)) / 3600000, open: open, noOut: !rec.out && !open };   // 22 Oct 2026: minus the breaks
}
function facAttMonth(P, ym, names) {                               // one month, every worker: days present / absent / late, hours, missing OUTs, per-day records
  var all = P.getProperties(), days = {}, today = facYmd(Date.now());
  Object.keys(all).forEach(function (k) { if (k.indexOf('FAC_ATT_' + ym) === 0) { var d = k.slice(8); if (d <= today) try { var r = JSON.parse(all[k]); Object.keys(r).forEach(function (n) { r[n] = facAttRec(r[n]); if (!r[n]) delete r[n]; }); days[d] = r; } catch (e) {} } });
  var W = {}; names.forEach(function (n) { W[n.toUpperCase()] = { name: n, present: 0, absent: 0, late: 0, lateMin: 0, hours: 0, noOut: 0, days: {} }; });
  Object.keys(days).sort().forEach(function (d) { Object.keys(days[d]).forEach(function (k) { var w = W[k] = W[k] || { name: k, present: 0, absent: 0, late: 0, lateMin: 0, hours: 0, noOut: 0, days: {} }, r = days[d][k];
    if (r.a) { w.absent++; w.days[d] = { a: 1 }; return; } w.present++; var hh = facAttHours(r, d); w.hours += hh.h; if (hh.noOut) w.noOut++; if (r.late) { w.late++; w.lateMin += r.late; }
    w.days[d] = { in: r.in || 0, out: r.out || 0, late: r.late || 0, h: Math.round(hh.h * 10) / 10, noOut: hh.noOut, p: r.p || 0 }; }); });
  var y = +ym.slice(0, 4), mo = +ym.slice(5, 7), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { ok: true, ym: ym, daysInMonth: dim, daysSoFar: ym === today.slice(0, 7) ? +today.slice(8, 10) : (ym < today.slice(0, 7) ? dim : 0), workers: Object.keys(W).map(function (k) { var w = W[k]; w.hours = Math.round(w.hours * 10) / 10; return w; }) };
}
function facSal(P) { var r = null; try { r = JSON.parse(P.getProperty('FAC_SAL') || 'null'); } catch (e) {} return r && typeof r === 'object' ? r : {}; }   // monthly salaries - Abbas only, never in the repo
// Materials: a short list (FAC_MAT = [{n: name, q: quantity, u: unit, low: alert level}]) kept by the factory; "low" = q at or under the alert level.
function facMat(P) { var r = null; try { r = JSON.parse(P.getProperty('FAC_MAT') || 'null'); } catch (e) {} return Array.isArray(r) ? r : []; }
function facMatLow(P) { return facMat(P).filter(function (m) { return m.low != null && m.low !== '' && +m.q <= +m.low; }); }
function facLate(P, rtok) {                                     // cards with a due date that is past or within 2 days, not yet READY / FINISH (Trello, cached 60 s)
  var c = CacheService.getScriptCache(), h = c.get('FAC_LATE'); if (h) return JSON.parse(h);
  var cards = []; try { cards = (trApi('get', '/boards/' + FAC.BOARD + '/cards', { filter: 'open', limit: 1000, fields: 'name,idList,due' }, rtok) || []).map(function (x) { return { id: x.id, name: x.name, l: x.idList, due: x.due ? String(x.due).slice(0, 10) : '' }; }); } catch (e) {}
  var done = {}; FAC.LISTS.forEach(function (l) { if (/^(READY|READY 2|FINISH|FINISH SAMPLES|SAMPLE DONE|RETURNS BACK)$/.test(l[0])) done[l[1]] = 1; });
  var today = Date.parse(facYmd(Date.now()) + 'T00:00:00Z');
  var late = cards.filter(function (x) { return x.due && !done[x.l]; }).map(function (x) { return { id: x.id, name: x.name, l: x.l, due: x.due, days: Math.round((Date.parse(x.due + 'T00:00:00Z') - today) / 86400000) }; }).filter(function (x) { return x.days <= 2; }).sort(function (a, b) { return a.days - b.days; });
  try { c.put('FAC_LATE', JSON.stringify(late), 60); } catch (e) {} return late;
}
function facWorkRep(P, rtok, rdays) {                            // every worker's output over the last N days + what each has in hand + per-day pieces, attendance, late cards, low stock
  var rsince = new Date(Date.now() - 120 * 86400000).toISOString(), rcut = Date.now() - rdays * 86400000, rday0 = Math.floor((Date.now() + 4 * 3600000) / 86400000) * 86400000 - 4 * 3600000, racts = [], rbefore = '';   // rday0 = today 00:00 Dubai   // read 120 days back: a batch still in hand may be old
  for (var ri = 0; ri < 5; ri++) { var rq = { filter: 'commentCard', since: rsince, limit: 1000 }; if (rbefore) rq.before = rbefore; var rpage = trApi('get', '/boards/' + FAC.BOARD + '/actions', rq, rtok) || []; racts = racts.concat(rpage); if (rpage.length < 1000) break; rbefore = rpage[rpage.length - 1].id; }
  var byCard = {}; racts.forEach(function (a) { var cid0 = ((a.data || {}).card || {}).id; if (cid0 && WK_RE.test(String((a.data || {}).text || ''))) (byCard[cid0] = byCard[cid0] || { name: (a.data.card || {}).name || '', acts: [] }).acts.push(a); });
  var rw = {}; facWorkers(P, rtok).forEach(function (w) { rw[w.name.toUpperCase()] = { name: w.name, pcs: 0, ms: 0, batches: 0, open: 0, cards: {}, hand: [], last: 0, byDay: {} }; });
  Object.keys(byCard).forEach(function (cid0) { var bc = byCard[cid0], wk0 = facWkParse(bc.acts.slice().sort(function (x, y) { return Date.parse(x.date) - Date.parse(y.date); }));
    Object.keys(wk0).forEach(function (w) { var r = rw[w] = rw[w] || { name: w, pcs: 0, ms: 0, batches: 0, open: 0, cards: {}, hand: [], last: 0, byDay: {} }; wk0[w].forEach(function (b) {
      var evs = (b.parts || []).slice(); if (b.out) evs.push({ t: b.out, n: b.d - (b.pd || 0) });   // 23 Oct 2026: every delivery counts on its own day (parts too)
      evs.forEach(function (ev) { if (ev.t >= rday0) r.today = (r.today || 0) + ev.n; if (ev.t < rcut) return; r.pcs += ev.n; r.cards[cid0] = (r.cards[cid0] || 0) + ev.n; if (ev.t > r.last) r.last = ev.t; var dk = facYmd(ev.t); r.byDay[dk] = (r.byDay[dk] || 0) + ev.n; });
      if (b.out) { if (b.out >= rcut) { r.ms += facWorkMs(b.in, b.out); r.batches++; } }
      else { r.open++; if (b.pd && evs.length && evs[evs.length - 1].t >= rcut) r.ms += facWorkMs(b.in, evs[evs.length - 1].t); r.hand.push({ id: cid0, name: bc.name, g: b.g - (b.pd || 0), given: b.g, pd: b.pd || 0, in: b.in, adds: b.adds || [], by: b.by, wd: facWorkDur(facWorkMs(b.in, Date.now())) }); } }); }); });
  var rout = { ok: true, t: Date.now(), days: rdays, todayN: Object.keys(rw).filter(function (k) { return rw[k].today; }).length, workers: Object.keys(rw).map(function (k) { var r = rw[k]; return { name: r.name, today: r.today || 0, pcs: r.pcs, dur: facWorkDur(r.ms), perDay: r.ms ? facRate(r.pcs, r.ms) : 0, batches: r.batches, open: r.open, last: r.last, byDay: r.byDay, hand: r.hand.sort(function (a, b) { return a.in - b.in; }), cards: Object.keys(r.cards).map(function (cid0) { return { id: cid0, name: (byCard[cid0] || {}).name || '', pcs: r.cards[cid0] }; }) }; }) };
  rout.att = facAttWeek(P); rout.roles = facRoles(P, rtok); rout.today = facYmd(Date.now()); try { rout.late = facLate(P, rtok); } catch (e) { rout.late = []; } rout.low = facMatLow(P).map(function (m) { return { n: m.n, q: m.q, u: m.u || '' }; });
  return rout;
}
// The DAILY CLOSING: at 10 pm Dubai (Friday 12 noon) the relay writes the day into the direct chat - pieces per worker, who has what in hand,
// attendance, designs moved today, late designs, low stock. Once a day (FAC_DAILY_LAST); off with FAC_DAILY_OFF (More → Factory); "Post now" = op daily.
function facDailyText(P, rtok, when) {
  var ymd = facYmd(when), rep = facWorkRep(P, rtok, 7), att = facAtt(P, ymd), names = facWorkers(P, rtok).map(function (w) { return w.name; }), L = [];
  var sj = function (n) { var m = String(n || '').match(/\d{3,6}/); return m ? 'SJ-' + m[0] : String(n || '').slice(0, 20); };
  L.push('*📒 DAILY CLOSING · ' + facWhen(when).replace(/ \d\d:\d\d$/, '') + '* · দিনের হিসাব');
  var did = rep.workers.filter(function (w) { return (w.byDay || {})[ymd]; }).sort(function (a, b) { return b.byDay[ymd] - a.byDay[ymd]; }), tot = did.reduce(function (a, w) { return a + w.byDay[ymd]; }, 0);
  L.push('👷 *' + tot + ' pcs done today* · আজ হয়েছে' + (did.length ? ' · ' + did.map(function (w) { return w.name + ' ' + w.byDay[ymd]; }).join(' · ') : ' · nobody pressed Done · কেউ Done চাপেনি'));
  var hand = rep.workers.filter(function (w) { return w.hand && w.hand.length; });
  if (hand.length) L.push('⏳ *In hand · হাতে:* ' + hand.map(function (w) { return w.name + ' ' + w.hand.map(function (h) { return h.g + ' (' + sj(h.name) + ')'; }).join(' + '); }).join(' · '));
  var pres = names.filter(function (n) { var r = att[n.toUpperCase()]; return r && !r.a; }), abs = names.filter(function (n) { var r = att[n.toUpperCase()]; return r && r.a; }), lateL = names.filter(function (n) { var r = att[n.toUpperCase()]; return r && r.late; });
  if (pres.length || abs.length) L.push('📅 *Present ' + pres.length + '* · *Absent ' + abs.length + '*' + (abs.length ? ' (' + abs.join(', ') + ')' : '') + (lateL.length ? ' · ⏰ late: ' + lateL.map(function (n) { return n + ' ' + att[n.toUpperCase()].late + ' min'; }).join(', ') : '') + ' · উপস্থিত ' + pres.length + ' · অনুপস্থিত ' + abs.length);
  var noOut = names.filter(function (n) { var r = att[n.toUpperCase()]; return r && r.in && !r.out; }); if (noOut.length) L.push('⏱ *No Out yet · আউট হয়নি:* ' + noOut.join(', '));
  try { var day0 = new Date(Date.parse(ymd + 'T00:00:00Z') - 4 * 3600000).toISOString(), mv = trApi('get', '/boards/' + FAC.BOARD + '/actions', { filter: 'updateCard:idList', since: day0, limit: 200 }, rtok) || [], byL = {}, seen = {};
    mv.forEach(function (a) { var d = a.data || {}, c = d.card || {}; if (!d.listAfter || seen[c.id]) return; seen[c.id] = 1; (byL[d.listAfter.name] = byL[d.listAfter.name] || []).push(sj(c.name)); });
    var ks = Object.keys(byL); if (ks.length) L.push('🔀 *Moved today · আজ সরানো:* ' + ks.map(function (k) { return k + ' ← ' + byL[k].join(', '); }).join(' · ')); } catch (e) {}
  var late = rep.late || [], over = late.filter(function (x) { return x.days < 0; }), soon = late.filter(function (x) { return x.days >= 0; });
  if (over.length) L.push('⏰ *Late · দেরি:* ' + over.map(function (x) { return sj(x.name) + ' (' + (-x.days) + ' d)'; }).join(' · '));
  if (soon.length) L.push('📅 *Due soon · শীঘ্রই:* ' + soon.map(function (x) { return sj(x.name) + ' (' + (x.days === 0 ? 'today' : x.days + ' d'); }).join(' · ') + ')');
  if (rep.low && rep.low.length) L.push('📦 *Low stock · কম আছে:* ' + rep.low.map(function (m) { return m.n + ' ' + m.q + (m.u ? ' ' + m.u : ''); }).join(' · '));
  return L.join('\n');
}
function facDaily(P, who) {
  var rtok = P.getProperty('TRELLO') || P.getProperty('TRELLO_W'), FT = P.getProperty('SLACK_FACTORY_TOKEN'), text = facDailyText(P, rtok, Date.now());
  var dm = FT ? facDm(P, FT) : null, ts = '';
  if (dm) { var pj = slackApi(FT, 'chat.postMessage', { channel: dm.ch, text: text + (who ? '\n_' + who + ' (factory app)_' : '') }); if (pj.ok) ts = pj.ts; }
  facBump(); facNudge(P, 'dm'); return { ok: true, text: text, ts: ts, posted: !!ts };
}
function facDailyTick(P) {                                       // from the 1-minute timer: after closing time, once per day
  if (P.getProperty('FAC_DAILY_OFF')) return; var u = new Date(Date.now() + 4 * 3600000), h = u.getUTCHours(), fri = u.getUTCDay() === 5, ymd = facYmd(Date.now());
  if (h < (fri ? WORK_TO_FRI : WORK_TO) || P.getProperty('FAC_DAILY_LAST') === ymd) return;
  P.setProperty('FAC_DAILY_LAST', ymd); try { facDaily(P, ''); } catch (e) {}
}
function facWkLine(w, b) { var r = b.out ? ' · ' + facWorkDur(facWorkMs(b.in, b.out)) + ' · ≈' + facRate(b.d, facWorkMs(b.in, b.out)) + '/day' : ' · since ' + facDay(b.in); return w + ' ' + (b.out ? b.d + ' pcs ✓' : b.g + ' pcs ⏳') + r; }
function facStages(acts, card) {                               // time in each list, from the card's birth to its (last) arrival in READY / READY 2
  var born = null, cur = null, evs = [];
  acts.forEach(function (a) { var d = a.data || {};
    if (/^(createCard|copyCard|moveCardToBoard|convertToCardFromCheckItem)$/.test(a.type)) { if (!born) { born = Date.parse(a.date); cur = (d.list || {}).name || null; } return; }
    if (a.type === 'updateCard' && d.listAfter) evs.push({ t: Date.parse(a.date), from: (d.listBefore || {}).name || null, to: d.listAfter.name }); });
  if (!born) born = idTime(card.id); if (evs.length && evs[0].from) cur = evs[0].from;   // Trello's own history wins over the creation note
  if (!cur) cur = '?';
  var FIN = /^(FINISH|FINISH SAMPLES)$/, RDY = /^(READY|READY 2)$/, cut = null, fin = null;
  for (var i = evs.length - 1; i >= 0; i--) if (FIN.test(evs[i].to)) { fin = i; break; }
  var upto = fin != null ? fin : evs.length;                   // events before the final FINISH count
  for (var j = upto - 1; j >= 0; j--) if (RDY.test(evs[j].to)) { cut = j; break; }
  var end = cut != null ? evs[cut].t : fin != null ? evs[fin].t : Date.now(), stop = cut != null ? cut : fin != null ? fin : evs.length;
  var segs = {}, order = [], t0 = born, list = cur, steps = [];   // 24 Oct 2026: steps = the card's path in order (list, from, to), for a clean timeline
  for (var k = 0; k < stop; k++) { var e = evs[k]; if (e.t > t0) { if (!segs[list]) { segs[list] = { name: list, ms: 0, n: 0 }; order.push(list); } segs[list].ms += e.t - t0; segs[list].n++; steps.push({ name: list, t0: t0, t1: e.t }); } t0 = e.t; list = e.to; }
  if (end > t0) { if (!segs[list]) { segs[list] = { name: list, ms: 0, n: 0 }; order.push(list); } segs[list].ms += end - t0; segs[list].n++; steps.push({ name: list, t0: t0, t1: end }); }
  var known = FAC.LISTS.map(function (l) { return l[0]; }); order.sort(function (a, b) { var x = known.indexOf(a), y = known.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  return { born: born, end: end, total: end - born, segs: order.map(function (n) { return segs[n]; }), steps: steps, endList: cut != null ? evs[cut].to : fin != null ? evs[fin].to : '', done: cut != null ? 'READY' : fin != null ? 'FINISH' : '', finished: fin != null };
}
function facReportText(card, st, wk) {                       // 24 Oct 2026 (Abbas: "give me the report in the chat very clean"): header, timeline with dates, totals, workers
  var p = String(card.name || ''), no = (p.match(/(?:SJ|SH|US)\s*[-=:*#(]*\s*\**\(?\s*(\d{3,6}(?:-[A-Z])?)/i) || p.match(/\b(\d{4,6})\b/) || [])[1] || '', pcs = (p.match(/(\d{1,4})\s*pcs/i) || [])[1] || '';
  var NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮'], L = [];
  L.push('📊 *' + (no ? 'SJ-' + no : p.slice(0, 40)) + ' · PRODUCTION REPORT*' + (pcs ? ' · ' + pcs + ' pcs' : '') + (st.done ? '' : ' · so far'));
  L.push('🗓 *' + facDay(st.born) + ' → ' + (st.done ? (st.endList || st.done) + ' ' : 'today ') + facDay(st.end) + '* · *' + facDur(st.total) + '* total · মোট');
  L.push('');
  L.push('*Timeline · ধাপে ধাপে*');
  var steps = st.steps || [], shown = steps.length > 15 ? steps.slice(steps.length - 15) : steps; if (steps.length > 15) L.push('… ' + (steps.length - 15) + ' earlier moves');
  shown.forEach(function (g, i) { L.push(NUM[i] + ' *' + g.name + '* · ' + facDur(g.t1 - g.t0) + ' · ' + facWhen(g.t0) + ' → ' + facWhen(g.t1)); });
  if (st.done) L.push('✅ *' + (st.endList || st.done) + '* · ' + facWhen(st.end)); else L.push('⏳ still going · এখনো চলছে');
  var multi = st.segs.filter(function (g) { return g.n > 1; });
  if (multi.length) { L.push(''); L.push('*Time per stage · ধাপ অনুযায়ী মোট* (came back more than once)'); st.segs.forEach(function (g) { L.push('• ' + g.name + ' · ' + facDur(g.ms) + (g.n > 1 ? ' · ' + g.n + '×' : '')); }); }
  var ws = Object.keys(wk);
  if (ws.length) { L.push(''); L.push('👷 *Workers · কর্মী* (1 day = 8 am – 10 pm minus breaks · Fri 8 – 12)');
    ws.forEach(function (w) { var bs = wk[w], d = 0, ms = 0, open = 0, inh = 0; bs.forEach(function (b) { if (b.out) { d += b.d; ms += facWorkMs(b.in, b.out); } else { open++; d += b.pd || 0; inh += b.g - (b.pd || 0); } });
      L.push('• *' + w + '* · ' + d + ' pcs' + (ms ? ' · ' + facWorkDur(ms) + ' · ≈ ' + facRate(d, ms) + ' pcs/day' : '') + (open ? ' · ' + inh + ' pcs still in hand ⏳' : '')); }); }
  L.push('');
  L.push('_উৎপাদন রিপোর্ট · শুরু থেকে ' + (st.done === 'READY' ? 'রেডি' : 'শেষ') + ' পর্যন্ত ' + facDur(st.total) + '_');
  return L.join('\n');
}
function facReport(P, wtok, FT, cid, force, who) {              // posts the report into the card's chat + Trello; once per card unless forced
  var tok = wtok || P.getProperty('TRELLO'), card = trApi('get', '/cards/' + cid, { fields: 'name,idList,idBoard' }, tok); if (card.idBoard !== FAC.BOARD) return { ok: false, error: 'not an ALM card' };
  var acts = facActs(tok, cid), have = acts.some(function (a) { return a.type === 'commentCard' && /#report\b/.test(String((a.data || {}).text || '')); });
  if (have && !force) return { ok: true, already: true };
  var st = facStages(acts, card), wk = facWkParse(acts), text = facReportText(card, st, wk);
  if (!st.finished && !force) return { ok: false, error: 'not finished' };
  var ts = '';
  if (FT) { try { var th = facThread(P, FT, cid, tok, true); if (th) { var pj = slackApi(FT, 'chat.postMessage', { channel: th.ch, thread_ts: th.ts, text: text }); if (pj.ok) ts = pj.ts; } } catch (e) {} }
  if (wtok) { try { trApi('post', '/cards/' + cid + '/actions/comments', { text: text.replace(/\*/g, '') + '\n' + (who ? who + ' (factory app) ' : '') + '#report' }, wtok); } catch (e) {} }
  facBump(); facNudge(P, cid);
  return { ok: true, ts: ts, text: text };
}
function facWkField(wtok, cid, w, text) { if (!w.id) return; try { trApi('put', '/cards/' + cid + '/customField/' + w.id + '/item', {}, wtok, { value: { text: String(text).slice(0, 60) } }); } catch (e) {} }
function nrmName(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]/g, ''); }
function facUsers(FT) {                                        // the people of the workspace (no bots, no deleted), for "new direct chat with..."; cached 10 min
  var c = CacheService.getScriptCache(), h = c.get('FAC_USERS'); if (h) return JSON.parse(h);
  var outu = [], cur = '';
  for (var i = 0; i < 5; i++) {
    var j = slackApi(FT, 'users.list', { limit: 200, cursor: cur }, true);
    if (!j.ok) { if (j.error === 'missing_scope') throw new Error('the factory Slack app needs users:read'); break; }
    (j.members || []).forEach(function (u) { if (u.deleted || u.is_bot || u.id === 'USLACKBOT') return; var pr = u.profile || {}; outu.push({ id: u.id, name: pr.real_name || u.real_name || u.name, handle: u.name, dn: pr.display_name || '' }); });
    cur = (j.response_metadata || {}).next_cursor || ''; if (!cur) break;
  }
  outu.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  try { c.put('FAC_USERS', JSON.stringify(outu), 600); } catch (e) {}
  return outu;
}
function facDmHist(FT, dm, since, limit) {                     // the direct chat = the channel's own messages (not thread replies), oldest first
  var rq = { channel: dm.ch, limit: limit || 100 }; if (since) rq.oldest = String(since);
  var j = slackApi(FT, 'conversations.history', rq, true);
  if (!j.ok) throw new Error('Slack said ' + j.error + (j.error === 'not_in_channel' ? ' (invite the factory bot to #' + dm.name + ')' : j.error === 'missing_scope' ? ' (the factory Slack app needs channels:history + groups:history)' : ''));
  return (j.messages || []).filter(function (m) { return !m.subtype || m.subtype === 'bot_message' || m.subtype === 'file_share' || m.subtype === 'thread_broadcast'; }).sort(function (a, b) { return +a.ts - +b.ts; });
}
function facUnread(P, FT, cards, who, fresh) {                         // what THIS person has not seen yet: lines by others, newer than their last look (and newer than their first use)
  who = String(who || '').trim(); if (!who || !FT) return {};
  var W = who.toUpperCase().slice(0, 20), k = 'FSEEN_' + who.toUpperCase().slice(0, 40), rec = JSON.parse(P.getProperty(k) || 'null');
  if (!rec) { rec = { _t0: String(Date.now() / 1000) }; P.setProperty(k, JSON.stringify(rec)); }
  var cache = CacheService.getScriptCache(), g = facGen(), ck = 'FAC_UN_' + W, hit = fresh ? null : cache.get(ck + '_' + g + '_' + (rec._v || 0)); if (hit) return JSON.parse(hit);
  var lastGood = JSON.parse(cache.get(ck + '_L') || '{}'), outm = {}, looked = 0, mine = function (mm) { return String(mm.who).toUpperCase() === who.toUpperCase(); };
  var th = null; try { th = facThreads(P, FT, cards, fresh); } catch (e) { th = null; }
  if (th) {
    var all = P.getProperties(), byCard = {}; Object.keys(all).forEach(function (x) { if (x.indexOf('FTH_') === 0) byCard[x.slice(4)] = JSON.parse(all[x]); });
    Object.keys(th).sort(function (a, b) { return +th[b].last - +th[a].last; }).forEach(function (cid) {   // newest activity first: a fresh message is counted before old move lines
      var t = th[cid], seen = Math.max(+(rec[cid] || 0), +rec._t0); if (!(+t.last > seen) || !byCard[cid]) return;
      var rk = 'FUR2_' + W + '_' + cid + '_' + t.last + '_' + seen, rh = cache.get(rk);
      if (rh) { var r0 = JSON.parse(rh); if (r0.n) outm[cid] = r0; return; }             // this thread has not changed since we last counted it
      if (!facBudget()) { if (lastGood[cid]) outm[cid] = lastGood[cid]; return; }
      looked++;
      var rp = slackApi(FT, 'conversations.replies', { channel: byCard[cid].ch, ts: byCard[cid].ts, oldest: String(seen), limit: 100 }, true);
      if (!rp.ok) { facSlow(rp); if (lastGood[cid]) outm[cid] = lastGood[cid]; return; }  // Slack busy: keep what we knew, never blank it
      var n = 0, lastOther = '', tx = '';
      (rp.messages || []).forEach(function (m) { if (+m.ts <= seen || m.ts === byCard[cid].ts) return; var mm = facMsg(P, FT, m, byCard[cid].ts); if ((mm.sys && !facNote(mm, who)) || mine(mm)) return; n++; lastOther = m.ts; tx = facLine(mm); });
      var r = { n: n, last: lastOther, tx: tx }; try { cache.put(rk, JSON.stringify(r), 21600); } catch (e) {} if (n) outm[cid] = r;
    });
  } else Object.keys(lastGood).forEach(function (x) { if (x !== 'dm' && x !== 'lais' && !isXRoom(x) && x.charAt(0) !== 'L') outm[x] = lastGood[x]; });
  try { var dm = facDm(P, FT); if (dm) {                      // the direct chat counts too (Abbas 14 Oct: "include those chats notifications in catchup")
    var seenD = Math.max(+(rec.dm || 0), +rec._t0), nd = 0, lastD = '', txD = '';
    facDmMsgs(P, FT, dm, fresh).forEach(function (m) { if (+m.ts <= seenD) return; var md = facMsg(P, FT, m, null); if ((md.sys && !facNote(md, who)) || mine(md)) return; nd++; lastD = m.ts; txD = facLine(md); });
    if (nd) outm.dm = { n: nd, last: lastD, tx: txD };
  } } catch (e) { if (lastGood.dm) outm.dm = lastGood.dm; }
  facXRoomsFor(P, FT, who).forEach(function (xr) { try {        // #cash / #expenses (Abbas only) count like the direct chat
    var seenX = Math.max(+(rec[xr.k] || 0), +rec._t0), nx = 0, lastX = '', txX = '';
    facDmMsgs(P, FT, xr, fresh).forEach(function (m) { if (+m.ts <= seenX) return; var mx = facMsg(P, FT, m, null); if ((mx.sys && !facNote(mx, who)) || mine(mx)) return; nx++; lastX = m.ts; txX = facLine(mx); });
    if (nx) outm[xr.k] = { n: nx, last: lastX, tx: txX };
  } catch (e) { if (lastGood[xr.k]) outm[xr.k] = lastGood[xr.k]; } });
  try { var lsr = facLaisFor(P, FT, who); if (lsr) {           // #laisfactory counts too - only for the people who may see it
    var seenL = Math.max(+(rec.lais || 0), +rec._t0), nl = 0, lastL = '', txL = '';
    var LT = P.getProperty('SLACK_BOT_TOKEN'), ltop = facLaisTop(P, LT, lsr, fresh); ltop.forEach(function (m) { if (+m.ts <= seenL) return; var ml = facMsg(P, LT, m, null); if (ml.sys || mine(ml)) return; nl++; lastL = m.ts; txL = facLine(ml); });
    if (nl) outm.lais = { n: nl, last: lastL, tx: txL };
    ltop.forEach(function (m) { if (!m.lr) return; var oid = 'L' + m.ts, seenO = Math.max(+(rec[oid] || 0), +rec._t0); if (!(+m.lr > seenO)) return;   // each order's thread
      var ok2 = 'FLR_' + W + '_' + oid + '_' + m.lr + '_' + seenO, oh = cache.get(ok2); if (oh) { var o0 = JSON.parse(oh); if (o0.n) outm[oid] = o0; return; }
      if (!facBudget()) { if (lastGood[oid]) outm[oid] = lastGood[oid]; return; }
      var orp = slackApi(LT, 'conversations.replies', { channel: lsr.ch, ts: m.ts, oldest: String(seenO), limit: 100 }, true); if (!orp.ok) { if (lastGood[oid]) outm[oid] = lastGood[oid]; return; }
      var on = 0, olast = '', otx = ''; (orp.messages || []).forEach(function (r) { if (+r.ts <= seenO || r.ts === m.ts) return; var mr = facMsg(P, LT, r, m.ts); if (mr.sys || mine(mr)) return; on++; olast = r.ts; otx = facLine(mr); });
      var ro = { n: on, last: olast, tx: otx }; try { cache.put(ok2, JSON.stringify(ro), 21600); } catch (e) {} if (on) outm[oid] = ro; });
  } } catch (e) { if (lastGood.lais) outm.lais = lastGood.lais; }
  try { cache.put(ck + '_' + g + '_' + (rec._v || 0), JSON.stringify(outm), facTtl(P)); cache.put(ck + '_L', JSON.stringify(outm), 3600); } catch (e) {}
  return outm;
}
function facDmMsgs(P, FT, dm, fresh) {                         // the direct chat: last 60 channel messages + their thread replies (shown with ↳), oldest first; shared by every phone
  var c = CacheService.getScriptCache(), g = facGen(), k = 'FAC_DMH_' + dm.ch + '_' + g, h = fresh ? null : c.get(k); if (h) return JSON.parse(h);
  var slim = function (m, rp) { return { ts: m.ts, text: (rp ? '↳ ' : '') + String(m.text || ''), user: m.user, bot_id: m.bot_id, username: m.username, subtype: m.subtype,
    files: (m.files || []).map(function (f) { return { id: f.id, name: f.name, mimetype: f.mimetype, size: f.size }; }) }; };
  var outm = [];
  var top; try { top = facDmHist(FT, dm, '', 60); } catch (e) { var lg = c.get('FAC_DMH_' + dm.ch + '_L'); if (lg) return JSON.parse(lg); throw e; }
  top.forEach(function (m) {
    outm.push(slim(m));
    if (m.reply_count && m.latest_reply) {                     // someone answered inside a thread of the direct chat (Slack's "reply in thread")
      var rk = 'FAC_DMR_' + m.ts + '_' + m.latest_reply, rh = c.get(rk), reps = null;
      if (rh) reps = JSON.parse(rh); else { var rj = slackApi(FT, 'conversations.replies', { channel: dm.ch, ts: m.ts, limit: 100 }, true); facSlow(rj); if (rj.ok) { reps = (rj.messages || []).filter(function (x) { return x.ts !== m.ts; }).map(function (x) { return slim(x, true); }); try { c.put(rk, JSON.stringify(reps), 21600); } catch (e) {} } }
      (reps || []).forEach(function (x) { outm.push(x); });
    }
  });
  outm.sort(function (a, b) { return +a.ts - +b.ts; });
  try { c.put(k, JSON.stringify(outm), facTtl(P) > 10 ? 30 : 6); c.put('FAC_DMH_' + dm.ch + '_L', JSON.stringify(outm), 3600); } catch (e) {}
  return outm;
}
function facUser(P, FT, uid) {                               // {n: first name as shown, wn: every name Slack has for this person (for the "my side" match)}
  var c = CacheService.getScriptCache(), k = 'FAC_U2_' + uid, h = c.get(k); if (h) return JSON.parse(h);
  var j = slackApi(FT, 'users.info', { user: uid }, true), pr = j.ok ? (j.user.profile || {}) : {}, u = j.ok ? j.user : {};
  var names = [pr.real_name, u.real_name, pr.display_name, u.name].filter(function (x) { return x; }).map(String);
  var r = { n: (names[0] || uid).split(' ')[0], wn: names.join(' ').split(/[\s._\-]+/).filter(function (x) { return x; }) };
  c.put(k, JSON.stringify(r), 21600); return r;
}
function facMsg(P, FT, m, root) {                             // one Slack message -> what the phone shows
  var text = String(m.text || ''), who = '', app = false, wn = [], mm = text.match(/^\*([^*]{1,40}):\*\s?([\s\S]*)$/);
  if (m.bot_id && mm) { who = mm[1]; text = mm[2]; app = true; }
  else if (m.bot_id) { who = m.username || 'SJ'; }
  else if (m.user) { var fu = facUser(P, FT, m.user); who = fu.n; wn = fu.wn; }
  var files = (m.files || []).map(function (f) { var mt = f.mimetype || '', nm = f.name || '';
    var video = /^video\//.test(mt) || (!/^audio\//.test(mt) && /\.(mp4|mov|m4v|webm|3gp)$/i.test(nm));
    var audio = !video && (/^audio\//.test(mt) || /\.(m4a|opus|ogg|oga|mp3|aac|amr|wav)$/i.test(nm) || (/\.webm$/i.test(nm) && /^voice/i.test(nm)));
    return { id: f.id, name: nm, type: mt, size: f.size || 0, img: /^image\//.test(mt), audio: audio, video: video }; });
  var sys = /^→ \*/.test(text) && m.bot_id;
  return { ts: m.ts, who: who, wn: wn, app: app, sys: !!sys, root: m.ts === root, text: text.replace(/<(https?:[^|>]+)(\|[^>]*)?>/g, '$1'), files: files };
}
// ---- STEP 3 (12-13 Oct 2026): the buzz. When Abbas writes in a card's thread, the factory phone gets a Telegram message with a link
// straight to that card. A 1-minute timer (setupFacWatch, run once by Abbas) looks at #cutting; the phone is linked once by sending a
// 6-letter code to the bot. Needs script property TG_FACTORY_TOKEN (the bot token from @BotFather, typed in by Abbas).
function tgApi(P, method, args) {
  var tok = P.getProperty('TG_FACTORY_TOKEN'); if (!tok) return { ok: false, error: 'no token' };
  try { return JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(args || {}), muteHttpExceptions: true }).getContentText()); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function facTgPoll(P) {                                        // read what people sent to the bot: a 6-letter code links that chat to a factory phone
  var off = +(P.getProperty('TG_OFFSET') || 0), u = tgApi(P, 'getUpdates', { offset: off, timeout: 0, allowed_updates: ['message'] });
  if (!u.ok) return;
  (u.result || []).forEach(function (up) {
    off = Math.max(off, up.update_id + 1);
    var m = up.message; if (!m || !m.text) return;
    var code = String(m.text).trim().toUpperCase().replace(/^\/START\s*/, ''), rec = P.getProperty('TG_CODE_' + code);
    if (rec) { rec = JSON.parse(rec); P.setProperty('TG_FAC_' + rec.dev, JSON.stringify({ chat: m.chat.id, who: rec.who, t: Date.now() })); P.deleteProperty('TG_CODE_' + code);
      tgApi(P, 'sendMessage', { chat_id: m.chat.id, text: '✅ Linked to the SJ Factory app' + (rec.who ? ' (' + rec.who + ')' : '') + '. You will get a message here when Abbas writes on a card.\nایپ سے جڑ گیا۔ جب عباس کسی کارڈ پر لکھیں گے تو یہاں پیغام آئے گا۔' }); }
    else if (/^\/start/i.test(m.text)) tgApi(P, 'sendMessage', { chat_id: m.chat.id, text: 'Send the 6-letter code shown in the SJ Factory app (🔔 button).\nایپ میں دکھایا گیا 6 حرفی کوڈ یہاں بھیجیں۔' });
  });
  P.setProperty('TG_OFFSET', String(off));
}
function facWatch() {                                          // every minute: new replies by a person (not the bot) in a card's thread -> Telegram to the factory phones
  var P = PropertiesService.getScriptProperties(), FT = P.getProperty('SLACK_FACTORY_TOKEN'); if (!FT || !P.getProperty('TG_FACTORY_TOKEN')) return;
  var all = P.getProperties(), phones = Object.keys(all).filter(function (k) { return k.indexOf('TG_FAC_') === 0; }).map(function (k) { return JSON.parse(all[k]); });
  facTgPoll(P);
  if (!phones.length) return;
  var byTs = {}; Object.keys(all).forEach(function (k) { if (k.indexOf('FTH_') === 0) byTs[JSON.parse(all[k]).ts] = k.slice(4); });
  var first = !all['FAC_SEEN'], seen = JSON.parse(all['FAC_SEEN'] || '{}'), hist = slackApi(FT, 'conversations.history', { channel: DOX.CUTTING, limit: 100 }, true), changed = false;
  if (!hist.ok) return;
  if (first) { (hist.messages || []).forEach(function (m) { if (byTs[m.ts]) seen[m.ts] = m.latest_reply || m.ts; }); P.setProperty('FAC_SEEN', JSON.stringify(seen)); return; }   // first run: only take note, never buzz about old replies
  (hist.messages || []).forEach(function (m) {
    var card = byTs[m.ts]; if (!card || !m.latest_reply) return;
    var last = seen[m.ts] || m.ts; if (+m.latest_reply <= +last) return;
    var rp = slackApi(FT, 'conversations.replies', { channel: DOX.CUTTING, ts: m.ts, oldest: last, limit: 50 }, true);
    var news = (rp.messages || []).filter(function (x) { return x.ts !== m.ts && +x.ts > +last && !x.bot_id; });   // only people, never the factory bot's own lines
    seen[m.ts] = m.latest_reply; changed = true;
    if (!news.length) return;
    var who = facUser(P, FT, news[0].user).n, no = (String(m.text || '').match(/\d{4,6}/) || [''])[0];
    var txt = news.map(function (x) { return (x.text ? String(x.text).replace(/<[^>]+>/g, '').slice(0, 200) : '') + ((x.files || []).length ? ' 📎' : ''); }).join('\n');
    var body = '💬 ' + (no ? 'SJ-' + no : 'a card') + ' · ' + who + ':\n' + txt + '\n\nOpen · کھولیں: https://abbas911-prog.github.io/sj-designs/factory.html#card=' + card;
    phones.forEach(function (ph) { tgApi(P, 'sendMessage', { chat_id: ph.chat, text: body, disable_web_page_preview: true }); });
  });
  if (changed) { var ks = Object.keys(seen); if (ks.length > 300) ks.sort().slice(0, ks.length - 300).forEach(function (k) { delete seen[k]; }); P.setProperty('FAC_SEEN', JSON.stringify(seen)); }
}
function setupFacWatch() {                                     // Abbas runs this ONCE from the editor (Run button) and allows the trigger permission
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'facWatch') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('facWatch').timeBased().everyMinutes(1).create();
  facWatch();
}
// 15 Oct 2026 audit: a phone that lost the answer (LTE, locked screen) retries - for a post / upload / new card that used to do it TWICE.
// Every action now carries a once-only id (rid): the first answer is kept 10 min and any retry gets that same answer.
var FAC_ONCE = /^(post|up|upfin|move|edit|copy|add|attach|sample|dmnew|dmset|later|retnew|retset|workset|report|workers|sheetset|attset|matset|salset|daily)$/;
function fac(reqText, P) {
  var rq0 = {}; try { rq0 = JSON.parse(reqText); } catch (e) {}
  var rid = FAC_ONCE.test(rq0.op || '') ? String(rq0.rid || '').replace(/[^\w-]/g, '').slice(0, 40) : '', cR = CacheService.getScriptCache();
  if (rid) { var prev = cR.get('FRID_' + rid); if (prev === 'busy') return out({ ok: false, busy: true, error: 'still sending - one moment' }); if (prev) return ContentService.createTextOutput(prev).setMimeType(ContentService.MimeType.JSON); cR.put('FRID_' + rid, 'busy', 120); }
  var res = fac0(reqText, P);
  if (rid) { try { var txt = res.getContent(), jj = JSON.parse(txt); if (jj.ok && txt.length < 90000) cR.put('FRID_' + rid, txt, 21600); else cR.remove('FRID_' + rid); } catch (e) { cR.remove('FRID_' + rid); } }
  return res;
}
function fac0(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var rtok = P.getProperty('TRELLO') || P.getProperty('TRELLO_W'), wtok = P.getProperty('TRELLO_W');
  if (!rtok) return out({ ok: false, error: 'the relay has no Trello key' });
  facRetLists(P, wtok, req.op === 'sample' && req.kind === 'ret' ? 2 : req.op === 'list');
  var ids = FAC.LISTS.map(function (l) { return l[1]; });
  try {
    if (req.op === 'list') {
      var who0 = String(req.who || '').slice(0, 40), cache = CacheService.getScriptCache(), hit = req.fresh ? null : bigGet(cache, 'FAC_LIST');
      if (hit && !req.fresh) { var hv = JSON.parse(hit); try { hv.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), hv.cards, who0); } catch (e) {} hv.later = facLater(P, who0); try { hv.dm = facDm(P, P.getProperty('SLACK_FACTORY_TOKEN')); } catch (e) { hv.dm = null; } hv.lais = facLaisFor(P, P.getProperty('SLACK_FACTORY_TOKEN'), who0); hv.rooms = facXRoomsFor(P, P.getProperty('SLACK_FACTORY_TOKEN'), who0); hv.lo = facLaisOrders(P, who0, false); hv.live = facLive(P); try { hv.ret = facRetSum(P); } catch (e) {} hv.fast = P.getProperty('FAC_FAST') || ''; hv.rv = RELAY_VER; hv.wroles = facRoles(P, P.getProperty('TRELLO') || P.getProperty('TRELLO_W')); try { hv.workers = facWorkers(P, rtok).map(function (w) { return w.name; }); } catch (e) {} /* 25 Oct 2026 (Abbas: "no workers list"): the cached answer had no workers */ hv.refs = facRefs(P); hv.limit = FAC.LIMIT; try { hv.act = facAct(P, P.getProperty('SLACK_FACTORY_TOKEN'), hv.cards); } catch (e) {} return out(hv); }
      var cf = facCf(rtok), listIds = FAC.LISTS.map(function (l) { return l[1]; });
      // ONE Trello call for the whole board (newest cards first), instead of one per list: Abbas wants the app updated right away, and the
      // phones ask every 10 s - this keeps the relay inside Google's daily fetch quota
      var cards = trApi('get', '/boards/' + FAC.BOARD + '/cards', { filter: 'open', limit: 1000, fields: 'name,idList,pos,shortUrl,idAttachmentCover,dateLastActivity,labels,due', customFieldItems: 'true', attachments: 'cover', attachment_fields: 'id,previews,mimeType' }, rtok) || [];
      try { if (!cache.get('FAC_GC') && cards.length > 50) { cache.put('FAC_GC', '1', 86400); var onB = {}; cards.forEach(function (c) { onB[c.id] = 1; }); var allP = P.getProperties();
        Object.keys(allP).forEach(function (k) { if (k.indexOf('FTH_') === 0 && !onB[k.slice(4)]) P.deleteProperty(k); }); } } catch (e) {}   // archived / deleted cards: their chat link is not needed any more
      cards = cards.filter(function (c) { return listIds.indexOf(c.idList) >= 0; });
      var perList = {}; cards.sort(function (a, b) { return a.pos - b.pos; });
      cards = cards.filter(function (c) { var lim = FAC.LIMIT[c.idList]; if (!lim) return true; perList[c.idList] = (perList[c.idList] || 0) + 1; return perList[c.idList] <= lim; });
      var outc = cards.map(function (c) {
        var f = {}; (c.customFieldItems || []).forEach(function (it) { var n = cf[it.idCustomField], v = it.value || {}; var x = v.text != null ? v.text : v.number != null ? v.number : v.date || (v.checked === 'true' ? '✓' : null); if (n && x != null && String(x).trim() !== '') f[n] = String(x); });
        var a = (c.attachments || [])[0], img = a && a.previews && a.previews.length ? a.id : '';
        return { id: c.id, name: c.name, l: c.idList, pos: c.pos, url: c.shortUrl, img: img, f: f, at: c.dateLastActivity, due: c.due ? String(c.due).slice(0, 10) : '', lb: (c.labels || []).filter(function (l) { return l.name; }).map(function (l) { return { n: l.name, c: l.color || '' }; }) };
      });
      var res = { ok: true, t: Date.now(), lists: FAC.LISTS, show: listIds, cards: outc, w: !!wtok, th: {}, tg: !!P.getProperty('TG_FACTORY_TOKEN') };
      try { bigPut(cache, 'FAC_LIST', JSON.stringify(res), 25); bigPut(cache, 'FAC_LIST_L', JSON.stringify(res), 3600); } catch (e) {}
      try { if (P.getProperty('SLACK_FACTORY_TOKEN')) res.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), outc, who0, !!req.fresh); } catch (e) {}
      res.later = facLater(P, who0);
      try { res.dm = facDm(P, P.getProperty('SLACK_FACTORY_TOKEN')); } catch (e) { res.dm = null; } res.lais = facLaisFor(P, P.getProperty('SLACK_FACTORY_TOKEN'), who0); res.rooms = facXRoomsFor(P, P.getProperty('SLACK_FACTORY_TOKEN'), who0); res.lo = facLaisOrders(P, who0, false);
      res.live = facLive(P); try { res.ret = facRetSum(P); } catch (e) {} res.fast = P.getProperty('FAC_FAST') || ''; res.rv = RELAY_VER; res.refs = facRefs(P); res.limit = FAC.LIMIT; try { res.wroles = facRoles(P, rtok); res.workers = facWorkers(P, rtok).map(function (w) { return w.name; }); } catch (e) {} try { res.act = facAct(P, P.getProperty('SLACK_FACTORY_TOKEN'), outc); } catch (e) {}
      return out(res);
    }
    if (req.op === 'ping') {                                  // 15 Oct 2026: the cheap "anything new?" every 4 s - no Trello call; the cards come from the cached list
      try { facTrelloMoves(P, wtok, P.getProperty('SLACK_FACTORY_TOKEN')); } catch (e) {}   // 20 Oct 2026: a card moved straight in Trello -> a line in its chat
      try { facSampleNeed(P, wtok); } catch (e) {}           // 18 Oct 2026: #samplesneed pictures -> SAMPLE cards on RETURNS (at most once a minute)
      var FTp = P.getProperty('SLACK_FACTORY_TOKEN'), whp = String(req.who || '').slice(0, 40), lc0 = bigGet(CacheService.getScriptCache(), 'FAC_LIST') || bigGet(CacheService.getScriptCache(), 'FAC_LIST_L');
      var pcards = lc0 ? JSON.parse(lc0).cards : Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('FTH_') === 0; }).map(function (k) { return { id: k.slice(4) }; });
      var pth = {}; try { pth = facUnread(P, FTp, pcards, whp, !!req.fresh); } catch (e) {}
      var pdm = null; try { pdm = facDm(P, FTp); } catch (e) {}
      var prs = null; try { prs = facRetSum(P); } catch (e) {}
      var pact; try { pact = facAct(P, FTp, pcards); } catch (e) {}   // 17 Oct 2026: last-line time per chat on every ping, so the Chats tab never shows an older line
      return out({ ok: true, rv: RELAY_VER, th: pth, later: facLater(P, whp), dm: pdm, lais: facLaisFor(P, FTp, whp), rooms: facXRoomsFor(P, FTp, whp), lo: facLaisOrders(P, whp, false), gen: facGen(), ev: !!P.getProperty('FAC_EVENTS_ON'), live: facLive(P), ret: prs, fast: P.getProperty('FAC_FAST') || '', refs: facRefs(P), act: pact });
    }
    if (req.op === 'ntfyset') {                               // turn phone notifications on/off for this person (topic made on the phone)
      var nw = String(req.who || '').trim().toUpperCase().slice(0, 40), ntp = String(req.topic || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); if (!nw) return out({ ok: false, error: 'bad request' });
      var nmap = JSON.parse(P.getProperty('FNTFY') || '{}');
      if (req.on && ntp.length >= 12) nmap[nw] = ntp; else delete nmap[nw];
      P.setProperty('FNTFY', JSON.stringify(nmap));
      var timer = '';
      if (req.on) { try { var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'facNotifyTick'; }); if (!has) setupFacNotify(); timer = 'ok'; } catch (e) { timer = String(e.message || e).slice(0, 120); }
        // nothing old: everything unread right now counts as already sent, so turning it on does not fire 20 notifications
        try { var cc0 = CacheService.getScriptCache(), lc1 = bigGet(cc0, 'FAC_LIST_L') || bigGet(cc0, 'FAC_LIST'), un0 = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), lc1 ? JSON.parse(lc1).cards : [], nw, false), nt0 = {}; Object.keys(un0).forEach(function (k) { if (un0[k].last) nt0[k] = un0[k].last; }); P.setProperty('FNOTE_' + nw, JSON.stringify(nt0)); } catch (e) {} }
      return out({ ok: true, on: !!nmap[nw], timer: timer, events: !!P.getProperty('FAC_EVENTS_ON') });
    }
    if (req.op === 'ntfytest') {
      var tw = String(req.who || '').trim().toUpperCase().slice(0, 40), tmap = JSON.parse(P.getProperty('FNTFY') || '{}'); if (!tmap[tw]) return out({ ok: false, error: 'notifications are off for ' + tw });
      return out({ ok: facNtfy(tmap[tw], { title: 'AL MUTAGADED · test', msg: '✅ Notifications work · নোটিফিকেশন চালু আছে', click: 'https://abbas911-prog.github.io/sj-designs/factory.html' }) });
    }
    if (req.op === 'wpkey') {                                 // 20 Oct 2026: the public half of the push key, for a phone that turns Web Push on
      try { return out({ ok: true, key: facVapid(P).pub }); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); }
    }
    if (req.op === 'wpset') {                                 // keep / drop this phone's push address for this person
      var ww = String(req.who || '').trim().toUpperCase().slice(0, 40), wsub = req.sub || {}, wk = wsub.keys || {}, wdev = String(req.dev || '').replace(/[^a-z0-9]/g, '').slice(0, 12);
      if (!ww || !/^https:\/\/[^\s]+$/.test(String(wsub.endpoint || '')) || !wk.p256dh || !wk.auth) return out({ ok: false, error: 'bad request' });
      var wsubs = facWpSubs(P, ww).filter(function (x) { return x.endpoint !== wsub.endpoint && !(wdev && x.dev === wdev); });
      if (req.on) wsubs.push({ endpoint: String(wsub.endpoint).slice(0, 700), keys: { p256dh: String(wk.p256dh).slice(0, 200), auth: String(wk.auth).slice(0, 60) }, dev: wdev, at: Date.now() });
      wsubs = wsubs.slice(-4); if (wsubs.length) P.setProperty('FWP_' + ww, JSON.stringify(wsubs)); else P.deleteProperty('FWP_' + ww);
      var wtimer = '';
      if (req.on) { try { var whas = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'facNotifyTick'; }); if (!whas) setupFacNotify(); wtimer = 'ok'; } catch (e) { wtimer = String(e.message || e).slice(0, 120); }
        if (!P.getProperty('FNOTE_' + ww)) { try { var wc0 = CacheService.getScriptCache(), wl1 = bigGet(wc0, 'FAC_LIST_L') || bigGet(wc0, 'FAC_LIST'), wu0 = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), wl1 ? JSON.parse(wl1).cards : [], ww, false), wn0 = {}; Object.keys(wu0).forEach(function (k) { if (wu0[k].last) wn0[k] = wu0[k].last; }); P.setProperty('FNOTE_' + ww, JSON.stringify(wn0)); } catch (e) {} } }   // nothing old fires when it is turned on
      return out({ ok: true, on: wsubs.length > 0, n: wsubs.length, timer: wtimer, events: !!P.getProperty('FAC_EVENTS_ON') });
    }
    if (req.op === 'wptest') {
      var wtw = String(req.who || '').trim().toUpperCase().slice(0, 40); if (!facWpSubs(P, wtw).length) return out({ ok: false, error: 'no phone of ' + wtw + ' has notifications on' });
      try { return out({ ok: facWpSend(P, wtw, { title: 'AL MUTAGADED · test', msg: '✅ Notifications work · নোটিফিকেশন চালু আছে', click: 'https://abbas911-prog.github.io/sj-designs/factory.html', tag: 'test' }) }); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); }
    }
    if (req.op === 'ntfyget') { var gm = JSON.parse(P.getProperty('FNTFY') || '{}'), gw = String(req.who || '').trim().toUpperCase().slice(0, 40); return out({ ok: true, on: !!gm[gw], topic: gm[gw] || '', events: !!P.getProperty('FAC_EVENTS_ON') }); }
    if (req.op === 'img') {                                   // a card's cover photo, ~300-600 px, fetched with the auth header (browsers are refused)
      var cid = String(req.card || '').replace(/[^0-9a-f]/g, ''), aid = String(req.att || '').replace(/[^0-9a-f]/g, '');
      if (!cid || !aid) return out({ ok: false, error: 'bad request' });
      var ck = 'FAC_IMG_' + aid + (req.big ? '_B' : ''), c2 = CacheService.getScriptCache(), have = c2.get(ck); if (have) return out({ ok: true, b64: have });
      var at = trApi('get', '/cards/' + cid + '/attachments/' + aid, { fields: 'previews,url,mimeType,bytes' }, rtok), pvs = (at.previews || []).slice().sort(function (x, y) { return x.width - y.width; });
      var pv = req.big ? pvs.slice(-1)[0] : (pvs.filter(function (p) { return p.width >= 300; })[0] || pvs.slice(-1)[0]);
      if (!pv && /^image\//.test(at.mimeType || '') && (at.bytes || 0) <= 1800000 && at.url) pv = { url: at.url, width: 0 };   // 16 Oct: a brand-new photo whose Trello previews are not made yet - the original, if small
      if (!pv) return out({ ok: false, error: /^image\//.test(at.mimeType || '') ? 'photo preview not ready yet' : 'not a picture' });
      // big = the sharpest we can get: Trello's largest preview, or the ORIGINAL file when the preview is small and the original is a photo under 8 MB (Abbas 13 Oct: "very blurry")
      var u = (req.big && pv.width < 1600 && /^image\//.test(at.mimeType || '') && (at.bytes || 0) <= 8 * 1024 * 1024 && at.url) ? at.url : pv.url;
      var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true, headers: { Authorization: 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + rtok + '"' } });
      if (r.getResponseCode() !== 200) return out({ ok: false, error: 'photo: Trello said ' + r.getResponseCode() });
      var b64 = Utilities.base64Encode(r.getBlob().getBytes());
      if (b64.length > (req.big ? 12000000 : 2600000)) return out({ ok: false, error: 'photo too big' });
      if (b64.length < 99000) c2.put(ck, b64, 21600);
      return out({ ok: true, b64: b64, type: at.mimeType || 'image/jpeg' });
    }
    // ---- STEP 2 (12 Oct 2026): the card chat = the card's Slack #cutting thread, both ways ----
    var FT = P.getProperty('SLACK_FACTORY_TOKEN');
    if (isXRoom(req.card) && /^(thread|post|up|upurl|seen|later)$/.test(req.op) && !facOwner(req.who)) return out({ ok: false, error: 'only Abbas can see this chat', noaccess: true });
    if (req.op === 'seen') {                                  // 16 Oct 2026: the phone read a chat through the FAST LANE - remember it as seen (no Slack call)
      var sc = isRoom(req.card) || isLaisOrder(req.card) ? req.card : String(req.card || '').replace(/[^0-9a-f]/g, ''), sts = String(req.ts || '');
      if (!sc || !/^\d+\.\d+$/.test(sts)) return out({ ok: false, error: 'bad request' });
      facSeen(P, String(req.who || ''), sc, sts); return out({ ok: true });
    }
    if (req.op === 'fastset') {                               // 16 Oct 2026: the FAST LANE link (Cloudflare worker), pasted in the app - checked before it is kept
      var fu = String(req.url || '').trim().replace(/\/+$/, '');
      if (!fu) { P.deleteProperty('FAC_FAST'); return out({ ok: true, fast: '' }); }
      if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/i.test(fu)) return out({ ok: false, error: 'the link must look like https://sj-fast.NAME.workers.dev' });
      var fr = null; try { fr = JSON.parse(UrlFetchApp.fetch(fu + '/', { muteHttpExceptions: true }).getContentText()); } catch (e) {}
      if (!fr || fr.sj !== 'fast') return out({ ok: false, error: 'that link is not the SJ fast-lane worker (paste the code and press Deploy first)' });
      if (!fr.slack) return out({ ok: false, error: 'the worker has no SLACK_TOKEN secret yet (Settings -> Variables and Secrets)' });
      P.setProperty('FAC_FAST', fu); return out({ ok: true, fast: fu });
    }
    // ---- RETURNS (16 Oct 2026, Abbas: "some pieces get returned to the factory … once the alteration or errors are done I get it back. I need a
    // tracking system in this app"). One record per return (FRT_<n>): design, pieces given, pieces back, reason, who/when for every step.
    // Every step also writes a line into that card's chat (or the Direct chat), so the other side gets the usual new-message alert.
    if (/^ret(list|new|set)$/.test(req.op)) {
      var rwho = String(req.who || '').slice(0, 40) || 'factory';
      if (req.op === 'retlist') return out({ ok: true, rets: facRets(P, true) });
      var rlk = LockService.getScriptLock(); rlk.waitLock(15000);
      try {
        var rr, rline = '';
        if (req.op === 'retnew') {
          var rpcs = Math.floor(+req.pcs || 0); if (!(rpcs > 0 && rpcs < 10000)) return out({ ok: false, error: 'how many pieces?' });
          var rcard = String(req.card || '').replace(/[^0-9a-f]/g, '').slice(0, 24), rn = +(P.getProperty('FRT_N') || 0) + 1; P.setProperty('FRT_N', String(rn));
          rr = { id: rn, card: rcard, no: String(req.no || '').slice(0, 30), title: String(req.title || '').slice(0, 120), pcs: rpcs, back: 0, fixed: 0, why: String(req.why || '').slice(0, 60), col: String(req.col || '').slice(0, 120), note: String(req.note || '').slice(0, 500), by: rwho, at: Date.now(), st: 'out', ev: [[Date.now(), rwho, 'out', rpcs]] };
          rline = '↩️ *RETURN R' + rn + '* · ' + rpcs + ' pcs given back to the factory' + (rr.why ? ' · ' + rr.why : '') + (rr.col ? ' · ' + rr.col : '') + (rr.note ? '\n' + rr.note : '') + '\n_ফেরত R' + rn + ' · ' + rpcs + ' পিস কারখানায় দেওয়া হয়েছে_';
        } else {
          rr = JSON.parse(P.getProperty('FRT_' + Math.floor(+req.id || 0)) || 'null'); if (!rr) return out({ ok: false, error: 'return not found' });
          var left = rr.pcs - rr.back, rcn = Math.floor(+req.n || 0), rnote = String(req.note || '').slice(0, 300);
          if (req.st === 'fixed') { rcn = Math.min(Math.max(rcn || left, 1), left); rr.fixed = Math.min(left, Math.max(rr.fixed || 0, rcn)); if (rr.st === 'out') rr.st = 'fixed'; rr.ev.push([Date.now(), rwho, 'fixed', rcn]);
            rline = '🧵 *R' + rr.id + '* · ' + rcn + ' pcs fixed - ready to send back' + (rnote ? '\n' + rnote : '') + '\n_R' + rr.id + ' · ' + rcn + ' পিস ঠিক করা হয়েছে, ফেরত পাঠানোর জন্য রেডি_'; }
          else if (req.st === 'back') { if (left <= 0) return out({ ok: false, error: 'all pieces are already back' }); rcn = Math.min(Math.max(rcn || left, 1), left); rr.back += rcn; rr.fixed = Math.max(0, (rr.fixed || 0) - rcn); rr.st = rr.back >= rr.pcs ? 'back' : (rr.fixed ? 'fixed' : 'out'); rr.ev.push([Date.now(), rwho, 'back', rcn]); if (rr.st === 'back') rr.done = Date.now();
            rline = '📥 *R' + rr.id + '* · ' + rcn + ' pcs received back' + (rr.st === 'back' ? ' ✅ all ' + rr.pcs + ' back' : ' · ' + (rr.pcs - rr.back) + ' still at the factory') + (rnote ? '\n' + rnote : '') + '\n_R' + rr.id + ' · ' + rcn + ' পিস ফেরত এসেছে_'; }
          else if (req.st === 'note') { if (!rnote) return out({ ok: false, error: 'write the note' }); rr.ev.push([Date.now(), rwho, 'note', 0, rnote]); rline = '📝 *R' + rr.id + '* · ' + rnote; }
          else if (req.st === 'cancel') { rr.st = 'cancel'; rr.done = Date.now(); rr.ev.push([Date.now(), rwho, 'cancel', 0]); rline = '✖️ *R' + rr.id + '* cancelled' + (rnote ? ' · ' + rnote : ''); }
          else return out({ ok: false, error: 'bad request' });
          if (rr.ev.length > 40) rr.ev = rr.ev.slice(-40);
        }
        P.setProperty('FRT_' + rr.id, JSON.stringify(rr));
        var rts = '', rerr = '';
        if (FT) { try {                                         // the line in the chat (card thread, else the Direct chat)
          var rdest = null; if (rr.card) { var rth = facThread(P, FT, rr.card, rtok, true); if (rth) rdest = { channel: rth.ch, thread_ts: rth.ts, key: rr.card }; }
          if (!rdest) { var rdm = facDm(P, FT); if (rdm) rdest = { channel: rdm.ch, key: 'dm' }; }
          if (rdest) { var rpost = { channel: rdest.channel, text: '*' + rwho + ':* ' + (rr.card ? '' : (rr.no ? rr.no + ' · ' : '')) + rline }; if (rdest.thread_ts) rpost.thread_ts = rdest.thread_ts;
            var rj = slackApi(FT, 'chat.postMessage', rpost); if (rj.ok) { rts = rj.ts; try { facSeen(P, rwho, rdest.key, rj.ts); } catch (e) {} facBump(); facNudge(P, rdest.key); } else rerr = rj.error; }
        } catch (e) { rerr = String(e.message || e); } }
        facNudge(P, 'ret:' + rr.id);
        return out({ ok: true, ret: rr, ts: rts, chat: rerr ? 'saved - but the chat line failed: ' + rerr : 'ok', rets: facRets(P, true) });
      } finally { rlk.releaseLock(); }
    }
    if (req.op === 'dmch') {                                  // the channels the bot can see, for the direct-chat picker
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      return out({ ok: true, dm: facDm(P, FT), chans: facChans(FT) });
    }
    if (req.op === 'dmusers') {                               // the people, for "new direct chat with..."
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      return out({ ok: true, users: facUsers(FT) });
    }
    if (req.op === 'dmnew') {                                 // 14 Oct 2026 (Abbas): "make one specific for direct message for mohammod" - a NEW private channel with that person (+ the bot + whoever asked), becomes the direct chat
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var nu = String(req.user || '').replace(/[^A-Z0-9]/g, ''), nwho2 = String(req.who || '').slice(0, 40) || 'factory'; if (!nu) return out({ ok: false, error: 'bad request' });
      var us = facUsers(FT), person = us.filter(function (u) { return u.id === nu; })[0]; if (!person) return out({ ok: false, error: 'no such person' });
      var slug = ('dm-' + String(person.name || person.handle).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 70), cj = null, nm = slug;
      for (var ni = 0; ni < 4; ni++) { cj = slackApi(FT, 'conversations.create', { name: nm, is_private: true }); if (cj.ok || cj.error !== 'name_taken') break; nm = slug + '-' + (ni + 2); }
      if (!cj.ok) return out({ ok: false, error: 'Slack said ' + cj.error + (cj.error === 'missing_scope' ? ' (the factory Slack app needs groups:write, then Reinstall)' : '') });
      var nch = cj.channel.id, invite = [nu], me = nrmName(nwho2), mine = us.filter(function (u) { return u.id !== nu && [u.name, u.handle, u.dn].some(function (x) { x = nrmName(String(x || '').split(/[\s._-]+/)[0]); return x.length >= 2 && me.length >= 2 && (x === me || x.indexOf(me) === 0 || me.indexOf(x) === 0); }); });
      if (mine.length === 1) invite.push(mine[0].id);          // the person who asked, when their sign-in name matches exactly one Slack member
      var ij = slackApi(FT, 'conversations.invite', { channel: nch, users: invite.join(',') }); if (!ij.ok && ij.error !== 'already_in_channel') return out({ ok: false, error: 'made #' + nm + ' but could not invite: Slack said ' + ij.error });
      var dnew2 = { ch: nch, name: nm, user: nu }; P.setProperty('FAC_DM', JSON.stringify(dnew2)); CacheService.getScriptCache().remove('FAC_CHANS');
      try { slackApi(FT, 'chat.postMessage', { channel: nch, text: '→ *DIRECT CHAT* · ' + nwho2 + ' opened this chat with ' + person.name + ' from the factory app' }); } catch (e) {}
      return out({ ok: true, dm: dnew2, invited: invite.length, me: mine.length === 1 ? mine[0].name : '' });
    }
    if (req.op === 'dmset') {                                 // choose (or change) the direct-chat channel; a system line in the channel says who did it
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var dch = String(req.ch || '').replace(/[^A-Z0-9]/g, ''), dwho = String(req.who || '').slice(0, 40) || 'factory'; if (!dch) return out({ ok: false, error: 'bad request' });
      var dpick = facChans(FT).filter(function (c) { return c.id === dch; })[0]; if (!dpick) return out({ ok: false, error: 'no such channel' });
      if (!dpick.member) { var dj = slackApi(FT, 'conversations.join', { channel: dch }); if (!dj.ok) return out({ ok: false, error: 'the factory bot is not in #' + dpick.name + ' - open the channel in Slack and type /invite @SJ Orders, then choose it again' }); CacheService.getScriptCache().remove('FAC_CHANS'); }
      var dnew = { ch: dch, name: dpick.name }; P.setProperty('FAC_DM', JSON.stringify(dnew));
      try { slackApi(FT, 'chat.postMessage', { channel: dch, text: '→ *DIRECT CHAT* · ' + dwho + ' linked this channel to the factory app' }); } catch (e) {}
      return out({ ok: true, dm: dnew });
    }
    if ((req.op === 'thread' || req.op === 'post') && isLaisOrder(req.card)) {   // one #laisfactory order = its Slack thread (SJ Memo bot)
      if (!facLaisOk(P, FT, req.who)) return out({ ok: false, error: 'only Abbas and the people in #laisfactory can see this chat', noaccess: true });
      var LO = facLais(P, FT), LOT = P.getProperty('SLACK_BOT_TOKEN'), lots = String(req.card).slice(1); if (!LO || !LOT) return out({ ok: false, error: '#laisfactory: invite @SJ Memo into the channel in Slack' });
      if (req.op === 'post') { var lt2 = String(req.text || '').slice(0, 3000), lw2 = String(req.who || '').slice(0, 40) || 'factory'; if (!lt2.trim()) return out({ ok: false, error: 'bad request' });
        var lp = slackApi(LOT, 'chat.postMessage', { channel: LO.ch, thread_ts: lots, text: '*' + lw2 + ':* ' + lt2 }); if (!lp.ok) return out({ ok: false, error: 'Slack said ' + lp.error });
        try { facSeen(P, lw2, req.card, lp.ts); } catch (e) {} CacheService.getScriptCache().remove('FAC_LAIST_' + LO.ch); facBump(); return out({ ok: true, ts: lp.ts }); }
      if (req.since && !/^\d+\.\d+$/.test(String(req.since))) req.since = '';
      var lrp = slackApi(LOT, 'conversations.replies', { channel: LO.ch, ts: lots, limit: 200 }, true); if (!lrp.ok) return out({ ok: false, error: 'Slack said ' + lrp.error });
      var lms = (lrp.messages || []).filter(function (m) { return !req.since || +m.ts > +req.since; }), llast = lms.reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, req.since || '0');
      if (req.look !== 0 && +llast > 0) facSeen(P, String(req.who || ''), req.card, llast);
      return out({ ok: true, ch: LO.ch, ts: lots, msgs: lms.map(function (m) { var x = facMsg(P, LOT, m, lots); if (m.ts === lots) x.root = true; return x; }) });
    }
    if (req.op === 'thread' && isRoom(req.card)) {           // the direct chat (or #laisfactory): the channel's messages (oldest first), only those after req.since when given
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' }); var RTt = roomTok(P, req.card, FT);
      if (req.card === 'lais' && !facLaisOk(P, FT, req.who)) return out({ ok: false, error: 'only Abbas and the people in #laisfactory can see this chat', noaccess: true });
      var ddm = facRoom(P, FT, req.card); if (!ddm) return out({ ok: false, error: req.card === 'lais' ? '#laisfactory: invite @SJ Memo into the channel in Slack (/invite @SJ Memo)' : isXRoom(req.card) ? 'no #' + req.card + ' channel the factory bot can see - make it public or /invite @SJ Orders' : 'no direct chat channel chosen yet' });
      if (req.since && !/^\d+\.\d+$/.test(String(req.since))) req.since = '';
      var dms = (req.card === 'lais' ? facLaisTop(P, RTt, ddm, false) : facDmMsgs(P, RTt, ddm, false)).filter(function (m) { return !req.since || +m.ts > +req.since; });
      var dlast = dms.reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, req.since || '0');
      if (req.look !== 0) { if (+dlast > 0) facSeen(P, String(req.who || ''), req.card, dlast); else if (!req.since) facSeen(P, String(req.who || ''), req.card, String(Date.now() / 1000)); }
      return out({ ok: true, ch: ddm.ch, name: ddm.name, msgs: dms.map(function (m) { return facMsg(P, RTt, m, null); }) });
    }
    if (req.op === 'post' && isRoom(req.card)) {             // a line into the direct chat (or #laisfactory)
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      if (req.card === 'lais' && !facLaisOk(P, FT, req.who)) return out({ ok: false, error: 'only Abbas and the people in #laisfactory can write here', noaccess: true });
      var pdm = facRoom(P, FT, req.card), ptx2 = String(req.text || '').slice(0, 3000), pwho2 = String(req.who || '').slice(0, 40) || 'factory';
      if (!pdm) return out({ ok: false, error: 'no direct chat channel chosen yet' }); if (!ptx2.trim()) return out({ ok: false, error: 'bad request' });
      var pj2 = slackApi(roomTok(P, req.card, FT), 'chat.postMessage', { channel: pdm.ch, text: '*' + pwho2 + ':* ' + ptx2 });
      if (!pj2.ok) return out({ ok: false, error: 'Slack said ' + pj2.error + (pj2.error === 'not_in_channel' ? ' (invite the bot to #' + pdm.name + ')' : '') });
      try { facSeen(P, pwho2, req.card, pj2.ts); } catch (e) {} facBump(); facNudge(P, req.card);
      return out({ ok: true, ts: pj2.ts });
    }
    if (req.op === 'thread') {                                // the thread of one card: root + replies (only those after req.since when given)
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var tc = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!tc) return out({ ok: false, error: 'bad request' });
      var th = facThread(P, FT, tc, rtok, !!req.make);
      if (!th) return out({ ok: true, none: true, msgs: [] });
      if (req.since && !/^\d+\.\d+$/.test(String(req.since))) req.since = '';
      if (req.since && !req.force) { try { var hh0 = facHist(P, FT, th.ch, false).filter(function (m) { return m.t === th.ts; })[0]; if (hh0 && !hh0.o && +(hh0.lr || hh0.t) <= +req.since) { if (req.look !== 0) facSeen(P, String(req.who || ''), tc, req.since); return out({ ok: true, ch: th.ch, ts: th.ts, msgs: [] }); } } catch (e) {} }   // nothing new (fresh page only; the phone forces a real read now and then): no Slack call
      var rq = { channel: th.ch, ts: th.ts, limit: 200 }; if (req.since) rq.oldest = String(req.since);
      var rp = slackApi(FT, 'conversations.replies', rq, true);
      if (!rp.ok && rp.error === 'ratelimited') { facSlow(rp); Utilities.sleep(1500); rp = slackApi(FT, 'conversations.replies', rq, true); }
      if (!rp.ok) return out({ ok: false, error: rp.error === 'ratelimited' ? 'Slack is busy - trying again in a few seconds' : 'Slack said ' + rp.error });
      var ms = (rp.messages || []).filter(function (m) { return !req.since || m.ts !== String(req.since); }).map(function (m) { return facMsg(P, FT, m, th.ts); });
      var lastTs = (rp.messages || []).reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, req.since || th.ts);
      if (req.look !== 0) { try { facSeen(P, String(req.who || ''), tc, lastTs); } catch (e) {} }   // seen only when the person is really looking (15 Oct 2026: a chat left open on another phone / in the background used to swallow the alert)
      return out({ ok: true, ch: th.ch, ts: th.ts, msgs: ms });
    }
    if (req.op === 'post') {                                  // a text line from the factory phone into the thread, shown as "*Name:* text"
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var pc = String(req.card || '').replace(/[^0-9a-f]/g, ''), ptx = String(req.text || '').slice(0, 3000), pwho = String(req.who || '').slice(0, 40) || 'factory';
      if (!pc || !ptx.trim()) return out({ ok: false, error: 'bad request' });
      var pth = facThread(P, FT, pc, rtok, true);
      var pj = slackApi(FT, 'chat.postMessage', { channel: pth.ch, thread_ts: pth.ts, text: '*' + pwho + ':* ' + ptx });
      if (!pj.ok) return out({ ok: false, error: 'Slack said ' + pj.error });
      try { facSeen(P, pwho, pc, pj.ts); } catch (e) {} facBump(); facNudge(P, pc);
      return out({ ok: true, ts: pj.ts });
    }
    if (req.op === 'upurl') {                                 // 15 Oct 2026 (Abbas: "don't compress my photos and videos"): the phone sends the ORIGINAL file straight to Slack
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var uf = Array.isArray(req.files) ? req.files.slice(0, 10) : []; if (!uf.length) return out({ ok: false, error: 'bad request' });
      var UUT = isLaisOrder(req.card) ? P.getProperty('SLACK_BOT_TOKEN') : roomTok(P, req.card, FT); var urls = uf.map(function (f) { var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: { Authorization: 'Bearer ' + UUT }, muteHttpExceptions: true,
        payload: { filename: String(f.name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 80), length: String(Math.max(1, +f.size || 1)) } }).getContentText()); if (!a.ok) throw new Error('Slack said ' + a.error); return { id: a.file_id, url: a.upload_url }; });
      return out({ ok: true, urls: urls });
    }
    if (req.op === 'up') {                                    // photos / voice notes / files from the factory phone -> ONE message in the thread (Abbas 13 Oct: "like Slack ... all as one message")
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      if (req.card === 'lais' && !facLaisOk(P, FT, req.who)) return out({ ok: false, error: 'only Abbas and the people in #laisfactory can write here', noaccess: true });
      var ULO = isLaisOrder(req.card); if (ULO && !facLaisOk(P, FT, req.who)) return out({ ok: false, error: 'only Abbas and the people in #laisfactory can write here', noaccess: true });
      var UT = ULO ? P.getProperty('SLACK_BOT_TOKEN') : roomTok(P, req.card, FT), udm = ULO ? facLais(P, FT) : isRoom(req.card) ? facRoom(P, FT, req.card) : null, uc = udm ? req.card : String(req.card || '').replace(/[^0-9a-f]/g, ''), uwho = String(req.who || '').slice(0, 40) || 'factory';
      var ufs = Array.isArray(req.files) ? req.files : (req.b64 ? [{ name: req.name, b64: req.b64 }] : []), pre = Array.isArray(req.fids) ? req.fids.map(function (x) { return String(x).replace(/[^A-Z0-9]/g, ''); }).filter(String).slice(0, 10) : [];
      if (isRoom(req.card) && !udm) return out({ ok: false, error: 'no direct chat channel chosen yet' });
      if (!uc || (!ufs.length && !pre.length) || ufs.length + pre.length > 10) return out({ ok: false, error: 'bad request' });
      if (pre.length && Array.isArray(req.sizes)) {           // the phone uploaded straight to Slack: make sure every byte arrived before the message is posted
        for (var vi = 0; vi < pre.length; vi++) { var vf = slackApi(UT, 'files.info', { file: pre[vi] }, true), vs = vf.ok ? +((vf.file || {}).size || 0) : -1, want = +req.sizes[vi] || 0;
          if (vf.ok && vs > 0 && want > 0 && vs !== want) return out({ ok: false, error: 'upload incomplete (' + vs + ' of ' + want + ' bytes)', retry: true }); } }
      var uth = udm ? { ch: udm.ch, ts: ULO ? String(req.card).slice(1) : '' } : facThread(P, FT, uc, rtok, true), fids = pre.slice(), tot = 0;
      for (var ui = 0; ui < ufs.length; ui++) {
        var un = String(ufs[ui].name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 60), ub = Utilities.base64Decode(String(ufs[ui].b64 || ''));
        tot += ub.length; if (ub.length > 18 * 1024 * 1024 || tot > 40 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 18 MB each, 40 MB together)' });
        fids.push(slackUp(UT, un, ub));
      }
      var utext = '*' + uwho + ':* ' + (req.text ? String(req.text).slice(0, 3000) : (req.labels || []).concat(ufs.map(function (f) { return f.name; })).map(function (f) { f = { name: String(f || '') }; var n = String(f.name || ''); return /^voice/i.test(n) ? '🎤 voice note' : /\.(jpe?g|png|webp|heic)$/i.test(n) ? '📷 photo' : /\.(mp4|mov|webm)$/i.test(n) ? '🎬 video' : '📎 ' + n; }).join(' · '));
      var uj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + UT }, muteHttpExceptions: true,
        payload: uth.ts ? { files: JSON.stringify(fids.map(function (f) { return { id: f }; })), channel_id: uth.ch, thread_ts: uth.ts, initial_comment: utext } : { files: JSON.stringify(fids.map(function (f) { return { id: f }; })), channel_id: uth.ch, initial_comment: utext } }).getContentText());
      if (!uj.ok) return out({ ok: false, error: 'Slack said ' + uj.error });
      try { facSeen(P, uwho, uc, String(Date.now() / 1000)); } catch (e) {} facBump(); facNudge(P, uc);
      return out({ ok: true, fids: fids });
    }
    if (req.op === 'media') {                                 // one Slack file for the phone (photo preview, voice note, video), through the bot token
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var mf = String(req.file || '').replace(/[^A-Z0-9]/g, ''); if (!mf) return out({ ok: false, error: 'bad request' });
      var md = facMedia(FT, mf, !!req.full); if (!md.ok && /not_found|invalid/.test(md.error || '') && P.getProperty('SLACK_BOT_TOKEN')) md = facMedia(P.getProperty('SLACK_BOT_TOKEN'), mf, !!req.full);   // a #laisfactory (SJTC) file
      return out(md);
    }
    if (req.op === 'setpw') {                                 // 13 Oct 2026: the factory password is set from the order memo (owner key-check), not the read-only settings page
      if (!ownerOk(P, req.chk)) return out({ ok: false, error: 'owner password does not match' });
      var npw = String(req.pw || ''); if (npw.length < 4) return out({ ok: false, error: 'password too short' });
      P.setProperty('FACTORY_PASSWORD', npw); return out({ ok: true });
    }
    if (req.op === 'tglink') {                                // the factory phone asks for a 6-letter code to send to the Telegram bot
      if (!P.getProperty('TG_FACTORY_TOKEN')) return out({ ok: false, error: 'Telegram is not set up yet (TG_FACTORY_TOKEN)' });
      var dev = String(req.dev || '').replace(/[^a-z0-9]/g, '').slice(0, 12), who2 = String(req.who || '').slice(0, 40); if (!dev) return out({ ok: false, error: 'bad request' });
      var have2 = P.getProperty('TG_FAC_' + dev); if (have2 && !req.again) return out({ ok: true, linked: true });
      var code = ''; for (var ci = 0; ci < 6; ci++) code += 'ABCDEFGHJKLMNPQRSTUVWXYZ'.charAt(Math.floor(Math.random() * 24));
      P.setProperty('TG_CODE_' + code, JSON.stringify({ dev: dev, who: who2, t: Date.now() }));
      var me = tgApi(P, 'getMe', {}); return out({ ok: true, code: code, bot: me.ok ? me.result.username : '' });
    }
    if (req.op === 'tgcheck') {                               // has the code been sent to the bot yet? (reads the bot's new messages)
      var dv = String(req.dev || '').replace(/[^a-z0-9]/g, '').slice(0, 12); facTgPoll(P);
      return out({ ok: true, linked: !!P.getProperty('TG_FAC_' + dv) });
    }
    if (req.op === 'atts') {                                  // all attachments of a card (Abbas 13 Oct: the cover stays; show the other attachments too)
      var ac2 = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!ac2) return out({ ok: false, error: 'bad request' });
      var acd = trApi('get', '/cards/' + ac2, { fields: 'idAttachmentCover,desc' }, rtok), cv = acd.idAttachmentCover || '';
      var al = trApi('get', '/cards/' + ac2 + '/attachments', { fields: 'id,name,mimeType,previews,url,bytes,date' }, rtok) || [];
      return out({ ok: true, cover: cv, desc: String(acd.desc || ''), atts: al.map(function (a) { return { id: a.id, name: a.name, type: a.mimeType || '', img: !!(a.previews && a.previews.length), url: a.url, bytes: a.bytes || 0, date: a.date }; }) });
    }
    if (req.op === 'attach') {                                // 13 Oct 2026 (Abbas): "add a photo on trello attachment" - photos from the phone go onto the real Trello card
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var xc = String(req.card || '').replace(/[^0-9a-f]/g, ''), xwho = String(req.who || '').slice(0, 40) || 'factory';
      var xfs = Array.isArray(req.files) ? req.files : []; if (!xc || !xfs.length || xfs.length > 10) return out({ ok: false, error: 'bad request' });
      var xcard = trApi('get', '/cards/' + xc, { fields: 'idBoard,idAttachmentCover' }, wtok); if (xcard.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      var added = [], noCover = !xcard.idAttachmentCover;
      for (var xi = 0; xi < xfs.length; xi++) {
        var xn = String(xfs[xi].name || 'photo.jpg').replace(/[^\w.\-]/g, '_').slice(0, 60), xb = Utilities.base64Decode(String(xfs[xi].b64 || ''));
        if (xb.length > 10 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 10 MB)' });
        var xr = UrlFetchApp.fetch('https://api.trello.com/1/cards/' + xc + '/attachments?key=' + TKEY + '&token=' + wtok, { method: 'post', muteHttpExceptions: true,
          payload: { file: Utilities.newBlob(xb, String(xfs[xi].type || 'image/jpeg'), xn), name: xn, setCover: (noCover && xi === 0 && !!req.cover) ? 'true' : 'false' } });
        if (xr.getResponseCode() >= 300) return out({ ok: false, error: 'Trello said ' + xr.getResponseCode() + ': ' + xr.getContentText().slice(0, 100) });
        var xj = JSON.parse(xr.getContentText()); added.push(xj.id);
      }
      try { if (FT) { var xth = facThread(P, FT, xc, rtok, true); slackApi(FT, 'chat.postMessage', { channel: xth.ch, thread_ts: xth.ts, text: '→ *TRELLO* · ' + xwho + ' added ' + added.length + (added.length === 1 ? ' photo' : ' photos') + ' to the card' }); } } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST');
      return out({ ok: true, ids: added });
    }
    if (req.op === 'sample') {                                // 13 Oct 2026 (Abbas): ⭐ NEW SAMPLE - a card on SAMPLES + the details (photos / videos / voice notes) posted in #samples-discuss, which becomes the card's chat
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var sname = String(req.name || '').trim().slice(0, 500), sdesc = String(req.desc || '').slice(0, 16000), swho = String(req.who || '').slice(0, 40) || 'factory';
      var sfs = Array.isArray(req.files) ? req.files : []; if (!sname || sfs.length > 10) return out({ ok: false, error: 'bad request' });
      var SRET = req.kind === 'ret', srl = SRET ? facRetLists(P, wtok, 2) : null; if (SRET && !srl) return out({ ok: false, error: 'could not make the RETURNS list on Trello' });
      var SUSM = !SRET && !!req.usman, SUP = null;   // 18 Oct 2026 (Abbas): tick "USMAN hand work" on a NEW SAMPLE -> its chat is made in the #usman sample channel, not #samples-discuss
      if (SUSM) { try { SUP = facUsmSampleCh(P, FT); } catch (e) { return out({ ok: false, error: e.message }); } if (!SUP) return out({ ok: false, error: 'no Usman samples channel found in Slack - make one (e.g. #usman-samples) and /invite @SJ Orders into it' }); }
      var SCH = SRET ? DOX.CUTTING : SUSM ? SUP.ch : FAC.SAMPLES_CH, SLIST = SRET ? srl.ret : FAC.LISTS[0][1], SCHN = SRET ? '#cutting' : SUSM ? '#' + SUP.name : '#samples-discuss';
      var scard2 = trApi('post', '/cards', { idList: SLIST, name: sname, desc: sdesc, pos: 'top' }, wtok);
      // Abbas 13 Oct: the Trello card gets ONLY a cover - the first photo, or a frame of the video (made on the phone) - everything else goes to Slack only
      var satt = 0; if (req.cover && req.cover.b64) { try {
        var cb = Utilities.base64Decode(String(req.cover.b64)), cn = String(req.cover.name || 'cover.jpg').replace(/[^\w.\-]/g, '_').slice(0, 60);
        if (cb.length <= DOX.TRELLO_MAX) { var xr2 = UrlFetchApp.fetch('https://api.trello.com/1/cards/' + scard2.id + '/attachments?key=' + TKEY + '&token=' + wtok, { method: 'post', muteHttpExceptions: true,
          payload: { file: Utilities.newBlob(cb, 'image/jpeg', cn), name: cn, setCover: 'true' } }); if (xr2.getResponseCode() < 300) satt = 1; } } catch (e) {} }
      var sids = (Array.isArray(req.fids) ? req.fids : []).map(function (x) { return String(x).replace(/[^A-Z0-9]/g, ''); }).filter(String).slice(0, 10), stot = 0;   // originals already sent to Slack by the phone
      for (var si = 0; si < sfs.length; si++) {
        var sn = String(sfs[si].name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 60), sb = Utilities.base64Decode(String(sfs[si].b64 || ''));
        stot += sb.length; if (sb.length > 18 * 1024 * 1024 || stot > 40 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 18 MB each, 40 MB together)' });
        sids.push(slackUp(FT, sn, sb));
      }
      var stext = (SRET ? '↩️ *RETURN* · pieces given back to the factory' + (sdesc ? '\n' + sdesc : '') + '\n_ফেরত - ঠিক করে ফেরত দিন_' : '⭐ *SAMPLE* · ' + sname + (SUSM ? '\n🧵 USMAN hand work' : '') + (sdesc ? '\n' + sdesc : '')) + '\n' + scard2.shortUrl + '\n_' + swho + ' · factory app_', sts = '';
      if (sids.length) {
        var sj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + FT }, muteHttpExceptions: true,
          payload: { files: JSON.stringify(sids.map(function (f) { return { id: f }; })), channel_id: SCH, initial_comment: stext } }).getContentText());
        if (!sj.ok) return out({ ok: false, error: 'Slack said ' + sj.error + (sj.error === 'not_in_channel' ? ' (invite the factory bot to ' + SCHN + ')' : ''), card: scard2.id, list: SLIST });
        try { var sh = (sj.files || [])[0].shares || {}, grp = sh.public || sh.private || {}, arr = grp[SCH] || []; sts = arr.length ? arr[0].ts : ''; } catch (e) {}
        if (!sts) { Utilities.sleep(1200); var sh2 = slackApi(FT, 'conversations.history', { channel: SCH, limit: 20 }, true); var hit2 = (sh2.messages || []).filter(function (m) { return String(m.text || '').indexOf(scard2.shortUrl) >= 0; })[0]; if (hit2) sts = hit2.ts; }
      } else {
        var sp = slackApi(FT, 'chat.postMessage', { channel: SCH, text: stext }); if (!sp.ok) return out({ ok: false, error: 'Slack said ' + sp.error + (sp.error === 'not_in_channel' ? ' (invite the factory bot to ' + SCHN + ')' : ''), card: scard2.id, list: SLIST }); sts = sp.ts;
      }
      if (sts) P.setProperty('FTH_' + scard2.id, JSON.stringify({ ch: SCH, ts: sts }));       // that post IS the card's chat from now on
      try { trApi('post', '/cards/' + scard2.id + '/actions/comments', { text: (SRET ? '↩️ Return · ' : '⭐ Sample · ') + swho + ' (factory app) · posted in ' + SCHN }, wtok); } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facBump();
      if (SRET) facNudge(P, 'list:' + scard2.id);
      return out({ ok: true, id: scard2.id, url: scard2.shortUrl, files: sids.length, att: satt, list: SLIST });
    }
    if (req.op === 'later') {                                 // pin / unpin a card on this person's LATER list (per person, shared by all their phones)
      var lc = isRoom(req.card) || isLaisOrder(req.card) ? req.card : String(req.card || '').replace(/[^0-9a-f]/g, ''), lwho = String(req.who || '').trim().toUpperCase().slice(0, 40); if (!lc || !lwho) return out({ ok: false, error: 'bad request' });
      var lk = 'FLATER_' + lwho, lrec = JSON.parse(P.getProperty(lk) || '{}');
      if (req.on) lrec[lc] = String(Date.now()); else delete lrec[lc];
      var lks = Object.keys(lrec); if (lks.length > 200) lks.sort(function (a, b) { return +lrec[a] - +lrec[b]; }).slice(0, lks.length - 200).forEach(function (k) { delete lrec[k]; });
      P.setProperty(lk, JSON.stringify(lrec)); return out({ ok: true, later: lrec });
    }
    if (req.op === 'edit') {                                  // 13 Oct 2026 (Abbas): "let me edit the description of the trello card" (title too)
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var ec = String(req.card || '').replace(/[^0-9a-f]/g, ''), ewho = String(req.who || '').slice(0, 40) || 'factory', eset = {};
      if (!ec) return out({ ok: false, error: 'bad request' });
      if (req.desc != null) eset.desc = String(req.desc).slice(0, 16000);
      if (req.name != null && String(req.name).trim()) eset.name = String(req.name).trim().slice(0, 500);
      if (!Object.keys(eset).length) return out({ ok: false, error: 'nothing to change' });
      var ecard = trApi('get', '/cards/' + ec, { fields: 'idBoard' }, wtok); if (ecard.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      trApi('put', '/cards/' + ec, eset, wtok);
      try { if (FT) { var eth = facThread(P, FT, ec, rtok, true); slackApi(FT, 'chat.postMessage', { channel: eth.ch, thread_ts: eth.ts, text: '→ *EDIT* · ' + ewho + ' changed the ' + Object.keys(eset).map(function (k) { return k === 'desc' ? 'description' : 'title'; }).join(' and ') }); } } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST');
      return out({ ok: true });
    }
    if (req.op === 'copy' || req.op === 'add') {              // 13 Oct 2026 (Abbas): "copying the card and adding a new card" - a real Trello card, top of the chosen list
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var nto = String(req.to || ''), nname = String(req.name || '').trim().slice(0, 500), nwho = String(req.who || '').slice(0, 40) || 'factory';
      if (ids.indexOf(nto) < 0 || !nname) return out({ ok: false, error: 'bad request' });
      var nbody = { idList: nto, name: nname, pos: 'top' };
      if (req.desc != null) nbody.desc = String(req.desc).slice(0, 16000);
      if (req.op === 'copy') {
        var sc = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!sc) return out({ ok: false, error: 'bad request' });
        var scard = trApi('get', '/cards/' + sc, { fields: 'idBoard,shortUrl' }, wtok); if (scard.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
        nbody.idCardSource = sc; nbody.keepFromSource = req.keep === 'none' ? 'none' : (req.keep || 'attachments,labels,customFields,checklists,stickers');
      }
      var ncard = trApi('post', '/cards', nbody, wtok);
      var ln2 = FAC.LISTS.filter(function (l) { return l[1] === nto; })[0];
      try { trApi('post', '/cards/' + ncard.id + '/actions/comments', { text: (req.op === 'copy' ? 'Copied from ' + scard.shortUrl : 'Added') + ' · ' + nwho + ' (factory app)' }, wtok); } catch (e) {}
      if (req.op === 'add' && req.usman && FT) try {   // 18 Oct 2026 (Abbas): ticked "USMAN hand work" -> the card's chat is made in #usmancutting, not #cutting
        var nup = slackApi(FT, 'chat.postMessage', { channel: DOX.USMANCUT, text: '🧵 ' + nname + '\n🧵 USMAN hand work\n' + ncard.shortUrl + '\n_card chat · factory app_' });
        if (nup.ok) P.setProperty('FTH_' + ncard.id, JSON.stringify({ ch: DOX.USMANCUT, ts: nup.ts })); } catch (e) {}
      try { if (FT) { var nth = facThread(P, FT, ncard.id, rtok, true); slackApi(FT, 'chat.postMessage', { channel: nth.ch, thread_ts: nth.ts, text: '→ *' + (ln2 ? ln2[0] : 'NEW') + '* · ' + nwho + (req.op === 'copy' ? ' copied this card from ' + scard.shortUrl : ' added this card') + ' · 🕒 ' + facWhen(Date.now()) }); } } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST');
      return out({ ok: true, id: ncard.id, url: ncard.shortUrl });
    }
    if (req.op === 'move') {                                  // "Done -> next stage" (or Move to...): the real Trello card moves, top of the new list
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var card = String(req.card || '').replace(/[^0-9a-f]/g, ''), to = String(req.to || ''), who = String(req.who || '').slice(0, 40) || 'factory';
      if (!card || ids.indexOf(to) < 0) return out({ ok: false, error: 'bad request' });
      var now = trApi('get', '/cards/' + card, { fields: 'idList,name,idBoard' }, wtok);
      if (now.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      if (req.from && now.idList !== req.from && now.idList !== to) {   // someone moved it meanwhile: say where it is, do nothing (already at "to" = a retry after a lost answer: fine)
        var nm = FAC.LISTS.filter(function (l) { return l[1] === now.idList; })[0];
        return out({ ok: false, moved: true, error: 'This card was already moved to ' + (nm ? nm[0] : 'another list') + ' - press ↻ to refresh' });
      }
      if (now.idList !== to) {
        trApi('put', '/cards/' + card, { idList: to, pos: 'top' }, wtok);
        var tn = FAC.LISTS.filter(function (l) { return l[1] === to; })[0][0];
        try { trApi('post', '/cards/' + card + '/actions/comments', { text: '→ ' + tn + ' · ' + who + ' (factory app)' }, wtok); } catch (e) {}
        try { var mth = P.getProperty('FTH_' + card); if (mth && FT) { mth = JSON.parse(mth); slackApi(FT, 'chat.postMessage', { channel: mth.ch, thread_ts: mth.ts, text: '→ *' + tn + '* · ' + who + ' · 🕒 ' + facWhen(Date.now()) }); } } catch (e) {}
      }
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facNudge(P, 'list:' + card);
      if (/^(FINISH|FINISH SAMPLES)$/.test(FAC.LISTS.filter(function (l) { return l[1] === to; })[0][0])) { try { facReport(P, wtok, FT, card, false, who); } catch (e) {} }   // 21 Oct 2026: the production report
      return out({ ok: true });
    }
    if (req.op === 'work') {                                  // 21 Oct 2026: the workers and their batches on this card (from the Trello comments)
      var wc = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!wc) return out({ ok: false, error: 'bad request' });
      var wcache = CacheService.getScriptCache(), wh = req.fresh ? null : wcache.get('FAC_WK_' + wc), wnames = facWorkers(P, rtok).map(function (w) { return w.name; });   // the list of names is never from the cache (it can be edited any time)
      if (wh) { var wh0 = JSON.parse(wh); wh0.workers = wnames; wh0.roles = facRoles(P, rtok); return out(wh0); }
      var wacts = facActs(rtok, wc), wres = { ok: true, workers: wnames, roles: facRoles(P, rtok), batches: facWkParse(wacts), sheet: facSheetParse(wacts), hours: [WORK_FROM, WORK_TO] };   // 22 Oct 2026: + the card sheet (cut / rejected / packed …)
      Object.keys(wres.batches).forEach(function (w) { wres.batches[w].forEach(function (b) { var wm = facWorkMs(b.in, b.out || Date.now()); b.wd = facWorkDur(wm); if (b.out) b.rate = facRate(b.d, wm); }); });
      try { wcache.put('FAC_WK_' + wc, JSON.stringify(wres), 30); } catch (e) {} return out(wres);
    }
    if (req.op === 'workers') {                               // 21 Oct 2026: the list of machine workers, changed from the app (More → Workers → Edit)
      var wn = Array.isArray(req.names) ? req.names.map(function (x) { return String(x || '').replace(/[^\w .'()\-\u0980-\u09ff]/g, '').trim().slice(0, 44); }).filter(Boolean) : null;   // "Name (role)" allowed
      if (!wn || !wn.length || wn.length > 40) return out({ ok: false, error: 'give 1 to 40 names' });
      var wseen = {}; wn = wn.filter(function (x) { var k = facWorkerSplit(x).name.toUpperCase(); if (!k || wseen[k]) return false; wseen[k] = 1; return true; });
      P.setProperty('FAC_WORKERS', JSON.stringify(wn)); P.setProperty('FAC_WORKERS_V', '2'); bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); CacheService.getScriptCache().removeAll(['FAC_WKR_7', 'FAC_WKR_30', 'FAC_WKR_90']);
      return out({ ok: true, workers: facWorkers(P, rtok).map(function (w) { return w.name; }), roles: facRoles(P, rtok) });
    }
    if (req.op === 'workset') {                               // 21 Oct 2026: pieces given to a worker (kind 'in') / pieces back from them (kind 'out')
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var kc = String(req.card || '').replace(/[^0-9a-f]/g, ''), kw = String(req.worker || '').trim().toUpperCase().slice(0, 40), kp = Math.floor(+req.pcs || 0), kk = req.kind === 'out' ? 'OUT' : req.kind === 'part' ? 'PART' : 'IN', kwho = String(req.who || '').slice(0, 40) || 'factory';
      var kW = facWorkers(P, rtok).filter(function (w) { return w.name.toUpperCase() === kw; })[0]; if (!kc || !kW || !((kp > 0 || (kk === 'OUT' && kp === 0)) && kp < 100000)) return out({ ok: false, error: 'bad request' });
      var kcard = trApi('get', '/cards/' + kc, { fields: 'idBoard,name' }, wtok); if (kcard.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      var kacts = facActs(rtok, kc), kb = facWkParse(kacts)[kW.name.toUpperCase()] || [], kopen = kb.filter(function (b) { return !b.out; });
      if (kk !== 'IN' && !kopen.length) return out({ ok: false, error: kW.name + ' has no pieces in hand on this card' });
      var kpd = kopen.length ? (kopen[0].pd || 0) : 0, krem = kopen.length ? kopen[0].g - kpd : 0, kd = kk === 'OUT' ? kpd + kp : 0;   // kd = the batch's total done when it closes
      if (kk === 'PART' && !(kp < krem)) return out({ ok: false, error: 'part done must be less than the ' + krem + ' pcs in hand - use All done' });
      if (kk === 'OUT' && kp === 0 && !kpd) return out({ ok: false, error: 'how many pieces came back?' });
      var kdur = kk === 'OUT' ? facDur(Date.now() - kopen[0].in) : '', kwms = kk === 'OUT' ? facWorkMs(kopen[0].in, Date.now()) : 0;
      trApi('post', '/cards/' + kc + '/actions/comments', { text: '👷 ' + kk + ' · ' + kW.name + ' · ' + kp + ' pcs' + (kdur ? ' · ' + kdur : '') + ' · ' + kwho + ' (factory app) · ' + facWhen(Date.now()) + (kk === 'OUT' ? ' · got ' + facWhen(kopen[0].in) + ' · ' + facWorkDur(kwms) + (kpd ? ' · total ' + kd + ' pcs' : '') + ' · ≈' + facRate(kd, kwms) + '/day' : kk === 'PART' ? ' · ' + (krem - kp) + ' pcs still in hand' : '') }, wtok);
      var ktot = kb.reduce(function (a, b) { return a + (b.out ? b.d : (b.pd || 0)); }, 0) + kp;   // done on this card so far, this delivery included
      facWkField(wtok, kc, kW, kk === 'IN' ? (ktot - kp ? (ktot - kp) + ' ✓ + ' : '') + (krem + kp) + ' ⏳' : kk === 'PART' ? ktot + ' ✓ + ' + (krem - kp) + ' ⏳' : ktot + ' ✓');
      // 21 Oct 2026 (Abbas: "mention the time - when the worker got the work, when we pressed Done, how much time he took - flawless and detailed")
      var know = Date.now(), kgot = kk === 'OUT' ? kopen[0] : null;
      var kline = kk === 'IN'
        ? '👷 *' + kW.name + '* ← *' + kp + ' pcs* given · 🕒 ' + facWhen(know) + (kopen.length ? ' · now *' + (krem + kp) + ' pcs* in hand (first ' + kopen[0].g + ' on ' + facWhen(kopen[0].in) + ')' : '') + '\n_' + kW.name + ' · ' + kp + ' পিস দেওয়া হয়েছে · ' + facWhen(know) + '_'
        : kk === 'PART'
        ? '👷 *' + kW.name + '* ✓ *' + kp + ' pcs* done (part) · *' + (krem - kp) + ' pcs* still in hand · ' + (kpd + kp) + ' of ' + kopen[0].g + ' done so far · 🕒 ' + facWhen(know) + ' · got ' + facWhen(kopen[0].in) + '\n_' + kW.name + ' · ' + kp + ' পিস হয়ে গেছে · ' + (krem - kp) + ' পিস এখনো হাতে_'
        : '👷 *' + kW.name + '* ✓ *' + kd + ' pcs* done' + (kpd ? ' (' + kp + ' now + ' + kpd + ' before)' : '') + (kd !== kgot.g ? ' of ' + kgot.g + ' given' : '') + '\n🕒 got ' + facWhen(kgot.in) + (kgot.addT ? kgot.addT.map(function (t, i) { return ' (+' + kgot.adds[i] + ' on ' + facWhen(t) + ')'; }).join('') : '') + ' → back ' + facWhen(know) + '\n⏱ ' + kdur + ' on the clock · ' + facWorkDur(kwms) + ' (8 am – 10 pm, breaks off' + (kwms !== know - kgot.in ? ', Fri 8 – 12' : '') + ') · *≈ ' + facRate(kd, kwms) + ' pcs / day*\n_' + kW.name + ' · ' + kd + ' পিস হয়ে গেছে · ' + facWorkDur(kwms) + ' · দিনে ≈ ' + facRate(kd, kwms) + ' পিস_';
      try { if (FT) { var kth = facThread(P, FT, kc, rtok, true); if (kth) slackApi(FT, 'chat.postMessage', { channel: kth.ch, thread_ts: kth.ts, text: '→ *WORK* · ' + kwho + ' · ' + kline }); } } catch (e) {}
      CacheService.getScriptCache().remove('FAC_WK_' + kc); CacheService.getScriptCache().removeAll(['FAC_WKR_7', 'FAC_WKR_30', 'FAC_WKR_90']); bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facBump(); facNudge(P, kc);
      return out({ ok: true });
    }
    if (req.op === 'workrep') {                               // 21 Oct 2026: every worker's output over the last N days + what each one has IN HAND right now (from the board's comments)
      var rdays = Math.min(120, Math.max(1, Math.floor(+req.days || 30))), rcache = CacheService.getScriptCache(), rk = 'FAC_WKR_' + rdays, rh = req.fresh ? null : rcache.get(rk); if (rh) return out(JSON.parse(rh));
      var rout = facWorkRep(P, rtok, rdays);
      try { rcache.put(rk, JSON.stringify(rout), 60); } catch (e) {} return out(rout);
    }
    if (req.op === 'sheetset') {                              // 22 Oct 2026: the card sheet - cut / rejected / packed / hand work out-in / first piece OK / due date
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var sc0 = String(req.card || '').replace(/[^0-9a-f]/g, ''), sk = String(req.kind || ''), swho = String(req.who || '').slice(0, 40) || 'factory', snow = Date.now();
      if (!sc0 || !(SH_KINDS[sk] || sk === 'due')) return out({ ok: false, error: 'bad request' });
      var scard = trApi('get', '/cards/' + sc0, { fields: 'idBoard,name,due' }, wtok); if (scard.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      var sdue = scard.due ? String(scard.due).slice(0, 10) : '', sline;
      if (sk === 'due') { var sd = String(req.due || ''); if (sd && !/^\d{4}-\d\d-\d\d$/.test(sd)) return out({ ok: false, error: 'bad request' });
        trApi('put', '/cards/' + sc0, {}, wtok, { due: sd ? sd + 'T18:00:00.000Z' : null }); sdue = sd;
        trApi('post', '/cards/' + sc0 + '/actions/comments', { text: '📋 DUE · ' + (sd || 'none') + ' · ' + swho + ' (factory app) · ' + facWhen(snow) }, wtok);
        sline = sd ? '📅 *Due ' + facDay(Date.parse(sd + 'T12:00:00Z')) + '* · ডেলিভারি তারিখ' : '📅 Due date removed · তারিখ মুছে ফেলা হয়েছে'; }
      else { var sn = sk === 'first' ? 1 : Math.floor(+req.pcs || 0); if (!(sn >= 0 && sn < 100000)) return out({ ok: false, error: 'bad request' });
        trApi('post', '/cards/' + sc0 + '/actions/comments', { text: '📋 ' + SH_KINDS[sk] + ' · ' + sn + ' pcs · ' + swho + ' (factory app) · ' + facWhen(snow) }, wtok);
        sline = SH_LABEL[sk][0] + (sk === 'first' ? '' : ' *' + sn + ' pcs*') + ' · ' + SH_LABEL[sk][1] + (sk === 'first' ? '' : ' ' + sn + ' পিস'); }
      try { if (FT) { var sth = facThread(P, FT, sc0, rtok, true); if (sth) slackApi(FT, 'chat.postMessage', { channel: sth.ch, thread_ts: sth.ts, text: '→ *SHEET* · ' + swho + ' · ' + sline + ' · 🕒 ' + facWhen(snow) }); } } catch (e) {}
      CacheService.getScriptCache().remove('FAC_WK_' + sc0); CacheService.getScriptCache().removeAll(['FAC_WKR_7', 'FAC_WKR_30', 'FAC_WKR_90', 'FAC_LATE']); bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facBump(); facNudge(P, sc0);
      return out({ ok: true, due: sdue, sheet: facSheetParse(facActs(rtok, sc0)) });
    }
    if (req.op === 'att') {                                   // 22 Oct 2026: attendance of one day (+ the week), for the Factory screen
      var ad = /^\d{4}-\d\d-\d\d$/.test(String(req.day || '')) ? String(req.day) : facYmd(Date.now());
      return out({ ok: true, day: ad, today: facYmd(Date.now()), att: facAtt(P, ad), week: facAttWeek(P), workers: facWorkers(P, rtok).map(function (w) { return w.name; }), roles: facRoles(P, rtok) });
    }
    if (req.op === 'attset') {                                // 22 Oct 2026: the clock - kind in / out / absent / present / clear, one worker; 'at' = "HH:MM" to correct a time (Abbas only)
      var ad2 = /^\d{4}-\d\d-\d\d$/.test(String(req.day || '')) ? String(req.day) : facYmd(Date.now()), cur = facAtt(P, ad2), an = String(req.name || '').trim().toUpperCase().slice(0, 30), ak = String(req.kind || ''), anow = Date.now();
      if (ad2 > facYmd(anow)) return out({ ok: false, error: 'not a future day' });
      if (req.att && typeof req.att === 'object' && !an) { Object.keys(req.att).slice(0, 60).forEach(function (n) { var k = String(n).trim().toUpperCase().slice(0, 30); if (!k) return; var v = req.att[n]; if (v === 1) cur[k] = { p: 1 }; else if (v === 0) cur[k] = { a: 1 }; else delete cur[k]; }); }   // the first version's ✓ / ✗ marks
      else { if (!an || !/^(in|out|absent|present|clear)$/.test(ak)) return out({ ok: false, error: 'bad request' });
        var at = req.at ? facAtMs(ad2, req.at) : 0; if (req.at && (!at || !facOwner(req.who))) return out({ ok: false, error: req.at && !at ? 'time must be HH:MM' : 'only Abbas can change a time', noaccess: !at ? false : true });
        if (ad2 !== facYmd(anow) && !at && ak !== 'absent' && ak !== 'present' && ak !== 'clear') return out({ ok: false, error: 'for an earlier day type the time (HH:MM)' });
        var r = cur[an] && !cur[an].a ? cur[an] : {}, sh = facShift(ad2);
        if (ak === 'in') { r = { in: at || anow }; var lm = Math.floor((r.in - sh.start) / 60000); if (lm > ATT_GRACE_MIN) r.late = lm; if (cur[an] && cur[an].out) r.out = cur[an].out; cur[an] = r; }
        else if (ak === 'out') { if (!r.in) return out({ ok: false, error: 'press In first' }); r.out = at || anow; if (r.out < r.in) return out({ ok: false, error: 'out before in' }); cur[an] = r; }
        else if (ak === 'absent') cur[an] = { a: 1 }; else if (ak === 'present') cur[an] = { p: 1 }; else delete cur[an]; }
      P.setProperty('FAC_ATT_' + ad2, JSON.stringify(cur)); CacheService.getScriptCache().removeAll(['FAC_WKR_7', 'FAC_WKR_30', 'FAC_WKR_90']);
      return out({ ok: true, day: ad2, att: cur });
    }
    if (req.op === 'attmonth') {                              // 22 Oct 2026: the month - days, late, hours per worker (+ salaries and the pay estimate for Abbas)
      var ym = /^\d{4}-\d\d$/.test(String(req.ym || '')) ? String(req.ym) : facYmd(Date.now()).slice(0, 7), mres = facAttMonth(P, ym, facWorkers(P, rtok).map(function (w) { return w.name; }));
      if (facOwner(req.who)) mres.sal = facSal(P); return out(mres);
    }
    if (req.op === 'sal' || req.op === 'salset') {            // 22 Oct 2026: monthly salaries - Abbas only (pay = salary − absent days × salary / 30, shown on his phone)
      if (!facOwner(req.who)) return out({ ok: false, error: 'only Abbas can see the salaries', noaccess: true });
      if (req.op === 'salset') { var ss = {}, sin = req.sal && typeof req.sal === 'object' ? req.sal : {}; Object.keys(sin).slice(0, 60).forEach(function (n) { var k = String(n).trim().toUpperCase().slice(0, 30), v = +sin[n]; if (k && v > 0 && v < 10000000) ss[k] = Math.round(v); }); P.setProperty('FAC_SAL', JSON.stringify(ss)); }
      return out({ ok: true, sal: facSal(P) });
    }
    if (req.op === 'mat') return out({ ok: true, items: facMat(P), low: facMatLow(P) });   // 22 Oct 2026: materials (thread, labels, elastic …)
    if (req.op === 'matset') {
      var mi = Array.isArray(req.items) ? req.items.slice(0, 80).map(function (m) { m = m || {}; var n = String(m.n || '').replace(/[<>]/g, '').trim().slice(0, 40); if (!n) return null;
        return { n: n, q: Math.max(0, Math.round(+m.q || 0)), u: String(m.u || '').trim().slice(0, 12), low: m.low === '' || m.low == null ? null : Math.max(0, Math.round(+m.low || 0)) }; }).filter(Boolean) : null;
      if (!mi) return out({ ok: false, error: 'bad request' }); P.setProperty('FAC_MAT', JSON.stringify(mi)); CacheService.getScriptCache().removeAll(['FAC_WKR_7', 'FAC_WKR_30', 'FAC_WKR_90']);
      return out({ ok: true, items: mi, low: facMatLow(P) });
    }
    if (req.op === 'daily') {                                 // 22 Oct 2026: the daily closing report - get / set (on-off) / now (post it now); only Abbas changes or posts
      if (req.kind === 'get') return out({ ok: true, on: !P.getProperty('FAC_DAILY_OFF'), last: P.getProperty('FAC_DAILY_LAST') || '' });
      if (!facOwner(req.who)) return out({ ok: false, error: 'only Abbas can do this', noaccess: true });
      if (req.kind === 'set') { if (req.on) P.deleteProperty('FAC_DAILY_OFF'); else P.setProperty('FAC_DAILY_OFF', '1'); return out({ ok: true, on: !P.getProperty('FAC_DAILY_OFF') }); }
      if (req.kind === 'now') { try { return out(facDaily(P, String(req.who || '').slice(0, 40))); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); } }
      if (req.kind === 'preview') { try { return out({ ok: true, text: facDailyText(P, rtok, Date.now()) }); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); } }
      return out({ ok: false, error: 'bad request' });
    }
    if (req.op === 'reportauto') {                            // 21 Oct 2026: the app just moved a card to FINISH (fast lane): post the report now if it is not there yet
      var pa0 = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!pa0) return out({ ok: false, error: 'bad request' });
      try { return out(facReport(P, wtok, FT, pa0, false, String(req.who || '').slice(0, 40))); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); }
    }
    if (req.op === 'report') {                                // 21 Oct 2026: the production report of one card, by hand (also for a card not finished yet: "so far")
      var pc0 = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!pc0) return out({ ok: false, error: 'bad request' });
      try { return out(facReport(P, wtok, FT, pc0, true, String(req.who || '').slice(0, 40))); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 160) }); }
    }
    if (req.op === 'archive') {                               // 18 Oct 2026 (Abbas): "when the card is in CAME BACK, give me an option after that to delete it" - only RETURNS BACK cards;
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });   // archived in Trello (it can be restored from Trello's Archive), never erased
      var acard = String(req.card || '').replace(/[^0-9a-f]/g, ''), awho = String(req.who || '').slice(0, 40) || 'factory', arl = facRetLists(P, wtok, false);
      if (!acard || !arl) return out({ ok: false, error: 'bad request' });
      var anow = trApi('get', '/cards/' + acard, { fields: 'idList,name,idBoard,closed' }, wtok);
      if (anow.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      if (anow.closed) return out({ ok: true, already: true });
      if (anow.idList !== arl.back) return out({ ok: false, error: 'Only a card in CAME BACK (RETURNS BACK) can be deleted' });
      try { trApi('post', '/cards/' + acard + '/actions/comments', { text: '🗑 Deleted (archived) · ' + awho + ' (factory app)' }, wtok); } catch (e) {}
      trApi('put', '/cards/' + acard, { closed: true }, wtok);
      try { var ath = P.getProperty('FTH_' + acard); if (ath && FT) { ath = JSON.parse(ath); slackApi(FT, 'chat.postMessage', { channel: ath.ch, thread_ts: ath.ts, text: '→ *DELETED* · ' + awho }); } } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facNudge(P, 'list:' + acard);
      return out({ ok: true });
    }
    return out({ ok: false, error: 'the relay does not know "' + String(req.op) + '" yet - Abbas must deploy the new version (Deploy → Manage deployments → ✏️ → New version)' });
  } catch (e) { return out({ ok: false, error: String(e.message || e).replace(/(token|key)=[^&\s"']+/gi, '$1=…').slice(0, 200) }); }
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
        var items = (Array.isArray(req.items) ? req.items : []).slice(0, 60).map(function (x) { return { no: String(x.no || '').slice(0, 20), pcs: +x.pcs || 0, c: String(x.c || '').slice(0, 120), row: String(x.row || '').slice(0, 20), loc: ({ g: 'g', o: 'o', m: 'm' })[x.loc] || '' }; });
        if (!o) o = { id: id, created: now, by: by, steps: {} };
        o.name = String(req.name || '').slice(0, 80); o.items = items; o.pcs = +req.pcs || 0; o.dl = String(req.dl || '').slice(0, 160); o.upd = now; o.del = 0;
        if (req.s1 && !o.steps.s1) o.steps.s1 = { by: by, t: now };
      } else if (op === 'tick') {
        if (!o) return out({ ok: false, error: 'that order is not on the list any more' });
        if (ORD_STEPS.indexOf(req.step) < 0) return out({ ok: false, error: 'bad step' });
        o.steps[req.step] = req.on ? { by: by, t: now, n: String(req.note || '').slice(0, 60) } : null; o.upd = now;
        o.done = ORD_STEPS.every(function (k) { return o.steps[k]; }) ? (o.done || now) : 0;
      } else if (op === 'link') {                                 // 19 Oct 2026: the order's #godown / #customer posts (its two chats) and its invoice
        if (!o) return out({ ok: false, error: 'that order is not on the list any more' });
        ['gts', 'cts'].forEach(function (f) { if (req[f]) o[f] = String(req[f]).replace(/[^\d.]/g, '').slice(0, 20); });
        if (req.bill) o.bill = String(req.bill).slice(0, 30); o.upd = now;
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
  // 11 Oct 2026 (Abbas): his employee uses Small Vendors too. The ledger is now kept as "VAULT2", locked with the SHOP password on the
  // phone (the request is already signed with it); the old owner-locked "VAULT" stays untouched as a backup and is only read once
  // by an owner phone to move the data across.
  var v2 = !!req.v2, pre = v2 ? 'VAULT2' : 'VAULT', h = '', have = null;
  if (!v2) {
    var chk = String(req.chk || ''); if (chk.length < 32) return out({ ok: false, error: 'owner password missing' });
    h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chk, Utilities.Charset.UTF_8));
  }
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    if (!v2) { have = P.getProperty('VAULT_CHK'); if (have && have !== h) return out({ ok: false, error: 'owner password does not match the one used before' }); }
    var cur = vRead(P, pre);
    if (req.op === 'get') return out({ ok: true, box: cur ? cur.box : null, v: cur ? cur.v : 0 });
    if (req.op !== 'put') return out({ ok: false, error: 'bad request' });
    var curV = cur ? cur.v : 0;
    if ((+req.base || 0) !== curV) return out({ ok: false, conflict: true, box: cur ? cur.box : null, v: curV });   // someone saved in between - the phone merges and tries again
    if (!req.box || typeof req.box.ct !== 'string' || req.box.ct.length > 400000) return out({ ok: false, error: 'bad box' });
    if (cur) vWrite(P, pre + 'P', cur);        // spare copy of the previous version
    var v = curV + 1; vWrite(P, pre, { v: v, box: req.box });
    if (!v2 && !have) P.setProperty('VAULT_CHK', h);
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
function slackPdf(reqText, P, v2) {
  var req = JSON.parse(reqText);
  // v2 (Abbas, 12 Oct 2026): nothing goes to a group unless ticked; #godown gets the godown pick list, #customer the full memo
  var chans = MEMO_PDF_CHANNELS;
  if (v2) { var to = String(req.to || ''); if (to !== 'godown' && to !== 'customer') return out({ ok: false, error: 'bad channel' }); chans = [MEMO_PDF_CHANNELS[to === 'godown' ? 0 : 1]]; }
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return out({ ok: false, error: 'the relay has no SLACK_BOT_TOKEN yet' });
  // 12 Oct 2026 (Abbas): photos / videos / voice notes / a paper go WITH the godown post. Each one is uploaded first (op 'file' -> Slack file id),
  // then the pick-list post shares the PDF and those files in ONE message.
  if (v2 && req.op === 'file') {
    var fb = Utilities.base64Decode(String(req.b64 || '')); if (fb.length < 10 || fb.length > 18000000) return out({ ok: false, error: 'file too big or empty' });
    var fn = String(req.name || 'file').replace(/[^\w.\- ]+/g, '-').slice(0, 80);
    try { return out({ ok: true, fid: slackUp(tok, fn, fb) }); } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 200) }); }
  }
  var bytes = Utilities.base64Decode(String(req.pdf || '')); if (bytes.length < 100 || bytes.length > 18000000) return out({ ok: false, error: 'bad PDF' });
  var name = String(req.name || 'SJ-memo.pdf').replace(/[^\w.\- ]+/g, '-').slice(0, 80); if (!/\.pdf$/i.test(name)) name += '.pdf';
  var H = { Authorization: 'Bearer ' + tok };
  var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: H, muteHttpExceptions: true,
    payload: { filename: name, length: String(bytes.length) } }).getContentText());
  if (!a.ok) return out({ ok: false, error: 'Slack said ' + a.error + (a.error === 'missing_scope' ? ' (the SJ Memo app needs files:write)' : '') });
  var up = UrlFetchApp.fetch(a.upload_url, { method: 'post', payload: Utilities.newBlob(bytes, 'application/pdf', name), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) return out({ ok: false, error: 'Slack upload said ' + up.getResponseCode() });
  var c = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: H, muteHttpExceptions: true,
    payload: { files: JSON.stringify([{ id: a.file_id, title: name.replace(/\.pdf$/i, '') }].concat((v2 && Array.isArray(req.fids) ? req.fids : []).filter(function (f) { return /^F[A-Z0-9]{6,20}$/.test(String(f)); }).slice(0, 25).map(function (f) { return { id: String(f) }; }))), channels: chans.join(','), initial_comment: String(req.text || '').slice(0, 3000) } }).getContentText());
  if (!c.ok) return out({ ok: false, error: 'Slack said ' + c.error + (c.error === 'not_in_channel' || c.error === 'channel_not_found' ? ' (invite @SJ Memo to #godown and #customer)' : '') });
  // 18 Oct 2026 (Abbas: "if an order is sent to customer, right away you have to open a chat for that ... for that specific order"):
  // the #customer post IS the order's chat (its Slack thread). Its ts goes back to the phone so the app can open that chat at once.
  var ts = '';
  try { var sh = ((c.files || [])[0] || {}).shares || {}; [sh.public, sh.private].forEach(function (g) { if (g) Object.keys(g).forEach(function (ch) { (g[ch] || []).forEach(function (x) { if (x.ts) ts = x.ts; }); }); }); } catch (e) {}
  if (v2) {
    if (!ts) { try { Utilities.sleep(700); var want = String(req.text || '').split('\n')[0].slice(0, 60), hh = slackApi(tok, 'conversations.history', { channel: chans[0], limit: 6 }, true); ((hh.ok && hh.messages) || []).forEach(function (m) { if (!ts && want && String(m.text || '').indexOf(want) === 0) ts = m.ts; }); } catch (e) {} }
    try { bigDrop(CacheService.getScriptCache(), to === 'godown' ? 'GD_HIST' : 'CC_HIST'); } catch (e) {}
  }
  return out({ ok: true, file: a.file_id, to: v2 ? req.to : 'both', ts: ts });
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
// ---- CUSTOMER CHATS in the order memo (17 Oct 2026, Abbas: "add the #customers chat directly in there … I have the godown list in the
// app but I don't have the customers … I click on the customer, I have each and every customer's list in which I can speak about that
// specific customer's details"). Everything lives in Slack #customer (SJTC workspace, the SJ Memo bot): every "*ORDER MEMO* — NAME" post
// the memo sends belongs to that customer, and each customer gets ONE chat thread under a "👤 *CUSTOMER* · NAME" message, made on the first
// line written. Needs on the SJ Memo Slack app: channels:history (groups:history if #customer is private), files:read, users:read.
var CC_CH = MEMO_PDF_CHANNELS[1];
// 17 Oct 2026 23:50: Slack hands the 👤 back as the shortcode :bust_in_silhouette:, so every root was invisible to the relay - the chat read nothing and each post made a NEW root (three roots for Matiullah naif). Both spellings are accepted now.
function ccIsRoot(t) { return /^\s*(?:👤|:bust_in_silhouette:)/.test(String(t || '')); }
function ccIsMemo(t) { return /^\*ORDER MEMO[^*\n]*\*/.test(String(t || '')); }                       // 18 Oct 2026: every ORDER MEMO post is a chat of its own (key 'O' + ts)
function ccRootKey(m) { return ccIsMemo(m.text) ? 'O' + m.ts : ccKey(ccName(m.text)); }
function ccMemoHead(t) { var L = String(t || '').split('\n').slice(1).map(function (x) { return x.replace(/[*_]/g, '').trim(); }).filter(Boolean); return L.slice(0, 2).join(' · ').slice(0, 160); }
function ccName(t) { var s = String(t || ''), m = s.match(/^\*ORDER MEMO[^*\n]*\*[^\n]*?[—-]\s*([^\n]+)/) || s.match(/^\s*(?:👤|:bust_in_silhouette:)\s*\*CUSTOMER\*\s*·\s*([^\n]+)/); if (!m) return ''; var n = m[1].replace(/[*_]/g, '').trim(); return /^no name$/i.test(n) ? '' : n.slice(0, 60); }
function ccKey(n) { return String(n || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function ccErr(e) { return 'Slack said ' + e + (e === 'missing_scope' ? ' — the SJ Memo Slack app needs channels:history (or groups:history), files:read and users:read: api.slack.com/apps → SJ Memo → OAuth & Permissions → Bot Token Scopes → add → Reinstall' : e === 'not_in_channel' ? ' — invite @SJ Memo to #customer' : ''); }
function ccHist(tok, fresh) {                                   // newest 400 messages of #customer, kept 20 s for every phone
  var c = CacheService.getScriptCache(), h = fresh ? null : bigGet(c, 'CC_HIST'); if (h) return JSON.parse(h);
  var all = [], cur = '';
  for (var i = 0; i < 2; i++) { var j = slackApi(tok, 'conversations.history', { channel: CC_CH, limit: 200, cursor: cur }, true); if (!j.ok) throw new Error(ccErr(j.error));
    (j.messages || []).forEach(function (m) { all.push({ ts: m.ts, text: String(m.text || '').slice(0, 1500), user: m.user || '', bot: !!m.bot_id, rc: m.reply_count || 0, lr: m.latest_reply || '', files: (m.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }); });
    cur = (j.response_metadata || {}).next_cursor || ''; if (!cur) break; }
  try { bigPut(c, 'CC_HIST', JSON.stringify(all), 20); } catch (e) {}
  return all;
}
function ccWho(tok, m) {                                        // "*Abbas:* text" (written in the app) or a person in Slack
  var t = String(m.text || ''), mm = t.match(/^\*([^*]{1,40}):\*\s?([\s\S]*)$/); if (m.bot && mm) return { who: mm[1], text: mm[2], app: true };
  if (m.bot) return { who: 'SJ Memo', text: t, app: false };
  var c = CacheService.getScriptCache(), k = 'CC_U_' + m.user, n = c.get(k);
  if (!n && m.user) { var u = slackApi(tok, 'users.info', { user: m.user }, true); n = u.ok ? String((u.user.profile || {}).real_name || u.user.real_name || u.user.name || '').split(' ')[0] : 'Slack'; c.put(k, n, 21600); }
  return { who: n || 'Slack', text: t, app: false };
}
function ccDiag() {                                            // read-only check, run from the editor: which scopes the SJ Memo bot has and whether it can read #customer
  var tok = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN'), L = [];
  var r = UrlFetchApp.fetch('https://slack.com/api/conversations.history?channel=' + CC_CH + '&limit=3', { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }), h = r.getHeaders(), j = JSON.parse(r.getContentText());
  L.push('scopes: ' + (h['x-oauth-scopes'] || h['X-OAuth-Scopes'] || '?')); L.push('#customer history ok=' + j.ok + (j.ok ? ' · ' + (j.messages || []).length + ' msgs' : ' err=' + j.error + ' needed=' + (j.needed || '')));
  (j.messages || []).forEach(function (m) { L.push('  ' + String(m.text || '').slice(0, 60).replace(/\n/g, ' ') + ((m.files || []).length ? ' [+' + m.files.length + ' file]' : '')); });
  var P = PropertiesService.getScriptProperties(); L.push('live topic set: ' + !!P.getProperty('CC_LIVE') + ' · notify people: ' + Object.keys(JSON.parse(P.getProperty('CCNTFY') || '{}')).join(',') + ' · seen records: ' + Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('CCSEEN_') === 0; }).length);
  Logger.log(L.join('\n')); return L.join('\n');
}
// ---- 17 Oct 2026 (Abbas: the customer chat must have "a catch-up process as well, just like Slack, just like we did on the other app, and
// notification as well"). Per PERSON (the name typed in the memo): CCSEEN_<NAME> = {customer key: newest ts seen}. A message counts as new when
// it is newer than that mark, newer than the person's first use, and written by someone else. The relay keeps one private doorbell topic
// (CC_LIVE) and rings it with the customer key only (no text) on every post and on every Slack event in #customer, so every open memo pulls at
// once. Phone notifications go through ntfy (CCNTFY = {NAME: topic}), sent on Slack events and, as a fallback, from any phone's list call once a minute.
function ccWhoKey(w) { return String(w || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40) || 'SJ'; }
function ccSeenGet(P, who) { var k = 'CCSEEN_' + ccWhoKey(who), s = {}; try { s = JSON.parse(P.getProperty(k) || '{}'); } catch (e) { s = {}; } if (!s._t0) { s._t0 = String(Date.now() / 1000 - 30 * 86400); try { P.setProperty(k, JSON.stringify(s)); } catch (e) {} } return s; }
function ccSeenPut(P, who, s) { try { var ks = Object.keys(s).filter(function (k) { return k !== '_t0'; }); while (JSON.stringify(s).length > 7500 && ks.length) { var old = ks.sort(function (a, b) { return +s[a] - +s[b]; }).shift(); delete s[old]; } P.setProperty('CCSEEN_' + ccWhoKey(who), JSON.stringify(s)); } catch (e) {} }
function ccMine(w, who) { var a = String(w.who || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(), b = String(who || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim(); if (!a || !b) return false; if (a === b) return true; var a1 = a.split(' ')[0], b1 = b.split(' ')[0]; return a1.length >= 3 && b1.length >= 3 && (a1.indexOf(b1) === 0 || b1.indexOf(a1) === 0); }
function ccLine(w, m) { var t = String(w.text || '').replace(/\s+/g, ' ').trim(); if (!t || t === '📎') t = (m.files || []).map(function (f) { return /^audio/.test(f.type) || /^voice-/i.test(f.name) ? '🎤 voice note' : /^image/.test(f.type) ? '📷 photo' : /^video/.test(f.type) ? '🎬 video' : '📎 ' + f.name; }).join(' · ') || t; return (w.who ? w.who + ': ' : '') + t.slice(0, 120); }
function ccReplies(tok, root) {                                 // one thread's replies, cached by its newest reply
  var c = CacheService.getScriptCache(), k = 'CC_TH_' + root.ts + '_' + (root.lr || '0'), h = bigGet(c, k); if (h) return JSON.parse(h);
  var rp = slackApi(tok, 'conversations.replies', { channel: CC_CH, ts: root.ts, limit: 200 }, true); if (!rp.ok) throw new Error(ccErr(rp.error));
  var L = (rp.messages || []).filter(function (x) { return x.ts !== root.ts; }).map(function (x) { var w = ccWho(tok, { text: x.text, user: x.user, bot: !!x.bot_id }); return { ts: x.ts, who: w.who, app: w.app, text: w.text, files: (x.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }; });
  try { bigPut(c, k, JSON.stringify(L), 1800); } catch (e) {}
  return L;
}
function ccUnread(P, tok, hist, who, budget) {                  // {key: {n, last, tx, name}} for this person - at most `budget` thread reads
  var seen = ccSeenGet(P, who), t0 = +seen._t0 || 0, out = {}, reads = 0;
  hist.filter(function (m) { return (ccIsRoot(m.text) || ccIsMemo(m.text)) && m.rc; }).sort(function (a, b) { return +(b.lr || b.ts) - +(a.lr || a.ts); }).forEach(function (m) {
    var nm = ccName(m.text), k = ccRootKey(m); if (!k || k === 'O') return; var mark = Math.max(+(seen[k] || 0), t0); if (+(m.lr || 0) <= mark) return;
    var c = CacheService.getScriptCache(), ck = 'CC_UN_' + ccWhoKey(who) + '_' + k.replace(/[^A-Z0-9]/g, '').slice(0, 30) + '_' + m.lr + '_' + String(mark).slice(0, 15), cached = c.get(ck);
    if (cached) { var o = JSON.parse(cached); if (o.n) out[k] = o; return; }
    if (reads >= budget) return; reads++;
    var L; try { L = ccReplies(tok, m); } catch (e) { return; }
    var n = 0, last = '', tx = '';
    L.forEach(function (x) { if (+x.ts <= mark) return; if (ccMine(x, who)) return; n++; if (+x.ts > +last) { last = x.ts; tx = ccLine(x, x); } });
    var res = { n: n, last: last, tx: tx, name: nm || 'no name', root: ccIsMemo(m.text) ? m.ts : '' }; try { c.put(ck, JSON.stringify(res), 600); } catch (e) {} if (n) out[k] = res;
  });
  return out;
}
function ccLive(P) { var t = P.getProperty('CC_LIVE'); if (!t) { t = 'sjcust-' + Utilities.getUuid().replace(/-/g, '').slice(0, 22); P.setProperty('CC_LIVE', t); } return t; }
function ccNudge(P, key) { try { UrlFetchApp.fetch('https://ntfy.sh/' + ccLive(P), { method: 'post', payload: 'k=' + encodeURIComponent(String(key || '').slice(0, 60)), headers: { 'Cache': 'no', 'Firebase': 'no' }, muteHttpExceptions: true }); } catch (e) {} }
// ---- 19 Oct 2026 (Abbas: "when an order is made to send to godown, bring the #godown chat for it directly ... two options of the chats in that
// order, one #godown, one #customers"). Each ORDER has two chats: the thread under its pick-list post in #godown (key 'G' + ts) and the thread under
// its memo post in #customer (key 'O' + ts). The order (ORD_<id>) remembers both ts (gts / cts, op "link").
var GD_CH = MEMO_PDF_CHANNELS[0];
function gdHist(tok, fresh) {                                    // newest 200 top-level posts of #godown (rc / lr only), kept 20 s for every phone
  var c = CacheService.getScriptCache(), h = fresh ? null : bigGet(c, 'GD_HIST'); if (h) return JSON.parse(h);
  var j = slackApi(tok, 'conversations.history', { channel: GD_CH, limit: 200 }, true); if (!j.ok) throw new Error(ccErr(j.error).replace('#customer', '#godown'));
  var all = (j.messages || []).map(function (m) { return { ts: m.ts, rc: m.reply_count || 0, lr: m.latest_reply || '', text: String(m.text || '').slice(0, 300) }; });
  try { bigPut(c, 'GD_HIST', JSON.stringify(all), 20); } catch (e) {} return all;
}
function chReplies(tok, ch, root, lr) {                          // one thread of #godown or #customer: root first, then the replies (cached by its newest reply)
  var c = CacheService.getScriptCache(), k = 'CH_TH_' + ch + '_' + root + '_' + (lr || '0'), h = lr ? bigGet(c, k) : null; if (h) return JSON.parse(h);
  var rp = slackApi(tok, 'conversations.replies', { channel: ch, ts: root, limit: 200 }, true); if (!rp.ok) throw new Error(ccErr(rp.error));
  var L = (rp.messages || []).map(function (x) { var w = ccWho(tok, { text: x.text, user: x.user, bot: !!x.bot_id }); return { ts: x.ts, who: w.who, app: w.app, text: w.text, root: x.ts === root, files: (x.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }; });
  if (lr) { try { bigPut(c, k, JSON.stringify(L), 1800); } catch (e) {} } return L;
}
function gdUnread(P, tok, who, roots, budget, fresh) {           // {'G'+ts: {n, last, tx}} for this person over the given #godown roots
  var out = {}; roots = (roots || []).map(function (x) { return String(x).replace(/[^\d.]/g, ''); }).filter(String).slice(0, 40); if (!roots.length) return out;
  var hist; try { hist = gdHist(tok, fresh); } catch (e) { return out; }
  var seen = ccSeenGet(P, who), t0 = +seen._t0 || 0, reads = 0, c = CacheService.getScriptCache();
  hist.filter(function (m) { return m.rc && roots.indexOf(m.ts) >= 0; }).forEach(function (m) {
    var k = 'G' + m.ts, mark = Math.max(+(seen[k] || 0), t0); if (+(m.lr || 0) <= mark) return;
    var ck = 'GD_UN_' + ccWhoKey(who) + '_' + m.ts + '_' + m.lr + '_' + String(mark).slice(0, 15), cached = c.get(ck); if (cached) { var o = JSON.parse(cached); if (o.n) out[k] = o; return; }
    if (reads >= budget) return; reads++;
    var L; try { L = chReplies(tok, GD_CH, m.ts, m.lr); } catch (e) { return; }
    var n = 0, last = '', tx = ''; L.forEach(function (x) { if (x.root || +x.ts <= mark || ccMine(x, who)) return; n++; if (+x.ts > +last) { last = x.ts; tx = ccLine(x, x); } });
    var res = { n: n, last: last, tx: tx }; try { c.put(ck, JSON.stringify(res), 600); } catch (e) {} if (n) out[k] = res; });
  return out;
}
function gdOrders(P) {                                           // open orders that have a #godown chat: {ts: {oid, name}}
  var all = P.getProperties(), r = {}; Object.keys(all).forEach(function (k) { if (k.indexOf('ORD_') !== 0) return; try { var o = JSON.parse(all[k]); if (o.gts && !o.del && !o.done) r[o.gts] = { oid: o.id, name: o.name || 'order' }; } catch (e) {} }); return r;
}
// ---------- DIRECT CHATS (22 Oct 2026, Abbas: "a direct chat between me and Muhammad, and me and Imran, in this app") ----------
// One private Slack channel #sj-direct (found by name among the bot's channels, else made by the relay), one thread per person
// ("💬 *DIRECT* · Abbas ↔ Muhammad"); the chat = that thread's replies. Abbas sees every person's chat; a person sees only his own
// (first name of `who` = the name in the list). People = CC_DM_PEOPLE (default Muhammad, Imran), changed from the app (op dmpeople, owner only).
var DM_NAME = 'sj-direct', DM_DEFAULT = ['Muhammad', 'Imran'];
function dmPeople(P) { var L = []; try { L = JSON.parse(P.getProperty('CC_DM_PEOPLE') || '[]'); } catch (e) { L = []; } if (!Array.isArray(L) || !L.length) L = DM_DEFAULT.slice(); return L.map(function (x) { return String(x || '').replace(/[*_\n]/g, '').trim().slice(0, 40); }).filter(String).slice(0, 20); }
function dmIsAbbas(who) { return /^ABBAS/.test(ccWhoKey(who)); }
function dmFor(P, who) { var all = dmPeople(P); if (dmIsAbbas(who)) return all; return all.filter(function (n) { return ccMine({ who: n }, who); }); }
function dmCh(P, tok) {
  var id = P.getProperty('CC_DM_CH'); if (id) return id;
  var cur = '', n = 0;
  do { var j = slackApi(tok, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: 200, cursor: cur }, true); if (!j.ok) break;
    var hit = (j.channels || []).filter(function (c) { return c.name === DM_NAME; })[0]; if (hit) { id = hit.id; break; } cur = (j.response_metadata || {}).next_cursor || ''; } while (cur && ++n < 10);
  if (!id) { var cj = slackApi(tok, 'conversations.create', { name: DM_NAME, is_private: true }); if (!cj.ok) throw new Error('Slack would not let the bot make #' + DM_NAME + ' (' + cj.error + ')'); id = (cj.channel || {}).id; }
  if (!id) throw new Error('no #' + DM_NAME); P.setProperty('CC_DM_CH', id); return id;
}
function dmChFor(P, tok, name) {                                   // 22 Oct 2026 (Abbas made a private channel "Muhammad" with the bot in it): the person's
  var k = 'CC_DM_CH_' + ccWhoKey(name), id = P.getProperty(k); if (id) return id;      // own channel wins (set by name, or pasted: op dmset with the name)
  var slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), cur = '', n = 0;
  try { do { var j = slackApi(tok, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: 200, cursor: cur }, true); if (!j.ok) break;
    var hit = (j.channels || []).filter(function (c) { var cn = String(c.name || '').toLowerCase(); return cn === slug || cn === 'sj-' + slug || cn === slug + '-direct' || cn === 'direct-' + slug; })[0]; if (hit) { id = hit.id; break; }
    cur = (j.response_metadata || {}).next_cursor || ''; } while (cur && ++n < 10); } catch (e) {}
  if (id) { P.setProperty(k, id); return id; }
  return dmCh(P, tok);                                              // nothing of his own: the shared #sj-direct
}
function dmRoot(P, tok, name) {                                    // the person's thread root (in his own channel, else #sj-direct), made once
  var k = 'CC_DM_ROOT_' + ccWhoKey(name), ts = P.getProperty(k); if (ts) return ts;
  var ch = dmChFor(P, tok, name), pj = slackApi(tok, 'chat.postMessage', { channel: ch, text: '💬 *DIRECT* · Abbas ↔ ' + name }); if (!pj.ok) throw new Error(ccErr(pj.error));
  P.setProperty(k, pj.ts); return pj.ts;
}
function dmHist(tok, ch, fresh) {                                 // newest 100 top-level posts of a direct channel (the thread roots), kept 20 s
  var c = CacheService.getScriptCache(), ck = 'DM_HIST_' + ch, h = fresh ? null : c.get(ck); if (h) return JSON.parse(h);
  var j = slackApi(tok, 'conversations.history', { channel: ch, limit: 100 }, true); if (!j.ok) throw new Error(ccErr(j.error).replace('#customer', 'the direct channel'));
  var all = (j.messages || []).map(function (m) { return { ts: m.ts, rc: m.reply_count || 0, lr: m.latest_reply || '', text: String(m.text || '').slice(0, 120) }; });
  try { c.put(ck, JSON.stringify(all), 20); } catch (e) {} return all;
}
function dmDrop(P) { var c = CacheService.getScriptCache(); Object.keys(P.getProperties()).forEach(function (k) { if (k.indexOf('CC_DM_CH') === 0) c.remove('DM_HIST_' + P.getProperty(k)); }); }
function dmIsCh(P, id) { if (!id) return false; var all = P.getProperties(); return Object.keys(all).some(function (k) { return k.indexOf('CC_DM_CH') === 0 && all[k] === id; }); }
function dmUnread(P, tok, ch, who, roots, budget, fresh) {        // {'D'+ts: {n, last, tx}} for this person over the given roots
  var out = {}; roots = (roots || []).filter(String).slice(0, 20); if (!roots.length) return out;
  var hist; try { hist = dmHist(tok, ch, fresh); } catch (e) { return out; }
  var seen = ccSeenGet(P, who), t0 = +seen._t0 || 0, reads = 0, c = CacheService.getScriptCache();
  hist.filter(function (m) { return m.rc && roots.indexOf(m.ts) >= 0; }).forEach(function (m) {
    var k = 'D' + m.ts, mark = Math.max(+(seen[k] || 0), t0); if (+(m.lr || 0) <= mark) return;
    var ck = 'DM_UN_' + ccWhoKey(who) + '_' + m.ts + '_' + m.lr + '_' + String(mark).slice(0, 15), cached = c.get(ck); if (cached) { var o = JSON.parse(cached); if (o.n) out[k] = o; return; }
    if (reads >= budget) return; reads++;
    var L; try { L = chReplies(tok, ch, m.ts, m.lr); } catch (e) { return; }
    var n = 0, last = '', tx = ''; L.forEach(function (x) { if (x.root || +x.ts <= mark || ccMine(x, who)) return; n++; if (+x.ts > +last) { last = x.ts; tx = ccLine(x, x); } });
    var res = { n: n, last: last, tx: tx }; try { c.put(ck, JSON.stringify(res), 600); } catch (e) {} if (n) out[k] = res; });
  return out;
}
function dmList(P, tok, who, budget, fresh) {                     // the direct chats this person may see, with unread counts
  var names = dmFor(P, who); if (!names.length) return [];
  var rows = names.map(function (n) { var root = dmRoot(P, tok, n); return { k: 'D' + root, name: n, root: root, ch: dmChFor(P, tok, n), un: 0, tx: '', last: '0' }; });
  var byCh = {}; rows.forEach(function (r) { (byCh[r.ch] = byCh[r.ch] || []).push(r); });
  Object.keys(byCh).forEach(function (ch) {
    var hist = []; try { hist = dmHist(tok, ch, fresh); } catch (e) {}
    byCh[ch].forEach(function (r) { var m = hist.filter(function (x) { return x.ts === r.root; })[0]; if (m) r.last = m.lr && +m.lr > +m.ts ? m.lr : m.ts; });
    var un = dmUnread(P, tok, ch, who, byCh[ch].map(function (r) { return r.root; }), budget, fresh);
    byCh[ch].forEach(function (r) { var u = un[r.k]; if (u) { r.un = u.n; r.tx = u.tx; if (+u.last > +r.last) r.last = u.last; } });
  });
  return rows.map(function (r) { return { k: r.k, name: r.name, root: r.root, un: r.un, tx: r.tx, last: r.last }; });
}
function ccNotifyScan(P, why) {                                  // phone notifications (ntfy app) for everyone who turned them on
  var map = {}; try { map = JSON.parse(P.getProperty('CCNTFY') || '{}'); } catch (e) {} var names = Object.keys(map); if (!names.length) return 0;
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return 0;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(200)) return 0; var sent = 0;
  try {
    var hist; try { hist = ccHist(tok, why === 'event'); } catch (e) { return 0; }
    names.forEach(function (nm) {
      var un = ccUnread(P, tok, hist, nm, 6), nk = 'CCNOTE_' + ccWhoKey(nm), noted = {}; try { noted = JSON.parse(P.getProperty(nk) || '{}'); } catch (e) {} var changed = false;
      Object.keys(un).forEach(function (k) { var u = un[k]; if (!u.n || !u.last || +(noted[k] || 0) >= +u.last) return;
        if (facNtfy(map[nm], { title: (u.root ? '📄 ' : '👤 ') + (u.name || k) + (u.n > 1 ? ' · ' + u.n + ' new' : ''), msg: u.tx || 'New message', click: 'https://abbas911-prog.github.io/sj-designs/memo.html#chat=' + encodeURIComponent(u.name || k) + (u.root ? '&o=' + u.root : '') })) { sent++; noted[k] = u.last; changed = true; } });
      try { var dl = dmList(P, tok, nm, 3, why === 'event');
        dl.forEach(function (r) { if (!r.un) return; var kk = r.k, lastD = r.last; if (+(noted[kk] || 0) >= +lastD) return;
          if (facNtfy(map[nm], { title: '💬 ' + (dmIsAbbas(nm) ? r.name : 'Abbas') + ' · direct' + (r.un > 1 ? ' · ' + r.un + ' new' : ''), msg: r.tx || 'New message', click: 'https://abbas911-prog.github.io/sj-designs/memo.html#dm=' + encodeURIComponent(r.name) })) { sent++; noted[kk] = lastD; changed = true; } }); } catch (e) {}
      try { var go = gdOrders(P), gu = gdUnread(P, tok, nm, Object.keys(go), 4, why === 'event');
        Object.keys(gu).forEach(function (k) { var u = gu[k], o2 = go[k.slice(1)] || {}; if (!u.n || !u.last || +(noted[k] || 0) >= +u.last) return;
          if (facNtfy(map[nm], { title: '📦 ' + (o2.name || 'order') + ' · godown' + (u.n > 1 ? ' · ' + u.n + ' new' : ''), msg: u.tx || 'New message', click: 'https://abbas911-prog.github.io/sj-designs/memo.html#ord=' + encodeURIComponent(o2.oid || '') + '&c=g' })) { sent++; noted[k] = u.last; changed = true; } }); } catch (e) {}
      if (changed) { var ks = Object.keys(noted); while (JSON.stringify(noted).length > 7500 && ks.length) delete noted[ks.shift()]; try { P.setProperty(nk, JSON.stringify(noted)); } catch (e) {} }
    });
  } finally { lock.releaseLock(); }
  return sent;
}
function ccRoot(P, tok, nm, k2, cR) {                            // the customer's 👤 thread root: remembered (CC_ROOT_), else found in #customer, else made. Works with chat:write alone once remembered.
  var pk = 'CC_ROOT_' + k2.replace(/[^A-Z0-9]/g, '_').slice(0, 60), r = P.getProperty(pk); if (r) return r;
  var lock = LockService.getScriptLock(); lock.waitLock(15000); var rootTs = '';
  try { r = P.getProperty(pk); if (r) return r;
    try { rootTs = (ccHist(tok, true).filter(function (m) { return ccIsRoot(m.text) && ccKey(ccName(m.text)) === k2; }).sort(function (a, b) { return +a.ts - +b.ts; })[0] || {}).ts || ''; } catch (e) { if (!/missing_scope/.test(String(e.message || e))) throw e; }   // no history scope yet: a new root is made (the chat still goes through)
    if (!rootTs) { var r0 = slackApi(tok, 'chat.postMessage', { channel: CC_CH, text: '👤 *CUSTOMER* · ' + nm + '\n_customer chat · SJ memo app_' }); if (!r0.ok) throw new Error(ccErr(r0.error)); rootTs = r0.ts; bigDrop(cR, 'CC_HIST'); }
    P.setProperty(pk, rootTs);
  } finally { lock.releaseLock(); }
  return rootTs;
}
function cchat(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return out({ ok: false, error: 'the relay has no SLACK_BOT_TOKEN yet' });
  var cR = CacheService.getScriptCache(), rid = String(req.rid || '').replace(/[^\w-]/g, '').slice(0, 40), who = String(req.who || '').replace(/[*\n]/g, '').trim().slice(0, 40) || 'SJ';
  if (rid) { var prev = cR.get('CCR_' + rid); if (prev) return ContentService.createTextOutput(prev).setMimeType(ContentService.MimeType.JSON); }
  try {
    if (req.op === 'list' || req.op === 'ping') {
      var by = {}, ords = [], hist = ccHist(tok, !!req.fresh);
      hist.forEach(function (m) { var n = ccName(m.text), memo = ccIsMemo(m.text), l = m.lr && +m.lr > +m.ts ? m.lr : m.ts;
        if (memo) ords.push({ k: 'O' + m.ts, ts: m.ts, name: n || 'no name', head: ccMemoHead(m.text), chat: m.rc, last: l, un: 0, tx: '' });
        if (!n) return; var k = ccKey(n), e = by[k] || (by[k] = { k: k, name: n, last: '0', memos: 0, chat: 0, root: '', un: 0, tx: '' });
        if (memo) e.memos++; else { e.root = m.ts; e.chat += m.rc; }
        if (+l > +e.last) e.last = l; });
      var un = ccUnread(P, tok, hist, who, req.op === 'ping' ? 4 : 8), ntf = {}; try { ntf = JSON.parse(P.getProperty('CCNTFY') || '{}'); } catch (e) {}
      Object.keys(un).forEach(function (k) { if (by[k]) { by[k].un = un[k].n; by[k].tx = un[k].tx; } ords.forEach(function (o) { if (o.k === k) { o.un = un[k].n; o.tx = un[k].tx; } }); });
      ords.sort(function (a, b) { return +b.last - +a.last; });
      if (!cR.get('CC_NSCAN')) { cR.put('CC_NSCAN', '1', 60); try { ccNotifyScan(P, 'poll'); } catch (e) {} }   // fallback when Slack's push is not pointed at the relay
      var gun = {}; try { gun = gdUnread(P, tok, who, req.groots || Object.keys(gdOrders(P)), req.op === 'ping' ? 4 : 8, !!req.fresh); } catch (e) {}
      var dms = [], dmerr = ''; try { dms = dmList(P, tok, who, req.op === 'ping' ? 2 : 4, !!req.fresh); } catch (e) { dms = []; dmerr = String(e.message || e).slice(0, 300); }   // 22 Oct 2026: the reason is shown in the app, never swallowed
      var ev = cR.get('CC_EV_AT'); return out({ ok: true, dms: dms, dmerr: dmerr, gun: gun, customers: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return +b.last - +a.last; }), orders: ords.slice(0, 150), live: ccLive(P), nt: !!ntf[ccWhoKey(who)], ev: !!ev });
    }
    if ((req.ch === 'godown' || req.ch === 'direct') && (req.op === 'thread' || req.op === 'seen' || req.op === 'post' || req.op === 'up')) {
      var gr = String(req.root || '').replace(/[^\d.]/g, ''); if (!gr) return out({ ok: false, error: req.ch === 'direct' ? 'no direct chat yet' : 'no #godown post for this order' });
      var isDm = req.ch === 'direct', XCH = GD_CH, XP = 'G';
      if (isDm) { XP = 'D'; var okNames = dmFor(P, who), okRoots = okNames.map(function (n) { return P.getProperty('CC_DM_ROOT_' + ccWhoKey(n)) || ''; }), di = okRoots.indexOf(gr); if (di < 0) return out({ ok: false, error: 'noaccess — this direct chat is not yours' }); XCH = dmChFor(P, tok, okNames[di]); }
      if (req.op === 'thread') {
        var gh = []; try { gh = isDm ? dmHist(tok, XCH, !!req.fresh) : gdHist(tok, !!req.fresh); } catch (e) {} var gm = gh.filter(function (m) { return m.ts === gr; })[0];
        var GL = chReplies(tok, XCH, gr, gm && gm.lr && !req.fresh ? gm.lr : ''), gms = isDm ? GL.filter(function (x) { return !x.root; }) : GL.map(function (x) { if (x.root) { x.memo = true; x.who = 'Godown pick list'; x.text = String(x.text || '').replace(/^\*GODOWN PICK LIST\*[^\n]*\n?/, ''); } return x; });
        if (req.look && gms.length) { var sg = ccSeenGet(P, who), tg = gms[gms.length - 1].ts; if (+tg > +(sg[XP + gr] || 0)) { sg[XP + gr] = tg; ccSeenPut(P, who, sg); } }
        return out({ ok: true, root: gr, msgs: gms });
      }
      if (req.op === 'seen') { var sg2 = ccSeenGet(P, who), tg2 = String(req.ts || (Date.now() / 1000)); if (+tg2 > +(sg2[XP + gr] || 0)) { sg2[XP + gr] = tg2; ccSeenPut(P, who, sg2); } return out({ ok: true }); }
      var gtx = String(req.text || '').slice(0, 3000), gres;
      if (req.op === 'post') { if (!gtx.trim()) return out({ ok: false, error: 'empty' }); var gp = slackApi(tok, 'chat.postMessage', { channel: XCH, thread_ts: gr, text: '*' + who + ':* ' + gtx }); if (!gp.ok) return out({ ok: false, error: ccErr(gp.error) }); gres = { ok: true, ts: gp.ts, root: gr }; }
      else {
        var gfs = Array.isArray(req.files) ? req.files.slice(0, 10) : [], gids = [], gtot = 0;
        for (var gi = 0; gi < gfs.length; gi++) { var gb = Utilities.base64Decode(String(gfs[gi].b64 || '')); gtot += gb.length; if (gb.length > 18000000 || gtot > 40000000) return out({ ok: false, error: 'files too big (18 MB each, 40 MB together)' }); gids.push(slackUp(tok, String(gfs[gi].name || 'file').replace(/[^\w.\- ]+/g, '-').slice(0, 80), gb)); }
        if (!gids.length) return out({ ok: false, error: 'no file' });
        var gj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
          payload: { files: JSON.stringify(gids.map(function (f) { return { id: f }; })), channel_id: XCH, thread_ts: gr, initial_comment: '*' + who + ':* ' + (gtx || '📎') } }).getContentText());
        if (!gj.ok) return out({ ok: false, error: ccErr(gj.error) }); gres = { ok: true, root: gr, files: gids.length };
      }
      if (isDm) cR.remove('DM_HIST_' + XCH); else bigDrop(cR, 'GD_HIST');
      var sg3 = ccSeenGet(P, who), nowG = String(Date.now() / 1000 + 2); if (+nowG > +(sg3[XP + gr] || 0)) { sg3[XP + gr] = nowG; ccSeenPut(P, who, sg3); }
      ccNudge(P, XP + gr);
      var grt = JSON.stringify(gres); if (rid) cR.put('CCR_' + rid, grt, 21600); return ContentService.createTextOutput(grt).setMimeType(ContentService.MimeType.JSON);
    }
    if (req.op === 'dmset') {                                   // 22 Oct 2026: Abbas made #sj-direct himself (bot not allowed to) and pastes its id from the app (owner only)
      if (!ownerOk(P, req.chk)) return out({ ok: false, error: 'owner only' });
      var dch = String(req.ch || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!/^[CG][A-Z0-9]{8,}$/.test(dch)) return out({ ok: false, error: 'that is not a channel id (it looks like C0ABC12DEF)' });
      var di = slackApi(tok, 'conversations.info', { channel: dch }, true); if (!di.ok) return out({ ok: false, error: ccErr(di.error) + ' — invite @SJ Memo to that channel' });
      var pn = String(req.name || '').replace(/[*_\n]/g, '').trim().slice(0, 40), who1 = pn ? dmPeople(P).filter(function (n) { return ccWhoKey(n) === ccWhoKey(pn); })[0] : '';
      if (pn && !who1) return out({ ok: false, error: 'no person called ' + pn + ' in the direct-chat list' });
      if (who1) { P.setProperty('CC_DM_CH_' + ccWhoKey(who1), dch); P.deleteProperty('CC_DM_ROOT_' + ccWhoKey(who1)); }
      else { P.setProperty('CC_DM_CH', dch); Object.keys(P.getProperties()).forEach(function (k) { if (k.indexOf('CC_DM_ROOT_') === 0 && !P.getProperty('CC_DM_CH_' + k.slice(11))) P.deleteProperty(k); }); }
      dmDrop(P); return out({ ok: true, ch: dch, name: (di.channel || {}).name || '', person: who1 || '' });
    }
    if (req.op === 'dmpeople') {                                // 22 Oct 2026: Abbas edits the list of people with a direct chat (owner check as the vault)
      if (!ownerOk(P, req.chk)) return out({ ok: false, error: 'owner only' });
      if (Array.isArray(req.people)) P.setProperty('CC_DM_PEOPLE', JSON.stringify(req.people.map(function (x) { return String(x || '').replace(/[*_\n]/g, '').trim().slice(0, 40); }).filter(String).slice(0, 20)));
      return out({ ok: true, people: dmPeople(P) });
    }
    if (req.op === 'findroot') {                                  // 20 Oct 2026: an order sent before its posts were remembered - find its pick-list post in #godown and its memo post in #customer
      var fk = ccKey(String(req.name || '').replace(/[*_]/g, ' ')) || 'NO NAME', at = (+req.at || Date.now()) / 1000, best = function (list, re) {
        var hit = null, gap = 3 * 86400; list.forEach(function (m) { var mm = String(m.text || '').match(re); if (!mm) return; var nk = ccKey(mm[1].replace(/[*_]/g, ' ')); if (nk !== fk) return;
          var d = Math.abs(+m.ts - at) + (+m.ts < at - 120 ? 3600 : 0); if (d < gap) { gap = d; hit = m.ts; } }); return hit || ''; };
      var fg = '', fc = ''; try { fg = best(gdHist(tok, true), /^\*GODOWN PICK LIST\*[^\n]*—\s*([^\n]+)/); } catch (e) {} try { fc = best(ccHist(tok, true), /^\*ORDER MEMO[^*\n]*\*[^\n]*—\s*([^\n]+)/); } catch (e) {}
      return out({ ok: true, gts: fg, cts: fc });
    }
    if (req.op === 'mkroot') {                                    // an order sent before 19 Oct has no post in that channel yet: one short post starts its chat
      var mch = req.ch === 'godown' ? GD_CH : CC_CH, mtx = String(req.text || '').slice(0, 1500); if (!mtx.trim()) return out({ ok: false, error: 'empty' });
      var mp = slackApi(tok, 'chat.postMessage', { channel: mch, text: mtx }); if (!mp.ok) return out({ ok: false, error: ccErr(mp.error) });
      bigDrop(cR, req.ch === 'godown' ? 'GD_HIST' : 'CC_HIST'); var mrt = JSON.stringify({ ok: true, ts: mp.ts }); if (rid) cR.put('CCR_' + rid, mrt, 21600); return ContentService.createTextOutput(mrt).setMimeType(ContentService.MimeType.JSON);
    }
    if (req.op === 'thread' && req.root) {
      var rts = String(req.root).replace(/[^\d.]/g, ''), rm = ccHist(tok, !!req.fresh).filter(function (m) { return m.ts === rts; })[0];
      if (!rm) { try { var one = slackApi(tok, 'conversations.replies', { channel: CC_CH, ts: rts, limit: 1 }, true); var x0 = one.ok && (one.messages || [])[0]; if (x0) rm = { ts: x0.ts, text: String(x0.text || '').slice(0, 1500), rc: x0.reply_count || 0, lr: x0.latest_reply || '', files: (x0.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }; } catch (e) {} }
      if (!rm) return out({ ok: false, error: 'this order post is not in #customer any more' });
      var ms2 = [{ ts: rm.ts, who: 'Order memo', memo: true, text: rm.text.replace(/^\*ORDER MEMO[^*\n]*\*[^\n]*\n?/, ''), files: rm.files }];
      if (rm.rc) ccReplies(tok, rm).forEach(function (x) { ms2.push(x); });
      if (req.look) { var so = ccSeenGet(P, who), tp2 = ms2[ms2.length - 1].ts; if (+tp2 > +(so['O' + rts] || 0)) { so['O' + rts] = tp2; ccSeenPut(P, who, so); } }
      return out({ ok: true, name: ccName(rm.text) || String(req.name || ''), root: rts, head: ccMemoHead(rm.text), msgs: ms2 });
    }
    if (req.op === 'thread') {
      var key = ccKey(req.name); if (!key) return out({ ok: false, error: 'no customer name' });
      var mine = ccHist(tok, !!req.fresh).filter(function (m) { return ccKey(ccName(m.text)) === key; }), msgs = [];
      mine.forEach(function (m) {
        var memo = /^\*ORDER MEMO[^*\n]*\*/.test(m.text);
        if (memo) msgs.push({ ts: m.ts, who: 'Order memo', memo: true, text: m.text.replace(/^\*ORDER MEMO[^*\n]*\*[^\n]*\n?/, ''), files: m.files });
        if (m.rc) ccReplies(tok, m).forEach(function (x) { msgs.push(x); });
      });
      msgs.sort(function (a, b) { return +a.ts - +b.ts; });
      var root = (mine.filter(function (m) { return ccIsRoot(m.text); })[0] || {}).ts || '';
      if (req.look && msgs.length) { var s = ccSeenGet(P, who), top = msgs[msgs.length - 1].ts; if (+top > +(s[key] || 0)) { s[key] = top; ccSeenPut(P, who, s); } }   // seen only while the person is really looking (the app says)
      return out({ ok: true, name: req.name, root: root, msgs: msgs });
    }
    if (req.op === 'seen') { var sk = req.root ? 'O' + String(req.root).replace(/[^\d.]/g, '') : ccKey(req.name); if (!sk || sk === 'O') return out({ ok: false, error: 'no customer name' }); var s2 = ccSeenGet(P, who), t2 = String(req.ts || (Date.now() / 1000)); if (+t2 > +(s2[sk] || 0)) { s2[sk] = t2; ccSeenPut(P, who, s2); } return out({ ok: true }); }
    if (req.op === 'ntfyset') { var tp = String(req.topic || '').replace(/[^\w-]/g, '').slice(0, 64); if (tp.length < 8) return out({ ok: false, error: 'bad topic' }); var nmap = {}; try { nmap = JSON.parse(P.getProperty('CCNTFY') || '{}'); } catch (e) {} nmap[ccWhoKey(who)] = tp; P.setProperty('CCNTFY', JSON.stringify(nmap));
      var hs; try { hs = ccHist(tok, false); } catch (e) { hs = []; } var un0 = ccUnread(P, tok, hs, who, 8), noted0 = {}; Object.keys(un0).forEach(function (k) { noted0[k] = un0[k].last; }); try { P.setProperty('CCNOTE_' + ccWhoKey(who), JSON.stringify(noted0)); } catch (e) {}   // no flood of old messages
      return out({ ok: true }); }
    if (req.op === 'ntfyoff') { var omap = {}; try { omap = JSON.parse(P.getProperty('CCNTFY') || '{}'); } catch (e) {} delete omap[ccWhoKey(who)]; P.setProperty('CCNTFY', JSON.stringify(omap)); return out({ ok: true }); }
    if (req.op === 'ntfytest') { var tmap = {}; try { tmap = JSON.parse(P.getProperty('CCNTFY') || '{}'); } catch (e) {} var tt = tmap[ccWhoKey(who)]; if (!tt) return out({ ok: false, error: 'notifications are off for ' + who }); // 20 Oct 2026: a failed SJ Stock test now says WHY (ntfy's own answer), so the phone shows the real reason instead of "ntfy did not answer"
      try { var tr = UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ topic: tt, title: 'SJ Stock · test', message: 'Notifications are on for ' + who + ' ✓', click: 'https://abbas911-prog.github.io/sj-designs/memo.html#chat=', tags: ['speech_balloon'], priority: 4 }) });
        var tc = tr.getResponseCode(); if (tc === 200) return out({ ok: true });
        var tb = ''; try { var tj = JSON.parse(tr.getContentText()); tb = tj.error || ''; } catch (e) { tb = String(tr.getContentText() || '').slice(0, 120); }
        return out({ ok: false, error: 'ntfy refused it (' + tc + (tb ? ': ' + tb : '') + ')' + (tc === 429 ? ' - ntfy limits messages from Google servers; tell Claude' : '') });
      } catch (e) { return out({ ok: false, error: 'could not reach ntfy (' + String(e.message || e).slice(0, 120) + ')' }); } }
    if (req.op === 'post' || req.op === 'up') {
      var nm = String(req.name || '').replace(/[*_\n]/g, ' ').trim().slice(0, 60), k2 = ccKey(nm), txt = String(req.text || '').slice(0, 3000);
      var oroot = String(req.root || '').replace(/[^\d.]/g, '');                 // 18 Oct 2026: a line written in an ORDER chat goes under that order's post
      if (!k2 && !oroot) return out({ ok: false, error: 'no customer name' });
      var rootTs = oroot || ccRoot(P, tok, nm, k2, cR), res, sk2 = oroot ? 'O' + oroot : k2;
      if (req.op === 'post') { if (!txt.trim()) return out({ ok: false, error: 'empty' }); var pj = slackApi(tok, 'chat.postMessage', { channel: CC_CH, thread_ts: rootTs, text: '*' + who + ':* ' + txt }); if (!pj.ok) return out({ ok: false, error: ccErr(pj.error) }); res = { ok: true, ts: pj.ts, root: rootTs }; }
      else {
        var fs = Array.isArray(req.files) ? req.files.slice(0, 10) : [], ids = [], tot = 0;
        for (var i = 0; i < fs.length; i++) { var b = Utilities.base64Decode(String(fs[i].b64 || '')); tot += b.length; if (b.length > 18000000 || tot > 40000000) return out({ ok: false, error: 'files too big (18 MB each, 40 MB together)' }); ids.push(slackUp(tok, String(fs[i].name || 'file').replace(/[^\w.\- ]+/g, '-').slice(0, 80), b)); }
        if (!ids.length) return out({ ok: false, error: 'no file' });
        var cj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true,
          payload: { files: JSON.stringify(ids.map(function (f) { return { id: f }; })), channel_id: CC_CH, thread_ts: rootTs, initial_comment: '*' + who + ':* ' + (txt || '📎') } }).getContentText());
        if (!cj.ok) return out({ ok: false, error: ccErr(cj.error) }); res = { ok: true, root: rootTs, files: ids.length };
      }
      bigDrop(cR, 'CC_HIST');
      var s3 = ccSeenGet(P, who), nowTs = String(Date.now() / 1000 + 2); if (+nowTs > +(s3[sk2] || 0)) { s3[sk2] = nowTs; ccSeenPut(P, who, s3); }   // my own line is never "new" for me
      ccNudge(P, sk2);
      var rt = JSON.stringify(res); if (rid) cR.put('CCR_' + rid, rt, 21600); return ContentService.createTextOutput(rt).setMimeType(ContentService.MimeType.JSON);
    }
    if (req.op === 'file') {                                    // a photo / PDF / voice note of the chat, for the phone (original bytes)
      var fid = String(req.id || '').replace(/[^A-Z0-9]/g, ''), fi = slackApi(tok, 'files.info', { file: fid }, true); if (!fi.ok) return out({ ok: false, error: ccErr(fi.error) });
      var f = fi.file || {}, u = req.thumb ? (f.thumb_720 || f.thumb_480 || f.url_private) : (f.url_private_download || f.url_private); if (!u) return out({ ok: false, error: 'no file link' });
      if (!req.thumb && (f.size || 0) > 14000000) return out({ ok: false, error: 'file too big for the app', link: f.permalink || '' });
      var r = UrlFetchApp.fetch(u, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
      var fbl = r.getResponseCode() === 200 ? r.getBlob() : null;
      if (!fbl || /text\/html/.test(String(fbl.getContentType() || ''))) return out({ ok: false, error: 'Slack refused the file (the SJ Memo app needs files:read)', link: f.permalink || '' });
      return out({ ok: true, b64: Utilities.base64Encode(fbl.getBytes()), type: f.mimetype || 'application/octet-stream', name: f.name || fid });
    }
    return out({ ok: false, error: 'the relay does not know "' + req.op + '" yet - Abbas must deploy the new version' });
  } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 300) }); }
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
function doCostSale(cardId, req, tok, notes) {                 // COST / SALE custom fields on a USMAN HAND WORK card (Abbas 1 Oct for US- cards, 12 Oct for hand-work orders too)
  [[DOX.COST, req.cost], [DOX.SALE, req.sale]].forEach(function (x) {
    if (x[1] === '' || x[1] == null || !isFinite(+x[1])) return;
    try { trApi('put', '/cards/' + cardId + '/customField/' + x[0] + '/item', {}, tok, { value: { number: String(+x[1]) } }); } catch (e) { notes.push('COST/SALE not set: ' + String(e.message).slice(0, 80)); }
  });
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
        doCostSale(card.id, req, tok, notes);
        st.newCard = true;
      } else if (req.fresh && !req.src && !(req.base && doFindCard(req.base, tok))) {   // /N with nothing to copy: a plain card with RATE + HISAAB
        var labs = [DOX.RATE, DOX.HISAAB]; if (req.customer) labs.push(doLabel(DOX.ALM, req.customer, tok));
        card = trApi('post', '/cards', { idList: DOX.START, name: name, pos: 'top', idLabels: labs.join(',') }, tok);
        st.newCard = true;
      } else {                                                // the normal order: a real COPY of the newest ALM card
        // 18 Oct 2026 (Abbas, SJ-35895): /N with a design number = copy THAT design's card (pictures + custom fields) under the NEW number - before, /N made an empty card
        var src = req.src ? trApi('get', '/cards/' + req.src, { fields: 'name,closed,idAttachmentCover,shortUrl' }, tok) : doFindCard(req.base || req.no, tok);
        if (!src) return out({ ok: false, error: 'no ALM card found for ' + (req.base || req.no) + ' - mark it /N if it is a new fabric' });
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
        doCostSale(uc.id, req, tok, notes);                    // Abbas 12 Oct 2026: "two spaces for the cost price and the sale price ... mention them in the custom fields of those cards"
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
// CUSTOMER BALANCES (Abbas, 11 Oct 2026: "save the opening balances within the app ... when I make a receipt of a particular customer
// once with the given opening balance, you should continue from there on, be it sales or receipt, from now onwards").
// One Google Sheet in his Drive, made by the relay on first use ("SJ Customer Balances (order memo app)"):
//   CUSTOMERS: KEY | CUSTOMER | OPENING | OPENING DATE | ADDED | BY
//   ENTRIES:   ID | KEY | CUSTOMER | TYPE (inv / rv / adj) | REF | DATE | SALE | RECEIVED | ADJUST | BY | DEVICE | SAVED | VOID
// balance = OPENING + SALE - RECEIVED + ADJUST over the entries that are not void. An entry ID is "<type>:<ref>:<device>", so sending the
// same invoice / receipt again replaces its line instead of adding a second one. Signed with the shop password (staff make bills too);
// the full list and the statements need the owner key-check as well.
// Run this once from the editor (pick setupSheets next to Run, press Run, allow Google Sheets): it asks for the Sheets permission
// and makes the balances sheet. The web app cannot ask for a new permission by itself.
function setupSheets() { var ss = custBook(PropertiesService.getScriptProperties()); console.log('Customer balances sheet: ' + ss.getUrl()); }
function custKey(n) { return String(n || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
function custNum(v) { var x = parseFloat(String(v == null ? '' : v).replace(/[,\s]/g, '')); return isFinite(x) ? Math.round(x * 100) / 100 : 0; }
function custBook(P) {
  var id = P.getProperty('CUST_SHEET'), ss = null;
  if (id) try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('SJ Customer Balances (order memo app)');
    var c = ss.getSheets()[0]; c.setName('CUSTOMERS'); c.appendRow(['KEY', 'CUSTOMER', 'OPENING', 'OPENING DATE', 'ADDED', 'BY']); c.setFrozenRows(1);
    var e = ss.insertSheet('ENTRIES'); e.appendRow(['ID', 'KEY', 'CUSTOMER', 'TYPE', 'REF', 'DATE', 'SALE', 'RECEIVED', 'ADJUST', 'BY', 'DEVICE', 'SAVED', 'VOID']); e.setFrozenRows(1);
    [c, e].forEach(function (sh) { sh.getRange('A:Z').setNumberFormat('@'); });   // keep dates and refs as typed text
    P.setProperty('CUST_SHEET', ss.getId());
  }
  return ss;
}
function custLoad(ss) {
  var C = ss.getSheetByName('CUSTOMERS'), E = ss.getSheetByName('ENTRIES');
  var cs = C.getDataRange().getDisplayValues().slice(1).map(function (r, i) { return { row: i + 2, key: r[0], name: r[1], open: custNum(r[2]), odate: r[3], gone: !!r[6] }; })
    .filter(function (c) { return !c.gone; });                        // a deleted customer keeps its row, marked in column G
  var es = E.getDataRange().getDisplayValues().slice(1).map(function (r, i) { return { row: i + 2, id: r[0], key: r[1], name: r[2], type: r[3], ref: r[4], date: r[5],
    sale: custNum(r[6]), recv: custNum(r[7]), adj: custNum(r[8]), by: r[9], dev: r[10], saved: r[11], voided: !!r[12] }; });
  return { C: C, E: E, cs: cs, es: es };
}
function custBal(L, key, except) {
  var c = L.cs.filter(function (x) { return x.key === key; })[0]; if (!c) return null;
  var es = L.es.filter(function (e) { return e.key === key && !e.voided && e.id !== except; });
  var bal = es.reduce(function (a, e) { return a + e.sale - e.recv + e.adj; }, c.open);
  return { name: c.name, open: c.open, odate: c.odate, bal: Math.round(bal * 100) / 100, n: es.length, es: es };
}
function cust(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var op = req.op, owner = req.chk ? ownerOk(P, req.chk) : false;
  try {
    var ss = custBook(P), lock = null;
    if (op === 'post' || op === 'void' || op === 'setopen' || op === 'delcust') { lock = LockService.getScriptLock(); lock.waitLock(15000); }
    try {
      var L = custLoad(ss), key = custKey(req.name);
      if (op === 'names') return out({ ok: true, names: L.cs.map(function (c) { return c.name; }).sort() });
      if (op === 'get') {
        var b = custBal(L, key, String(req.except || ''));
        if (!b) return out({ ok: true, found: false });
        var o = { ok: true, found: true, name: b.name, open: b.open, odate: b.odate, bal: b.bal, n: b.n };
        o.entries = b.es.map(function (e) { return { id: e.id, type: e.type, ref: e.ref, date: e.date, sale: e.sale, recv: e.recv, adj: e.adj, by: e.by }; });
        return out(o);
      }
      if (op === 'list') {                   // 11 Oct 2026: his employee sees the balances too (any phone with the shop password)
        return out({ ok: true, sheet: ss.getUrl(), list: L.cs.map(function (c) { var b = custBal(L, c.key); var last = b.es.map(function (e) { return e.date; }).sort().pop() || c.odate;
          return { name: c.name, bal: b.bal, n: b.n, last: last }; }) });
      }
      if (op === 'post') {
        if (!key) return out({ ok: false, error: 'no customer name' });
        var id = String(req.id || '').slice(0, 80), type = ['inv', 'rv', 'adj'].indexOf(req.type) >= 0 ? req.type : '';
        if (!id || !type) return out({ ok: false, error: 'bad request' });
        var now = new Date().toISOString(), made = false;
        if (!L.cs.some(function (c) { return c.key === key; })) {          // first time: what he typed becomes the opening balance
          L.C.appendRow([key, String(req.name).trim().replace(/\s+/g, ' ').slice(0, 80), String(custNum(req.open)), String(req.date || now.slice(0, 10)), now, String(req.by || '').slice(0, 40)]);
          L = custLoad(ss); made = true;
        }
        var c = L.cs.filter(function (x) { return x.key === key; })[0];
        var row = [id, key, c.name, type, String(req.ref || '').slice(0, 40), String(req.date || now.slice(0, 10)), String(custNum(req.sale)), String(custNum(req.recv)), String(custNum(req.adj)),
          String(req.by || '').slice(0, 40), String(req.dev || '').slice(0, 20), now, ''];
        var have = L.es.filter(function (e) { return e.id === id; })[0];
        if (have) L.E.getRange(have.row, 1, 1, row.length).setValues([row]); else L.E.appendRow(row);
        L = custLoad(ss); var b2 = custBal(L, key);
        return out({ ok: true, made: made, name: b2.name, bal: b2.bal, n: b2.n });
      }
      if (op === 'void') {
        var hv = L.es.filter(function (e) { return e.id === String(req.id || ''); })[0];
        if (hv && !hv.voided) L.E.getRange(hv.row, 13).setValue(new Date().toISOString() + ' ' + String(req.by || '').slice(0, 30));
        var b3 = hv ? custBal(custLoad(ss), hv.key) : null;
        return out({ ok: true, name: b3 && b3.name, bal: b3 && b3.bal });
      }
      if (op === 'delcust') {                // 11 Oct 2026 (Abbas): customers can be deleted; the rows stay in the sheet, marked
        var dc = L.cs.filter(function (x) { return x.key === key; })[0]; if (!dc) return out({ ok: false, error: 'no such customer' });
        var mark = new Date().toISOString() + ' ' + String(req.by || '').slice(0, 30);
        L.es.forEach(function (e) { if (e.key === key && !e.voided) L.E.getRange(e.row, 13).setValue(mark + ' (customer deleted)'); });
        L.C.getRange(dc.row, 7).setValue(mark);
        return out({ ok: true });
      }
      if (op === 'setopen') {
        var cc = L.cs.filter(function (x) { return x.key === key; })[0]; if (!cc) return out({ ok: false, error: 'no such customer' });
        L.C.getRange(cc.row, 3, 1, 2).setValues([[String(custNum(req.open)), String(req.odate || cc.odate)]]);
        var b4 = custBal(custLoad(ss), key); return out({ ok: true, name: b4.name, bal: b4.bal });
      }
      return out({ ok: false, error: 'bad request' });
    } finally { if (lock) lock.releaseLock(); }
  } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 300) }); }
}
// CASH ENTRY (Abbas, 11 Oct 2026): his #purchase lines typed in the app (owner phone only) and posted to #purchase by the SJ Memo
// bot, photos attached, in the exact wording the 22:00 SJ Cash run reads. The run still writes the ledger; this only posts.
var PURCHASE_CH = 'C09SCSQ0M6J';
function cashPost(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  if (!ownerOk(P, req.chk)) return out({ ok: false, error: 'owner password does not match' });
  if (req.op === 'list') return out({ ok: true, log: JSON.parse(P.getProperty('CASHLOG') || '[]') });
  if (req.op !== 'post') return out({ ok: false, error: 'bad request' });
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return out({ ok: false, error: 'the relay has no SLACK_BOT_TOKEN' });
  var id = String(req.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40), text = String(req.text || '').slice(0, 3000);
  var nph = (req.photos || []).length; if (!id || (!text.trim() && !nph)) return out({ ok: false, error: 'nothing to send - type a line or attach a photo' });   // 13 Oct 2026 (Abbas): a photo alone is enough, text may be blank
  var key = 'CASH_' + id, st = JSON.parse(P.getProperty(key) || '{}');
  if (st.done) return out({ ok: true, again: true });               // pressing Send again never posts twice
  try {
    st.files = st.files || [];
    (req.photos || []).forEach(function (b64, i) {
      if (st.files[i]) return;
      st.files[i] = slackUp(tok, 'purchase-' + (i + 1) + '.jpg', Utilities.base64Decode(String(b64))); P.setProperty(key, JSON.stringify(st));
    });
    slackShare(tok, st.files, [PURCHASE_CH], text);
    st.done = Date.now(); P.setProperty(key, JSON.stringify(st));
    var log = JSON.parse(P.getProperty('CASHLOG') || '[]'); log.unshift({ t: st.done, text: (text.trim() || '(photo only)').slice(0, 300), n: st.files.length, read: String(req.read || '').slice(0, 160) });
    P.setProperty('CASHLOG', JSON.stringify(log.slice(0, 30)));
    return out({ ok: true });
  } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 200) + (/not_in_channel|channel_not_found/.test(String(e)) ? ' - invite @SJ Memo to #purchase' : '') }); }
}
function doGet() { return out({ ok: true, relay: 'sj-memo' }); }
function hex(bytes) { return bytes.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join(''); }
// ---------- SAVED BILLS (Abbas, 18 Oct 2026: "keep that invoice in the draft somewhere. So if I had to make some changes in the bill, I would go
// inside the bill and change whatever I want to change") ----------
// Every invoice / receipt voucher / payment voucher the app draws is kept here, one row per number, in the BILLS tab of the customer-balances
// spreadsheet. Any phone with the shop password can list them, open one (the app rebuilds the form from DATA), change it and send it again.
// STATUS: draft (made) -> sent (Send PDF pressed) -> included (Include & share pressed). 'deleted' hides a row. DATA = the app's JSON, in 45k chunks.
function billsSheet(ss) { var S = ss.getSheetByName('BILLS'); if (!S) { S = ss.insertSheet('BILLS'); S.appendRow(['REF', 'TYPE', 'CUSTOMER', 'STATUS', 'TOTAL', 'DATE', 'UPDATED', 'BY', 'DEVICE', 'DATA1', 'DATA2', 'DATA3', 'DATA4', 'DATA5', 'DATA6']); S.setFrozenRows(1); S.getRange('A:O').setNumberFormat('@'); } return S; }
function bills(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var ref = String(req.ref || '').trim().toUpperCase().slice(0, 30), op = req.op;
  try {
    var S = billsSheet(custBook(P)), rows = S.getDataRange().getDisplayValues().slice(1);
    function row(r) { return { ref: r[0], type: r[1], name: r[2], status: r[3], total: r[4], date: r[5], updated: r[6], by: r[7], dev: r[8] }; }
    if (op === 'list') { var L = rows.map(row).filter(function (b) { return b.ref && b.status !== 'deleted'; }); L.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; }); return out({ ok: true, bills: L.slice(0, 400) }); }
    if (!ref) return out({ ok: false, error: 'no bill number' });
    var idx = -1; rows.forEach(function (r, i) { if (r[0] === ref) idx = i; });
    if (op === 'get') { if (idx < 0 || rows[idx][3] === 'deleted') return out({ ok: false, error: 'not saved' }); var o = row(rows[idx]); o.ok = true; o.data = rows[idx].slice(9).map(function (x) { return String(x || '').replace(/^J/, ''); }).join(''); return out(o); }
    if (op === 'put') {
      var data = String(req.data || ''); if (!data || data.length > 268000) return out({ ok: false, error: 'bill too big to keep' });
      var lock = LockService.getScriptLock(); lock.waitLock(15000);
      try {
        rows = S.getDataRange().getDisplayValues().slice(1); idx = -1; rows.forEach(function (r, i) { if (r[0] === ref) idx = i; });
        var old = idx >= 0 ? row(rows[idx]) : null, st = String(req.status || 'draft').slice(0, 12), rank = { draft: 0, sent: 1, included: 2 };
        if (old && old.dev && req.dev && old.dev !== String(req.dev) && custKey(old.name) !== custKey(req.name) && !req.force) return out({ ok: false, clash: true, error: ref + ' is already used on another phone (for ' + (old.name || 'another customer') + ')' });   // bill numbers run per phone
        if (old && !req.force && (rank[old.status] || 0) > (rank[st] || 0)) st = old.status;      // a bill never goes back from sent/included by itself
        var vals = [ref, String(req.type || 'inv').slice(0, 4), String(req.name || '').slice(0, 80), st, String(req.total || '').slice(0, 20), String(req.date || '').slice(0, 10), new Date().toISOString(), String(req.by || '').slice(0, 40), String(req.dev || '').slice(0, 12)];
        for (var i = 0; i < 6; i++) { var ch = data.slice(i * 45000, (i + 1) * 45000); vals.push(ch ? 'J' + ch : ''); }   // 'J' in front: a cell can never be read as a formula
        if (idx < 0) S.appendRow(vals); else S.getRange(idx + 2, 1, 1, vals.length).setValues([vals]);
      } finally { lock.releaseLock(); }
      return out({ ok: true, ref: ref, status: st });
    }
    if (op === 'next') {                                          // 21 Oct 2026: ONE number series for the whole shop. When a bill is finalised (green button / Send) the phone
      // asks "is my number free?": kept when no other phone used it and it is ahead of every number in the sheet; otherwise the next free number is
      // given (and reserved here at once, so two phones can never get the same one). The phone's old draft row moves aside (deleted).
      var ty = String(req.type || 'inv').slice(0, 4), pfx = (ref.match(/^[A-Z]+-/) || [ty.toUpperCase() + '-'])[0], mine = +((ref.match(/(\d+)\s*$/) || [])[1] || 0), give = ref;
      var lock2 = LockService.getScriptLock(); lock2.waitLock(15000);
      try {
        rows = S.getDataRange().getDisplayValues().slice(1); var top = 0, taken = false, ri = -1;
        rows.forEach(function (r, i) { if (r[1] !== ty) return; var n = +((String(r[0]).match(/(\d+)\s*$/) || [])[1] || 0), own = r[0] === ref && !(r[8] && req.dev && r[8] !== String(req.dev));
          if (r[0] === ref) { ri = i; if (!own && r[3] !== 'deleted') taken = true; }
          if (own && r[3] !== 'deleted') return;                 // my own live draft under this number does not count against me; every other number (even deleted ones) does
          if (n > top) top = n; });
        if (taken || mine <= top) { give = pfx + String(top + 1).padStart(4, '0');
          S.appendRow([give, ty, String(req.name || '').slice(0, 80), 'draft', '', String(req.date || '').slice(0, 10), new Date().toISOString(), String(req.by || '').slice(0, 40), String(req.dev || '').slice(0, 12)]);
          if (ri >= 0 && !taken && rows[ri][3] === 'draft') S.getRange(ri + 2, 4).setValue('deleted'); }
      } finally { lock2.releaseLock(); }
      return out({ ok: true, ref: give, was: ref });
    }
    if (op === 'del') { if (idx >= 0) S.getRange(idx + 2, 4).setValue('deleted'); return out({ ok: true }); }
    return out({ ok: false, error: 'the relay does not know "' + op + '" yet' });
  } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 200) }); }
}
// 19 Oct 2026: run this ONE time from the editor (▷ Run) when the app says "Balance not checked … SpreadsheetApp … permission".
// It opens the customer-balances sheet, so Google asks for the Sheets permission; after Allow, Deploy → New version.
function sheetCheck() { var P = PropertiesService.getScriptProperties(), ss = custBook(P); var L = ['sheet: ' + ss.getName(), 'tabs: ' + ss.getSheets().map(function (x) { return x.getName(); }).join(', '), 'bills saved: ' + Math.max(0, billsSheet(ss).getLastRow() - 1)]; Logger.log(L.join('\n')); return L.join('\n'); }
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
// 15 Oct 2026: read-only check run from the editor (▶ Run facDiag) - prints what the factory app's "new messages" logic sees. No keys or tokens are printed.
function snDiag() {                                            // read-only check from the editor: #samplesneed access + the Usman channels the factory bot sees (no keys printed)
  var P = PropertiesService.getScriptProperties(), ST = P.getProperty('SLACK_BOT_TOKEN'), FT = P.getProperty('SLACK_FACTORY_TOKEN'), c = CacheService.getScriptCache(), L = [];
  L.push('SNEED_LAST ' + P.getProperty('SNEED_LAST') + ' · err ' + c.get('SNEED_ERR') + ' · label ' + P.getProperty('FSAMPLE_LBL') + ' · returns ' + P.getProperty('FRET_LISTS') + ' · usman-sample ' + P.getProperty('FAC_USMP'));
  var h = slackApi(ST, 'conversations.history', { channel: DOX.SAMPLESNEED, limit: 6 }, true); L.push('#samplesneed ok=' + h.ok + (h.ok ? '' : ' err=' + h.error));
  (h.messages || []).forEach(function (m) { L.push('  ' + m.ts + ' files ' + (m.files || []).map(function (f) { return f.mimetype; }).join(',') + ' · ' + String(m.text || '').slice(0, 50).replace(/\n/g, ' ')); });
  try { facChans(FT).filter(function (x) { return /usman|sample/i.test(x.name); }).forEach(function (x) { L.push('factory channel #' + x.name + ' ' + x.id + (x.member ? ' (bot in)' : ' (bot NOT in)') + (x.priv ? ' private' : '')); }); } catch (e) { L.push('channels err ' + e.message); }
  Logger.log(L.join('\n'));
}
function facDiag() {
  var P = PropertiesService.getScriptProperties(), FT = P.getProperty('SLACK_FACTORY_TOKEN'), c = CacheService.getScriptCache(), L = [];
  var dm = JSON.parse(P.getProperty('FAC_DM') || 'null'); L.push('direct chat: ' + JSON.stringify(dm));
  L.push('slack push seen: ' + (P.getProperty('FAC_EVENTS_ON') ? new Date(+P.getProperty('FAC_EVENTS_ON')).toISOString() : 'NEVER') + ' · gen ' + facGen() + ' · slow-down ' + (c.get('FAC_RL') || 'no'));
  L.push('notify people: ' + Object.keys(JSON.parse(P.getProperty('FNTFY') || '{}')).join(','));
  ['ABBAS'].forEach(function (w) { var r = JSON.parse(P.getProperty('FSEEN_' + w) || '{}'); L.push('seen ' + w + ': first use ' + r._t0 + ' · dm ' + r.dm + ' · v ' + r._v); });
  if (dm && FT) {
    var h = slackApi(FT, 'conversations.history', { channel: dm.ch, limit: 8 }, true);
    L.push('dm history ok=' + h.ok + (h.ok ? '' : ' err=' + h.error));
    (h.messages || []).forEach(function (m) { L.push('  ' + m.ts + ' ' + (m.user ? 'user ' + facUser(P, FT, m.user).n : 'bot') + (m.subtype ? ' [' + m.subtype + ']' : '') + (m.reply_count ? ' replies ' + m.reply_count + ' last ' + m.latest_reply : '') + ' · ' + String(m.text || '').slice(0, 50)); });
  }
  var lc = bigGet(c, 'FAC_LIST_L') || bigGet(c, 'FAC_LIST'); L.push('cached list: ' + (lc ? JSON.parse(lc).cards.length + ' cards' : 'none'));
  try { L.push('unread ABBAS: ' + JSON.stringify(facUnread(P, FT, lc ? JSON.parse(lc).cards : [], 'Abbas', true))); } catch (e) { L.push('unread error: ' + e.message); }
  var cut = slackApi(FT, 'conversations.history', { channel: DOX.CUTTING, limit: 5 }, true); L.push('#cutting ok=' + cut.ok + (cut.ok ? '' : ' err=' + cut.error));
  (cut.messages || []).forEach(function (m) { L.push('  root ' + m.ts + ' replies ' + (m.reply_count || 0) + ' last ' + (m.latest_reply || '-') + ' · ' + String(m.text || '').slice(0, 40).replace(/\n/g, ' ')); });
  var since = Date.now() / 1000 - 3 * 3600;                     // everything written in the last 3 hours in every channel the bot is in
  facChans(FT).filter(function (x) { return x.member; }).forEach(function (ch) {
    var hh = slackApi(FT, 'conversations.history', { channel: ch.id, limit: 30 }, true); if (!hh.ok) { L.push('#' + ch.name + ' err ' + hh.error); return; }
    (hh.messages || []).forEach(function (m) {
      if (+m.ts > since) L.push('#' + ch.name + ' NEW top ' + m.ts + ' ' + String(m.text || '').slice(0, 50).replace(/\n/g, ' '));
      if (m.latest_reply && +m.latest_reply > since) L.push('#' + ch.name + ' NEW reply in thread ' + m.ts + ' at ' + m.latest_reply + ' · card thread? ' + (Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('FTH_') === 0 && P.getProperty(k).indexOf(m.ts) >= 0; })[0] || 'NO') + ' · ' + String(m.text || '').slice(0, 40).replace(/\n/g, ' '));
    });
  });
  Logger.log(L.join('\n')); return L.join('\n');
}

// ===== TIMO (19 Oct 2026) =====
// Abbas's own day planner (timo.html, opened from the SJ Stock app's More menu on owner phones). The whole planner is one JSON copy kept in a
// TIMO tab of the customer-balances spreadsheet (chunks of 45k with a 'J' in front so a cell never turns into a formula). Signed with the shop
// password like every memo job, plus the owner key-check, so staff phones can never read or change it. Newest copy wins: a put older than the
// stored one is refused with the stored copy, and the phone switches to it.
function timo(req, P) {
  var o = JSON.parse(req);
  if (!ownerOk(P, o.chk)) return out({ ok: false, error: 'owner only' });
  var ss = custBook(P), T = ss.getSheetByName('TIMO');
  if (!T) { T = ss.insertSheet('TIMO'); T.appendRow(['UPDATED', 'AT', 'DEVICE', 'DATA1', 'DATA2', 'DATA3', 'DATA4', 'DATA5', 'DATA6', 'DATA7', 'DATA8']); T.getRange('A:Z').setNumberFormat('@'); T.setFrozenRows(1); }
  var read = function () { if (T.getLastRow() < 2) return { at: 0, data: '' }; var r = T.getRange(2, 1, 1, 11).getValues()[0];
    return { at: +r[1] || 0, data: r.slice(3).map(function (c) { return String(c || '').replace(/^J/, ''); }).join('') }; };
  if (o.op === 'get') { var g = read(); return out({ ok: true, at: g.at, data: g.data }); }
  if (o.op === 'put') {
    var data = String(o.data || ''), at = +o.at || 0;
    if (!data || data.length > 8 * 45000) return out({ ok: false, error: 'too big' });
    try { JSON.parse(data); } catch (x) { return out({ ok: false, error: 'bad data' }); }
    var lk = LockService.getScriptLock(); lk.waitLock(20000);
    try {
      var cur = read(); if (cur.at > at && !o.force) return out({ ok: false, stale: true, at: cur.at, data: cur.data });
      var row = [Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd HH:mm:ss'), String(at), String(o.dev || '')];
      for (var i = 0; i < 8; i++) { var part = data.slice(i * 45000, (i + 1) * 45000); row.push(part ? 'J' + part : ''); }
      T.getRange(2, 1, 1, 11).setValues([row]);
    } finally { lk.releaseLock(); }
    return out({ ok: true, at: at });
  }
  return out({ ok: false, error: 'bad op' });
}
