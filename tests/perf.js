// Speed check (not pass/fail): NODE_PATH=$(npm root -g) node tests/perf.js — 350 fake designs, phone-speed CPU (CPU=4), prints freeze time per action. PROF=tap|live|scroll|memo prints a profile.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const thumbs = fs.readdirSync(path.join(DIR, 'thumbs')).filter(f => f.endsWith('.jpg')).map(f => f.replace('.jpg', ''));
const N = +(process.env.N || 350), cards = [];
for (let i = 0; i < N; i++) { const nc = 2 + i % 4, q = Array.from({ length: nc }, (_, j) => 4 + ((i + j) % 9)); cards.push({ id: 'c' + String(i).padStart(5, '0'), idShort: i, list: i % 10 === 0 ? 's' : 'r', name: i % 10 === 0 ? 'SJ-' + (70000 + i) + ' SAMPLE' : 'SJ-' + (40000 + i) + ' (' + q.reduce((a, b) => a + b, 0) + ') colour = (' + nc + ') (' + q.join('/') + ')', attachments: [{ id: thumbs[i % thumbs.length], mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }); }
const enc = lock({ updated: new Date().toISOString(), cards });
let liveCards = cards;
function relay(b) { const req = JSON.parse(b.req || '{}');
  if (b.job === 'live') return { ok: true, cards: liveCards };
  if (b.job === 'bills') return { ok: true, bills: [] };
  if (b.job === 'orders') return { ok: true, orders: [] };
  if (b.job === 'cchat') return { ok: true, customers: [], orders: [], gun: {} };
  if (b.job === 'cust') return { ok: true, list: [], names: [] };
  return { ok: true }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } const f = path.join(DIR, decodeURIComponent(u.slice(1))); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : u.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(JSON.parse(r.request().postData() || '{}'))) }));
  await pg.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  const cdp = await pg.context().newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(process.env.CPU || 4) });
  await pg.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }); });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW);
  let t0 = Date.now(); await pg.reload(); await pg.waitForSelector('#feed .design:not([hidden])', { timeout: 60000 }); const tLoad = Date.now() - t0;
  await pg.waitForTimeout(3000);
  const lt = async (label, fn) => { await pg.evaluate(() => { window.__lt = []; }); const s = Date.now(); await fn(); const wall = Date.now() - s; await pg.waitForTimeout(700); const L = await pg.evaluate(() => window.__lt.slice()); console.log(label.padEnd(34), 'wall', String(wall).padStart(5), 'ms | long tasks', L.length, 'total', Math.round(L.reduce((a, b) => a + b, 0)), 'max', Math.round(Math.max(0, ...L))); };
  const prof = async (label, fn) => { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); await fn(); await pg.waitForTimeout(800); const { profile } = await cdp.send('Profiler.stop');
    const self = {}, byId = {}; profile.nodes.forEach(n => byId[n.id] = n); const dt = {}; (profile.samples || []).forEach((id, i) => { dt[id] = (dt[id] || 0) + (profile.timeDeltas[i] || 0); });
    profile.nodes.forEach(n => { const k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dt[n.id] || 0); });
    // inclusive time per function
    const incl = {}; const walk = (n, stack) => { const k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; const t = dt[n.id] || 0; new Set(stack.concat(k)).forEach(x => incl[x] = (incl[x] || 0) + t); (n.children || []).forEach(c => walk(byId[c], stack.concat(k))); }; walk(profile.nodes[0], []);
    console.log('--- PROFILE', label); Object.entries(incl).filter(e => !/^\(|^:/.test(e[0])).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(e => console.log('  incl', String(Math.round(e[1] / 1000)).padStart(6), 'ms', e[0]));
    Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(e => console.log('  self', String(Math.round(e[1] / 1000)).padStart(6), 'ms', e[0])); };
  if (process.env.PROF) { const A = process.env.PROF;
    if (A === 'tap') await prof('tap', () => pg.evaluate(() => document.querySelectorAll('#feed .design:not([hidden]) .step button[data-d="1"]')[3].click()));
    if (A === 'live') { liveCards = cards.map((c, i) => i === 5 ? Object.assign({}, c, { name: c.name + ' ' }) : c); await prof('live', () => pg.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 1500)); })); }
    if (A === 'scroll') await prof('scroll', async () => { for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, 800); await pg.waitForTimeout(120); } });
    if (A === 'memo') { await pg.evaluate(() => document.querySelectorAll('#feed .design:not([hidden]) .step button[data-d="1"]')[3].click()); await prof('memo', async () => { await pg.click('#nav button[data-nv="memo"]'); await pg.waitForFunction(() => /page/.test(document.querySelector('#ds').textContent), null, { timeout: 60000 }); }); }
    await br.close(); srv.close(); return; }
  console.log('designs', N, 'cpu x' + (process.env.CPU || 4), '| first screen', tLoad, 'ms');
  await lt('tap + on a colour', () => pg.evaluate(() => { const b = document.querySelectorAll('#feed .design:not([hidden]) .step button[data-d="1"]')[3]; const s = performance.now(); b.click(); return performance.now() - s; }));
  for (let i = 0; i < 5; i++) await pg.evaluate(i => document.querySelectorAll('#feed .design:not([hidden]) .step button[data-d="1"]')[10 + i * 7].click(), i);
  await lt('tap + with 6 colours picked', () => pg.evaluate(() => document.querySelectorAll('#feed .design:not([hidden]) .step button[data-d="1"]')[60].click()));
  await lt('type 3 digits in search', async () => { await pg.focus('#q'); await pg.keyboard.type('401'); });
  await pg.fill('#q', ''); await pg.dispatchEvent('#q', 'input');
  await lt('scroll down 6 screens', async () => { for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, 800); await pg.waitForTimeout(120); } });
  liveCards = cards.map((c, i) => i === 5 ? Object.assign({}, c, { name: c.name.replace(/\((\d+)\) colour/, (m, n) => '(' + (+n - 1) + ') colour').replace(/\/(\d+)\)$/, (m, n) => '/' + (n - 1) + ')') }) : c);
  await lt('live update (someone sold 1 pc)', () => pg.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 1500)); }));
  await lt('open Memo (OK)', async () => { await pg.click('#nav button[data-nv="memo"]'); await pg.waitForFunction(() => /page/.test(document.querySelector('#ds').textContent), null, { timeout: 60000 }); });
  await lt('open Chats tab', async () => { await pg.click('#nav button[data-nv="chats"]'); await pg.waitForTimeout(500); });
  await lt('back to Stock', async () => { await pg.click('#nav button[data-nv="stock"]'); await pg.waitForTimeout(300); });
  await lt('idle 15 s (background timers)', () => pg.waitForTimeout(15000));
  console.log('page errors', errs.slice(0, 3));
  await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
