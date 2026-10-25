// SJ ASSISTANT — its own Google Apps Script web app (24 Oct 2026). NOT the SJ relay: separate project, separate link, separate password.
// It talks to Slack directly with the two Slack bots' tokens (SJTC = SJ Stock side, factory = AL MUTAGADED side), which Abbas pastes ONCE into
// the Assistant app's setup screen; they are kept in THIS script's properties only (never in the repo, never in a chat).
// Every chat the bots can see = one channel chat (its top-level posts) + one chat per thread (an order memo, a pick list, a card…).
// Lines written from any SJ app are "*Name:* text" posted by a bot — shown as Name. Read marks ("seen") are the Assistant's own.
var AS_VER = '2026-10-25a';
var WS = ['s', 'f'];                                               // s = SJTC workspace, f = factory workspace; e = Email (the Gmail this script runs as — see below)
// EMAIL (25 Oct 2026): a third source. The script reads the Gmail inbox of the Google account it is deployed under (abbassayed033@gmail.com);
// the other addresses auto-forward into it. No tokens: Google asks Abbas once to allow Gmail when the new version is deployed.
// One chat per email thread (key "e:<threadId>:"), newest mail first; marketing / social mail is left out. Reply = a Gmail reply in that thread.
var EM_DAYS = 10, EM_MAX = 40, EM_Q = 'in:inbox -category:promotions -category:social -category:forums newer_than:' + EM_DAYS + 'd';
function gmailOn() { return typeof GmailApp !== 'undefined' && !!GmailApp; }
var HOT_MS = 2 * 3600 * 1000, PER_CALL = 4, HIST_N = 200;           // channels read per feed call per workspace: hot ones + the longest-unread cold ones

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hex(b) { return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join(''); }
function P_() { return PropertiesService.getScriptProperties(); }
function C_() { return CacheService.getScriptCache(); }
function doGet() { return out({ ok: true, app: 'sj-assistant', ver: AS_VER, ready: !!P_().getProperty('AS_PW') }); }

function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}'), P = P_();
    if (b.setup) return setup(b.setup, P);                         // first time only: no password stored yet
    var pw = P.getProperty('AS_PW'); if (!pw) return out({ ok: false, error: 'not set up yet', setup: true });
    if (typeof b.req !== 'string' || b.req.length > 30000000) return out({ ok: false, error: 'bad request' });
    if (hex(Utilities.computeHmacSha256Signature(b.req, pw, Utilities.Charset.UTF_8)) !== String(b.sig)) return out({ ok: false, error: 'wrong password' });
    var req = JSON.parse(b.req); if (Math.abs(Date.now() - (+req.t || 0)) > 10 * 60 * 1000) return out({ ok: false, error: 'request too old - check the phone clock' });
    var who = String(req.who || '').replace(/[*\n]/g, '').trim().slice(0, 40) || 'Abbas';
    var c = C_(), rid = String(req.rid || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (rid) { var prev = c.get('RID_' + rid); if (prev) return ContentService.createTextOutput(prev).setMimeType(ContentService.MimeType.JSON); }
    var res = run(req, who, P);
    if (rid && res && res.ok) { try { c.put('RID_' + rid, JSON.stringify(res), 21600); } catch (x) {} }
    return out(res);
  } catch (err) { return out({ ok: false, error: String(err && err.message || err).slice(0, 300) }); }
}

function setup(s, P) {
  if (P.getProperty('AS_PW')) return out({ ok: false, error: 'already set up - sign in with the Assistant password' });
  var pw = String(s.pw || ''); if (pw.length < 6) return out({ ok: false, error: 'choose a password of at least 6 letters' });
  var t = { s: String(s.s || '').trim(), f: String(s.f || '').trim() }, seen = {};
  for (var i = 0; i < WS.length; i++) { var w = WS[i]; if (!t[w]) continue; var a = slack(t[w], 'auth.test', {}); if (!a.ok) return out({ ok: false, error: (w === 's' ? 'SJTC' : 'factory') + ' token: Slack said ' + a.error }); seen[w] = a.team || ''; }
  if (!t.s && !t.f) return out({ ok: false, error: 'paste at least one Slack bot token' });
  P.setProperty('AS_PW', pw); if (t.s) P.setProperty('AS_TOK_s', t.s); if (t.f) P.setProperty('AS_TOK_f', t.f);
  WS.forEach(function (w) { if (seen[w]) P.setProperty('AS_TEAM_' + w, seen[w]); });
  P.setProperty('AS_T0', String(Date.now() / 1000 - 86400));    // the first Catch-up shows the last 24 hours
  return out({ ok: true, teams: seen });
}

function run(req, who, P) {
  var op = req.op;
  if (op === 'hello') return { ok: true, ver: AS_VER, teams: { s: P.getProperty('AS_TEAM_s') || '', f: P.getProperty('AS_TEAM_f') || '' }, email: gmailOn() ? myMail() : '' };
  if (op === 'mail') return mailNew(req, who, P);                  // a new email to an address (text + files), e.g. a Slack photo sent on by email
  if (op === 'tokens') {                                         // change a token later from the app (signed)
    var tt = { s: String(req.s || '').trim(), f: String(req.f || '').trim() }, teams = {};
    for (var i = 0; i < WS.length; i++) { var w = WS[i]; if (!tt[w]) continue; var a = slack(tt[w], 'auth.test', {}); if (!a.ok) return { ok: false, error: 'Slack said ' + a.error }; P.setProperty('AS_TOK_' + w, tt[w]); P.setProperty('AS_TEAM_' + w, a.team || ''); C_().remove('CHANS_' + w); teams[w] = a.team; }
    return { ok: true, teams: teams };
  }
  if (op === 'feed') return feed(who, P, !!req.fresh);
  if (op === 'chans') { var L = []; WS.forEach(function (w) { var tk = P.getProperty('AS_TOK_' + w); if (!tk) return; chans(w, tk).forEach(function (ch) { L.push({ k: w + ':' + ch.id + ':', ws: w, ch: ch.id, chn: ch.name }); }); }); return { ok: true, chans: L }; }
  var k = parseKey(req.k); if (!k) return { ok: false, error: 'bad chat' };
  if (k.ws === 'e') return emailOp(op, k, req, who, P);
  var tok = P.getProperty('AS_TOK_' + k.ws); if (!tok) return { ok: false, error: 'no Slack token for this workspace yet' };
  if (op === 'thread') {
    var msgs = k.ts ? replies(tok, k.ch, k.ts, '', true) : chHist(tok, k.ch, true).slice().reverse();
    var users = names(k.ws, tok), outm = msgs.map(function (m) { return msgOut(m, users, k.ts); });
    if (req.look && outm.length) seenPut(P, req.k, outm[outm.length - 1].ts);
    return { ok: true, msgs: outm };
  }
  if (op === 'seen') { seenPut(P, req.k, String(req.ts || Date.now() / 1000)); return { ok: true }; }
  if (op === 'unseen') { return { ok: true, mark: unseen(P, req.k, String(req.since || '')) }; }   // keep unread: the chat comes back in the Catch-up as it was
  if (op === 'post') {
    var tx = String(req.text || '').slice(0, 3500); if (!tx.trim()) return { ok: false, error: 'empty' };
    var p = { channel: k.ch, text: '*' + who + ':* ' + tx }; if (k.ts) p.thread_ts = k.ts;
    var pj = slack(tok, 'chat.postMessage', p); if (!pj.ok) return { ok: false, error: slackErr(pj.error) };
    afterWrite(P, k, req.k, pj.ts); return { ok: true, ts: pj.ts };
  }
  if (op === 'up') {
    var fs = Array.isArray(req.files) ? req.files.slice(0, 10) : [], ids = [], tot = 0;
    for (var j = 0; j < fs.length; j++) { var by = Utilities.base64Decode(String(fs[j].b64 || '')); tot += by.length; if (by.length > 18000000 || tot > 40000000) return { ok: false, error: 'files too big (18 MB each, 40 MB together)' };
      ids.push(upload(tok, String(fs[j].name || 'file').replace(/[^\w.\- ]+/g, '-').slice(0, 80), by)); }
    if (!ids.length) return { ok: false, error: 'no file' };
    var pl = { files: JSON.stringify(ids.map(function (f) { return { id: f }; })), channel_id: k.ch, initial_comment: '*' + who + ':* ' + (String(req.text || '').slice(0, 3500) || fileWord(fs)) }; if (k.ts) pl.thread_ts = k.ts;
    var cj = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true, payload: pl }).getContentText());
    if (!cj.ok) return { ok: false, error: slackErr(cj.error) };
    afterWrite(P, k, req.k, String(Date.now() / 1000 + 2)); return { ok: true, files: ids.length };
  }
  if (op === 'file') {
    var fid = String(req.id || '').replace(/[^A-Z0-9]/g, ''), fi = slack(tok, 'files.info', { file: fid }, true); if (!fi.ok) return { ok: false, error: slackErr(fi.error) };
    var f = fi.file || {}, u = req.thumb ? (f.thumb_720 || f.thumb_480 || f.thumb_360 || f.url_private) : (f.url_private_download || f.url_private);
    if (!u) return { ok: false, error: 'no file link' }; if (!req.thumb && (f.size || 0) > 20000000) return { ok: false, error: 'file too big for the phone', link: f.permalink || '' };
    var r = UrlFetchApp.fetch(u, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }); if (r.getResponseCode() !== 200) return { ok: false, error: 'Slack file said ' + r.getResponseCode() };
    var bl = r.getBlob(); if (/text\/html/.test(String(bl.getContentType() || ''))) return { ok: false, error: 'Slack refused the file (the bot needs files:read)' };
    return { ok: true, b64: Utilities.base64Encode(bl.getBytes()), type: f.mimetype || bl.getContentType() || '', name: f.name || fid };
  }
  return { ok: false, error: 'unknown op ' + op };
}
function fileWord(fs) { return fs.map(function (f) { var n = String(f.name || ''); return /^voice/i.test(n) ? '🎤 voice note' : /\.(jpe?g|png|webp|heic|gif)$/i.test(n) ? '📷 photo' : /\.(mp4|mov|webm|m4v)$/i.test(n) ? '🎬 video' : '📎 ' + n; }).join(' · '); }
function afterWrite(P, k, key, ts) { var c = C_(); c.remove('H_' + k.ch); if (k.ts) c.remove('R_' + k.ch + '_' + k.ts); seenPut(P, key, String(Math.max(+ts || 0, Date.now() / 1000) + 1)); }
function parseKey(s) { var m = String(s || '').match(/^([sf]):([A-Z0-9]{6,}):(\d+\.\d+)?$/); if (m) return { ws: m[1], ch: m[2], ts: m[3] || '' }; var e = String(s || '').match(/^e:([A-Za-z0-9]{8,}):$/); return e ? { ws: 'e', ch: e[1], ts: '' } : null; }

// ---------- Email (Gmail of the account the script runs as) ----------
function myMail() { try { return String(Session.getEffectiveUser().getEmail() || ''); } catch (e) { return ''; } }
function emAddr(s) { var m = String(s || '').match(/<([^>]+)>/); return (m ? m[1] : String(s || '')).trim().toLowerCase(); }
function emName(s) { var m = String(s || '').match(/^\s*"?([^"<]+?)"?\s*</); var n = m ? m[1].trim() : ''; return n || emAddr(s).split('@')[0]; }
function emTs(d) { return String(Math.floor((d ? d.getTime() : Date.now()) / 1000)) + '.000000'; }
function emBody(m) {                                             // the mail's own words: plain text, quoted older mail cut off
  var t = ''; try { t = String(m.getPlainBody() || ''); } catch (e) {}
  if (!t.trim()) { try { t = String(m.getBody() || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'); } catch (e) {} }
  t = t.replace(/\r/g, '');
  var cut = t.search(/\n(On .{5,120}wrote:|-{3,} ?(Original|Forwarded) ?Message|From: .+\nSent: |_{10,})/i); if (cut > 40) t = t.slice(0, cut);
  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, 6000);
}
function emMsgOut(m, me) {                                       // one email → the same shape as a chat line
  var from = '', date = null, atts = [], id = ''; try { from = m.getFrom(); date = m.getDate(); id = m.getId(); atts = m.getAttachments({ includeInlineImages: false, includeAttachments: true }); } catch (e) {}
  var mineM = me && emAddr(from) === me;
  return { ts: emTs(date), who: mineM ? 'Abbas' : emName(from), app: false, sys: false, root: false, text: emBody(m), rc: 0, from: emAddr(from),
    files: atts.map(function (a, i) { var n = '', t = '', s = 0; try { n = a.getName(); t = a.getContentType(); s = a.getSize(); } catch (e) {} return { id: id + '-' + i, name: n || 'file', type: t || '', size: s }; }) };
}
function emThreads(fresh) {                                      // the inbox threads (newest first), kept 60 s so the feed polls do not hammer Gmail
  var c = C_(), h = fresh ? null : bigGet(c, 'EM_L'); if (h) return JSON.parse(h);
  var me = myMail().toLowerCase(), L = [], ths = GmailApp.search(EM_Q, 0, EM_MAX);
  ths.forEach(function (th) {
    var ms = th.getMessages(), last = ms[ms.length - 1], rows = ms.map(function (m) { return emMsgOut(m, me); });
    L.push({ id: th.getId(), subj: String(th.getFirstMessageSubject() || '(no subject)').slice(0, 120), from: emAddr(last.getFrom()), last: emTs(last.getDate()), n: ms.length, msgs: rows.map(function (r) { return { ts: r.ts, who: r.who, text: r.text.slice(0, 300), f: r.files.length, from: r.from }; }) });
  });
  L.sort(function (a, b) { return +b.last - +a.last; });
  try { bigPut(c, 'EM_L', JSON.stringify(L), 60); } catch (e) {} return L;
}
function emailFeed(who, P, all, fresh, chats, errs) {
  if (!gmailOn()) return; var L; try { L = emThreads(fresh); } catch (e) { errs.push('Email: ' + String(e.message || e).slice(0, 120)); return; }
  var t0 = +(all.AS_T0 || 0);
  L.forEach(function (th) {
    var key = 'e:' + th.id + ':', mark = Math.max(+(all['SN_' + key] || 0), t0), news = th.msgs.filter(function (m) { return +m.ts > mark && !mine(m, who); });
    chats.push({ k: key, ws: 'e', team: 'Email', chn: th.from, title: th.subj, kind: 'email', last: th.last, un: news.length, lines: news.slice(-3).map(function (m) { return { who: m.who, text: String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 220) || (m.f ? '📎 ' + m.f + ' attachment' + (m.f > 1 ? 's' : '') : '(empty mail)'), ts: m.ts, f: m.f }; }) });
  });
}
function emailOp(op, k, req, who, P) {
  if (!gmailOn()) return { ok: false, error: 'Gmail is not allowed for this script yet — deploy the new version and allow Gmail' };
  var th = null; try { th = GmailApp.getThreadById(k.ch); } catch (e) {} if (!th) return { ok: false, error: 'that email thread is gone' };
  if (op === 'thread') { var me = myMail().toLowerCase(), outm = th.getMessages().map(function (m) { return emMsgOut(m, me); }); if (req.look && outm.length) seenPut(P, req.k, outm[outm.length - 1].ts); return { ok: true, msgs: outm, subj: th.getFirstMessageSubject() }; }
  if (op === 'seen') { seenPut(P, req.k, String(req.ts || Date.now() / 1000)); return { ok: true }; }
  if (op === 'unseen') { return { ok: true, mark: unseen(P, req.k, String(req.since || '')) }; }
  if (op === 'post' || op === 'up') {                             // reply in the thread (to the last mail's sender), files attached
    var tx = String(req.text || '').slice(0, 20000), blobs = [], fs = op === 'up' && Array.isArray(req.files) ? req.files.slice(0, 10) : [], tot = 0;
    for (var j = 0; j < fs.length; j++) { var by = Utilities.base64Decode(String(fs[j].b64 || '')); tot += by.length; if (tot > 20000000) return { ok: false, error: 'files too big for email (20 MB together)' }; blobs.push(Utilities.newBlob(by, emType(fs[j].name), String(fs[j].name || 'file').slice(0, 80))); }
    if (!tx.trim() && !blobs.length) return { ok: false, error: 'empty' };
    var ms = th.getMessages(), lastM = ms[ms.length - 1], o = { name: who }; if (blobs.length) o.attachments = blobs;
    try { lastM.reply(tx || fileWord(fs), o); } catch (e) { return { ok: false, error: 'Gmail said ' + String(e.message || e).slice(0, 160) }; }
    C_().remove('EM_L#n'); seenPut(P, req.k, String(Date.now() / 1000 + 2)); return { ok: true, ts: emTs(null), files: blobs.length };
  }
  if (op === 'file') {                                            // an attachment: "<messageId>-<index>"
    var mm = String(req.id || '').match(/^([A-Za-z0-9]{8,})-(\d{1,2})$/); if (!mm) return { ok: false, error: 'bad file' };
    var msg = null; try { msg = GmailApp.getMessageById(mm[1]); } catch (e) {} if (!msg) return { ok: false, error: 'that email is gone' };
    var a = msg.getAttachments({ includeInlineImages: false, includeAttachments: true })[+mm[2]]; if (!a) return { ok: false, error: 'no such attachment' };
    if (a.getSize() > 20000000) return { ok: false, error: 'file too big for the phone' };
    return { ok: true, b64: Utilities.base64Encode(a.getBytes()), type: a.getContentType() || '', name: a.getName() || 'file' };
  }
  return { ok: false, error: 'unknown op ' + op };
}
function emType(n) { n = String(n || '').toLowerCase(); return /\.(jpe?g)$/.test(n) ? 'image/jpeg' : /\.png$/.test(n) ? 'image/png' : /\.webp$/.test(n) ? 'image/webp' : /\.pdf$/.test(n) ? 'application/pdf' : /\.(m4a|mp4)$/.test(n) ? 'audio/mp4' : /\.webm$/.test(n) ? 'audio/webm' : /\.mp4$/.test(n) ? 'video/mp4' : 'application/octet-stream'; }
function mailNew(req, who, P) {                                   // op mail: { to, subject, text, files[] }
  if (!gmailOn()) return { ok: false, error: 'Gmail is not allowed for this script yet' };
  var to = String(req.to || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: 'that is not an email address' };
  var subj = String(req.subject || '').slice(0, 200).trim() || ('From ' + who), tx = String(req.text || '').slice(0, 20000), fs = Array.isArray(req.files) ? req.files.slice(0, 10) : [], blobs = [], tot = 0;
  for (var j = 0; j < fs.length; j++) { var by = Utilities.base64Decode(String(fs[j].b64 || '')); tot += by.length; if (tot > 20000000) return { ok: false, error: 'files too big for email (20 MB together)' }; blobs.push(Utilities.newBlob(by, emType(fs[j].name), String(fs[j].name || 'file').slice(0, 80))); }
  if (!tx.trim() && !blobs.length) return { ok: false, error: 'empty' };
  var o = { name: who }; if (blobs.length) o.attachments = blobs;
  try { GmailApp.sendEmail(to, subj, tx || fileWord(fs), o); } catch (e) { return { ok: false, error: 'Gmail said ' + String(e.message || e).slice(0, 160) }; }
  return { ok: true, to: to };
}

// ---------- Slack ----------
function slack(tok, method, params, get) {
  var o = { method: get ? 'get' : 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }, url = 'https://slack.com/api/' + method;
  if (get) url += '?' + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&'); else o.payload = params;
  for (var n = 0; n < 2; n++) { var r = UrlFetchApp.fetch(url, o), j; try { j = JSON.parse(r.getContentText()); } catch (e) { j = { ok: false, error: 'http_' + r.getResponseCode() }; }
    if (j.ok || j.error !== 'ratelimited' || n) return j; Utilities.sleep(1200); }
}
function slackErr(e) { return 'Slack said ' + e + (e === 'not_in_channel' ? ' — invite the bot into that channel (/invite @bot)' : e === 'missing_scope' ? ' — the bot needs that permission in api.slack.com/apps' : ''); }
function upload(tok, name, bytes) {
  var a = JSON.parse(UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true, payload: { filename: name, length: String(bytes.length) } }).getContentText());
  if (!a.ok) throw new Error(slackErr(a.error));
  var up = UrlFetchApp.fetch(a.upload_url, { method: 'post', payload: Utilities.newBlob(bytes, 'application/octet-stream', name), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) throw new Error('Slack upload said ' + up.getResponseCode()); return a.file_id;
}
function bigGet(c, k) { var n = +(c.get(k + '#n') || 0); if (!n) return null; var ks = []; for (var i = 0; i < n; i++) ks.push(k + '#' + i); var all = c.getAll(ks), s = ''; for (var j = 0; j < n; j++) { if (all[ks[j]] == null) return null; s += all[ks[j]]; } return s; }
function bigPut(c, k, s, ttl) { var parts = {}, n = Math.ceil(s.length / 90000) || 1; for (var i = 0; i < n; i++) parts[k + '#' + i] = s.slice(i * 90000, (i + 1) * 90000); parts[k + '#n'] = String(n); c.putAll(parts, ttl); }
function chans(w, tok) {                                          // the channels this bot is in (10 min)
  var c = C_(), h = c.get('CHANS_' + w); if (h) return JSON.parse(h);
  var L = [], cur = '', n = 0;
  do { var j = slack(tok, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: 200, cursor: cur }, true); if (!j.ok) break;
    (j.channels || []).forEach(function (x) { if (x.is_member) L.push({ id: x.id, name: x.name }); }); cur = (j.response_metadata || {}).next_cursor || ''; n++; } while (cur && n < 5);
  try { c.put('CHANS_' + w, JSON.stringify(L), 600); } catch (e) {} return L;
}
function slim(m) { return { ts: m.ts, text: String(m.text || '').slice(0, 2000), user: m.user || '', bot: !!m.bot_id, un: m.username || (m.bot_profile || {}).name || '', rc: m.reply_count || 0, lr: m.latest_reply || '', sub: m.subtype || '',
  files: (m.files || []).map(function (f) { return { id: f.id, name: f.name || '', type: f.mimetype || '', size: f.size || 0 }; }) }; }
function chHist(tok, ch, fresh) {                                 // newest top-level posts (newest first), kept 25 s
  var c = C_(), h = fresh ? null : bigGet(c, 'H_' + ch); if (h) return JSON.parse(h);
  var j = slack(tok, 'conversations.history', { channel: ch, limit: HIST_N }, true); if (!j.ok) throw new Error(slackErr(j.error));
  var L = (j.messages || []).filter(function (m) { return !/^(channel_join|channel_leave|channel_topic|channel_purpose|bot_add)$/.test(m.subtype || ''); }).map(slim);
  try { bigPut(c, 'H_' + ch, JSON.stringify(L), 25); } catch (e) {} return L;
}
function replies(tok, ch, ts, lr, fresh) {                        // one thread, oldest first; kept while its newest reply is the same
  var c = C_(), key = 'R_' + ch + '_' + ts, h = fresh ? null : bigGet(c, key); if (h) { var o = JSON.parse(h); if (!lr || o.lr === lr) return o.m; }
  var j = slack(tok, 'conversations.replies', { channel: ch, ts: ts, limit: 300 }, true); if (!j.ok) throw new Error(slackErr(j.error));
  var L = (j.messages || []).map(slim), last = L.reduce(function (a, m) { return +m.ts > +a ? m.ts : a; }, ts);
  try { bigPut(c, key, JSON.stringify({ lr: last, m: L }), 21600); } catch (e) {} return L;
}
function names(w, tok) {                                          // user id -> name (6 h)
  var c = C_(), h = c.get('USERS_' + w); if (h) return JSON.parse(h);
  var map = {}, cur = '', n = 0;
  do { var j = slack(tok, 'users.list', { limit: 200, cursor: cur }, true); if (!j.ok) break;
    (j.members || []).forEach(function (u) { var p = u.profile || {}; map[u.id] = p.display_name || p.real_name || u.real_name || u.name || u.id; }); cur = (j.response_metadata || {}).next_cursor || ''; n++; } while (cur && n < 5);
  try { c.put('USERS_' + w, JSON.stringify(map), 21600); } catch (e) {} return map;
}
function msgOut(m, users, root) {                                 // what the phone shows: who, text, files, system line
  var t = String(m.text || ''), who = '', app = false, mm = t.match(/^\*([^*\n]{1,40}):\*\s?([\s\S]*)$/);
  if (m.bot && mm) { who = mm[1]; t = mm[2]; app = true; } else if (m.bot) who = m.un || 'Bot'; else who = users[m.user] || m.user || '';
  var sys = m.bot && /^→ \*/.test(t);
  return { ts: m.ts, who: who, app: app, sys: !!sys, root: !!root && m.ts === root, text: t.replace(/<(https?:[^|>]+)\|([^>]*)>/g, '$2 ($1)').replace(/<(https?:[^>]+)>/g, '$1').replace(/<@(U\w+)>/g, function (_, u) { return '@' + (users[u] || u); }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    rc: m.rc || 0, files: m.files || [] };
}
function line(o) { var t = String(o.text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim(); if (!t && (o.files || []).length) t = fileWord(o.files); return t.slice(0, 220); }
function title(text, chn) {                                       // a thread's name from its first post
  var s = String(text || '').replace(/:bust_in_silhouette:/g, '👤'), m;
  if ((m = s.match(/^\*ORDER MEMO[^*\n]*\*[^\n]*?[—-]\s*([^\n]+)/))) return { t: m[1].replace(/[*_]/g, '').trim(), kind: 'order memo' };
  if ((m = s.match(/^\*GODOWN PICK LIST\*[^\n]*?[—-]\s*([^\n]+)/))) return { t: m[1].replace(/[*_]/g, '').trim(), kind: 'godown pick list' };
  if ((m = s.match(/^\s*👤\s*\*CUSTOMER\*\s*·\s*([^\n]+)/))) return { t: m[1].replace(/[*_]/g, '').trim(), kind: 'customer chat' };
  if ((m = s.match(/(?:SJ|SH|US)\s*[-=:*#(]*\s*\**\(?\s*(\d{3,6}(?:-[A-Z0-9]{1,3})?)/i))) return { t: 'SJ-' + m[1], kind: 'design' };
  var f = s.split('\n')[0].replace(/^\*[^*]{1,40}:\*\s*/, '').replace(/[*_<>]/g, '').replace(/https?:\S+/g, '').trim();
  return { t: f.slice(0, 60) || ('#' + chn), kind: 'thread' };
}

// ---------- seen marks (the Assistant's own) ----------
function seenPut(P, key, ts) { var k = 'SN_' + key, old = P.getProperty(k) || ''; if (+ts > +(old || 0)) { P.setProperty(k, String(ts)); P.setProperty('SNP_' + key, old || '0'); } }   // SNP_ = the mark before, for "keep unread"
function unseen(P, key, since) { var k = 'SN_' + key, prev = P.getProperty('SNP_' + key), cur = +(P.getProperty(k) || 0), t = prev != null ? +prev : 0; if (+since > 0) t = Math.min(t || +since, +since - 0.000001); if (t < cur) P.setProperty(k, String(t)); return t; }
function mine(o, who) { var a = String(o.who || '').toUpperCase().replace(/[^A-Z ]/g, '').trim().split(' ')[0], b = String(who || '').toUpperCase().replace(/[^A-Z ]/g, '').trim().split(' ')[0]; return a.length >= 3 && b.length >= 3 && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0); }

// ---------- the Catch-up: every chat with what is new in it, newest first ----------
function feed(who, P, fresh) {
  var all = P.getProperties(), t0 = +(all.AS_T0 || 0), c = C_(), chats = [], errs = [], now = Date.now();
  var mark = function (key) { return Math.max(+(all['SN_' + key] || 0), t0); };
  WS.forEach(function (w) {
    var tok = all['AS_TOK_' + w]; if (!tok) return;
    var team = all['AS_TEAM_' + w] || (w === 's' ? 'SJTC' : 'Factory'), L, users;
    try { L = chans(w, tok); users = names(w, tok); } catch (e) { errs.push(team + ': ' + e.message); return; }
    // which channels to read now: the hot ones (something in the last 2 h) and the ones read longest ago
    var st = {}; try { st = JSON.parse(c.get('ST_' + w) || '{}'); } catch (e) {}
    var order = L.slice().sort(function (a, b) { var sa = st[a.id] || {}, sb = st[b.id] || {}; return (sa.r || 0) - (sb.r || 0); });
    var hot = L.filter(function (ch) { var s = st[ch.id]; return s && s.a && now - s.a * 1000 < HOT_MS; }).slice(0, PER_CALL), pick = {};
    hot.forEach(function (ch) { pick[ch.id] = 1; }); order.filter(function (ch) { return !pick[ch.id]; }).slice(0, fresh ? L.length : PER_CALL).forEach(function (ch) { pick[ch.id] = 1; });
    var budget = fresh ? 30 : 8;                                    // thread reads per call per workspace (each cached by its newest reply)
    L.forEach(function (ch) {
      var H = null;
      if (pick[ch.id]) { try { H = chHist(tok, ch.id, false); st[ch.id] = { r: now, a: H.reduce(function (a, m) { return Math.max(a, +m.ts, +(m.lr || 0)); }, 0) }; } catch (e) { errs.push('#' + ch.name + ': ' + e.message); } }
      if (!H) { var hh = bigGet(c, 'HL_' + ch.id); H = hh ? JSON.parse(hh) : null; } else { try { bigPut(c, 'HL_' + ch.id, JSON.stringify(H), 21600); } catch (e) {} }
      if (!H) return;
      // the channel chat: its top-level posts
      var ck = w + ':' + ch.id + ':', cm = mark(ck), news = [], lastTop = '0';
      H.forEach(function (m) { if (+m.ts > +lastTop) lastTop = m.ts; if (+m.ts <= cm || m.rc) return; var o = msgOut(m, users, ''); if (o.sys || mine(o, who)) return; news.push(o); });   // a post with replies is its own chat
      chats.push({ k: ck, ws: w, team: team, chn: ch.name, title: '#' + ch.name, kind: 'channel', last: lastTop, un: news.length, lines: news.slice(0, 3).reverse().map(function (o) { return { who: o.who, text: line(o), ts: o.ts, f: (o.files || []).length }; }) });
      // one chat per thread
      H.forEach(function (m) {
        if (!m.rc) return; var tk = w + ':' + ch.id + ':' + m.ts, tm = mark(tk), ti = title(m.text, ch.name), row = { k: tk, ws: w, team: team, chn: ch.name, title: ti.t, kind: ti.kind, last: m.lr || m.ts, un: 0, lines: [] };
        if (+(m.lr || 0) > tm) {
          var R = null, rk = 'R_' + ch.id + '_' + m.ts, cached = bigGet(c, rk); if (cached) { var co = JSON.parse(cached); if (co.lr === m.lr) R = co.m; }
          if (!R && budget > 0) { budget--; try { R = replies(tok, ch.id, m.ts, m.lr, false); } catch (e) {} }
          if (R) { var nn = []; R.forEach(function (x) { if (x.ts === m.ts || +x.ts <= tm) return; var o = msgOut(x, users, m.ts); if (o.sys || mine(o, who)) return; nn.push(o); });
            row.un = nn.length; row.lines = nn.slice(-3).map(function (o) { return { who: o.who, text: line(o), ts: o.ts, f: (o.files || []).length }; }); }
          else row.un = -1;                                         // something new, not counted yet (next call)
        }
        chats.push(row);
      });
    });
    try { c.put('ST_' + w, JSON.stringify(st), 21600); } catch (e) {}
  });
  emailFeed(who, P, all, fresh, chats, errs);
  chats.sort(function (a, b) { return +b.last - +a.last; });
  var cut = Date.now() / 1000 - 45 * 86400; chats = chats.filter(function (x) { return x.un || +x.last > cut; }).slice(0, 400);
  return { ok: true, ver: AS_VER, chats: chats, errs: errs.slice(0, 5), t: Date.now(), email: gmailOn() ? myMail() : '' };
}
