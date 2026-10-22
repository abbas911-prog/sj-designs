// Test harness (20 Oct 2026): fake Trello + Slack + ntfy, the REAL tools/relay.gs run in Node with fake Apps Script services, and the REAL
// tools/fast-worker.js with a fake fetch. Nothing here talks to the internet and nothing here holds a real token.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');

// ---------------- fake world ----------------
function hexId(t) { return Math.floor((t || Date.now()) / 1000).toString(16).padStart(8, '0') + crypto.randomBytes(8).toString('hex'); }
let TSN = 0;
function slackTs() { TSN = Math.max(TSN + 1, Date.now() * 1000); return Math.floor(TSN / 1e6) + '.' + String(TSN % 1e6).padStart(6, '0'); }   // integer microseconds: never two messages with one ts

function makeWorld() {
  const W = { trello: { lists: [], cards: {}, cf: [{ id: 'cf1', name: 'FABRIC' }].concat(['TASLEEM', 'IRFAN ALI', 'HASHIM', 'QADIR', 'SHAHZAIB', 'SALMAAN', 'ZAKIR', 'USMAN', 'Anees', 'SHAWKEEN'].map((n, i) => ({ id: ['6a8629369e5acecd9d32161e', '6a86294212411acfd6b242e8', '6a862961d555a85cfa20f5a6', '6a8629740cfd2fbb02940ccb', '6a86297ea870d5e5d95d9915', '6a86298786371037d218c02b', '6a86298e8af0a7af3f0eabda', '6a862997069f7fc999a3784a', '6a8f0add4dd96589b353d1b6', '6a8f0ae17f378caf885b3e9a'][i], name: n }))), labels: [], actions: [] },
    slack: { ch: {}, users: { U1: { id: 'U1', name: 'ibrahim', real_name: 'Md Ibrahim', profile: { real_name: 'Md Ibrahim', display_name: 'ibrahim' } },
      U2: { id: 'U2', name: 'abbas_911', real_name: 'Abbas', profile: { real_name: 'Abbas', display_name: 'abbas' } } }, files: {} },
    ntfy: [], log: [], slackDelay: 0 };
  const L = [['SAMPLES', '65f8c9fd96d90dda4b355f0a'], ['SAMPLE DONE', '65a121d2829a36ccacd05593'], ['START', '6527c572b12b208471c080cb'], ['CUTTING', '6527c57751007e81a43f55a6'],
    ['IN LINE', '6527c57cd7e267fbf2a602b4'], ['READY FOR HAND WORK', '6527c585b9300f804906d9bd'], ['IN HAND WORK', '6527c59b796865bd9639b0c3'], ['CAME FROM HAND WORK', '6602ad25e74db40a25ab0296'],
    ['IN LINE (2)', '6527c5a3964596815651a97f'], ['IRON/CHECKING', '6527c5a93db4d8b8e91a8be9'], ['READY', '6527c5b13129a9ba37acd3ad'], ['READY 2', '699b35ceb77292db0289c473'],
    ['FINISH', '6527c5b41e630c094b619f5e'], ['FINISH SAMPLES', '68b77a221eef6fbb9a305e0e']];
  W.trello.lists = L.map(([name, id]) => ({ id, name, closed: false }));
  ['C09S552KD7T:cutting', 'C09T1BGHC6L:samples-discuss', 'C0BP61A2EF8:usmancutting', 'C0BV24ULLBD:samplesneed', 'C0DM0000001:trello-mohammod', 'C05UEHLGK9U:laisfactory', 'C0CASH00001:cash', 'C0EXP000001:expenses']
    .forEach(x => { const [id, name] = x.split(':'); W.slack.ch[id] = { id, name, msgs: [], member: id !== 'C0CASH00001', priv: id === 'C05UEHLGK9U' }; });   // the bot is NOT yet in #cash (it must join)
  return W;
}

function addCard(W, list, name, extra) {
  const id = hexId(Date.now() - ((extra && extra.ageDays) || 0) * 86400000), short = crypto.randomBytes(4).toString('hex');
  const c = Object.assign({ id, name, idList: list, idBoard: '6527c52485d9627f63157296', pos: (Object.keys(W.trello.cards).length + 1) * 1000, shortLink: short, shortUrl: 'https://trello.com/c/' + short,
    idAttachmentCover: '', dateLastActivity: new Date().toISOString(), labels: [], customFieldItems: [], desc: '', closed: false, attachments: [] }, extra || {});
  const born = new Date(Date.now() - ((extra && extra.ageDays) || 0) * 86400000).toISOString(); delete c.ageDays; W.trello.cards[id] = c;
  W.trello.actions.push({ id: hexId(), type: 'createCard', date: born, memberCreator: { fullName: 'Abbas Jamal' }, data: { card: { id, name }, list: { id: list, name: (W.trello.lists.find(l => l.id === list) || {}).name } } }); return c;
}
function postSlack(W, ch, m) {                                  // m: {text, user|bot_id, thread_ts, files}
  const C = W.slack.ch[ch]; if (!C) return { ok: false, error: 'channel_not_found' };
  const msg = Object.assign({ type: 'message', ts: slackTs() }, m);
  if (msg.files && !msg.files.length) delete msg.files;
  if (msg.files) msg.subtype = msg.subtype || undefined;
  C.msgs.push(msg);
  if (msg.thread_ts && msg.thread_ts !== msg.ts) { const root = C.msgs.find(x => x.ts === msg.thread_ts); if (root) { root.reply_count = (root.reply_count || 0) + 1; root.latest_reply = msg.ts; root.thread_ts = root.ts; } }
  W.log.push(['slack', ch, msg.thread_ts || '', msg.text]);
  return { ok: true, ts: msg.ts, channel: ch, message: msg };
}

// one HTTP request to "the internet" -> {status, body: Buffer, type}
function handle(W, method, url, body, headers) {
  method = String(method || 'get').toUpperCase(); const u = new URL(url), q = Object.fromEntries(u.searchParams);
  let form = {}; if (body && typeof body === 'object' && !Buffer.isBuffer(body)) form = body; else if (body) { const s = Buffer.isBuffer(body) ? body.toString() : String(body); try { form = JSON.parse(s); } catch (e) { form = Object.fromEntries(new URLSearchParams(s)); } }
  const A = Object.assign({}, q, form), J = (o, st) => ({ status: st || 200, body: Buffer.from(JSON.stringify(o)), type: 'application/json' });
  if (u.hostname === 'api.trello.com') return trello(W, method, u.pathname.replace(/^\/1/, ''), A, J);
  if (u.hostname === 'slack.com') return slack(W, u.pathname.replace(/^\/api\//, ''), A, J);
  if (u.hostname === 'files.slack.com') {
    const m = u.pathname.match(/^\/(dl|thumb|upload)\/(\w+)/); if (!m) return { status: 404, body: Buffer.from('no'), type: 'text/plain' };
    if (m[1] === 'upload') { const f = W.slack.files[m[2]]; if (f) { f.uploaded = Buffer.isBuffer(body) ? body.length : typeof body === 'string' ? body.length : f.size; f.size = f.want || f.size; } return { status: 200, body: Buffer.from('OK'), type: 'text/plain' }; }
    const f = W.slack.files[m[2]]; if (!f) return { status: 404, body: Buffer.from('no'), type: 'text/plain' };
    return { status: 200, body: f.bytes || Buffer.alloc(f.size || 10, 7), type: f.mimetype };
  }
  if (u.hostname === 'trello.com' && /^\/fake\//.test(u.pathname)) return { status: 200, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), type: 'image/jpeg' };
  if (u.hostname === 'ntfy.sh' && W.ntfyFail) return J({ code: 42908, http: 429, error: 'limit reached: daily message quota reached' }, 429);   // SJ Stock test of a refused ntfy
  if (u.hostname === 'ntfy.sh') { const topic = u.pathname.replace(/^\//, '') || form.topic; W.ntfy.push({ topic, body: typeof body === 'string' ? body : (form.message || JSON.stringify(form)), t: Date.now() }); return J({ id: 'n' + W.ntfy.length }); }
  if (u.hostname === 'push.test') { W.pushes = W.pushes || []; W.pushes.push({ url, headers: headers || {}, body: Buffer.isBuffer(body) ? body : Buffer.from(body || '') }); return { status: W.pushStatus || 201, body: Buffer.from(''), type: 'text/plain' }; }   // a fake Web Push service
  if (u.hostname === 'api.telegram.org') return J({ ok: false, error: 'no telegram in tests' });
  if (u.hostname === 'api.github.com') return { status: 204, body: Buffer.alloc(0), type: 'text/plain' };
  return { status: 404, body: Buffer.from('unknown host ' + u.hostname), type: 'text/plain' };
}

function trello(W, method, p, A, J) {
  const T = W.trello, BOARD = '6527c52485d9627f63157296', seg = p.split('/').filter(Boolean);
  const cardOut = (c, withAtt) => { const o = Object.assign({}, c); if (!withAtt) delete o.attachments; return o; };
  const act = (type, c, data, date) => { T.actions.push({ id: hexId(), type, date: date || new Date().toISOString(), memberCreator: { fullName: A._who || 'App Bot' }, data: Object.assign({ card: { id: c.id, name: c.name } }, data) }); };
  if (seg[0] === 'boards') {
    if (seg[2] === 'cards') { const cs = Object.values(T.cards).filter(c => !c.closed).sort((a, b) => b.id.localeCompare(a.id)).map(c => { const o = cardOut(c, false); if (A.attachments === 'cover') o.attachments = c.attachments.filter(a => a.id === c.idAttachmentCover).map(a => ({ id: a.id, previews: a.previews, mimeType: a.mimeType })); return o; }); return J(cs); }
    if (seg[2] === 'customFields') return J(T.cf);
    if (seg[2] === 'lists') return J(T.lists);
    if (seg[2] === 'labels') return J(T.labels);
    if (seg[2] === 'actions') { const since = A.since ? Date.parse(A.since) : 0, f = String(A.filter || '').split(','); return J(T.actions.filter(a => Date.parse(a.date) > since && f.some(x => x.split(':')[0] === a.type)).sort((x, y) => Date.parse(y.date) - Date.parse(x.date)).slice(0, +A.limit || 50)); }
  }
  if (seg[0] === 'lists' && seg.length === 1 && method === 'POST') { const l = { id: hexId(), name: A.name, closed: false }; T.lists.push(l); return J(l); }
  if (seg[0] === 'lists' && seg[2] === 'cards') return J(Object.values(T.cards).filter(c => c.idList === seg[1] && !c.closed).sort((a, b) => a.pos - b.pos).map(c => cardOut(c, false)));
  if (seg[0] === 'labels' && method === 'POST') { const l = { id: hexId(), name: A.name, color: A.color }; T.labels.push(l); return J(l); }
  if (seg[0] === 'tokens') return J({ permissions: [{ modelType: 'Board', write: true }] });
  if (seg[0] === 'cards') {
    if (seg.length === 1 && method === 'POST') { const src = A.idCardSource && T.cards[A.idCardSource]; const c = addCard(W, A.idList, A.name, { desc: A.desc || '', labels: src ? src.labels : [] }); const top = Math.min(0, ...Object.values(T.cards).filter(x => x.idList === A.idList && x !== c).map(x => x.pos)); c.pos = top - 1; act('createCard', c, { list: { id: A.idList } }); return J(cardOut(c)); }
    const c = T.cards[seg[1]]; if (!c) return { status: 404, body: Buffer.from('card not found'), type: 'text/plain' };
    if (seg.length === 2 && method === 'GET') return J(cardOut(c));
    if (seg.length === 2 && method === 'PUT') {
      if (A.idList && A.idList !== c.idList) { const before = T.lists.find(l => l.id === c.idList), after = T.lists.find(l => l.id === A.idList); act('updateCard', c, { listBefore: { name: before && before.name }, listAfter: { name: after && after.name } }); c.idList = A.idList; }
      if (A.pos === 'top') c.pos = Math.min(0, ...Object.values(T.cards).filter(x => x.idList === c.idList && x !== c).map(x => x.pos)) - 1;
      if (A.name != null) c.name = A.name; if (A.desc != null) c.desc = A.desc; if (A.due !== undefined) c.due = A.due || null; if (A.closed != null) c.closed = A.closed === true || A.closed === 'true';
      c.dateLastActivity = new Date().toISOString(); return J(cardOut(c)); }
    if (seg[2] === 'actions' && !seg[3] && method === 'GET') { const f = String(A.filter || '').split(','); return J(T.actions.filter(a => a.data && a.data.card && a.data.card.id === c.id && f.some(x => x.split(':')[0] === a.type)).sort((x, y) => Date.parse(y.date) - Date.parse(x.date)).slice(0, +A.limit || 50)); }
    if (seg[2] === 'customField' && seg[4] === 'item' && method === 'PUT') { const v = (A.value || {}); const it = c.customFieldItems.find(x => x.idCustomField === seg[3]); if (it) it.value = v; else c.customFieldItems.push({ idCustomField: seg[3], value: v }); return J({ ok: true }); }
    if (seg[2] === 'actions' && seg[3] === 'comments') { act('commentCard', c, { text: A.text }); W.log.push(['comment', c.id, A.text]); return J({ id: hexId() }); }
    if (seg[2] === 'attachments' && method === 'POST') { const a = { id: hexId(), name: A.name || 'file', mimeType: 'image/jpeg', bytes: 1000, url: 'https://trello.com/fake/orig/x.jpg', date: new Date().toISOString(), previews: [{ width: 600, url: 'https://trello.com/fake/p/600.jpg' }] }; c.attachments.push(a); if (A.setCover === 'true' || !c.idAttachmentCover) c.idAttachmentCover = a.id; return J(a); }
    if (seg[2] === 'attachments' && seg[3]) { const a = c.attachments.find(x => x.id === seg[3]); return a ? J(a) : { status: 404, body: Buffer.from('no att'), type: 'text/plain' }; }
    if (seg[2] === 'attachments') return J(c.attachments);
  }
  return { status: 404, body: Buffer.from('fake trello: no ' + method + ' ' + p), type: 'text/plain' };
}

function slack(W, m, A, J) {
  const S = W.slack, C = S.ch[A.channel || A.channel_id];
  const top = c => c.msgs.filter(x => !x.thread_ts || x.thread_ts === x.ts);
  switch (m) {
    case 'conversations.history': { if (!C) return J({ ok: false, error: 'channel_not_found' }); let ms = top(C).slice().reverse(); if (A.oldest) ms = ms.filter(x => +x.ts > +A.oldest); return J({ ok: true, messages: ms.slice(0, +A.limit || 100), has_more: false }); }
    case 'conversations.replies': { if (!C) return J({ ok: false, error: 'channel_not_found' }); const root = C.msgs.find(x => x.ts === A.ts); if (!root) return J({ ok: false, error: 'thread_not_found' });
      const reps = C.msgs.filter(x => x.thread_ts === A.ts && x.ts !== A.ts && (!A.oldest || +x.ts > +A.oldest)); return J({ ok: true, messages: [root].concat(reps).slice(0, +A.limit || 1000) }); }
    case 'conversations.info': return C ? J({ ok: true, channel: { id: C.id, name: C.name, is_member: C.member } }) : J({ ok: false, error: 'channel_not_found' });
    case 'conversations.members': return J({ ok: true, members: Object.keys(S.users) });
    case 'conversations.list': return J({ ok: true, channels: Object.values(S.ch).map(c => ({ id: c.id, name: c.name, is_member: c.member, is_private: c.priv })) });
    case 'conversations.join': if (C) C.member = true; return J({ ok: !!C });
    case 'conversations.create': { const id = 'C' + crypto.randomBytes(5).toString('hex').toUpperCase(); S.ch[id] = { id, name: A.name, member: true, priv: !!A.is_private, msgs: [] }; return J({ ok: true, channel: { id, name: A.name } }); }
    case 'users.list': return J({ ok: true, members: Object.values(S.users) });
    case 'users.info': return S.users[A.user] ? J({ ok: true, user: S.users[A.user] }) : J({ ok: false, error: 'user_not_found' });
    case 'chat.postMessage': { if (!C) return J({ ok: false, error: 'channel_not_found' }); const r = postSlack(W, C.id, { text: A.text, bot_id: 'B1', username: 'SJ Orders', thread_ts: A.thread_ts || undefined }); return J({ ok: true, ts: r.ts, channel: C.id }); }
    case 'files.info': { const f = S.files[A.file]; return f ? J({ ok: true, file: f }) : J({ ok: false, error: 'file_not_found' }); }
    case 'files.getUploadURLExternal': { const id = 'F' + crypto.randomBytes(5).toString('hex').toUpperCase(); S.files[id] = { id, name: A.filename, mimetype: /\.(m4a|webm|ogg)$/i.test(A.filename) ? 'audio/mp4' : /\.(mp4|mov)$/i.test(A.filename) ? 'video/mp4' : 'image/jpeg', size: 0, want: +A.length, url_private: 'https://files.slack.com/dl/' + id, url_private_download: 'https://files.slack.com/dl/' + id, thumb_720: 'https://files.slack.com/thumb/' + id };
      return J({ ok: true, upload_url: 'https://files.slack.com/upload/' + id, file_id: id }); }
    case 'files.completeUploadExternal': { if (!C) return J({ ok: false, error: 'channel_not_found' }); const ids = JSON.parse(A.files).map(x => x.id), files = ids.map(id => S.files[id]).filter(Boolean);
      const r = postSlack(W, C.id, { text: A.initial_comment || '', bot_id: 'B1', thread_ts: A.thread_ts || undefined, files }); return J({ ok: true, files: files.map(f => ({ id: f.id, shares: { public: { [C.id]: [{ ts: r.ts }] } } })) }); }
  }
  return J({ ok: false, error: 'fake slack: unknown method ' + m });
}

// ---------------- the relay (real tools/relay.gs) with fake Apps Script ----------------
function bytesOf(x) { if (Buffer.isBuffer(x)) return x; if (Array.isArray(x)) return Buffer.from(x.map(b => b & 255)); return Buffer.from(String(x), 'utf8'); }
function sbytes(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function blob(buf, type, name) { const b = { _b: bytesOf(buf), _t: type || 'application/octet-stream', _n: name || '' };
  b.getBytes = () => sbytes(b._b); b.getContentType = () => b._t; b.setName = n => { b._n = n; return b; }; b.getName = () => b._n; b.getDataAsString = () => b._b.toString(); return b; }

function makeRelay(W, props) {
  const P = Object.assign({}, props), CACHE = new Map();
  const cget = k => { const e = CACHE.get(k); if (!e) return null; if (e.exp < Date.now()) { CACHE.delete(k); return null; } return e.v; };
  const cache = { get: cget, put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('Argument too large: value'); CACHE.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
    putAll: (o, ttl) => Object.keys(o).forEach(k => cache.put(k, o[k], ttl)), getAll: ks => { const r = {}; ks.forEach(k => { const v = cget(k); if (v != null) r[k] = v; }); return r; }, remove: k => CACHE.delete(k), removeAll: ks => ks.forEach(k => CACHE.delete(k)) };
  const props_ = { getProperty: k => (k in P ? P[k] : null), setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large ' + k); P[k] = String(v); return props_; }, deleteProperty: k => { delete P[k]; return props_; }, getProperties: () => Object.assign({}, P), setProperties: o => { Object.assign(P, o); return props_; } };
  const fetchSync = (url, o) => { o = o || {}; let body = o.payload; if (body && typeof body === 'object' && body._b) body = body._b;
    if (W.fastSync && /\.workers\.dev\//.test(url)) { const r = W.fastSync.call(url, String(body)); (r.pushes || []).forEach(x => { W.pushes = W.pushes || []; W.pushes.push({ url: x.url, headers: x.headers, body: Buffer.from(x.body) }); }); W.log.push(['fetch', 'POST', url]);
      return { getResponseCode: () => r.status, getContentText: () => r.text, getBlob: () => blob(Buffer.from(r.text), 'application/json'), getHeaders: () => ({}) }; }
    const r = handle(W, o.method || 'get', url, body, o.headers || {}); W.log.push(['fetch', (o.method || 'get').toUpperCase(), url.replace(/token=[^&]+/, 'token=…').slice(0, 140)]);
    return { getResponseCode: () => r.status, getContentText: () => r.body.toString(), getBlob: () => blob(r.body, r.type), getHeaders: () => ({ 'Content-Type': r.type }) }; };
  const triggers = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => props_ }, CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: fetchSync, fetchAll: rs => rs.map(r => fetchSync(r.url, r)) },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: s => { const o = { _s: s, getContent: () => s, setMimeType: () => o }; return o; } },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (v, k) => sbytes(crypto.createHmac('sha256', bytesOf(k)).update(bytesOf(v)).digest()),
      computeDigest: (alg, v) => sbytes(crypto.createHash('sha256').update(bytesOf(v)).digest()),
      base64Encode: x => bytesOf(x).toString('base64'), base64Decode: s => sbytes(Buffer.from(String(s), 'base64')),
      getUuid: () => crypto.randomUUID(), sleep: () => {}, newBlob: (b, t, n) => blob(b, t, n), formatDate: d => new Date(d).toISOString() },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1), newTrigger: fn => { const ch = { timeBased: () => ch, everyMinutes: () => ch, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } }; return ch; } },
    Logger: { log: s => W.log.push(['log', String(s)]) }, console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/relay.gs'), 'utf8'), ctx, { filename: 'relay.gs' });
  return { P, cache, ctx, post: bodyText => ctx.doPost({ postData: { contents: bodyText } }).getContent() };
}

// ---------------- the fast lane (real tools/fast-worker.js) ----------------
async function makeWorker(W, relay, env) {
  let src = fs.readFileSync(path.join(ROOT, 'tools/fast-worker.js'), 'utf8').replace(/export default\s*\{/, 'module.exports = {');
  const fakeFetch = async (url, o) => { o = o || {}; url = String(url);
    if (/script\.google\.com/.test(url)) { const t = relay.post(String(o.body)); return new Response(t, { headers: { 'Content-Type': 'application/json' } }); }
    while (W.slackDelay && /slack\.com/.test(url)) { await new Promise(r => setTimeout(r, W.slackDelay)); break; }
    let body = o.body; if (body && ArrayBuffer.isView(body)) body = Buffer.from(body.buffer, body.byteOffset, body.byteLength); else if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) body = String(body);
    const r = handle(W, o.method || 'GET', url, body, o.headers || {}); return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type } }); };
  const mod = { exports: {} }; const ctx = vm.createContext({ module: mod, fetch: fakeFetch, crypto: globalThis.crypto, TextEncoder, btoa, atob, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout, console, Map, Date, JSON, Math, Promise, Object, Array, String, Number, RegExp, Error, encodeURIComponent });
  vm.runInContext(src, ctx, { filename: 'fast-worker.js' });
  const w = mod.exports, waits = [];
  return { fetch: async req => { const r = await w.fetch(req, env, { waitUntil: p => waits.push(p) }); await Promise.allSettled(waits.splice(0)); return r; } };
}

// the relay waits for its answers (Apps Script), the worker does not: for relay -> worker calls the worker runs in its own thread
function makeSyncWorker(props, env) {
  const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
  const ch = new MessageChannel(), flag = new Int32Array(new SharedArrayBuffer(4));
  const th = new Worker(path.join(__dirname, 'sync-thread.js'), { workerData: { props, env, port: ch.port2, flag }, transferList: [ch.port2] }); th.unref();
  return { call(url, body) { Atomics.store(flag, 0, 0); ch.port1.postMessage({ url, body }); Atomics.wait(flag, 0, 0, 30000); const m = receiveMessageOnPort(ch.port1); if (!m) throw new Error('sync worker gave no answer'); return m.message; },
    ctl(o) { return this.call('ctl://x', JSON.stringify(o)); }, stop() { return th.terminate(); } };
}

module.exports = { makeSyncWorker, ROOT, makeWorld, addCard, postSlack, handle, makeRelay, makeWorker, hexId, slackTs };
