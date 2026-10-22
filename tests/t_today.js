// Today tab (21 Oct 2026): owner dashboard - Timo's running block with its steps, chats with news, open orders, WhatsApp follow-ups, the day.
// Real memo.html + real timo.html (hidden frame) against a fake relay. No Slack/Trello/Google is touched.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), PW = 'test1234';
function lock(obj) { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.pbkdf2Sync(PW, salt, 1000, 32, 'sha256'); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return { salt: salt.toString('base64'), iv: iv.toString('base64'), iter: 1000, ct: ct.toString('base64') }; }
const cards = [{ id: 'c1', idShort: 1, list: 'r', name: 'SJ-18634 (16) colour = (2) (8/8)', attachments: [{ id: 'a1', mimeType: 'image/jpeg', date: '2026-10-01T00:00:00Z', name: 'x.jpg' }] }];
const enc = lock({ updated: new Date().toISOString(), cards });
const ORDS = { o1: { id: 'o1', name: '#50 Matiullah naif', created: Date.now() - 2 * 86400000, items: [{ no: '18634', pcs: 8 }], pcs: 8, steps: { s1: { by: 'M', t: 1 }, s2: { by: 'M', t: 1 }, s3: { by: 'M', t: 1 } } },
  o2: { id: 'o2', name: 'Musalim', created: Date.now() - 86400000, items: [{ no: '18634', pcs: 4 }], pcs: 4, steps: {} },
  o3: { id: 'o3', name: 'Old done', created: 1, items: [], pcs: 1, steps: { s1: 1, s2: 1, s3: 1, bill: 1, dn: 1, sent: 1 } } };
let timoData = null, timoAt = 0;
function relay(b) { const req = JSON.parse(b.req);
  if (b.job === 'orders') return { ok: true, orders: Object.values(ORDS) };
  if (b.job === 'cchat') { if (req.op === 'list' || req.op === 'ping') return { ok: true, customers: [{ k: 'MATIULLAH', name: 'MATIULLAH', last: '1760700000.1', memos: 2, chat: 3, un: 2, tx: 'Matiullah: send me the new designs' }], orders: [], gun: {} }; return { ok: true, msgs: [] }; }
  if (b.job === 'timo') { if (req.op === 'get') return { ok: true, data: timoData, at: timoAt }; if (req.op === 'put') { timoData = req.data; timoAt = req.at; return { ok: true }; } }
  if (b.job === 'bills') return { ok: true, bills: [] };
  return { ok: false, error: 'not in test ' + b.job + ' ' + req.op }; }
const srv = http.createServer((rq, rs) => { let u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify(enc)); } if (/costs?\.enc|costing\.enc/.test(u)) { rs.statusCode = 404; return rs.end('nf'); } const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.js') ? 'text/javascript' : 'text/html'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route(/script\.google\.com/, async (route) => { const b = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify(relay(b)) }); });
  await pg.route(/ntfy\.sh|fonts\.g/, r => r.abort());
  const d = new Date(), nowMin = d.getHours() * 60 + d.getMinutes(), K = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const S = { acts: [{ id: 'a1', title: 'Factory visit', icon: '🏭', color: 'mint', start: Math.max(0, nowMin - 10), dur: 60, repeat: 'daily', date: K, items: [{ t: 'Check cutting', m: 0 }, { t: 'Give pcs to Arif', m: 20 }, { t: 'Photos of sample', m: 10 }], notes: '', skip: [] },
    { id: 'a2', title: 'Bills', icon: '🧾', color: 'butter', start: Math.min(1380, nowMin + 120), dur: 45, repeat: 'none', date: K, items: [], notes: '', skip: [] }], todos: [], done: {}, checks: {}, stepAt: {}, days: {}, wa: [], at: Date.now() };
  // staff phone first: no Today tab
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'Abbas'); }, PW); await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 });
  const vis = (q) => pg.$eval(q, e => !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0).catch(() => false);
  const t = (q) => pg.$eval(q, e => e.textContent.trim()).catch(() => null);
  const out = [];
  out.push(['staff phone: no Today tab', !(await vis('#nvtoday'))]);
  // owner phone
  await pg.evaluate(s => { localStorage.setItem('sj_owner', '1'); localStorage.setItem('sj_costs', JSON.stringify({ d: {}, c: {} })); localStorage.setItem('sj_owner_pin', '1234'); localStorage.setItem('timo-state', JSON.stringify(s)); }, S);
  await pg.reload(); await pg.waitForSelector('#feed .design', { timeout: 15000 }); await pg.waitForTimeout(300);
  out.push(['owner phone: Today tab shown', await vis('#nvtoday')]);
  await pg.click('#nvtoday'); await pg.waitForSelector('#today:not([hidden])');
  await pg.waitForFunction(() => document.querySelectorAll('#tdbody [data-tdord]').length === 2, null, { timeout: 8000 }).catch(() => {});
  await pg.waitForFunction(() => document.querySelectorAll('#tdbody [data-tdchat]').length === 1, null, { timeout: 8000 }).catch(() => {});
  out.push(['Now card = the running block', (await t('.tdnow h2')).indexOf('Factory visit') >= 0]);
  out.push(['start → end shown', /→/.test(await t('.tdnow .sub')) && /left/.test(await t('.tdnow .sub'))]);
  out.push(['steps on the Now card', (await pg.$$eval('.tdst button', L => L.length)) === 3]);
  out.push(['chat with news listed', (await pg.$$eval('[data-tdchat]', L => L.length)) === 1 && (await t('[data-tdchat] .t small')).indexOf('new designs') >= 0]);
  out.push(['open orders listed, done one not', (await pg.$$eval('[data-tdord]', L => L.map(e => e.textContent))).join('|').indexOf('Old done') < 0 && (await pg.$$eval('[data-tdord]', L => L.length)) === 2]);
  out.push(['packed order = bill today, first', (await t('[data-tdord] .tag')) === 'bill today' && (await t('[data-tdord] .t b')).indexOf('Matiullah') >= 0]);
  out.push(['day blocks with start/end', (await pg.$$eval('.tdb', L => L.length)) === 2 && (await pg.$$eval('.tdb.cur', L => L.length)) === 1]);
  out.push(['counts row', (await t('.tdk')).indexOf('2') >= 0 && (await t('.tdk button:nth-child(4) b')) === '0/2']);
  // tick a step from the dashboard → Timo (hidden frame) stores it
  await pg.click('.tdst button[data-tdstep="0"]');
  await pg.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('timo-state')); return (s.checks[Object.keys(s.checks)[0]] || []).indexOf(0) >= 0; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
  const st1 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  out.push(['step ticked in Timo state', !!st1.checks['a1@' + K] && st1.checks['a1@' + K].indexOf(0) >= 0]);
  await pg.waitForTimeout(300); out.push(['dashboard redrawn: step shows ticked, next step ▶', (await pg.$eval('.tdst button[data-tdstep="0"]', e => e.classList.contains('on'))) && (await t('.tdst button[data-tdstep="1"] i')) === '▶']);
  for (let i = 0; i < 40 && !(timoData && (JSON.parse(timoData).checks['a1@' + K] || []).length === 1); i++) await pg.waitForTimeout(200);
  out.push(['Timo synced to the relay', !!timoData && (JSON.parse(timoData).checks['a1@' + K] || []).length === 1]);
  // WhatsApp follow-up: add, shows, tick
  await pg.fill('#tdwan', 'Ahmad'); await pg.fill('#tdwat', 'send the price of 48188'); await pg.click('#tdwaf button');
  await pg.waitForSelector('[data-tdwa]', { timeout: 8000 }).catch(() => {});
  out.push(['WhatsApp line added', (await pg.$$eval('[data-tdwa]', L => L.length)) === 1 && (await t('[data-tdwa] .t b')) === 'Ahmad' && (await t('.tdk button:nth-child(3) b')) === '1']);
  await pg.click('[data-tdwa]'); await pg.waitForFunction(() => document.querySelectorAll('[data-tdwa]').length === 0, null, { timeout: 8000 }).catch(() => {});
  out.push(['WhatsApp line ticked off', (await pg.$$eval('[data-tdwa]', L => L.length)) === 0]);
  // open the block → Timo appears on its task screen
  await pg.click('.tdnow [data-tdopen]'); await pg.waitForSelector('#timo:not([hidden])');
  const fr = pg.frames().find(f => f.url().indexOf('timo.html') >= 0);
  await fr.waitForSelector('#task h2', { timeout: 8000 }).catch(() => {});
  out.push(['Open block → Timo task screen', !!(await fr.$('#task h2')) && (await fr.$eval('#task h2', e => e.textContent)).indexOf('Factory visit') >= 0]);
  // Timo: Edit → the sheet has Starts AND Ends; typing an end sets the length
  await fr.click('#te'); await fr.waitForSelector('#f-end');
  const startV = await fr.$eval('#f-start', e => e.value), endV = await fr.$eval('#f-end', e => e.value);
  const mins = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  out.push(['sheet: Ends = start + length', mins(endV) === (mins(startV) + 60) % 1440]);
  const ne = mins(startV) + 90; await fr.fill('#f-end', String(Math.floor((ne % 1440) / 60)).padStart(2, '0') + ':' + String(ne % 60).padStart(2, '0'));
  await fr.click('#sheetf button[type="submit"]'); await fr.waitForTimeout(400);
  const st2 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  out.push(['typed end → length 90 min', st2.acts[0].dur === 90]);
  out.push(['block row shows its next step', (await fr.$eval('.blk .nx', e => e.textContent)).indexOf('Give pcs') >= 0]);
  await fr.click('#tx'); await fr.click('#back'); await pg.waitForTimeout(200);
  out.push(['back → Today redrawn with 90 min', await vis('#today') && (await t('.tdnow .sub')).indexOf('→') >= 0 && (await pg.$eval('.tdb.cur small', e => e.textContent)).indexOf('1 h 30') >= 0]);
  // 22 Oct 2026: steps under every block of the day, tickable there
  await pg.click('[data-tdx="a1"]'); await pg.waitForTimeout(200);
  out.push(['arrow opens the steps under the block', (await pg.$$eval('.tdxs button', L => L.length)) === 3]);
  await pg.click('[data-tdxst="a1:1"]');
  await pg.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('timo-state')); return (s.checks[Object.keys(s.checks)[0]] || []).indexOf(1) >= 0; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
  const st3 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  out.push(['step ticked from the day list', (st3.checks['a1@' + K] || []).indexOf(1) >= 0]);
  // + → Task: "Call Usman #T1 tomorrow" → a step inside tomorrow's first block only (the block repeats daily)
  await pg.click('#tdnew'); await pg.waitForSelector('#tdmenu:not([hidden])'); await pg.click('#tdaddT'); await pg.waitForSelector('#tdquick:not([hidden])');
  await pg.fill('#tdqt', 'Call Usman #T1 tomorrow 15 min'); await pg.click('#tdquick button[type="submit"]');
  const K2 = (() => { const x = new Date(d); x.setDate(x.getDate() + 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); })();
  await pg.waitForFunction(k2 => { try { const s = JSON.parse(localStorage.getItem('timo-state')); return !!(s.over && s.over['a1@' + k2]); } catch (e) { return false; } }, K2, { timeout: 8000 }).catch(() => {});
  const st4 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  const ov = st4.over && st4.over['a1@' + K2];
  out.push(['task landed in tomorrow\'s block only (4 steps there, 3 today)', !!ov && ov.items.length === 4 && ov.items[3].t === 'Call Usman' && ov.items[3].m === 15 && st4.acts[0].items.length === 3]);
  out.push(['toast names the block', (await t('#toast')).indexOf('Factory visit') >= 0]);
  // no #block → To-do list
  await pg.click('#tdnew'); await pg.click('#tdaddT'); await pg.fill('#tdqt', 'Buy thread'); await pg.click('#tdquick button[type="submit"]');
  await pg.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('timo-state')).todos.length === 1; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
  out.push(['line without #block goes to To-do', (await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')).todos.map(x => x.title))).join() === 'Buy thread']);
  // Timo itself: adding a step on a repeating block asks "Only this day / Every day"
  await pg.click('.tdnow [data-tdopen]'); await pg.waitForSelector('#timo:not([hidden])'); await fr.waitForSelector('#task h2', { timeout: 8000 });
  await fr.fill('#ns', 'Photos'); await fr.click('#addstep button[type="submit"]'); await fr.waitForSelector('#askA', { timeout: 5000 }).catch(() => {});
  out.push(['Timo asks only this day / every day', !!(await fr.$('#askA')) && (await fr.$eval('#askA', e => e.textContent)) === 'Only this day']);
  await fr.click('#askA'); await fr.waitForTimeout(300);
  const st5 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  out.push(['"Only this day": 4 steps today, the series keeps 3', (st5.over['a1@' + K] || { items: [] }).items.length === 4 && st5.acts[0].items.length === 3 && (await fr.$$eval('.step', L => L.length)) === 4]);
  await fr.click('#tx'); await fr.waitForTimeout(200);
  await fr.click('[data-x="a1"]'); await fr.waitForTimeout(200);
  out.push(['Timo day list: arrow shows the 4 steps of this day', (await fr.$$eval('.xsteps .xs', L => L.length)) === 4]);
  await fr.click('[data-xst="a1:3"]'); await fr.waitForTimeout(300);
  out.push(['tick from the Timo list', (await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')).checks))['a1@' + K].indexOf(3) >= 0]);
  // 22 Oct 2026: a to-do tapped → pick the day and the block → it becomes a step there (that day only)
  await fr.click('#t-todo'); await fr.waitForSelector('[data-topen]'); await fr.click('[data-topen]'); await fr.waitForSelector('[data-pb]');
  out.push(['to-do tap: day strip + blocks of the day', (await fr.$$eval('[data-pd]', L => L.length)) === 7 && (await fr.$$eval('[data-pb]', L => L.length)) === 2]);
  await fr.click('[data-pd]:nth-child(2)'); await fr.waitForTimeout(150); await fr.click('[data-pb="a1"]'); await fr.waitForTimeout(400);
  const st6 = await pg.evaluate(() => JSON.parse(localStorage.getItem('timo-state')));
  out.push(['"Buy thread" is now a step of tomorrow\'s block, to-do gone', st6.todos.length === 0 && (st6.over['a1@' + K2] || { items: [] }).items.some(x => x.t === 'Buy thread') && st6.acts[0].items.length === 3]);
  await fr.click('#back');
  out.push(['no page errors', errs.length === 0]); if (errs.length) console.log(errs);
  let fail = 0; out.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + n); });
  console.log(`\n${out.length - fail} passed, ${fail} failed`); await br.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
