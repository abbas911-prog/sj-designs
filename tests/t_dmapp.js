// Direct chats in the SJ Stock Chats tab (22 Oct 2026): Abbas's phone lists "Direct · Muhammad / Imran"; an employee's phone lists "Abbas" only;
// opening one reads the thread with ch:'direct'; a sent line reaches the relay with ch:'direct' + the person's root. Fake relay, no Slack.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const enc = lock({ updated: new Date().toISOString(), cards: [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [] }] });
const ROOTS = { Muhammad: '1792600000.000100', Imran: '1792600000.000200' }, posts = []; let msgsM = [{ ts: '1792600001.000100', who: 'Abbas', app: true, text: 'Check the 48188 cutting', files: [] }];
function dmsFor(who) { const all = Object.keys(ROOTS); const mine = /^abbas/i.test(who) ? all : all.filter(n => n.toLowerCase().startsWith(String(who || '').toLowerCase().split(' ')[0])); return mine.map(n => ({ k: 'D' + ROOTS[n], name: n, root: ROOTS[n], un: n === 'Muhammad' && !/^abbas/i.test(who) ? 1 : 0, tx: n === 'Muhammad' ? 'Abbas: Check the 48188 cutting' : '', last: '1792600001.000100' })); }
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'orders') return { ok: true, orders: [] }; if (b.job === 'bills') return { ok: true, bills: [] }; if (b.job === 'timo') return { ok: true, data: null, at: 0 };
  if (b.job !== 'cchat') return { ok: false, error: 'not in test' };
  if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [], orders: [], gun: {}, dms: dmsFor(req.who), live: '', nt: false, ev: false };
  if (req.op === 'thread' && req.ch === 'direct') return req.root === ROOTS.Muhammad ? { ok: true, root: req.root, msgs: msgsM } : { ok: true, root: req.root, msgs: [] };
  if (req.op === 'post') { posts.push(req); msgsM.push({ ts: '1792600002.000100', who: req.who, app: true, text: req.text, files: [] }); return { ok: true, ts: '1792600002.000100', root: req.root }; }
  if (req.op === 'seen') return { ok: true };
  return { ok: false, error: 'the relay does not know "' + req.op + '"' }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } if (/costs?\.enc|costing\.enc/.test(u)) { rs.statusCode = 404; return rs.end('nf'); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const errs = []; const out = []; const ok = (n, v) => out.push([n, !!v]);
  const boot = async (me) => { const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); pg.on('pageerror', e => errs.push(e.message));
    await pg.route(/script\.google\.com/, async (route) => { const b = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); }); await pg.route(/ntfy\.sh/, r => r.abort());
    await pg.goto(URL0); await pg.evaluate(a => { localStorage.clear(); localStorage.setItem('sj_memo_pw', a.pw); localStorage.setItem('sj_me', a.me); }, { pw: PW, me }); await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); return pg; };
  const t = (pg, q) => pg.$eval(q, e => e.textContent.trim()).catch(() => null);
  // Abbas's phone
  const pg = await boot('Abbas'); await pg.click('#nav button[data-nv="chats"]'); await pg.waitForSelector('.ccrow[data-ch="direct"]', { timeout: 10000 });
  ok('Abbas: Direct section with Muhammad and Imran', (await pg.$$eval('.ccrow[data-ch="direct"] .t b', L => L.map(e => e.textContent))).join() === 'Muhammad,Imran');
  ok('direct rows are the first thing in the Chats tab', await pg.$eval('#ccbody', e => e.firstElementChild.classList.contains('bsec') && e.children[1].dataset.ch === 'direct'));
  await pg.click('.ccrow[data-ch="direct"]'); await pg.waitForSelector('.ccm', { timeout: 8000 });
  ok('opens as a direct chat with the line', (await t(pg, '#cct')).indexOf('Muhammad') >= 0 && (await t(pg, '#cct')).indexOf('direct') >= 0 && (await pg.$$eval('.ccm', L => L.length)) === 1);
  await pg.fill('#cctxt', 'Thanks, send photos'); await pg.click('#ccsend');
  await pg.waitForFunction(() => [...document.querySelectorAll('.ccm.me')].some(e => e.textContent.indexOf('send photos') >= 0 && !e.classList.contains('pend')), null, { timeout: 12000 }).catch(() => {});
  ok('sent line goes to the relay as direct + the person\'s root', posts.length === 1 && posts[0].ch === 'direct' && posts[0].root === ROOTS.Muhammad && posts[0].who === 'Abbas' && posts[0].text === 'Thanks, send photos');
  // Imran's phone
  const p2 = await boot('Imran'); await p2.click('#nav button[data-nv="chats"]'); await p2.waitForSelector('.ccrow[data-ch="direct"]', { timeout: 10000 });
  ok('Imran: one direct chat, shown as "Abbas"', (await p2.$$eval('.ccrow[data-ch="direct"] .t b', L => L.map(e => e.textContent))).join() === 'Abbas');
  // Muhammad's phone: the new-messages box carries the direct line and opens it
  const p3 = await boot('Muhammad'); await p3.waitForFunction(() => document.querySelector('#nvc').textContent === '1', null, { timeout: 10000 }).catch(() => {});
  ok('Muhammad: badge 1 for the direct line', (await t(p3, '#nvc')) === '1');
  await p3.click('#nav button[data-nv="chats"]'); await p3.waitForSelector('.ccnr', { timeout: 8000 });
  ok('new-messages box says 💬 Abbas · direct', (await t(p3, '.ccnr .n')).indexOf('Abbas') >= 0 && (await t(p3, '.ccnr .n')).indexOf('direct') >= 0);
  await p3.click('.ccnr'); await p3.waitForSelector('.ccm', { timeout: 8000 }); ok('tap → the direct chat opens', (await t(p3, '#cct')).indexOf('direct') >= 0);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
