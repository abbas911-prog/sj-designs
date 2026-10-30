// SJ Stock photos (24 Oct 2026, Abbas: "in the app we always take the photos which are not JAMAL; if there is no real picture, the JAMAL photo"):
// the colour numbers go on the shop line-up photos (newest first); a real JAMAL studio photo (roles.json ['lineup', score, 'jamal']) carries
// them only when the card has no shop photo; AI covers only when there is nothing else. The 79623 case: JAMAL 6 + JAMAL 3 newer than shop 6 + shop 3.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const att = (id, date) => ({ id, mimeType: 'image/jpeg', date, name: 'photo.jpeg' });
const cards = [
  { id: 'c1', idShort: 1, list: 'r', name: 'SJ = **(79623)** (96) pcs color = (9) ,,,, (16/8/8/8/16/16)..(8/8/8)', attachments: [att('shot1', '2026-06-20T12:47:42Z'), att('shop3', '2026-06-21T16:50:32Z'), att('shop6', '2026-06-21T16:51:24Z'), att('jam3', '2026-07-16T14:50:48Z'), att('jam6', '2026-07-16T14:51:02Z')] },
  { id: 'c2', idShort: 2, list: 'r', name: 'SJ-11111 (12) colour = (3) (4/4/4)', attachments: [att('jamA', '2026-07-01T00:00:00Z'), att('coverA', '2026-07-02T00:00:00Z')] },
  { id: 'c3', idShort: 3, list: 'r', name: 'SJ-22222 (8) colour = (2) (4/4)', attachments: [att('coverB', '2026-07-02T00:00:00Z'), att('detB', '2026-07-03T00:00:00Z')] },
  { id: 'c4', idShort: 4, list: 'r', name: 'Sj = **(57026)** (38) pcs __ Colour= (6)__(0-3/14-3/16-3/0-3/8-3//0-3)', attachments: [att('shopC', '2026-07-02T00:00:00Z')] },
  { id: 'c5', idShort: 5, list: 'r', name: 'Sj= (40032) ..(60) pcs colour= 1 ___(60)', attachments: [att('shopD', '2026-07-02T00:00:00Z')] },
  { id: 'c6', idShort: 6, list: 'r', name: 'Sj = **(51862)** (48) pcs __ colour _(5)__(8/4/12/8)_(16)', attachments: [att('shopE', '2026-07-02T00:00:00Z')] },
  { id: 'c7', idShort: 7, list: 'r', name: 'Sj 83942 (8pcs) 1 colour', attachments: [att('shopF', '2026-07-02T00:00:00Z')] }
];
const roles = { shopC: ['lineup'], shopD: ['lineup'], shopE: ['lineup'], shopF: ['lineup'], shot1: ['shot'], shop3: ['lineup'], shop6: ['lineup', 0.7], jam3: ['lineup', 0.973, 'jamal'], jam6: ['lineup', 1.0, 'jamal'], jamA: ['lineup', 0.9, 'jamal'], coverA: ['cover', 0.9], coverB: ['cover', 0.9], detB: ['detail'] };
const enc = lock({ updated: new Date().toISOString(), cards });
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0];
  if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); }
  if (u === '/thumbs/roles.json') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(roles)); }
  const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile() && !/^\/(thumbs|costs|costing)/.test(u)) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/octet-stream'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port, URL0 = 'http://localhost:' + port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [] }) })); await pg.route(/ntfy\.sh/, r => r.abort());
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload();
  await pg.waitForSelector('#feed .design', { timeout: 15000 });
  // what the app built: the numbers under each photo of a design, in order
  const got = {};
  for (const no of ['79623', '11111', '22222', '57026']) got[no] = await pg.$$eval('.design[data-no="' + no + '"] .ph', L => L.map(e => [...e.querySelectorAll('.nums span')].map(s => s.textContent).join(',')));
  const out = []; const ok = (n, v) => out.push([n, !!v]);
  ok('79623: two photos carry the numbers 1-6 and 7-9 (the shop photos), the JAMAL photos stay hidden', got['79623'].length === 2 && got['79623'][0] === '1,2,3,4,5,6' && got['79623'][1] === '7,8,9');
  ok('11111: no shop photo → the JAMAL photo carries 1-3, the AI cover stays hidden', got['11111'].length === 1 && got['11111'][0] === '1,2,3');
  ok('22222: nothing real → the AI cover carries 1-2, the detail photo follows without numbers', got['22222'].length === 2 && got['22222'][0] === '1,2' && got['22222'][1] === '');
  // 27 Oct 2026 (Abbas, 57026: "why is this 7 when colours are 6?"): the double slash in "(8-3//0-3)" is not a colour
  ok('57026 "(0-3/14-3/16-3/0-3/8-3//0-3)" = 6 colours, 38 pcs, 6 numbers on the photo', got['57026'].length === 1 && got['57026'][0] === '1,2,3,4,5,6' && (await pg.$eval('.design[data-no="57026"] .meta, .design[data-no="57026"]', e => e.textContent)).indexOf('6 colours') >= 0);
  // 30 Oct 2026 (Abbas, SJ-40032 "60 pcs · 0 colours · check card": "why can't I select this design?"): a colour's count written as a plain "(60)"
  const meta = no => pg.$eval('.design[data-no="' + no + '"] .meta, .design[data-no="' + no + '"]', e => e.textContent).catch(() => '');
  ok('40032 "colour= 1 ___(60)" = 1 colour of 60, no "check card", pickable', /60 pcs · 1 colour/.test(await meta('40032')) && !/check card/.test(await meta('40032')) && !!(await pg.$('.design[data-no="40032"] .step button')));
  ok('83942 "(8pcs) 1 colour" = 1 colour of 8, no "check card", pickable', /8 pcs · 1 colour/.test(await meta('83942')) && !/check card/.test(await meta('83942')) && !!(await pg.$('.design[data-no="83942"] .step button')));
  ok('51862 "colour _(5)__(8/4/12/8)_(16)" = 5 colours, 48 pcs (the (16) is the 5th colour; the (5) is not)', /5 colours/.test(await meta('51862')) && !/check card/.test(await meta('51862')));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  // which attachments got the numbers for 79623: the article's signature ends with the photo ids in order
  const ids = await pg.evaluate(() => { const a = document.querySelector('.design[data-no="79623"]'); return a ? a.dataset.sig : ''; });
  ok('79623: the numbered photos are shop6 then shop3 (newest shop photo = first group)', /\|shop6,shop3$/.test(ids));
  out.forEach(o => console.log((o[1] ? 'ok   ' : 'FAIL ') + o[0])); const fail = out.filter(o => !o[1]).length; console.log(`\n${out.length - fail} passed, ${fail} failed`);
  await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
