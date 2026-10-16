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
  const [cf, per] = await Promise.all([cfNames(env), Promise.all(lists.map(id => trello(env, 'get', '/lists/' + id + '/cards', { fields: 'name,idList,pos,shortUrl,idAttachmentCover,dateLastActivity,labels', customFieldItems: 'true' })))]);
  const cards = [].concat.apply([], per).sort((a, b) => a.pos - b.pos);
  return { ok: true, t: Date.now(), covered: lists, cards: cards.map(c => { const f = {}; (c.customFieldItems || []).forEach(it => { const n = cf[it.idCustomField], v = it.value || {}; const x = v.text != null ? v.text : v.number != null ? v.number : v.date || (v.checked === 'true' ? '✓' : null); if (n && x != null && String(x).trim() !== '') f[n] = String(x); });
    return { id: c.id, name: c.name, l: c.idList, pos: c.pos, url: c.shortUrl, img: c.idAttachmentCover || '', f, at: c.dateLastActivity, lb: (c.labels || []).filter(l => l.name).map(l => ({ n: l.name, c: l.color || '' })) }; }) };
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
    if (ref && /^[CG][A-Z0-9]{5,}$/.test(ref[0]) && /^\d+\.\d+$/.test(ref[1]) && env.SLACK_TOKEN) ctx.waitUntil(slack(env, 'chat.postMessage', { channel: ref[0], thread_ts: ref[1], text: '→ *' + tl[0] + '* · ' + who }).catch(() => {}));
  }
  const topic = String(q.topic || '').replace(/[^\w-]/g, '').slice(0, 64);
  if (topic) ctx.waitUntil(fetch('https://ntfy.sh/' + topic, { method: 'POST', body: 'c=list:' + id, headers: { Cache: 'no', Firebase: 'no' } }).catch(() => {}));
  const res = { ok: true }; if (rid) ONCE.set(rid, res); return res;
}

function json(o, st) { return new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } }); }

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

async function hot(key, fn) { const h = HOT.get(key); if (h && Date.now() - h.at < 1500) return h.p; const p = fn(); HOT.set(key, { at: Date.now(), p }); if (HOT.size > 200) HOT.clear(); return p; }

async function thread(env, q) {                                  // a card chat = the replies of its #cutting (or #samples-discuss) message
  const ch = String(q.ch || ''), ts = String(q.ts || ''), since = /^\d+\.\d+$/.test(String(q.since || '')) ? String(q.since) : '';
  if (!/^[CG][A-Z0-9]{5,}$/.test(ch) || !/^\d+\.\d+$/.test(ts)) return { ok: false, error: 'bad request' };
  const rp = await hot('t' + ch + ts + since, () => slack(env, 'conversations.replies', { channel: ch, ts, limit: 200, oldest: since }, true));
  if (!rp.ok) return { ok: false, error: rp.error === 'ratelimited' ? 'Slack is busy - one moment' : 'Slack said ' + rp.error, slow: rp.error === 'ratelimited' };
  const U = await users(env);
  return { ok: true, ch, ts, msgs: (rp.messages || []).filter(m => !since || +m.ts > +since).map(m => shape(U, m, ts)) };
}

async function dm(env, q) {                                      // the Direct chat: newest 60 channel lines + replies inside their threads (shown with ↳)
  const ch = String(q.ch || ''), since = /^\d+\.\d+$/.test(String(q.since || '')) ? String(q.since) : '';
  if (!/^[CG][A-Z0-9]{5,}$/.test(ch)) return { ok: false, error: 'bad request' };
  const h = await hot('d' + ch, () => slack(env, 'conversations.history', { channel: ch, limit: 60 }, true));
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

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, sj: 'fast', slack: !!env.SLACK_TOKEN, trello: !!env.TRELLO_TOKEN });
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
      if (q.op === 'hello') return json({ ok: true, sj: 'fast', slack: !!env.SLACK_TOKEN, trello: !!env.TRELLO_TOKEN });
      return json({ ok: false, error: 'unknown op' }, 400);
    } catch (e) { return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500); }
  }
};
