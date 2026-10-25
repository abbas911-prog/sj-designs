// SJ ASSISTANT — its own Google Apps Script web app (24 Oct 2026). NOT the SJ relay: separate project, separate link, separate password.
// It talks to Slack directly with the two Slack bots' tokens (SJTC = SJ Stock side, factory = AL MUTAGADED side), which Abbas pastes ONCE into
// the Assistant app's setup screen; they are kept in THIS script's properties only (never in the repo, never in a chat).
// Every chat the bots can see = one channel chat (its top-level posts) + one chat per thread (an order memo, a pick list, a card…).
// Lines written from any SJ app are "*Name:* text" posted by a bot — shown as Name. Read marks ("seen") are the Assistant's own.
var AS_VER = '2026-10-25d';
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
  if (op === 'hello') return { ok: true, ver: AS_VER, teams: { s: P.getProperty('AS_TEAM_s') || '', f: P.getProperty('AS_TEAM_f') || '' }, email: gmailOn() ? myMail() : '', ai: !!P.getProperty('AS_AI'), tts: P.getProperty('AS_TTS_KIND') || '', trello: !!P.getProperty('AS_TRELLO_TOKEN'), brain: P.getProperty('AS_BRAIN') || BRAIN_DEFAULT, notes: P.getProperty('AS_NOTES') || '' };
  if (op === 'mail') return mailNew(req, who, P);                  // a new email to an address (text + files), e.g. a Slack photo sent on by email
  if (op === 'aikey') { var kk = String(req.key || '').trim(); if (!kk) { P.deleteProperty('AS_AI'); return { ok: true, ai: false }; } if (!/^sk-ant-/.test(kk)) return { ok: false, error: 'that does not look like an Anthropic key (sk-ant-…)' };
    var tst = aiCall(kk, P, [{ role: 'user', content: 'Say OK' }], 'Reply with the single word OK.', [], 20); if (tst.error) return { ok: false, error: tst.error }; P.setProperty('AS_AI', kk); return { ok: true, ai: true }; }
  if (op === 'trello') { var tk = String(req.key || '').trim(), tt = String(req.token || '').trim(); if (!tk || !tt) { P.deleteProperty('AS_TRELLO_KEY'); P.deleteProperty('AS_TRELLO_TOKEN'); return { ok: true, trello: false }; }
    var tr = UrlFetchApp.fetch('https://api.trello.com/1/members/me?fields=username&key=' + tk + '&token=' + tt, { muteHttpExceptions: true }); if (tr.getResponseCode() !== 200) return { ok: false, error: 'Trello refused that key/token' }; P.setProperty('AS_TRELLO_KEY', tk); P.setProperty('AS_TRELLO_TOKEN', tt); C_().remove('TRELLO_CARDS'); return { ok: true, trello: true }; }
  if (op === 'ttskey') {                                         // a professional voice: OpenAI or ElevenLabs key, pasted by Abbas; tested once
    var kind = String(req.kind || ''), tk2 = String(req.key || '').trim(); if (!tk2) { P.deleteProperty('AS_TTS_KEY'); P.deleteProperty('AS_TTS_KIND'); return { ok: true, tts: '' }; }
    if (kind !== 'openai' && kind !== 'eleven') return { ok: false, error: 'pick OpenAI or ElevenLabs' };
    var tr2 = ttsMake(kind, tk2, String(req.voice || ''), 'Hello Abbas.'); if (tr2.error) return { ok: false, error: tr2.error };
    P.setProperty('AS_TTS_KEY', tk2); P.setProperty('AS_TTS_KIND', kind); if (req.voice) P.setProperty('AS_TTS_VOICE', String(req.voice)); return { ok: true, tts: kind, b64: tr2.b64 }; }
  if (op === 'ttsvoice') { P.setProperty('AS_TTS_VOICE', String(req.voice || '')); return { ok: true }; }
  if (op === 'tts') { var kd = P.getProperty('AS_TTS_KIND'), ky = P.getProperty('AS_TTS_KEY'); if (!kd || !ky) return { ok: false, error: 'no voice key' };
    var tx3 = String(req.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200); if (!tx3) return { ok: false, error: 'empty' };
    var c3 = C_(), ck = 'TTS_' + hex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, kd + '|' + (P.getProperty('AS_TTS_VOICE') || '') + '|' + tx3)), hit = bigGet(c3, ck); if (hit) return { ok: true, b64: hit, cached: true };
    var r3 = ttsMake(kd, ky, P.getProperty('AS_TTS_VOICE') || '', tx3); if (r3.error) return { ok: false, error: r3.error }; try { bigPut(c3, ck, r3.b64, 21600); } catch (e) {} return { ok: true, b64: r3.b64 }; }
  if (op === 'brain') { P.setProperty('AS_BRAIN', String(req.text || '').slice(0, 8000)); return { ok: true }; }
  if (op === 'notes') { if (req.text !== undefined) P.setProperty('AS_NOTES', String(req.text || '').slice(0, 8000)); return { ok: true, notes: P.getProperty('AS_NOTES') || '' }; }
  if (op === 'ask') return askAI(req, who, P);
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
// ---------- the AI brain (25 Oct 2026): Abbas's own key (AS_AI), pasted once in the app's settings; the small fast model by default ----------
// The phone sends a question (typed or spoken) + what it knows (Timo day); the script adds the brain file, the notebook, the chat list and the
// new lines, and lets the model READ chats itself (tool read_chat). Anything that SENDS is never done here: the model asks for it with an
// action tool, the script queues it, and the phone shows it to Abbas and sends only after his yes.
var AI_MODEL = 'claude-sonnet-5-5', AI_URL = 'https://api.anthropic.com/v1/messages', AI_ROUNDS = 4;
var BRAIN_DEFAULT = [
  'You are the assistant of Abbas (Dubai). He runs SJ Trading / SJTC (Sayed Jamal Trading Co.): wholesale jalabiya and lace, and the AL MUTAGADED garment factory.',
  'Sources you see: Slack SJTC (customer order memos, godown pick lists, direct chats), Slack Factory (one chat per design card, #cash, #expenses, #laisfactory = lace), Email (his Gmail), and later WhatsApp.',
  'Design numbers look like SJ-48188 (also written 48188). A card chat in the factory workspace is that design\'s production thread.',
  'People often write Urdu, Hindi, Arabic or Bengali in Latin letters. Always answer Abbas in short plain English; translate any foreign line you quote.',
  'Style: brief, direct, no flattery. When reading out what is new, go chat by chat: who said what, newest first, and say which ones need his reply.',
  'HARD RULES: 1) Say only what a tool returned or what is in CHATS / NEW LINES / SCREEN below. If you have not read it, say "I have not read that yet" and read it with read_chat. Never invent names, numbers, times or figures. 2) Never claim something was sent: sends are QUEUED (send_message, send_email, forward_last, voice_note); Abbas confirms with "yes" on the phone. 3) WhatsApp is not connected yet: you can only forward_last to "whatsapp" (opens his share sheet) — say so when he asks to message someone on WhatsApp.',
  'THE SCREEN: Abbas talks to you by voice while looking at the phone. You control the screen with tools: walk_start (go through every chat with new messages one by one — each opens on screen and is read aloud by the phone), next_chat, skip_chat, open_chat (open one chat fully: for a design card this shows the card details at the top), close_chat, play_voice (play the latest voice note / video in the open chat), voice_note (hands-free: the phone records him from "start" until he stops speaking, then asks to send), forward_last (last N messages of a chat, with files, to a chat / whatsapp / email), mark_done. When he says "one by one", "go through them", "show me each message" → walk_start. When he says "next" → next_chat. "Play it" → play_voice. "Reply …" / "tell him …" while a chat is open → send_message to that chat. Keep spoken answers short; the screen shows the details.',
  'Money: AED unless said otherwise. Dates: Dubai time.',
  'Lookups: customer balances and saved bills = tool customer; vendors / cash accounts = tool ledger; invoices posted to Slack #sales-new or receipts = tool find_messages (they are shown on the phone with photos); card stage = tool trello_card; his day plan = TIMO below, add with timo_add. Use a lookup before answering a money or status question; never guess figures.'
].join('\n');
var AI_TOOLS = [
  { name: 'read_chat', description: 'Read the last messages of one chat (Slack channel, card thread, order memo, email thread) by its name as it appears in the chat list. Use it before answering about what someone said, a status, a balance written in a chat.', input_schema: { type: 'object', properties: { chat: { type: 'string', description: 'the chat name, e.g. "SJ-48188", "#cash", "NASIR (LIBYA)", "Lace shipment"' }, n: { type: 'integer', description: 'how many latest messages, default 25' } }, required: ['chat'] } },
  { name: 'remember', description: 'Write a short note into the notebook for later (things Abbas tells you to keep: "keep 48188 at 100", "Nadeem price 12.5").', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'send_message', description: 'QUEUE a message to a chat (Slack channel / thread / email thread) for Abbas to confirm. Write the message in the language Abbas wants (default English, Roman Urdu if he says so).', input_schema: { type: 'object', properties: { chat: { type: 'string' }, text: { type: 'string' } }, required: ['chat', 'text'] } },
  { name: 'send_email', description: 'QUEUE a new email to an address for Abbas to confirm.', input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } },
  { name: 'forward_last', description: 'QUEUE forwarding the latest message(s) of one chat (with their photos / voice notes / files) to another chat, to "whatsapp" (his share sheet), or to an email address. from_chat defaults to the open chat.', input_schema: { type: 'object', properties: { from_chat: { type: 'string' }, kind: { type: 'string', enum: ['photo', 'voice', 'file', 'message', 'any'], description: 'what to pick, default any' }, n: { type: 'integer', description: 'how many latest messages, default 1' }, to: { type: 'string', description: 'a chat name, "whatsapp", or an email address' } }, required: ['to'] } },
  { name: 'open_chat', description: 'Open a chat on the phone screen.', input_schema: { type: 'object', properties: { chat: { type: 'string' } }, required: ['chat'] } },
  { name: 'mark_done', description: 'Mark one chat (or all, chat = "all") as read in the Catch-up.', input_schema: { type: 'object', properties: { chat: { type: 'string' } }, required: ['chat'] } },
  { name: 'voice_note', description: 'Record a voice note hands-free: the phone starts recording Abbas, stops when he goes quiet, then asks to send it to that chat (default: the open chat).', input_schema: { type: 'object', properties: { chat: { type: 'string' } } } },
  { name: 'find_messages', description: 'Search one chat/channel for messages containing a word (a customer name, a design number, "receipt"…) and SHOW them on the phone with their photos. Use for "show me the last invoices of X" (channel #sales-new), receipts, bills.', input_schema: { type: 'object', properties: { chat: { type: 'string', description: 'channel or chat name, e.g. "#sales-new", "#sales", "#cash"' }, text: { type: 'string', description: 'what to look for (case does not matter)' }, n: { type: 'integer', description: 'how many latest matches, default 3' } }, required: ['chat', 'text'] } },
  { name: 'ledger', description: 'The SJ VENDOR LEDGER sheet: one tab per vendor / person / account (NADEEM, TUSHAR, RUSA, MATIULLAH, MANJAY, MAIN CASH, BUSINESS ACCOUNT…). Returns the current balance and the latest lines (date, description, amount). Use for "balance of…", "last payment to…", "what did we pay…".', input_schema: { type: 'object', properties: { name: { type: 'string' }, n: { type: 'integer', description: 'latest lines, default 8' } }, required: ['name'] } },
  { name: 'customer', description: 'A CUSTOMER of SJ Stock (the order memo app): opening balance, invoices and receipts, current balance, and the saved bills (INV-…, RV-…) with totals and status. Use for customer balances and "last invoices of <customer>".', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'trello_card', description: 'Where a design card is on the AL MUTAGADED Trello board: its list (stage), labels, last activity. Needs the Trello key/token in Settings.', input_schema: { type: 'object', properties: { design: { type: 'string', description: 'e.g. 48188 or SJ-48188' } }, required: ['design'] } },
  { name: 'walk_start', description: 'Start going through every chat with new messages one by one on the phone (each opens on screen and is read aloud). Returns how many.', input_schema: { type: 'object', properties: {} } },
  { name: 'next_chat', description: 'Move to the next chat in the walk (marks the current one read).', input_schema: { type: 'object', properties: {} } },
  { name: 'skip_chat', description: 'Next chat in the walk but keep the current one unread.', input_schema: { type: 'object', properties: {} } },
  { name: 'close_chat', description: 'Close the open chat and return to the assistant screen.', input_schema: { type: 'object', properties: {} } },
  { name: 'play_voice', description: 'Play the latest voice note or video in the open chat (or in the named chat).', input_schema: { type: 'object', properties: { chat: { type: 'string' } } } },
  { name: 'factory_status', description: 'What happened at the AL MUTAGADED factory since a time: cards that moved on the Trello board (needs Trello in Settings) and the new lines in the factory Slack. Use for "what is going on in the factory".', input_schema: { type: 'object', properties: { hours: { type: 'integer', description: 'look back this many hours, default 24' } } } },
  { name: 'timo_add', description: 'QUEUE adding a task / reminder to Timo (his day planner) for Abbas to confirm: text like "pay Nadeem 1000 #T1 today" — a #tag puts it inside that block, "tomorrow"/"mon" picks the day, "15 min" the length.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
];
var LEDGER_ID = '1SdVRWsmmZSdBMXFCfBlxRNQftT59mIAzzPj-ohOQr5c', CUST_ID = '1TJfwlodlnFslGDMzXZMtNnkn4ZoQOY1X4x2SOdaY3GI', ALM_BOARD = '6527c52485d9627f63157296';
function sheetsOn() { return typeof SpreadsheetApp !== 'undefined' && !!SpreadsheetApp; }
function fuzzy(list, q, get) { q = String(q || '').trim().toUpperCase(); if (!q) return null; var ex = list.filter(function (x) { return get(x).toUpperCase() === q; })[0]; if (ex) return ex;
  var st = list.filter(function (x) { return get(x).toUpperCase().indexOf(q) === 0; })[0]; if (st) return st; var qs = q.split(/\s+/)[0];
  return list.filter(function (x) { return get(x).toUpperCase().indexOf(q) >= 0; })[0] || list.filter(function (x) { return get(x).toUpperCase().indexOf(qs) >= 0 || qs.indexOf(get(x).toUpperCase().split(/\s+/)[0]) === 0; })[0] || null; }
function ledgerTool(name, n) {
  if (!sheetsOn()) return 'Sheets not allowed for this script yet';
  var ss; try { ss = SpreadsheetApp.openById(P_().getProperty('AS_LEDGER') || LEDGER_ID); } catch (e) { return 'could not open the vendor ledger: ' + e.message; }
  var tabs = ss.getSheets(), sh = fuzzy(tabs, name, function (t) { return t.getName(); }); if (!sh) return 'No ledger tab like "' + name + '". Tabs: ' + tabs.map(function (t) { return t.getName(); }).join(', ');
  var V = sh.getDataRange().getDisplayValues(), rows = V.filter(function (r) { return r[0] && /\d/.test(r[0]) && (r[1] || r[2] || r[3]); }), last = rows[rows.length - 1] || [];
  var bal = ''; for (var i = rows.length - 1; i >= 0 && !bal; i--) bal = rows[i][3];
  return 'LEDGER ' + sh.getName() + ' — balance now: ' + (bal || '?') + ' AED (last line ' + (last[0] || '-') + ')\n' + rows.slice(-(n || 8)).map(function (r) { return r[0] + ' | ' + r[1] + ' | ' + r[2] + ' | bal ' + r[3]; }).join('\n');
}
function customerTool(name) {
  if (!sheetsOn()) return 'Sheets not allowed for this script yet';
  var ss; try { ss = SpreadsheetApp.openById(P_().getProperty('AS_CUST') || CUST_ID); } catch (e) { return 'could not open the customer balances sheet: ' + e.message; }
  var C = ss.getSheetByName('CUSTOMERS'), E = ss.getSheetByName('ENTRIES'), B = ss.getSheetByName('BILLS'); if (!C || !E) return 'no CUSTOMERS / ENTRIES tabs';
  var cs = C.getDataRange().getDisplayValues().slice(1).filter(function (r) { return r[0] && !r[6]; }), c = fuzzy(cs, name, function (r) { return r[1] || r[0]; });
  var bills = B ? B.getDataRange().getDisplayValues().slice(1).filter(function (r) { return r[0] && r[3] !== 'deleted'; }) : [];
  var bl = c ? bills.filter(function (r) { return String(r[2] || '').toUpperCase() === String(c[0]).toUpperCase(); }) : bills.filter(function (r) { return String(r[2] || '').toUpperCase().indexOf(String(name).toUpperCase()) >= 0; });
  if (!c && !bl.length) return 'No customer like "' + name + '". Known: ' + cs.map(function (r) { return r[1]; }).slice(0, 60).join(', ');
  var o = '';
  if (c) { var es = E.getDataRange().getDisplayValues().slice(1).filter(function (r) { return r[1] === c[0] && !r[12]; }), num = function (v) { var x = parseFloat(String(v || '').replace(/[,\s]/g, '')); return isFinite(x) ? x : 0; };
    var bal = es.reduce(function (a, r) { return a + num(r[6]) - num(r[7]) + num(r[8]); }, num(c[2]));
    o += 'CUSTOMER ' + c[1] + ' — balance now ' + Math.round(bal) + ' AED (opening ' + c[2] + ' on ' + c[3] + ', ' + es.length + ' entries)\n' + es.slice(-8).map(function (r) { return r[5] + ' | ' + r[3] + ' ' + r[4] + ' | sale ' + r[6] + ' | received ' + r[7] + (r[8] ? ' | adjust ' + r[8] : ''); }).join('\n'); }
  if (bl.length) { bl.sort(function (a, b) { return a[6] < b[6] ? 1 : -1; }); o += (o ? '\n' : '') + 'SAVED BILLS (newest first):\n' + bl.slice(0, 6).map(function (r) { return r[0] + ' | ' + r[1] + ' | ' + r[3] + ' | ' + r[4] + ' AED | ' + r[5] + ' | by ' + r[7]; }).join('\n'); }
  return o;
}
function trelloTool(design) {
  var P = P_(), key = P.getProperty('AS_TRELLO_KEY'), tok = P.getProperty('AS_TRELLO_TOKEN'); if (!key || !tok) return 'No Trello key/token in Settings yet';
  var num = String(design || '').replace(/[^0-9A-Z-]/gi, '').replace(/^SJ-?/i, ''); if (!num) return 'which design?';
  var c = C_(), h = c.get('TRELLO_CARDS'), cards = h ? JSON.parse(h) : null, auth = 'key=' + key + '&token=' + tok, board = P.getProperty('AS_BOARD') || ALM_BOARD;
  if (!cards) { try { var lists = JSON.parse(UrlFetchApp.fetch('https://api.trello.com/1/boards/' + board + '/lists?fields=name&' + auth, { muteHttpExceptions: true }).getContentText()), LN = {}; lists.forEach(function (l) { LN[l.id] = l.name; });
      var cs = JSON.parse(UrlFetchApp.fetch('https://api.trello.com/1/boards/' + board + '/cards?fields=name,idList,labels,dateLastActivity,shortUrl&limit=1000&' + auth, { muteHttpExceptions: true }).getContentText());
      if (!Array.isArray(cs)) return 'Trello said: ' + JSON.stringify(cs).slice(0, 120);
      cards = cs.map(function (x) { return { n: x.name, l: LN[x.idList] || x.idList, lb: (x.labels || []).map(function (y) { return y.name; }).join(', '), a: x.dateLastActivity, u: x.shortUrl }; }); try { c.put('TRELLO_CARDS', JSON.stringify(cards), 120); } catch (e) {} }
    catch (e) { return 'Trello: ' + e.message; } }
  var hit = cards.filter(function (x) { return new RegExp('(^|[^0-9])' + num + '([^0-9]|$)').test(x.n); });
  if (!hit.length) return 'No card with ' + num + ' on the board';
  return hit.slice(0, 4).map(function (x) { return 'CARD "' + x.n + '" — list: ' + x.l + (x.lb ? ' — labels: ' + x.lb : '') + ' — last activity ' + String(x.a || '').slice(0, 10) + ' — ' + x.u; }).join('\n');
}
function factoryStatus(idx, hours, who, P) {
  var h = hours || 24, since = Date.now() - h * 3600 * 1000, out = [];
  var key = P.getProperty('AS_TRELLO_KEY'), tok = P.getProperty('AS_TRELLO_TOKEN');
  if (key && tok) { try { var c = C_(), hh = c.get('TRELLO_CARDS'), cards = hh ? JSON.parse(hh) : null; if (!cards) { trelloTool('000000'); hh = c.get('TRELLO_CARDS'); cards = hh ? JSON.parse(hh) : []; }
      var moved = cards.filter(function (x) { return x.a && new Date(x.a).getTime() > since; }).sort(function (a, b) { return a.a < b.a ? 1 : -1; });
      out.push('TRELLO (last ' + h + ' h): ' + (moved.length ? moved.slice(0, 15).map(function (x) { return x.n + ' → ' + x.l; }).join('; ') : 'no card changed')); } catch (e) { out.push('Trello: ' + e.message); } }
  else out.push('Trello not connected (no key in Settings) — card moves unknown');
  var fac = idx.list.filter(function (c) { return c.ws === 'f' && +c.last * 1000 > since; });
  out.push('FACTORY SLACK (last ' + h + ' h): ' + (fac.length ? fac.slice(0, 20).map(function (c) { return c.title + (c.un > 0 ? ' (' + c.un + ' new: ' + c.lines.map(function (l) { return l.who + ': ' + l.text; }).join(' / ') + ')' : ''); }).join('; ') : 'nothing new'));
  return out.join('\n');
}
function findMsgs(L, chat, text, n, who, P) {
  var c = findChatSrv(L, chat); if (!c) return { res: 'No chat called "' + chat + '"' };
  var k = parseKey(c.k), q = String(text || '').toLowerCase().trim(), msgs = [];
  if (k.ws === 'e') { var r = emailOp('thread', k, { k: c.k }, who, P); msgs = r.ok ? r.msgs : []; }
  else { var tok = P.getProperty('AS_TOK_' + k.ws), users = names(k.ws, tok), raw = k.ts ? replies(tok, k.ch, k.ts, '', false) : chHist(tok, k.ch, false); msgs = raw.map(function (m) { return msgOut(m, users, k.ts); }); }
  var hits = msgs.filter(function (m) { return !m.sys && (String(m.text || '').toLowerCase().indexOf(q) >= 0 || (m.files || []).some(function (f) { return String(f.name || '').toLowerCase().indexOf(q) >= 0; })); });
  hits.sort(function (a, b) { return +b.ts - +a.ts; }); hits = hits.slice(0, n || 3);
  var shown = hits.map(function (m) { return { k: c.k, chat: c.title, ts: m.ts, who: m.who, text: String(m.text || '').slice(0, 1500), files: m.files || [] }; });
  return { res: hits.length ? 'Found ' + hits.length + ' in ' + c.title + ' (shown on the phone):\n' + hits.map(function (m) { return Utilities.formatDate(new Date(+m.ts * 1000), 'Asia/Dubai', 'd MMM') + ' ' + m.who + ': ' + String(m.text || '').replace(/\s+/g, ' ').slice(0, 300) + ((m.files || []).length ? ' [' + fileWord(m.files) + ']' : ''); }).join('\n') : 'Nothing with "' + text + '" in the last ' + msgs.length + ' messages of ' + c.title, shown: shown };
}
function aiCall(key, P, messages, system, tools, maxTok) {
  var body = { model: P.getProperty('AS_MODEL') || AI_MODEL, max_tokens: maxTok || 900, system: system, messages: messages }; if (tools && tools.length) body.tools = tools;
  var r, j; try { r = UrlFetchApp.fetch(AI_URL, { method: 'post', contentType: 'application/json', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body), muteHttpExceptions: true }); j = JSON.parse(r.getContentText()); }
  catch (e) { return { error: 'AI: ' + String(e.message || e).slice(0, 160) }; }
  if (j.error) return { error: 'AI said: ' + (j.error.message || j.error.type || 'error').slice(0, 200) + (r.getResponseCode() === 401 ? ' — check the key' : r.getResponseCode() === 400 && /credit|balance/i.test(j.error.message || '') ? ' — top up the balance at console.anthropic.com' : '') };
  return j;
}
function chatIndex(who, P) {                                      // the chats the model may name: from the feed (cached 25 s inside)
  var f; try { f = feed(who, P, false); } catch (e) { return { list: [], digest: '' }; }
  var L = (f.chats || []).slice(0, 120), dg = [];
  L.forEach(function (c) { if (c.un > 0 && c.lines.length) dg.push('• ' + c.title + ' [' + (c.ws === 'e' ? 'Email' : c.team + ' #' + c.chn) + ']: ' + c.lines.map(function (l) { return l.who + ': ' + l.text; }).join(' / ')); });
  return { list: L, digest: dg.slice(0, 40).join('\n') };
}
function findChatSrv(L, q) { q = String(q || '').trim().toLowerCase().replace(/^#/, '').replace(/^sj-?/, ''); if (!q) return null;
  var norm = function (c) { return String(c.title || '').toLowerCase().replace(/^#/, '').replace(/^sj-?/, ''); };
  return L.filter(function (c) { return norm(c) === q || (c.kind === 'channel' && c.chn.toLowerCase() === q); })[0] || L.filter(function (c) { return norm(c).indexOf(q) >= 0 || String(c.chn || '').toLowerCase().indexOf(q) >= 0; })[0] || null; }
function readChatSrv(c, n, who, P) {
  var k = parseKey(c.k), msgs; if (!k) return 'bad chat';
  if (k.ws === 'e') { var r = emailOp('thread', k, { k: c.k }, who, P); if (!r.ok) return r.error; msgs = r.msgs; }
  else { var tok = P.getProperty('AS_TOK_' + k.ws); if (!tok) return 'no token'; var raw = k.ts ? replies(tok, k.ch, k.ts, '', false) : chHist(tok, k.ch, false).slice().reverse(); var users = names(k.ws, tok); msgs = raw.map(function (m) { return msgOut(m, users, k.ts); }); }
  return msgs.slice(-(n || 25)).map(function (m) { var d = new Date(+m.ts * 1000), ds = Utilities.formatDate(d, 'Asia/Dubai', 'd MMM HH:mm'); return ds + ' ' + (m.sys ? '→ ' : (m.who || '?') + ': ') + String(m.text || '').replace(/\s+/g, ' ').slice(0, 400) + ((m.files || []).length ? ' [' + fileWord(m.files) + ']' : ''); }).join('\n') || '(empty)';
}
function askAI(req, who, P) {
  var key = P.getProperty('AS_AI'); if (!key) return { ok: false, error: 'no AI key yet — add it in Settings', nokey: true };
  var q = String(req.q || '').trim().slice(0, 4000); if (!q) return { ok: false, error: 'empty' };
  var idx = chatIndex(who, P), now = Utilities.formatDate(new Date(), 'Asia/Dubai', 'EEEE d MMM yyyy HH:mm');
  var system = (P.getProperty('AS_BRAIN') || BRAIN_DEFAULT) + '\n\nNow: ' + now + ' (Dubai).\n\nNOTEBOOK:\n' + (P.getProperty('AS_NOTES') || '(empty)') +
    '\n\nCHATS (name [source] · unread):\n' + idx.list.map(function (c) { return c.title + ' [' + (c.ws === 'e' ? 'Email ' + c.chn : c.team + ' #' + c.chn) + ']' + (c.un > 0 ? ' · ' + c.un + ' new' : ''); }).join('\n') +
    '\n\nNEW LINES RIGHT NOW:\n' + (idx.digest || '(nothing new)') + (req.timo ? '\n\nTIMO (his day plan, from the phone):\n' + String(req.timo).slice(0, 2000) : '') +
    (req.screen && req.screen.chat ? '\n\nSCREEN: the chat "' + String(req.screen.chat).slice(0, 80) + '" is OPEN now' + (req.screen.walk ? ' (walk ' + req.screen.walk + ')' : '') + '. Its latest lines:\n' + String(req.screen.lines || '').slice(0, 1500) : '\n\nSCREEN: the assistant screen (no chat open).') +
    (req.mode === 'drive' ? '\n\nHe is listening by voice: answer in one or two short spoken sentences, no lists, no symbols; the screen shows the details.' : '');
  var msgs = []; (Array.isArray(req.hist) ? req.hist.slice(-8) : []).forEach(function (h) { if (h && (h.role === 'user' || h.role === 'assistant') && h.text) msgs.push({ role: h.role, content: String(h.text).slice(0, 2000) }); });
  msgs.push({ role: 'user', content: q });
  var actions = [], text = '', notes = P.getProperty('AS_NOTES') || '', shown = [];
  for (var round = 0; round < AI_ROUNDS; round++) {
    var j = aiCall(key, P, msgs, system, AI_TOOLS, 900); if (j.error) return { ok: false, error: j.error };
    var parts = j.content || [], uses = parts.filter(function (p) { return p.type === 'tool_use'; }); parts.forEach(function (p) { if (p.type === 'text' && p.text) text += (text ? '\n' : '') + p.text; });
    if (!uses.length) break;
    msgs.push({ role: 'assistant', content: parts }); var results = [];
    uses.forEach(function (u) { var inp = u.input || {}, res = '';
      if (u.name === 'read_chat') { var c = findChatSrv(idx.list, inp.chat); res = c ? 'CHAT ' + c.title + ':\n' + readChatSrv(c, +inp.n || 25, who, P) : 'No chat called "' + inp.chat + '". Names available are in the CHATS list.'; }
      else if (u.name === 'find_messages') { var fm = findMsgs(idx.list, inp.chat, inp.text, +inp.n || 3, who, P); res = fm.res; (fm.shown || []).forEach(function (x) { shown.push(x); }); }
      else if (u.name === 'ledger') { try { res = ledgerTool(inp.name, +inp.n || 8); } catch (e) { res = 'ledger: ' + e.message; } }
      else if (u.name === 'customer') { try { res = customerTool(inp.name); } catch (e) { res = 'customer: ' + e.message; } }
      else if (u.name === 'trello_card') { try { res = trelloTool(inp.design); } catch (e) { res = 'trello: ' + e.message; } }
      else if (u.name === 'timo_add') { actions.push({ type: 'timo_add', text: String(inp.text || '').slice(0, 200) }); res = 'queued — Abbas will confirm on the phone'; }
      else if (u.name === 'remember') { notes = (notes + '\n' + Utilities.formatDate(new Date(), 'Asia/Dubai', 'd MMM') + ': ' + String(inp.text || '').slice(0, 300)).trim().slice(-8000); P.setProperty('AS_NOTES', notes); res = 'noted'; }
      else if (u.name === 'factory_status') { try { res = factoryStatus(idx, +inp.hours || 24, who, P); } catch (e) { res = 'factory: ' + e.message; } }
      else if (/^(walk_start|next_chat|skip_chat|close_chat)$/.test(u.name)) { actions.push({ type: u.name }); res = u.name === 'walk_start' ? (idx.list.filter(function (c) { return c.un; }).length + ' chats with new messages — the phone opens them one by one and reads each aloud; you need not repeat their content') : 'done on the phone'; }
      else if (u.name === 'play_voice') { var pc = inp.chat ? findChatSrv(idx.list, inp.chat) : null; actions.push({ type: 'play_voice', k: pc ? pc.k : '', chat: pc ? pc.title : '' }); res = 'the phone plays it'; }
      else if (/^(send_message|send_email|forward_last|open_chat|mark_done|voice_note)$/.test(u.name)) {
        var a = { type: u.name, chat: inp.chat || inp.from_chat || '', text: inp.text || '', to: inp.to || '', subject: inp.subject || '', kind: inp.kind || 'any', n: Math.max(1, Math.min(5, +inp.n || 1)) };
        if (!a.chat && req.screen && req.screen.k && /^(forward_last|voice_note|send_message|mark_done)$/.test(u.name)) { a.chat = req.screen.chat; a.k = req.screen.k; }
        if (a.chat && !a.k) { var cc = findChatSrv(idx.list, a.chat); if (cc) { a.k = cc.k; a.chat = cc.title; } else if (u.name !== 'mark_done' || a.chat.toLowerCase() !== 'all') { res = 'No chat called "' + a.chat + '" — pick a name from the CHATS list.'; } }
        if (!res && !a.k && /^(forward_last|voice_note|send_message)$/.test(u.name)) res = 'Which chat? None is open and none was named.';
        if (!res) { if (/^(open_chat|mark_done)$/.test(u.name)) res = 'done on the phone'; else res = 'queued — Abbas will confirm on the phone; tell him it is ready and say what it contains'; actions.push(a); } }
      else res = 'unknown tool';
      results.push({ type: 'tool_result', tool_use_id: u.id, content: res.slice(0, 12000) }); });
    msgs.push({ role: 'user', content: results });
    if (j.stop_reason === 'end_turn') break;
  }
  return { ok: true, text: text.trim() || (actions.length ? 'Ready.' : '…'), actions: actions, notes: notes, shown: shown.slice(0, 8) };
}
// ---------- a professional voice (25 Oct 2026, Abbas: "not robotic, like Claude's app") ----------
// OpenAI (model gpt-4o-mini-tts, voices alloy/ash/coral/echo/fable/nova/onyx/sage/shimmer; ~AED 2 per 1M letters) or ElevenLabs (voice id; Starter plan).
function ttsMake(kind, key, voice, text) {
  try {
    if (kind === 'openai') {
      var r = UrlFetchApp.fetch('https://api.openai.com/v1/audio/speech', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true,
        payload: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice || 'onyx', input: text, response_format: 'mp3', instructions: 'Calm, warm, professional assistant. Natural pace. British-neutral English. Say Arabic and Urdu names naturally.' }) });
      if (r.getResponseCode() !== 200) { var j; try { j = JSON.parse(r.getContentText()); } catch (e) {} return { error: 'OpenAI said: ' + ((j && j.error && j.error.message) || r.getResponseCode()).toString().slice(0, 160) }; }
      return { b64: Utilities.base64Encode(r.getBlob().getBytes()) };
    }
    if (kind === 'eleven') {
      var vid = voice || 'JBFqnCBsd6RMkjVDRZzb';                      // "George" — warm, professional
      var r2 = UrlFetchApp.fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid + '?output_format=mp3_44100_64', { method: 'post', contentType: 'application/json', headers: { 'xi-api-key': key }, muteHttpExceptions: true,
        payload: JSON.stringify({ text: text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }) });
      if (r2.getResponseCode() !== 200) return { error: 'ElevenLabs said: ' + r2.getContentText().slice(0, 160) };
      return { b64: Utilities.base64Encode(r2.getBlob().getBytes()) };
    }
    return { error: 'unknown voice service' };
  } catch (e) { return { error: 'voice: ' + String(e.message || e).slice(0, 160) }; }
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
  return { ok: true, ver: AS_VER, chats: chats, errs: errs.slice(0, 5), t: Date.now(), email: gmailOn() ? myMail() : '', ai: !!all.AS_AI, tts: all.AS_TTS_KIND || '' };
}
