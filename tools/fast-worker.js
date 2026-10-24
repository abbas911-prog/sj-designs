// SJ FACTORY FAST LANE — Cloudflare Worker (free plan). 16 Oct 2026.
// Abbas: "you have to think better and do something about this chat .. not flawless at all".
// Why: every chat read / voice note / send used to go through the Google Apps Script relay, which takes 1-3 s per request (up to 10 s).
// This worker answers in ~0.1-0.3 s: it reads the card chats and the Direct chat straight from Slack, streams photos / voice notes /
// videos in ORIGINAL quality (no base64, no size squeeze), and posts text lines. Trello, uploads, returns, unread counts stay on the relay.
// Setup (Abbas, once): Cloudflare -> Workers -> create "sj-fast" -> paste this file -> Deploy -> Settings -> Variables and Secrets ->
// Secret SLACK_TOKEN = the factory Slack bot token (xoxb-…, from the SJ Orders Slack app). Then paste the worker link in the app (tap the
// status line -> Fast lane). Phones prove the factory password through the relay (the worker never stores it).
const RELAY = 'https://script.google.com/macros/s/AKfycbylqzZf0KPyK_u2W52l3Jb8u9uhd4o4mYp7vOeJlmBGJeQfejwYAazjQa6ymmlIsXpVoA/exec';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const OKKEYS = new Map();        // proven phone keys -> expiry (per worker instance)
const ONCE = new Map();          // once-only ids of posts -> answer (a retry never posts twice)
const HOT = new Map();           // the same chat asked by several phones within 1.5 s -> one Slack call
let USERS = null, USERS_AT = 0;
// ---- TRELLO (17 Oct 2026, Abbas: "still very laggy .. why can't you make it as smooth as real apps like Slack, Trello"): the card list, a card's
// attachments, cover / attachment photos and Done / Move also go phone -> worker -> Trello (~0.3 s) instead of through the Google relay (1-15 s).
// Needs a second secret, TRELLO_TOKEN (read + write token made with the app key below). Without it the phones keep using the relay.
const TKEY = '83fea3748717dd1e3fe28a15f2371759', BOARD = '6527c52485d9627f63157296';
let CF = null, CF_AT = 0;
async function trello(env, method, path, params) {
  const q = new URLSearchParams(params || {}); q.set('key', TKEY); q.set('token', env.TRELLO_TOKEN);
  const r = await fetch('https://api.trello.com/1' + path + '?' + q, { method: method.toUpperCase() });
  if (!r.ok) throw new Error('Trello said ' + r.status + ' ' + (await r.text()).slice(0, 80));
  return r.json();
}
async function cfNames(env) { if (CF && Date.now() - CF_AT < 6 * 3600000) return CF; const m = {}; (await trello(env, 'get', '/boards/' + BOARD + '/customFields') || []).forEach(f => { m[f.id] = f.name; }); CF = m; CF_AT = Date.now(); return m; }
async function tlist(env, q) {                                  // the cards of the app's lists, shaped exactly like the relay's list
  // 17 Oct 2026: one call per list, no attachment details (the cover id is enough) - the whole-board answer was ~4 MB and went over the
  // free plan's 10 ms CPU, so the worker failed and every phone fell back to the slow relay. The long "done" lists (FINISH, SAMPLE DONE,
  // FINISH SAMPLES - the ones with a limit) are NOT read here: the phone keeps them from the relay's list (refreshed every 5 min).
  const limit = q.limit || {}, lists = Array.isArray(q.lists) ? q.lists.map(l => String(l[1] || '')).filter(x => /^[0-9a-f]{24}$/.test(x) && !limit[x]) : []; if (!lists.length) return { ok: false, error: 'bad request' };
  const [cf, per] = await Promise.all([cfNames(env), Promise.all(lists.map(id => trello(env, 'get', '/lists/' + id + '/cards', { fields: 'name,idList,pos,shortUrl,idAttachmentCover,dateLastActivity,labels,due', customFieldItems: 'true' })))]);
  const cards = [].concat.apply([], per).sort((a, b) => a.pos - b.pos);
  return { ok: true, t: Date.now(), covered: lists, cards: cards.map(c => { const f = {}; (c.customFieldItems || []).forEach(it => { const n = cf[it.idCustomField], v = it.value || {}; const x = v.text != null ? v.text : v.number != null ? v.number : v.date || (v.checked === 'true' ? '✓' : null); if (n && x != null && String(x).trim() !== '') f[n] = String(x); });
    return { id: c.id, name: c.name, l: c.idList, pos: c.pos, url: c.shortUrl, img: c.idAttachmentCover || '', f, at: c.dateLastActivity, due: c.due ? String(c.due).slice(0, 10) : '', lb: (c.labels || []).filter(l => l.name).map(l => ({ n: l.name, c: l.color || '' })) }; }) };
}
async function tatts(env, q) {
  const id = String(q.card || '').replace(/[^0-9a-f]/g, ''); if (!id) return { ok: false, error: 'bad request' };
  const [cd, al] = await Promise.all([trello(env, 'get', '/cards/' + id, { fields: 'idAttachmentCover,desc' }), trello(env, 'get', '/cards/' + id + '/attachments', { fields: 'id,name,mimeType,previews,url,bytes,date' })]);
  return { ok: true, cover: cd.idAttachmentCover || '', desc: String(cd.desc || ''), atts: (al || []).map(a => ({ id: a.id, name: a.name, type: a.mimeType || '', img: !!(a.previews && a.previews.length), url: a.url, bytes: a.bytes || 0, date: a.date })) };
}
async function timg(env, q) {                                   // a card photo: Trello's 600-1000 px preview, or (big) the sharpest there is
  const id = String(q.card || '').replace(/[^0-9a-f]/g, ''), att = String(q.att || '').replace(/[^0-9a-f]/g, ''); if (!id || !att) return json({ ok: false, error: 'bad request' }, 400);
  const at = await trello(env, 'get', '/cards/' + id + '/attachments/' + att, { fields: 'previews,url,mimeType,bytes' }), pvs = (at.previews || []).slice().sort((x, y) => x.width - y.width);
  let u = q.big ? (pvs.length ? pvs[pvs.length - 1].url : '') : ((pvs.filter(p => p.width >= 600)[0] || pvs[pvs.length - 1] || {}).url || '');
  if ((q.big && (!pvs.length || pvs[pvs.length - 1].width < 1600) || !u) && /^image\//.test(at.mimeType || '') && (at.bytes || 0) <= 15 * 1024 * 1024 && at.url) u = at.url;
  if (!u) return json({ ok: false, error: 'not a picture' }, 404);
  const r = await fetch(u, { headers: { Authorization: 'OAuth oauth_consumer_key="' + TKEY + '", oauth_token="' + env.TRELLO_TOKEN + '"' } });
  if (!r.ok) return json({ ok: false, error: 'Trello photo ' + r.status }, 502);
  return new Response(r.body, { headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
async function tmove(env, q, ctx) {                             // Done -> next stage / Move to: the real Trello card moves to the top of the new list
  const rid = String(q.rid || '').replace(/[^\w-]/g, '').slice(0, 40); if (rid && ONCE.has(rid)) return ONCE.get(rid);
  const id = String(q.card || '').replace(/[^0-9a-f]/g, ''), to = String(q.to || ''), lists = Array.isArray(q.lists) ? q.lists : [], who = String(q.who || '').slice(0, 40) || 'factory';
  const tl = lists.filter(l => l[1] === to)[0]; if (!id || !tl) return { ok: false, error: 'bad request' };
  const now = await trello(env, 'get', '/cards/' + id, { fields: 'idList,idBoard' }); if (now.idBoard !== BOARD) return { ok: false, error: 'not an ALM card' };
  if (q.from && now.idList !== q.from) { const nm = lists.filter(l => l[1] === now.idList)[0]; return { ok: false, moved: true, error: 'This card was already moved to ' + (nm ? nm[0] : 'another list') + ' - press ↻ to refresh' }; }
  if (now.idList !== to) {
    await trello(env, 'put', '/cards/' + id, { idList: to, pos: 'top' });
    ctx.waitUntil(trello(env, 'post', '/cards/' + id + '/actions/comments', { text: '→ ' + tl[0] + ' · ' + who + ' (factory app)' }).catch(() => {}));
    const ref = Array.isArray(q.ref) ? q.ref : null;
    if (ref && /^[CG][A-Z0-9]{5,}$/.test(ref[0]) && /^\d+\.\d+$/.test(ref[1]) && env.SLACK_TOKEN) ctx.waitUntil(slack(env, 'chat.postMessage', { channel: ref[0], thread_ts: ref[1], text: '→ *' + tl[0] + '* · ' + who + ' · 🕒 ' + dubaiWhen(Date.now()) }).catch(() => {}));   // 24 Oct 2026 (Abbas): the time with every move
  }
  const topic = String(q.topic || '').replace(/[^\w-]/g, '').slice(0, 64);
  if (topic) ctx.waitUntil(fetch('https://ntfy.sh/' + topic, { method: 'POST', body: 'c=list:' + id, headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {}));
  const res = { ok: true }; if (rid) ONCE.set(rid, res); return res;
}

function json(o, st) { return new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } }); }

// 17 Oct 2026 (Abbas: "a message came through on Slack, and in the app it came after 25-30 seconds"): Slack Event Subscriptions point HERE
// (Request URL = <worker>/slack?t=<the app's private doorbell topic>). Slack is answered at once; the doorbell gets only "s:<channel>:<thread>"
// (no message text). Nothing in the event is trusted - a fake one can only make the phones re-read a chat.
async function slackEvent(req, url, ctx) {
  let b = {}; try { b = JSON.parse(await req.text()); } catch (e) { return new Response('ok'); }
  if (b.type === 'url_verification') return new Response(String(b.challenge || ''), { headers: { 'Content-Type': 'text/plain' } });
  const t = String(url.searchParams.get('t') || '').replace(/[^\w-]/g, '').slice(0, 64), ev = b.event || {};
  if (t && b.type === 'event_callback' && ev.type === 'message' && !req.headers.get('x-slack-retry-num')) {
    const ch = String(ev.channel || '').replace(/[^A-Z0-9]/g, ''), ts = String(ev.thread_ts || (ev.message && ev.message.thread_ts) || (ev.previous_message && ev.previous_message.thread_ts) || ev.ts || '').replace(/[^\d.]/g, '');
    ctx.waitUntil(fetch('https://ntfy.sh/' + t, { method: 'POST', body: 's:' + ch + ':' + ts, headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {}));
  }
  return new Response('ok');
}
async function slack(env, method, args, get) {
  const tok = env.SLACK_TOKEN; if (!tok) return { ok: false, error: 'the worker has no SLACK_TOKEN secret' };
  let r;
  if (get) { const q = new URLSearchParams(); for (const k in args) if (args[k] !== undefined && args[k] !== '') q.set(k, String(args[k])); r = await fetch('https://slack.com/api/' + method + '?' + q, { headers: { Authorization: 'Bearer ' + tok } }); }
  else r = await fetch('https://slack.com/api/' + method, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(args) });
  if (r.status === 429) return { ok: false, error: 'ratelimited', retry: +(r.headers.get('Retry-After') || 2) };
  try { return await r.json(); } catch (e) { return { ok: false, error: 'Slack answered ' + r.status }; }
}

async function proven(key) {                                    // key = sha256("sjfast|" + factory password), checked once by the relay
  if (!/^[0-9a-f]{64}$/.test(key || '')) return false;
  const until = OKKEYS.get(key); if (until && until > Date.now()) return true;
  try {
    const r = await fetch(RELAY, { method: 'POST', body: JSON.stringify({ job: 'fastchk', k: key }), redirect: 'follow' });
    const j = await r.json(); if (j && j.ok) { OKKEYS.set(key, Date.now() + 6 * 3600 * 1000); return true; }
  } catch (e) {}
  return false;
}

async function users(env) {                                     // every person of the workspace, one call, kept 10 min
  if (USERS && Date.now() - USERS_AT < 600000) return USERS;
  const m = {}; let cur = '';
  for (let i = 0; i < 3; i++) {
    const j = await slack(env, 'users.list', { limit: 200, cursor: cur }, true); if (!j.ok) break;
    (j.members || []).forEach(u => { const pr = u.profile || {}; const names = [pr.real_name, u.real_name, pr.display_name, u.name].filter(Boolean).map(String);
      m[u.id] = { n: (names[0] || u.id).split(' ')[0], wn: names.join(' ').split(/[\s._\-]+/).filter(Boolean) }; });
    cur = (j.response_metadata || {}).next_cursor || ''; if (!cur) break;
  }
  if (Object.keys(m).length) { USERS = m; USERS_AT = Date.now(); }
  return USERS || {};
}

function shape(U, m, root) {                                     // one Slack message -> what the phone shows (same as the relay's facMsg)
  let text = String(m.text || ''), who = '', app = false, wn = []; const mm = text.match(/^\*([^*]{1,40}):\*\s?([\s\S]*)$/);
  if (m.bot_id && mm) { who = mm[1]; text = mm[2]; app = true; }
  else if (m.bot_id) who = m.username || 'SJ';
  else if (m.user) { const fu = U[m.user] || { n: m.user, wn: [] }; who = fu.n; wn = fu.wn; }
  const files = (m.files || []).map(f => { const mt = f.mimetype || '', nm = f.name || '';
    const video = /^video\//.test(mt) || (!/^audio\//.test(mt) && /\.(mp4|mov|m4v|webm|3gp)$/i.test(nm));
    const audio = !video && (/^audio\//.test(mt) || /\.(m4a|opus|ogg|oga|mp3|aac|amr|wav)$/i.test(nm) || (/\.webm$/i.test(nm) && /^voice/i.test(nm)));
    return { id: f.id, name: nm, type: mt, size: f.size || 0, img: /^image\//.test(mt), audio, video }; });
  const sys = /^→ \*/.test(text) && m.bot_id;
  return { ts: m.ts, who, wn, app, sys: !!sys, root: m.ts === root, text: text.replace(/<(https?:[^|>]+)(\|[^>]*)?>/g, '$1'), files };
}
const SHOW = m => !m.subtype || m.subtype === 'bot_message' || m.subtype === 'file_share' || m.subtype === 'thread_broadcast';

function dubaiWhen(ms) { const u = new Date(ms + 4 * 3600000), M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return D[u.getUTCDay()] + ' ' + u.getUTCDate() + ' ' + M[u.getUTCMonth()] + ' ' + String(u.getUTCHours()).padStart(2, '0') + ':' + String(u.getUTCMinutes()).padStart(2, '0'); }   // "Fri 24 Oct 16:42" Dubai, same as the relay's facWhen
async function hot(key, fn, fresh) { const h = HOT.get(key); if (h && !fresh && Date.now() - h.at < 1500) return h.p; const p = fn(); HOT.set(key, { at: Date.now(), p }); if (HOT.size > 200) HOT.clear(); return p; }

async function thread(env, q) {                                  // a card chat = the replies of its #cutting (or #samples-discuss) message
  const ch = String(q.ch || ''), ts = String(q.ts || ''), since = /^\d+\.\d+$/.test(String(q.since || '')) ? String(q.since) : '';
  if (!/^[CG][A-Z0-9]{5,}$/.test(ch) || !/^\d+\.\d+$/.test(ts)) return { ok: false, error: 'bad request' };
  const rp = await hot('t' + ch + ts + since, () => slack(env, 'conversations.replies', { channel: ch, ts, limit: 200, oldest: since }, true), !!q.fresh);   // 24 Oct 2026: fresh = the phone was told something new arrived
  if (!rp.ok) return { ok: false, error: rp.error === 'ratelimited' ? 'Slack is busy - one moment' : 'Slack said ' + rp.error, slow: rp.error === 'ratelimited' };
  const U = await users(env);
  return { ok: true, ch, ts, msgs: (rp.messages || []).filter(m => !since || +m.ts > +since).map(m => shape(U, m, ts)) };
}

async function dm(env, q) {                                      // the Direct chat: newest 60 channel lines + replies inside their threads (shown with ↳)
  const ch = String(q.ch || ''), since = /^\d+\.\d+$/.test(String(q.since || '')) ? String(q.since) : '';
  if (!/^[CG][A-Z0-9]{5,}$/.test(ch)) return { ok: false, error: 'bad request' };
  const h = await hot('d' + ch, () => slack(env, 'conversations.history', { channel: ch, limit: 60 }, true), !!q.fresh);
  if (!h.ok) return { ok: false, error: h.error === 'ratelimited' ? 'Slack is busy - one moment' : 'Slack said ' + h.error, slow: h.error === 'ratelimited' };
  const U = await users(env), out = [];
  const top = (h.messages || []).filter(SHOW);
  const threads = top.filter(m => m.reply_count && m.latest_reply && (!since || +m.latest_reply > +since)).slice(0, 8);
  const reps = await Promise.all(threads.map(m => hot('r' + ch + m.ts + m.latest_reply, () => slack(env, 'conversations.replies', { channel: ch, ts: m.ts, limit: 100 }, true))));
  top.forEach(m => out.push(m));
  reps.forEach((rj, i) => { if (rj.ok) (rj.messages || []).forEach(x => { if (x.ts !== threads[i].ts && SHOW(x)) out.push(Object.assign({}, x, { text: '↳ ' + String(x.text || '') })); }); });
  const seen = {}; const msgs = out.filter(m => !since || +m.ts > +since).sort((a, b) => +a.ts - +b.ts).filter(m => seen[m.ts] ? false : (seen[m.ts] = 1)).map(m => shape(U, m, null));
  return { ok: true, ch, msgs };
}

async function post(env, q, ctx) {                               // a text line: "*Name:* text", into the thread (card) or the channel (Direct chat)
  const rid = String(q.rid || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (rid && ONCE.has(rid)) return ONCE.get(rid);
  const ch = String(q.ch || ''), ts = String(q.ts || ''), text = String(q.text || '').slice(0, 3000), who = String(q.who || '').slice(0, 40) || 'factory';
  if (!/^[CG][A-Z0-9]{5,}$/.test(ch) || !text.trim()) return { ok: false, error: 'bad request' };
  const a = { channel: ch, text: '*' + who + ':* ' + text }; if (/^\d+\.\d+$/.test(ts)) a.thread_ts = ts;
  const j = await slack(env, 'chat.postMessage', a);
  const res = j.ok ? { ok: true, ts: j.ts } : { ok: false, error: 'Slack said ' + j.error };
  if (j.ok) { if (rid) { ONCE.set(rid, res); if (ONCE.size > 500) ONCE.delete(ONCE.keys().next().value); }
    const topic = String(q.topic || '').replace(/[^\w-]/g, '').slice(0, 64);
    if (topic) ctx.waitUntil(fetch('https://ntfy.sh/' + topic, { method: 'POST', body: 'c=' + String(q.card || '').replace(/[^\w]/g, ''), headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {})); }
  return res;
}

async function file(env, q, req) {                              // a photo / voice note / video, streamed in its original quality
  const id = String(q.id || '').replace(/[^A-Z0-9]/g, ''); if (!id) return json({ ok: false, error: 'bad request' }, 400);
  const fi = await slack(env, 'files.info', { file: id }, true);
  if (!fi.ok) return json({ ok: false, error: 'Slack said ' + fi.error }, fi.error === 'ratelimited' ? 429 : 404);
  const f = fi.file || {}, u = q.thumb ? (f.thumb_720 || f.thumb_480 || f.url_private) : (f.url_private_download || f.url_private);
  if (!u) return json({ ok: false, error: 'no file link' }, 404);
  const h = { Authorization: 'Bearer ' + env.SLACK_TOKEN }; const rg = req.headers.get('Range'); if (rg) h.Range = rg;
  const r = await fetch(u, { headers: h });
  if (!r.ok && r.status !== 206) return json({ ok: false, error: 'Slack file answered ' + r.status }, 502);
  const ct = r.headers.get('Content-Type') || '';
  if (/text\/html/.test(ct)) return json({ ok: false, error: 'Slack refused the file (the bot needs files:read)' }, 403);
  const oh = new Headers({ ...CORS, 'Content-Type': f.mimetype || ct || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, X-File-Name' , 'X-File-Name': encodeURIComponent(f.name || id) });
  ['Content-Length', 'Content-Range', 'Accept-Ranges'].forEach(k => { const v = r.headers.get(k); if (v) oh.set(k, v); });
  return new Response(r.body, { status: r.status, headers: oh });
}

// ---- WEB PUSH (20 Oct 2026, Abbas: "do all" - phone notifications without the ntfy app). Only the RELAY calls these two (signed with the same
// phone key as everything else): "vapidnew" makes the push key pair once (the relay keeps it), "push" encrypts a notification for each phone
// address (RFC 8291, aes128gcm) and sends it with a VAPID signature (RFC 8292). Nothing is stored here.
const TE = new TextEncoder();
const b64u = b => { const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ub64 = s => { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; a.forEach(x => { o.set(x, p); p += x.length; }); return o; };
async function hkdf(salt, ikm, info, n) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8)); }
async function vapidNew() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey), j = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { ok: true, pub: b64u(pub), priv: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, d: j.d } };
}
async function wpEncrypt(sub, text) {
  const ua = ub64(sub.keys.p256dh), auth = ub64(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(TE.encode('WebPush: info\0'), ua, asPub), 32), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, TE.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, TE.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(TE.encode(text), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);     // header: salt · record size 4096 · key id = our public key
}
async function vapidJwt(priv, aud) {
  const h = b64u(TE.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), p = b64u(TE.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://abbas911-prog.github.io/sj-designs/' })));
  const k = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return h + '.' + p + '.' + b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, TE.encode(h + '.' + p)));
}
async function wpush(q) {
  const v = q.vapid || {}, subs = Array.isArray(q.subs) ? q.subs.slice(0, 20) : [], m = q.msg || {}; if (!v.pub || !v.priv || !subs.length) return { ok: false, error: 'bad request' };
  const text = JSON.stringify({ title: String(m.title || '').slice(0, 120), body: String(m.body || '').slice(0, 300), url: String(m.url || '').slice(0, 300), tag: String(m.tag || '').slice(0, 60) });
  const res = await Promise.all(subs.map(async s => { const ep = String((s && s.endpoint) || '');
    try { if (!/^https:\/\//.test(ep) || !s.keys) return { ep, ok: false, e: 'bad address' };
      const body = await wpEncrypt(s, text), jwt = await vapidJwt(v.priv, new URL(ep).origin);
      const r = await fetch(ep, { method: 'POST', headers: { Authorization: 'vapid t=' + jwt + ', k=' + v.pub, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body });
      return { ep, ok: r.status >= 200 && r.status < 300, st: r.status, gone: r.status === 404 || r.status === 410 };
    } catch (e) { return { ep, ok: false, e: String(e && e.message || e).slice(0, 80) }; } }));
  return { ok: res.some(x => x.ok), res };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, sj: 'fast', slack: !!env.SLACK_TOKEN, trello: !!env.TRELLO_TOKEN });
    if (req.method === 'POST' && url.pathname === '/slack') return slackEvent(req, url, ctx);
    let q = {};
    if (req.method === 'GET' && url.pathname === '/f') q = Object.fromEntries(url.searchParams);
    else { try { q = JSON.parse(await req.text()); } catch (e) { return json({ ok: false, error: 'bad request' }, 400); } }
    if (!(await proven(q.k))) return json({ ok: false, error: 'not allowed - sign in again', auth: true }, 403);
    try {
      if (url.pathname === '/f' || q.op === 'file') return await file(env, q, req);
      if (/^(tlist|tatts|timg|tmove)$/.test(q.op || '') && !env.TRELLO_TOKEN) return json({ ok: false, error: 'the worker has no TRELLO_TOKEN secret', notrello: true });
      if (q.op === 'timg') return await timg(env, q);
      if (q.op === 'tlist') return json(await tlist(env, q));
      if (q.op === 'tatts') return json(await tatts(env, q));
      if (q.op === 'tmove') return json(await tmove(env, q, ctx));
      if (q.op === 'thread') return json(await thread(env, q));
      if (q.op === 'dm') return json(await dm(env, q));
      if (q.op === 'post') return json(await post(env, q, ctx));
      if (q.op === 'hello') return json({ ok: true, sj: 'fast', slack: !!env.SLACK_TOKEN, trello: !!env.TRELLO_TOKEN, push: true });
      if (q.op === 'vapidnew') return json(await vapidNew());
      if (q.op === 'push') return json(await wpush(q));
      return json({ ok: false, error: 'unknown op' }, 400);
    } catch (e) { return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500); }
  }
};
