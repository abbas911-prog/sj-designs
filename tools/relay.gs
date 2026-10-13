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
    var pw = P.getProperty('MEMO_PASSWORD'), gh = P.getProperty('GH');
    if (!pw) return out({ ok: false, error: 'Relay not set up (script properties missing)' });
    if (b.job === 'fac') {                                    // FACTORY APP (12 Oct 2026): its own password (FACTORY_PASSWORD), or the shop password
      if (typeof b.req !== 'string' || b.req.length > 25000000) return out({ ok: false, error: 'bad request' });
      var fpw = P.getProperty('FACTORY_PASSWORD'), sg = String(b.sig), okf = [fpw, pw].some(function (k) { return k && hex(Utilities.computeHmacSha256Signature(b.req, k, Utilities.Charset.UTF_8)) === sg; });
      return okf ? fac(b.req, P) : out({ ok: false, error: 'wrong password' });
    }
    if (typeof b.req !== 'string' || b.req.length > (b.job === 'slackpdf' || b.job === 'slackpdf2' || b.job === 'dorder' || b.job === 'cash' ? 25000000 : 20000)) return out({ ok: false, error: 'bad request' });   // a memo PDF can be a few MB
    if (hex(Utilities.computeHmacSha256Signature(b.req, pw, Utilities.Charset.UTF_8)) !== String(b.sig)) return out({ ok: false, error: 'wrong password' });
    if (b.job === 'live') return live(b.req, P);
    if (b.job === 'orders') return orders(b.req, P);
    if (b.job === 'vault') return vault(b.req, P);
    if (b.job === 'slackpdf') return slackPdf(b.req, P);
    if (b.job === 'slackpdf2') return slackPdf(b.req, P, true);   // 12 Oct 2026: one channel per call, chosen by the ticks
    if (b.job === 'dorder') return dorder(b.req, P);
    if (b.job === 'cust') return cust(b.req, P);
    if (b.job === 'cash') return cashPost(b.req, P);
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
  var hist = slackApi(FT, 'conversations.history', { channel: CH, limit: 200 }, true);
  if (hist.ok) {
    var hit = (hist.messages || []).filter(function (m) { return String(m.text || '').indexOf(c.shortLink) >= 0 || String(m.text || '').indexOf(c.shortUrl) >= 0; }).sort(function (a, b) { return +a.ts - +b.ts; })[0];
    if (hit) { var t = { ch: CH, ts: hit.thread_ts || hit.ts }; P.setProperty(key, JSON.stringify(t)); return t; }
  } else if (hist.error === 'missing_scope') throw new Error('the factory Slack app needs channels:history + groups:history (then Reinstall)');
  if (!make) return null;
  var p = slackApi(FT, 'chat.postMessage', { channel: CH, text: (CH === FAC.SAMPLES_CH ? '⭐ ' : '🧵 ') + c.name + '\n' + c.shortUrl + '\n_card chat · factory app_' });
  if (!p.ok) throw new Error('Slack said ' + p.error + (p.error === 'not_in_channel' ? ' (invite the factory bot to ' + (CH === FAC.SAMPLES_CH ? '#samples-discuss' : '#cutting') + ')' : ''));
  var t2 = { ch: CH, ts: p.ts }; P.setProperty(key, JSON.stringify(t2)); return t2;
}
function facThreads(P, FT, cards, fresh) {                    // reply counts for the badges: one #cutting history call, matched to the remembered threads
  var cache = CacheService.getScriptCache(), hit = fresh ? null : cache.get('FAC_TH'); if (hit) return JSON.parse(hit);
  var all = P.getProperties(), byTs = {}, byLink = {}, outm = {};
  cards.forEach(function (c) { var v = all['FTH_' + c.id]; if (v) byTs[JSON.parse(v).ts] = c.id; else if (c.url) byLink[c.url.split('/').pop()] = c.id; });
  [DOX.CUTTING, FAC.SAMPLES_CH].forEach(function (CH) {                                   // #cutting for production cards, #samples-discuss for sample cards
    var hist = slackApi(FT, 'conversations.history', { channel: CH, limit: 200 }, true);
    (hist.messages || []).forEach(function (m) {
      var id = byTs[m.ts];
      if (!id) { var t = String(m.text || ''); for (var k in byLink) if (t.indexOf('/c/' + k) >= 0) { id = byLink[k]; delete byLink[k]; P.setProperty('FTH_' + id, JSON.stringify({ ch: CH, ts: m.ts })); break; } }   // an order message from before: remembered from now on
      if (id) outm[id] = { n: m.reply_count || 0, last: m.latest_reply || m.ts };
    });
  });
  cache.put('FAC_TH', JSON.stringify(outm), 8); return outm;
}
function facSeen(P, who, card, ts) {                           // FSEEN_<who> = { _t0: first use, <cardId>: last ts seen } - shared by every phone that person signs in on
  who = String(who || '').trim(); if (!who || !card) return;
  var k = 'FSEEN_' + who.toUpperCase().slice(0, 40), rec = JSON.parse(P.getProperty(k) || '{}'); if (!rec._t0) rec._t0 = String(Date.now() / 1000);
  if (!(+rec[card] >= +ts)) { rec[card] = String(ts); var ks = Object.keys(rec).filter(function (x) { return x !== '_t0'; }); if (ks.length > 400) ks.sort(function (a, b) { return +rec[a] - +rec[b]; }).slice(0, ks.length - 400).forEach(function (x) { delete rec[x]; }); P.setProperty(k, JSON.stringify(rec)); CacheService.getScriptCache().remove('FAC_UN_' + who.toUpperCase().slice(0, 20)); }
}
function facLater(P, who) {                                   // FLATER_<who> = { <cardId>: when pinned } - "read it, cannot do it now, keep it in front of me" (Abbas 13 Oct: like Slack's Catch up)
  who = String(who || '').trim(); if (!who) return {};
  return JSON.parse(P.getProperty('FLATER_' + who.toUpperCase().slice(0, 40)) || '{}');
}
function facUnread(P, FT, cards, who, fresh) {                         // what THIS person has not seen yet: replies by others, newer than their last look (and newer than their first use)
  who = String(who || '').trim(); if (!who || !FT) return {};
  var k = 'FSEEN_' + who.toUpperCase().slice(0, 40), rec = JSON.parse(P.getProperty(k) || 'null');
  if (!rec) { rec = { _t0: String(Date.now() / 1000) }; P.setProperty(k, JSON.stringify(rec)); }
  var cache = CacheService.getScriptCache(), ck = 'FAC_UN_' + who.toUpperCase().slice(0, 20), hit = fresh ? null : cache.get(ck); if (hit) return JSON.parse(hit);
  var th = facThreads(P, FT, cards, fresh), all = P.getProperties(), outm = {}, looked = 0;
  var byCard = {}; Object.keys(all).forEach(function (x) { if (x.indexOf('FTH_') === 0) byCard[x.slice(4)] = JSON.parse(all[x]); });
  Object.keys(th).forEach(function (cid) {
    var t = th[cid], seen = Math.max(+(rec[cid] || 0), +rec._t0); if (!(+t.last > seen) || !byCard[cid] || looked >= 15) return;
    looked++;
    var rp = slackApi(FT, 'conversations.replies', { channel: byCard[cid].ch, ts: byCard[cid].ts, oldest: String(seen), limit: 50 }, true);
    var n = 0, lastOther = '';
    (rp.messages || []).forEach(function (m) { if (+m.ts <= seen || m.ts === byCard[cid].ts) return; var mm = facMsg(P, FT, m, byCard[cid].ts); if (mm.sys) return; if (String(mm.who).toUpperCase() === who.toUpperCase()) return; n++; lastOther = m.ts; });
    if (n) outm[cid] = { n: n, last: lastOther };
  });
  cache.put(ck, JSON.stringify(outm), 8); return outm;
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
  var files = (m.files || []).map(function (f) { return { id: f.id, name: f.name, type: f.mimetype || '', size: f.size || 0, img: /^image\//.test(f.mimetype || ''), audio: /^audio\//.test(f.mimetype || '') || /\.(m4a|opus|ogg|webm|mp3|aac|amr|wav)$/i.test(f.name || ''), video: /^video\//.test(f.mimetype || '') }; });
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
function fac(reqText, P) {
  var req = JSON.parse(reqText);
  if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
  var rtok = P.getProperty('TRELLO') || P.getProperty('TRELLO_W'), wtok = P.getProperty('TRELLO_W');
  if (!rtok) return out({ ok: false, error: 'the relay has no Trello key' });
  var ids = FAC.LISTS.map(function (l) { return l[1]; });
  try {
    if (req.op === 'list') {
      var who0 = String(req.who || '').slice(0, 40), cache = CacheService.getScriptCache(), hit = cache.get('FAC_LIST');
      if (hit && !req.fresh) { var hv = JSON.parse(hit); try { hv.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), hv.cards, who0); } catch (e) {} hv.later = facLater(P, who0); return out(hv); }
      var cf = facCf(rtok), listIds = FAC.LISTS.map(function (l) { return l[1]; });
      // ONE Trello call for the whole board (newest cards first), instead of one per list: Abbas wants the app updated right away, and the
      // phones ask every 10 s - this keeps the relay inside Google's daily fetch quota
      var cards = trApi('get', '/boards/' + FAC.BOARD + '/cards', { filter: 'open', limit: 1000, fields: 'name,idList,pos,shortUrl,idAttachmentCover,dateLastActivity,labels', customFieldItems: 'true', attachments: 'cover', attachment_fields: 'id,previews,mimeType' }, rtok) || [];
      cards = cards.filter(function (c) { return listIds.indexOf(c.idList) >= 0; });
      var perList = {}; cards.sort(function (a, b) { return a.pos - b.pos; });
      cards = cards.filter(function (c) { var lim = FAC.LIMIT[c.idList]; if (!lim) return true; perList[c.idList] = (perList[c.idList] || 0) + 1; return perList[c.idList] <= lim; });
      var outc = cards.map(function (c) {
        var f = {}; (c.customFieldItems || []).forEach(function (it) { var n = cf[it.idCustomField], v = it.value || {}; var x = v.text != null ? v.text : v.number != null ? v.number : v.date || (v.checked === 'true' ? '✓' : null); if (n && x != null && String(x).trim() !== '') f[n] = String(x); });
        var a = (c.attachments || [])[0], img = a && a.previews && a.previews.length ? a.id : '';
        return { id: c.id, name: c.name, l: c.idList, pos: c.pos, url: c.shortUrl, img: img, f: f, at: c.dateLastActivity, lb: (c.labels || []).filter(function (l) { return l.name; }).map(function (l) { return { n: l.name, c: l.color || '' }; }) };
      });
      var res = { ok: true, t: Date.now(), lists: FAC.LISTS, show: listIds, cards: outc, w: !!wtok, th: {}, tg: !!P.getProperty('TG_FACTORY_TOKEN') };
      var js = JSON.stringify(res); if (js.length < 95000) cache.put('FAC_LIST', js, 8);
      try { if (P.getProperty('SLACK_FACTORY_TOKEN')) res.th = facUnread(P, P.getProperty('SLACK_FACTORY_TOKEN'), outc, who0, !!req.fresh); } catch (e) {}
      res.later = facLater(P, who0);
      return out(res);
    }
    if (req.op === 'img') {                                   // a card's cover photo, ~300-600 px, fetched with the auth header (browsers are refused)
      var cid = String(req.card || '').replace(/[^0-9a-f]/g, ''), aid = String(req.att || '').replace(/[^0-9a-f]/g, '');
      if (!cid || !aid) return out({ ok: false, error: 'bad request' });
      var ck = 'FAC_IMG_' + aid + (req.big ? '_B' : ''), c2 = CacheService.getScriptCache(), have = c2.get(ck); if (have) return out({ ok: true, b64: have });
      var at = trApi('get', '/cards/' + cid + '/attachments/' + aid, { fields: 'previews,url,mimeType,bytes' }, rtok), pvs = (at.previews || []).slice().sort(function (x, y) { return x.width - y.width; });
      var pv = req.big ? pvs.slice(-1)[0] : (pvs.filter(function (p) { return p.width >= 300; })[0] || pvs.slice(-1)[0]);
      if (!pv) return out({ ok: false, error: 'not a picture' });
      // big = the sharpest we can get: Trello's largest preview, or the ORIGINAL file when the preview is small and the original is a photo under 8 MB (Abbas 13 Oct: "very blurry")
      var u = (req.big && pv.width < 1600 && /^image\//.test(at.mimeType || '') && (at.bytes || 0) <= 8 * 1024 * 1024 && at.url) ? at.url : pv.url;
      var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true, headers: { Authorization: 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + rtok + '"' } });
      if (r.getResponseCode() !== 200) return out({ ok: false, error: 'photo: Trello said ' + r.getResponseCode() });
      var b64 = Utilities.base64Encode(r.getBlob().getBytes());
      if (b64.length > (req.big ? 12000000 : 900000)) return out({ ok: false, error: 'photo too big' });
      if (b64.length < 99000) c2.put(ck, b64, 21600);
      return out({ ok: true, b64: b64, type: at.mimeType || 'image/jpeg' });
    }
    // ---- STEP 2 (12 Oct 2026): the card chat = the card's Slack #cutting thread, both ways ----
    var FT = P.getProperty('SLACK_FACTORY_TOKEN');
    if (req.op === 'thread') {                                // the thread of one card: root + replies (only those after req.since when given)
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var tc = String(req.card || '').replace(/[^0-9a-f]/g, ''); if (!tc) return out({ ok: false, error: 'bad request' });
      var th = facThread(P, FT, tc, rtok, !!req.make);
      if (!th) return out({ ok: true, none: true, msgs: [] });
      var rq = { channel: th.ch, ts: th.ts, limit: 200 }; if (req.since) rq.oldest = String(req.since);
      var rp = slackApi(FT, 'conversations.replies', rq, true);
      var ms = (rp.messages || []).filter(function (m) { return !req.since || m.ts !== String(req.since); }).map(function (m) { return facMsg(P, FT, m, th.ts); });
      var lastTs = (rp.messages || []).reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, req.since || th.ts);
      facSeen(P, String(req.who || ''), tc, lastTs);                // this person has now seen the thread up to here (shared by all their phones)
      return out({ ok: true, ch: th.ch, ts: th.ts, msgs: ms });
    }
    if (req.op === 'post') {                                  // a text line from the factory phone into the thread, shown as "*Name:* text"
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var pc = String(req.card || '').replace(/[^0-9a-f]/g, ''), ptx = String(req.text || '').slice(0, 3000), pwho = String(req.who || '').slice(0, 40) || 'factory';
      if (!pc || !ptx.trim()) return out({ ok: false, error: 'bad request' });
      var pth = facThread(P, FT, pc, rtok, true);
      var pj = slackApi(FT, 'chat.postMessage', { channel: pth.ch, thread_ts: pth.ts, text: '*' + pwho + ':* ' + ptx });
      if (!pj.ok) return out({ ok: false, error: 'Slack said ' + pj.error });
      facSeen(P, pwho, pc, pj.ts); CacheService.getScriptCache().remove('FAC_UN_' + pwho.toUpperCase().slice(0, 20));
      return out({ ok: true, ts: pj.ts });
    }
    if (req.op === 'up') {                                    // photos / voice notes / files from the factory phone -> ONE message in the thread (Abbas 13 Oct: "like Slack ... all as one message")
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var uc = String(req.card || '').replace(/[^0-9a-f]/g, ''), uwho = String(req.who || '').slice(0, 40) || 'factory';
      var ufs = Array.isArray(req.files) ? req.files : (req.b64 ? [{ name: req.name, b64: req.b64 }] : []);
      if (!uc || !ufs.length || ufs.length > 10) return out({ ok: false, error: 'bad request' });
      var uth = facThread(P, FT, uc, rtok, true), fids = [], tot = 0;
      for (var ui = 0; ui < ufs.length; ui++) {
        var un = String(ufs[ui].name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 60), ub = Utilities.base64Decode(String(ufs[ui].b64 || ''));
        tot += ub.length; if (ub.length > 18 * 1024 * 1024 || tot > 40 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 18 MB each, 40 MB together)' });
        fids.push(slackUp(FT, un, ub));
      }
      var utext = '*' + uwho + ':* ' + (req.text ? String(req.text).slice(0, 3000) : ufs.map(function (f) { var n = String(f.name || ''); return /^voice/i.test(n) ? '🎤 voice note' : /\.(jpe?g|png|webp|heic)$/i.test(n) ? '📷 photo' : /\.(mp4|mov|webm)$/i.test(n) ? '🎬 video' : '📎 ' + n; }).join(' · '));
      var uj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + FT }, muteHttpExceptions: true,
        payload: { files: JSON.stringify(fids.map(function (f) { return { id: f }; })), channel_id: uth.ch, thread_ts: uth.ts, initial_comment: utext } }).getContentText());
      if (!uj.ok) return out({ ok: false, error: 'Slack said ' + uj.error });
      facSeen(P, uwho, uc, String(Date.now() / 1000));
      return out({ ok: true, fids: fids });
    }
    if (req.op === 'media') {                                 // one Slack file for the phone (photo thumbnail or the voice note), through the bot token
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var mf = String(req.file || '').replace(/[^A-Z0-9]/g, ''); if (!mf) return out({ ok: false, error: 'bad request' });
      var fi = slackApi(FT, 'files.info', { file: mf }, true); if (!fi.ok) return out({ ok: false, error: 'Slack said ' + fi.error + (fi.error === 'missing_scope' ? ' (the factory bot needs files:read)' : '') });
      var f = fi.file || {}, mu = (req.full ? null : (f.thumb_720 || f.thumb_480 || f.thumb_360)) || f.url_private_download || f.url_private;
      var mr = UrlFetchApp.fetch(mu, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + FT } });
      if (mr.getResponseCode() !== 200) return out({ ok: false, error: 'Slack file said ' + mr.getResponseCode() });
      var mb = mr.getBlob(); if (mb.getBytes().length > 20 * 1024 * 1024) return out({ ok: false, error: 'file too big' });
      return out({ ok: true, b64: Utilities.base64Encode(mb.getBytes()), type: mb.getContentType() || f.mimetype || '', name: f.name || '' });
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
      CacheService.getScriptCache().remove('FAC_LIST');
      return out({ ok: true, ids: added });
    }
    if (req.op === 'sample') {                                // 13 Oct 2026 (Abbas): ⭐ NEW SAMPLE - a card on SAMPLES + the details (photos / videos / voice notes) posted in #samples-discuss, which becomes the card's chat
      if (!wtok) return out({ ok: false, error: 'the relay\'s Trello key can only READ - add TRELLO_W' });
      if (!FT) return out({ ok: false, error: 'the relay has no SLACK_FACTORY_TOKEN' });
      var sname = String(req.name || '').trim().slice(0, 500), sdesc = String(req.desc || '').slice(0, 16000), swho = String(req.who || '').slice(0, 40) || 'factory';
      var sfs = Array.isArray(req.files) ? req.files : []; if (!sname || sfs.length > 10) return out({ ok: false, error: 'bad request' });
      var scard2 = trApi('post', '/cards', { idList: FAC.LISTS[0][1], name: sname, desc: sdesc, pos: 'top' }, wtok);
      var sids = [], stot = 0, satt = 0, scover = false;
      for (var si = 0; si < sfs.length; si++) {
        var sn = String(sfs[si].name || 'file').replace(/[^\w.\-]/g, '_').slice(0, 60), sb = Utilities.base64Decode(String(sfs[si].b64 || '')), stype = String(sfs[si].type || 'application/octet-stream');
        stot += sb.length; if (sb.length > 18 * 1024 * 1024 || stot > 40 * 1024 * 1024) return out({ ok: false, error: 'file too big (max 18 MB each, 40 MB together)' });
        sids.push(slackUp(FT, sn, sb));
        if (sb.length <= DOX.TRELLO_MAX) { try {                                                       // the same file onto the Trello card (first picture = cover)
          var isImg = /^image\//.test(stype), xr2 = UrlFetchApp.fetch('https://api.trello.com/1/cards/' + scard2.id + '/attachments?key=' + TKEY + '&token=' + wtok, { method: 'post', muteHttpExceptions: true,
            payload: { file: Utilities.newBlob(sb, stype, sn), name: sn, setCover: (isImg && !scover) ? 'true' : 'false' } });
          if (xr2.getResponseCode() < 300) { satt++; if (isImg) scover = true; } } catch (e) {} }
      }
      var stext = '⭐ *SAMPLE* · ' + sname + (sdesc ? '\n' + sdesc : '') + '\n' + scard2.shortUrl + '\n_' + swho + ' · factory app_', sts = '';
      if (sids.length) {
        var sj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + FT }, muteHttpExceptions: true,
          payload: { files: JSON.stringify(sids.map(function (f) { return { id: f }; })), channel_id: FAC.SAMPLES_CH, initial_comment: stext } }).getContentText());
        if (!sj.ok) return out({ ok: false, error: 'Slack said ' + sj.error + (sj.error === 'not_in_channel' ? ' (invite the factory bot to #samples-discuss)' : ''), card: scard2.id });
        try { var sh = (sj.files || [])[0].shares || {}, grp = sh.public || sh.private || {}, arr = grp[FAC.SAMPLES_CH] || []; sts = arr.length ? arr[0].ts : ''; } catch (e) {}
        if (!sts) { Utilities.sleep(1200); var sh2 = slackApi(FT, 'conversations.history', { channel: FAC.SAMPLES_CH, limit: 20 }, true); var hit2 = (sh2.messages || []).filter(function (m) { return String(m.text || '').indexOf(scard2.shortUrl) >= 0; })[0]; if (hit2) sts = hit2.ts; }
      } else {
        var sp = slackApi(FT, 'chat.postMessage', { channel: FAC.SAMPLES_CH, text: stext }); if (!sp.ok) return out({ ok: false, error: 'Slack said ' + sp.error + (sp.error === 'not_in_channel' ? ' (invite the factory bot to #samples-discuss)' : ''), card: scard2.id }); sts = sp.ts;
      }
      if (sts) P.setProperty('FTH_' + scard2.id, JSON.stringify({ ch: FAC.SAMPLES_CH, ts: sts }));       // that post IS the card's chat from now on
      try { trApi('post', '/cards/' + scard2.id + '/actions/comments', { text: '⭐ Sample · ' + swho + ' (factory app) · posted in #samples-discuss' }, wtok); } catch (e) {}
      CacheService.getScriptCache().remove('FAC_LIST'); CacheService.getScriptCache().remove('FAC_TH');
      return out({ ok: true, id: scard2.id, url: scard2.shortUrl, files: sids.length, att: satt });
    }
    if (req.op === 'later') {                                 // pin / unpin a card on this person's LATER list (per person, shared by all their phones)
      var lc = String(req.card || '').replace(/[^0-9a-f]/g, ''), lwho = String(req.who || '').trim().toUpperCase().slice(0, 40); if (!lc || !lwho) return out({ ok: false, error: 'bad request' });
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
      CacheService.getScriptCache().remove('FAC_LIST');
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
      try { if (FT) { var nth = facThread(P, FT, ncard.id, rtok, true); slackApi(FT, 'chat.postMessage', { channel: nth.ch, thread_ts: nth.ts, text: '→ *' + (ln2 ? ln2[0] : 'NEW') + '* · ' + nwho + (req.op === 'copy' ? ' copied this card from ' + scard.shortUrl : ' added this card') }); } } catch (e) {}
      CacheService.getScriptCache().remove('FAC_LIST');
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
      CacheService.getScriptCache().remove('FAC_LIST');
      return out({ ok: true });
    }
    return out({ ok: false, error: 'the relay does not know "' + String(req.op) + '" yet - Abbas must deploy the new version (Deploy → Manage deployments → ✏️ → New version)' });
  } catch (e) { return out({ ok: false, error: String(e.message || e).slice(0, 200) }); }
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
  if (!id || !text.trim()) return out({ ok: false, error: 'bad request' });
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
    var log = JSON.parse(P.getProperty('CASHLOG') || '[]'); log.unshift({ t: st.done, text: text.slice(0, 300), n: st.files.length, read: String(req.read || '').slice(0, 160) });
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
