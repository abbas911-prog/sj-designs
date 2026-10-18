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
    if (b.type === 'event_callback') { var cE = CacheService.getScriptCache(), eid = String(b.event_id || '').slice(0, 40); if (eid && cE.get('FEV_' + eid)) return out({ ok: true }); if (eid) cE.put('FEV_' + eid, '1', 3600); try { var evc = b.event || {}; if (evc.type === 'message') facNudge(P, facCardOf(P, evc)); } catch (x) {} try { facBump(); cE.put('FAC_EV_AT', String(Date.now()), 900); if (!P.getProperty('FAC_EVENTS_ON')) P.setProperty('FAC_EVENTS_ON', String(Date.now())); } catch (x) {} try { if ((b.event || {}).type === 'message') facNotifyScan(P, 'event'); } catch (x) {} try { facWarm(P, b.event || {}); } catch (x) {} return out({ ok: true }); }
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
    if (typeof b.req !== 'string' || b.req.length > (b.job === 'slackpdf' || b.job === 'slackpdf2' || b.job === 'dorder' || b.job === 'cash' || b.job === 'cchat' ? 25000000 : 20000)) return out({ ok: false, error: 'bad request' });   // a memo PDF can be a few MB
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
var FAC = { SAMPLES_CH: 'C09T1BGHC6L', SAMPLE_LISTS: ['65f8c9fd96d90dda4b355f0a', '65a121d2829a36ccacd05593', '68b77a221eef6fbb9a305e0e'],   // #samples-discuss (ChatGPT workspace): sample cards chat THERE, not in #cutting (Abbas 13 Oct)
  BOARD: '6527c52485d9627f63157296', LISTS: [                 // in the order Abbas wants them shown (13 Oct 2026)
  ['SAMPLES', '65f8c9fd96d90dda4b355f0a'], ['SAMPLE DONE', '65a121d2829a36ccacd05593'],
  ['START', '6527c572b12b208471c080cb'], ['CUTTING', '6527c57751007e81a43f55a6'], ['IN LINE', '6527c57cd7e267fbf2a602b4'],
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
function facLine(mm) { var t = String(mm.text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim(); if (!t && (mm.files || []).length) t = mm.files.map(function (f) { return f.audio ? '🎤 voice note' : f.img ? '📷 photo' : f.video ? '🎬 video' : '📎 ' + f.name; }).join(' · '); return (mm.who ? mm.who + ': ' : '') + t.slice(0, 160); }
function facNtfy(topic, o) {
  try { var r = UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ topic: topic, title: o.title, message: o.msg, click: o.click, tags: ['speech_balloon'], priority: 4 }) }); return r.getResponseCode() === 200; } catch (e) { return false; }
}
function facNotifyScan(P, why) {
  var map = JSON.parse(P.getProperty('FNTFY') || '{}'), names = Object.keys(map); if (!names.length) return 0;
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
        var card = byId[id], ttl = id === 'dm' ? '💬 Direct chat' + (dm ? ' #' + dm.name : '') : (card && card.name ? (String(card.name).match(/\d{3,6}/) ? 'SJ-' + String(card.name).match(/\d{3,6}/)[0] : String(card.name).slice(0, 40)) : 'Card chat');
        if (facNtfy(map[nm], { title: ttl + (u.n > 1 ? ' · ' + u.n + ' new' : ''), msg: u.tx || 'New message', click: 'https://abbas911-prog.github.io/sj-designs/factory.html#card=' + id })) { sent++; noted[id] = u.last; changed = true; }
      });
      if (changed) { facFit(noted, []); try { P.setProperty(nk, JSON.stringify(noted)); } catch (e) {} }
    });
  } finally { lock.releaseLock(); }
  return sent;
}
function facNotifyTick() {                                       // the fallback timer (every minute): when Slack's push is on, only every 5th minute
  var P = PropertiesService.getScriptProperties(); if (P.getProperty('FAC_EVENTS_ON') && new Date().getMinutes() % 5) return;
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
function facBump() { CacheService.getScriptCache().put('FAC_GEN', String(Date.now()), 21600); }
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
  if (!(+rec[card] >= +ts)) { rec[card] = String(ts); rec._v = (rec._v || 0) + 1; if (+rec._t0 < Date.now() / 1000 - 30 * 86400) rec._t0 = String(Date.now() / 1000 - 30 * 86400); facFit(rec, ['_t0', '_v', 'dm']); try { P.setProperty(k, JSON.stringify(rec)); } catch (e) { return; } CacheService.getScriptCache().remove('FAC_UN_' + who.toUpperCase().slice(0, 20)); }
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
      var rk = 'FUR_' + W + '_' + cid + '_' + t.last + '_' + seen, rh = cache.get(rk);
      if (rh) { var r0 = JSON.parse(rh); if (r0.n) outm[cid] = r0; return; }             // this thread has not changed since we last counted it
      if (!facBudget()) { if (lastGood[cid]) outm[cid] = lastGood[cid]; return; }
      looked++;
      var rp = slackApi(FT, 'conversations.replies', { channel: byCard[cid].ch, ts: byCard[cid].ts, oldest: String(seen), limit: 100 }, true);
      if (!rp.ok) { facSlow(rp); if (lastGood[cid]) outm[cid] = lastGood[cid]; return; }  // Slack busy: keep what we knew, never blank it
      var n = 0, lastOther = '', tx = '';
      (rp.messages || []).forEach(function (m) { if (+m.ts <= seen || m.ts === byCard[cid].ts) return; var mm = facMsg(P, FT, m, byCard[cid].ts); if (mm.sys || mine(mm)) return; n++; lastOther = m.ts; tx = facLine(mm); });
      var r = { n: n, last: lastOther, tx: tx }; try { cache.put(rk, JSON.stringify(r), 21600); } catch (e) {} if (n) outm[cid] = r;
    });
  } else Object.keys(lastGood).forEach(function (x) { if (x !== 'dm') outm[x] = lastGood[x]; });
  try { var dm = facDm(P, FT); if (dm) {                      // the direct chat counts too (Abbas 14 Oct: "include those chats notifications in catchup")
    var seenD = Math.max(+(rec.dm || 0), +rec._t0), nd = 0, lastD = '', txD = '';
    facDmMsgs(P, FT, dm, fresh).forEach(function (m) { if (+m.ts <= seenD) return; var md = facMsg(P, FT, m, null); if (md.sys || mine(md)) return; nd++; lastD = m.ts; txD = facLine(md); });
    if (nd) outm.dm = { n: nd, last: lastD, tx: txD };
  } } catch (e) { if (lastGood.dm) outm.dm = lastGood.dm; }
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
var FAC_ONCE = /^(post|up|upfin|move|edit|copy|add|attach|sample|dmnew|dmset|later|retnew|retset)$/;
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
      if (hit && !req.fresh) { var hv = JSON.parse(hit); try { hv.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), hv.cards, who0); } catch (e) {} hv.later = facLater(P, who0); try { hv.dm = facDm(P, P.getProperty('SLACK_FACTORY_TOKEN')); } catch (e) { hv.dm = null; } hv.live = facLive(P); try { hv.ret = facRetSum(P); } catch (e) {} hv.fast = P.getProperty('FAC_FAST') || ''; hv.refs = facRefs(P); hv.limit = FAC.LIMIT; try { hv.act = facAct(P, P.getProperty('SLACK_FACTORY_TOKEN'), hv.cards); } catch (e) {} return out(hv); }
      var cf = facCf(rtok), listIds = FAC.LISTS.map(function (l) { return l[1]; });
      // ONE Trello call for the whole board (newest cards first), instead of one per list: Abbas wants the app updated right away, and the
      // phones ask every 10 s - this keeps the relay inside Google's daily fetch quota
      var cards = trApi('get', '/boards/' + FAC.BOARD + '/cards', { filter: 'open', limit: 1000, fields: 'name,idList,pos,shortUrl,idAttachmentCover,dateLastActivity,labels', customFieldItems: 'true', attachments: 'cover', attachment_fields: 'id,previews,mimeType' }, rtok) || [];
      try { if (!cache.get('FAC_GC') && cards.length > 50) { cache.put('FAC_GC', '1', 86400); var onB = {}; cards.forEach(function (c) { onB[c.id] = 1; }); var allP = P.getProperties();
        Object.keys(allP).forEach(function (k) { if (k.indexOf('FTH_') === 0 && !onB[k.slice(4)]) P.deleteProperty(k); }); } } catch (e) {}   // archived / deleted cards: their chat link is not needed any more
      cards = cards.filter(function (c) { return listIds.indexOf(c.idList) >= 0; });
      var perList = {}; cards.sort(function (a, b) { return a.pos - b.pos; });
      cards = cards.filter(function (c) { var lim = FAC.LIMIT[c.idList]; if (!lim) return true; perList[c.idList] = (perList[c.idList] || 0) + 1; return perList[c.idList] <= lim; });
      var outc = cards.map(function (c) {
        var f = {}; (c.customFieldItems || []).forEach(function (it) { var n = cf[it.idCustomField], v = it.value || {}; var x = v.text != null ? v.text : v.number != null ? v.number : v.date || (v.checked === 'true' ? '✓' : null); if (n && x != null && String(x).trim() !== '') f[n] = String(x); });
        var a = (c.attachments || [])[0], img = a && a.previews && a.previews.length ? a.id : '';
        return { id: c.id, name: c.name, l: c.idList, pos: c.pos, url: c.shortUrl, img: img, f: f, at: c.dateLastActivity, lb: (c.labels || []).filter(function (l) { return l.name; }).map(function (l) { return { n: l.name, c: l.color || '' }; }) };
      });
      var res = { ok: true, t: Date.now(), lists: FAC.LISTS, show: listIds, cards: outc, w: !!wtok, th: {}, tg: !!P.getProperty('TG_FACTORY_TOKEN') };
      try { bigPut(cache, 'FAC_LIST', JSON.stringify(res), 25); bigPut(cache, 'FAC_LIST_L', JSON.stringify(res), 3600); } catch (e) {}
      try { if (P.getProperty('SLACK_FACTORY_TOKEN')) res.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), outc, who0, !!req.fresh); } catch (e) {}
      res.later = facLater(P, who0);
      try { res.dm = facDm(P, P.getProperty('SLACK_FACTORY_TOKEN')); } catch (e) { res.dm = null; }
      res.live = facLive(P); try { res.ret = facRetSum(P); } catch (e) {} res.fast = P.getProperty('FAC_FAST') || ''; res.refs = facRefs(P); res.limit = FAC.LIMIT; try { res.act = facAct(P, P.getProperty('SLACK_FACTORY_TOKEN'), outc); } catch (e) {}
      return out(res);
    }
    if (req.op === 'ping') {                                  // 15 Oct 2026: the cheap "anything new?" every 4 s - no Trello call; the cards come from the cached list
      try { facSampleNeed(P, wtok); } catch (e) {}           // 18 Oct 2026: #samplesneed pictures -> SAMPLE cards on RETURNS (at most once a minute)
      var FTp = P.getProperty('SLACK_FACTORY_TOKEN'), whp = String(req.who || '').slice(0, 40), lc0 = bigGet(CacheService.getScriptCache(), 'FAC_LIST') || bigGet(CacheService.getScriptCache(), 'FAC_LIST_L');
      var pcards = lc0 ? JSON.parse(lc0).cards : Object.keys(P.getProperties()).filter(function (k) { return k.indexOf('FTH_') === 0; }).map(function (k) { return { id: k.slice(4) }; });
      var pth = {}; try { pth = facUnread(P, FTp, pcards, whp, !!req.fresh); } catch (e) {}
      var pdm = null; try { pdm = facDm(P, FTp); } catch (e) {}
      var prs = null; try { prs = facRetSum(P); } catch (e) {}
      var pact; try { pact = facAct(P, FTp, pcards); } catch (e) {}   // 17 Oct 2026: last-line time per chat on every ping, so the Chats tab never shows an older line
      return out({ ok: true, th: pth, later: facLater(P, whp), dm: pdm, gen: facGen(), ev: !!P.getProperty('FAC_EVENTS_ON'), live: facLive(P), ret: prs, fast: P.getProperty('FAC_FAST') || '', refs: facRefs(P), act: pact });
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
    if (req.op === 'seen') {                                  // 16 Oct 2026: the phone read a chat through the FAST LANE - remember it as seen (no Slack call)
      var sc = req.card === 'dm' ? 'dm' : String(req.card || '').replace(/[^0-9a-f]/g, ''), sts = String(req.ts || '');
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
    if (req.op === 'thread' && req.card === 'dm') {           // the direct chat: the channel's messages (oldest first), only those after req.since when given
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var ddm = facDm(P, FT); if (!ddm) return out({ ok: false, error: 'no direct chat channel chosen yet' });
      if (req.since && !/^\d+\.\d+$/.test(String(req.since))) req.since = '';
      var dms = facDmMsgs(P, FT, ddm, false).filter(function (m) { return !req.since || +m.ts > +req.since; });
      var dlast = dms.reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, req.since || '0');
      if (req.look !== 0) { if (+dlast > 0) facSeen(P, String(req.who || ''), 'dm', dlast); else if (!req.since) facSeen(P, String(req.who || ''), 'dm', String(Date.now() / 1000)); }
      return out({ ok: true, ch: ddm.ch, name: ddm.name, msgs: dms.map(function (m) { return facMsg(P, FT, m, null); }) });
    }
    if (req.op === 'post' && req.card === 'dm') {             // a line into the direct chat
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var pdm = facDm(P, FT), ptx2 = String(req.text || '').slice(0, 3000), pwho2 = String(req.who || '').slice(0, 40) || 'factory';
      if (!pdm) return out({ ok: false, error: 'no direct chat channel chosen yet' }); if (!ptx2.trim()) return out({ ok: false, error: 'bad request' });
      var pj2 = slackApi(FT, 'chat.postMessage', { channel: pdm.ch, text: '*' + pwho2 + ':* ' + ptx2 });
      if (!pj2.ok) return out({ ok: false, error: 'Slack said ' + pj2.error + (pj2.error === 'not_in_channel' ? ' (invite the factory bot to #' + pdm.name + ')' : '') });
      try { facSeen(P, pwho2, 'dm', pj2.ts); } catch (e) {} facBump(); facNudge(P, 'dm');
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
      var urls = uf.map(function (f) { var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: { Authorization: 'Bearer ' + FT }, muteHttpExceptions: true,
        payload: { filename: String(f.name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 80), length: String(Math.max(1, +f.size || 1)) } }).getContentText()); if (!a.ok) throw new Error('Slack said ' + a.error); return { id: a.file_id, url: a.upload_url }; });
      return out({ ok: true, urls: urls });
    }
    if (req.op === 'up') {                                    // photos / voice notes / files from the factory phone -> ONE message in the thread (Abbas 13 Oct: "like Slack ... all as one message")
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var udm = req.card === 'dm' ? facDm(P, FT) : null, uc = udm ? 'dm' : String(req.card || '').replace(/[^0-9a-f]/g, ''), uwho = String(req.who || '').slice(0, 40) || 'factory';
      var ufs = Array.isArray(req.files) ? req.files : (req.b64 ? [{ name: req.name, b64: req.b64 }] : []), pre = Array.isArray(req.fids) ? req.fids.map(function (x) { return String(x).replace(/[^A-Z0-9]/g, ''); }).filter(String).slice(0, 10) : [];
      if (req.card === 'dm' && !udm) return out({ ok: false, error: 'no direct chat channel chosen yet' });
      if (!uc || (!ufs.length && !pre.length) || ufs.length + pre.length > 10) return out({ ok: false, error: 'bad request' });
      if (pre.length && Array.isArray(req.sizes)) {           // the phone uploaded straight to Slack: make sure every byte arrived before the message is posted
        for (var vi = 0; vi < pre.length; vi++) { var vf = slackApi(FT, 'files.info', { file: pre[vi] }, true), vs = vf.ok ? +((vf.file || {}).size || 0) : -1, want = +req.sizes[vi] || 0;
          if (vf.ok && vs > 0 && want > 0 && vs !== want) return out({ ok: false, error: 'upload incomplete (' + vs + ' of ' + want + ' bytes)', retry: true }); } }
      var uth = udm ? { ch: udm.ch, ts: '' } : facThread(P, FT, uc, rtok, true), fids = pre.slice(), tot = 0;
      for (var ui = 0; ui < ufs.length; ui++) {
        var un = String(ufs[ui].name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 60), ub = Utilities.base64Decode(String(ufs[ui].b64 || ''));
        tot += ub.length; if (ub.length > 18 * 1024 * 1024 || tot > 40 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 18 MB each, 40 MB together)' });
        fids.push(slackUp(FT, un, ub));
      }
      var utext = '*' + uwho + ':* ' + (req.text ? String(req.text).slice(0, 3000) : (req.labels || []).concat(ufs.map(function (f) { return f.name; })).map(function (f) { f = { name: String(f || '') }; var n = String(f.name || ''); return /^voice/i.test(n) ? '🎤 voice note' : /\.(jpe?g|png|webp|heic)$/i.test(n) ? '📷 photo' : /\.(mp4|mov|webm)$/i.test(n) ? '🎬 video' : '📎 ' + n; }).join(' · '));
      var uj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + FT }, muteHttpExceptions: true,
        payload: uth.ts ? { files: JSON.stringify(fids.map(function (f) { return { id: f }; })), channel_id: uth.ch, thread_ts: uth.ts, initial_comment: utext } : { files: JSON.stringify(fids.map(function (f) { return { id: f }; })), channel_id: uth.ch, initial_comment: utext } }).getContentText());
      if (!uj.ok) return out({ ok: false, error: 'Slack said ' + uj.error });
      try { facSeen(P, uwho, uc, String(Date.now() / 1000)); } catch (e) {} facBump(); facNudge(P, uc);
      return out({ ok: true, fids: fids });
    }
    if (req.op === 'media') {                                 // one Slack file for the phone (photo preview, voice note, video), through the bot token
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var mf = String(req.file || '').replace(/[^A-Z0-9]/g, ''); if (!mf) return out({ ok: false, error: 'bad request' });
      var md = facMedia(FT, mf, !!req.full); return out(md);
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
      var lc = req.card === 'dm' ? 'dm' : String(req.card || '').replace(/[^0-9a-f]/g, ''), lwho = String(req.who || '').trim().toUpperCase().slice(0, 40); if (!lc || !lwho) return out({ ok: false, error: 'bad request' });
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
      try { if (FT) { var nth = facThread(P, FT, ncard.id, rtok, true); slackApi(FT, 'chat.postMessage', { channel: nth.ch, thread_ts: nth.ts, text: '→ *' + (ln2 ? ln2[0] : 'NEW') + '* · ' + nwho + (req.op === 'copy' ? ' copied this card from ' + scard.shortUrl : ' added this card') }); } } catch (e) {}
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST');
      return out({ ok: true, id: ncard.id, url: ncard.shortUrl });
    }
    if (req.op === 'move') {                                  // "Done -> next stage" (or Move to...): the real Trello card moves, top of the new list
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      var card = String(req.card || '').replace(/[^0-9a-f]/g, ''), to = String(req.to || ''), who = String(req.who || '').slice(0, 40) || 'factory';
      if (!card || ids.indexOf(to) < 0) return out({ ok: false, error: 'bad request' });
      var now = trApi('get', '/cards/' + card, { fields: 'idList,name,idBoard' }, wtok);
      if (now.idBoard !== FAC.BOARD) return out({ ok: false, error: 'not an ALM card' });
      if (req.from && now.idList !== req.from) {             // someone moved it meanwhile: say where it is, do nothing
        var nm = FAC.LISTS.filter(function (l) { return l[1] === now.idList; })[0];
        return out({ ok: false, moved: true, error: 'This card was already moved to ' + (nm ? nm[0] : 'another list') + ' - press ↻ to refresh' });
      }
      if (now.idList !== to) {
        trApi('put', '/cards/' + card, { idList: to, pos: 'top' }, wtok);
        var tn = FAC.LISTS.filter(function (l) { return l[1] === to; })[0][0];
        try { trApi('post', '/cards/' + card + '/actions/comments', { text: '→ ' + tn + ' · ' + who + ' (factory app)' }, wtok); } catch (e) {}
        try { var mth = P.getProperty('FTH_' + card); if (mth && FT) { mth = JSON.parse(mth); slackApi(FT, 'chat.postMessage', { channel: mth.ch, thread_ts: mth.ts, text: '→ *' + tn + '* · ' + who }); } } catch (e) {}
      }
      bigDrop(CacheService.getScriptCache(), 'FAC_LIST'); facNudge(P, 'list:' + card);
      return out({ ok: true });
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
  return out({ ok: true, file: a.file_id, to: v2 ? req.to : 'both' });
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
function ccName(t) { var s = String(t || ''), m = s.match(/^\*ORDER MEMO\*[^\n]*?[—-]\s*([^\n]+)/) || s.match(/^👤\s*\*CUSTOMER\*\s*·\s*([^\n]+)/); if (!m) return ''; var n = m[1].replace(/[*_]/g, '').trim(); return /^no name$/i.test(n) ? '' : n.slice(0, 60); }
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
  Logger.log(L.join('\n')); return L.join('\n');
}
function cchat(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var tok = P.getProperty('SLACK_BOT_TOKEN'); if (!tok) return out({ ok: false, error: 'the relay has no SLACK_BOT_TOKEN yet' });
  var cR = CacheService.getScriptCache(), rid = String(req.rid || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (rid) { var prev = cR.get('CCR_' + rid); if (prev) return ContentService.createTextOutput(prev).setMimeType(ContentService.MimeType.JSON); }
  try {
    if (req.op === 'list') {
      var by = {};
      ccHist(tok, !!req.fresh).forEach(function (m) { var n = ccName(m.text); if (!n) return; var k = ccKey(n), e = by[k] || (by[k] = { name: n, last: '0', memos: 0, chat: 0, root: '' });
        if (/^\*ORDER MEMO\*/.test(m.text)) e.memos++; else { e.root = m.ts; e.chat += m.rc; }
        var l = m.lr && +m.lr > +m.ts ? m.lr : m.ts; if (+l > +e.last) e.last = l; });
      return out({ ok: true, customers: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return +b.last - +a.last; }) });
    }
    if (req.op === 'thread') {
      var key = ccKey(req.name); if (!key) return out({ ok: false, error: 'no customer name' });
      var mine = ccHist(tok, !!req.fresh).filter(function (m) { return ccKey(ccName(m.text)) === key; }), msgs = [];
      mine.forEach(function (m) {
        var memo = /^\*ORDER MEMO\*/.test(m.text);
        if (memo) msgs.push({ ts: m.ts, who: 'Order memo', memo: true, text: m.text.replace(/^\*ORDER MEMO\*[^\n]*\n?/, ''), files: m.files });
        if (m.rc) { var rp = slackApi(tok, 'conversations.replies', { channel: CC_CH, ts: m.ts, limit: 200 }, true); if (!rp.ok) throw new Error(ccErr(rp.error));
          (rp.messages || []).forEach(function (x) { if (x.ts === m.ts) return; var w = ccWho(tok, { text: x.text, user: x.user, bot: !!x.bot_id });
            msgs.push({ ts: x.ts, who: w.who, app: w.app, text: w.text, files: (x.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }); }); }
      });
      msgs.sort(function (a, b) { return +a.ts - +b.ts; });
      var root = (mine.filter(function (m) { return /^👤/.test(m.text); })[0] || {}).ts || '';
      return out({ ok: true, name: req.name, root: root, msgs: msgs });
    }
    if (req.op === 'post' || req.op === 'up') {
      var nm = String(req.name || '').replace(/[*_\n]/g, ' ').trim().slice(0, 60), k2 = ccKey(nm), who = String(req.who || '').replace(/[*\n]/g, '').slice(0, 40) || 'SJ', txt = String(req.text || '').slice(0, 3000);
      if (!k2) return out({ ok: false, error: 'no customer name' });
      var lock = LockService.getScriptLock(); lock.waitLock(15000); var rootTs = '';
      try { rootTs = (ccHist(tok, true).filter(function (m) { return /^👤/.test(m.text) && ccKey(ccName(m.text)) === k2; }).sort(function (a, b) { return +a.ts - +b.ts; })[0] || {}).ts || '';
        if (!rootTs) { var r0 = slackApi(tok, 'chat.postMessage', { channel: CC_CH, text: '👤 *CUSTOMER* · ' + nm + '\n_customer chat · SJ memo app_' }); if (!r0.ok) return out({ ok: false, error: ccErr(r0.error) }); rootTs = r0.ts; bigDrop(cR, 'CC_HIST'); }
      } finally { lock.releaseLock(); }
      var res;
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
