// SJ Stock Home Screen helper (memo-sw.js): the app page opens from the phone even with the site unreachable; a ?v= link takes the newest page.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const T = { offline: false, override: null }; let HTML_SENT = 0;
const srv = http.createServer((rq, rs) => { if (T.offline) { rq.socket.destroy(); return; } let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  const f = path.join(DIR, u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { let body = fs.readFileSync(f); const ov = T.override && /memo\.html$/.test(f); if (ov) body = Buffer.from(T.override(body.toString('utf8')));
    rs.setHeader('content-type', /\.html$/.test(f) ? 'text/html' : /\.js$/.test(f) ? 'text/javascript' : /\.webmanifest$/.test(f) ? 'application/manifest+json' : /\.png$/.test(f) ? 'image/png' : 'application/octet-stream');
    const et = ov ? '"e2"' : '"e1"'; rs.setHeader('etag', et); if (rq.headers['if-none-match'] === et) { rs.statusCode = 304; return rs.end(); } if (/memo\.html$/.test(f)) HTML_SENT++; return rs.end(body); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const URL0 = 'http://127.0.0.1:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await ctx.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [], bills: [], cards: [] }) })); await ctx.route(/ntfy\.sh|api\.github\.com|raw\.githubusercontent/, r => r.abort());
  const out = [];
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 });
  await pg.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await pg.waitForTimeout(1500); await pg.reload(); await pg.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  out.push(['helper installed, looks after memo.html only', await pg.evaluate(() => /memo-sw\.js$/.test(navigator.serviceWorker.controller.scriptURL) && /memo\.html$/.test(navigator.serviceWorker.controller.scriptURL.replace('memo-sw.js', 'memo.html')))]);
  const h0 = HTML_SENT; await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); await pg.waitForTimeout(1200);
  out.push(['opening again downloads nothing when the page did not change (ETag)', HTML_SENT === h0]);
  T.offline = true; const okOff = await pg.goto(URL0).then(() => true, () => false); const title = okOff ? await pg.title() : '';
  out.push(['with the site unreachable the app page still opens', okOff && title === 'SJ Stock']);
  T.offline = false; T.override = s => s.replace(/var VER = '/, "var VER = '9999-");
  await pg.goto(URL0 + '?v=9999-x'); await pg.waitForTimeout(500); const v = await pg.evaluate(() => (document.documentElement.outerHTML.match(/var VER = '([^']+)'/) || [])[1] || '');
  out.push(['a ?v= link takes the newest page from the site', /^9999-/.test(v)]);
  await pg.goto(URL0); await pg.waitForTimeout(500); const v2 = await pg.evaluate(() => (document.documentElement.outerHTML.match(/var VER = '([^']+)'/) || [])[1] || '');
  out.push(['the newest page is then kept on the phone', /^9999-/.test(v2)]);
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log('errors:', errs.slice(0, 3)); await br.close(); srv.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
