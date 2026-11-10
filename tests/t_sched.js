// Scheduled order message (10 Nov 2026, Abbas: "when adding a new card order, send that message on a schedule just like on Slack — long press,
// give it a time and date, and at that time the message goes"). Part 1: the REAL relay.gs (job dorder) with fake Slack — the factory message waits,
// goes once when its time comes (doSchedTick), can be cancelled or sent at once. Part 2: the app — hold Send order → time sheet → the send carries `at`.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const DIR = path.join(__dirname, '..'), F = require(path.join(DIR, 'tools', 'test', 'fakes'));
const PW = 'shop-test-pw', CHK = 'c'.repeat(64);
const out = []; const ok = (n, v) => out.push([n, !!v]);

// ---------- part 1: the relay ----------
const W = F.makeWorld(), R = F.makeRelay(W, { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-st', SLACK_FACTORY_TOKEN: 'xoxb-ft', TRELLO: 'trello-tok' });
const call = o => { const req = JSON.stringify(Object.assign({ t: Date.now(), dev: 'd1', chk: CHK }, o)); return JSON.parse(R.post(JSON.stringify({ job: 'dorder', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const cut = () => W.slack.ch.C09S552KD7T.msgs, sneed = () => W.slack.ch.C0BV24ULLBD.msgs;
const seed = (oid, no) => { W.slack.files['F' + no] = { id: 'F' + no, name: 'photo-1.jpg', mimetype: 'image/jpeg', size: 10 };
  R.P['DO_' + oid] = JSON.stringify({ mode: 'alm', usman: false, no: String(no), files: [{ slack: 'F' + no }], notes: [], card: { id: 'k' + no, name: 'SJ-' + no + ' (60) pcs', url: 'https://trello.com/c/' + no } }); };
const trig = () => R.ctx.ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'doSchedTick').length;
const due = () => { const L = JSON.parse(R.P.DO_SCHED || '[]'); L.forEach(x => { x.at = Date.now() - 1000; }); R.P.DO_SCHED = JSON.stringify(L); };
const has = (ms, s) => ms.filter(m => (m.text || '').indexOf(s) >= 0).length;

seed('o1', 11111);
const at1 = Date.now() + 2 * 36e5, a = call({ op: 'send', oid: 'o1', text: 'ORDER 11111\nhttps://trello.com/c/11111', sample: 'SJ-11111 SAMPLE', at: at1 });
ok('a send with a time 2 h ahead is kept, not posted (answer scheduled ' + a.scheduled + ')', a.ok && a.scheduled === at1 && !has(cut(), 'ORDER 11111') && !has(sneed(), 'SJ-11111'));
ok('the every-minute check is switched on once', trig() === 1);
const l1 = call({ op: 'list' });
ok('the order list says this relay can schedule and shows the waiting order', l1.sched === 1 && l1.log[0].oid === 'o1' && l1.log[0].at === at1 && !l1.log[0].sent);
R.ctx.doSchedTick();
ok('before its time nothing goes', !has(cut(), 'ORDER 11111') && JSON.parse(R.P.DO_SCHED).length === 1);
due(); R.ctx.doSchedTick();
const m1 = cut().filter(m => (m.text || '').indexOf('ORDER 11111') >= 0);
ok('at its time the factory message goes to #cutting with its photo, and SJ-11111 SAMPLE to #samplesneed', m1.length === 1 && (m1[0].files || []).length === 1 && has(sneed(), 'SJ-11111 SAMPLE') === 1);
ok('then the list is empty and the every-minute check is switched off', JSON.parse(R.P.DO_SCHED).length === 0 && trig() === 0 && call({ op: 'list' }).log[0].sent > 0);
R.ctx.doSchedTick(); call({ op: 'sendnow', oid: 'o1' });
ok('never twice (another tick, a late Send now)', has(cut(), 'ORDER 11111') === 1 && has(sneed(), 'SJ-11111 SAMPLE') === 1);

seed('o2', 22222); call({ op: 'send', oid: 'o2', text: 'ORDER 22222', sample: 'SJ-22222 SAMPLE', at: Date.now() + 36e5 });
const c2 = call({ op: 'unsched', oid: 'o2' }); due(); R.ctx.doSchedTick();
ok('Cancel: the message never goes, the list says cancelled', c2.ok && !has(cut(), 'ORDER 22222') && !has(sneed(), 'SJ-22222') && call({ op: 'list' }).log[0].cancelled > 0);

seed('o3', 33333); call({ op: 'send', oid: 'o3', text: 'ORDER 33333', sample: 'SJ-33333 SAMPLE', at: Date.now() + 5 * 36e5 });
const s3 = call({ op: 'sendnow', oid: 'o3' }); due(); R.ctx.doSchedTick();
ok('Send now: goes at once, and only once', s3.ok && has(cut(), 'ORDER 33333') === 1 && has(sneed(), 'SJ-33333 SAMPLE') === 1);

seed('o4', 44444); const f4 = call({ op: 'send', oid: 'o4', text: 'ORDER 44444', at: Date.now() + 40 * 864e5 });
ok('more than 30 days ahead is refused, nothing posted', !f4.ok && /30 days/.test(f4.error) && !has(cut(), 'ORDER 44444'));
const n4 = call({ op: 'send', oid: 'o4', text: 'ORDER 44444', sample: 'SJ-44444 SAMPLE' });
ok('a normal send (no time) still goes at once', n4.ok && !n4.scheduled && has(cut(), 'ORDER 44444') === 1);

// "it also has to include the Trello cards": a scheduled order's card is made now but hidden (archived) until its time
const c5 = call({ op: 'card', oid: 'o5', mode: 'alm', fresh: true, no: '55555', name: 'SJ-55555 /N (60) pcs', later: 1 }), k5 = c5.card && W.trello.cards[c5.card.id];
ok('a scheduled order: the Trello card is made but hidden (archived)', c5.ok && !!k5 && k5.closed === true);
call({ op: 'send', oid: 'o5', text: 'ORDER 55555', sample: 'SJ-55555 SAMPLE', at: Date.now() + 36e5 }); R.ctx.doSchedTick();
ok('before its time the card stays hidden and nothing is posted', k5 && k5.closed === true && !has(cut(), 'ORDER 55555'));
due(); R.ctx.doSchedTick();
const top5 = k5 && Math.min(...Object.values(W.trello.cards).filter(x => x.idList === k5.idList && !x.closed).map(x => x.pos));
ok('at its time the card appears on top of its list and the message goes, once', k5 && k5.closed === false && k5.pos === top5 && has(cut(), 'ORDER 55555') === 1);
const c6 = call({ op: 'card', oid: 'o6', mode: 'alm', fresh: true, no: '66666', name: 'SJ-66666 /N (60) pcs', later: 1 }), k6 = c6.card && W.trello.cards[c6.card.id];
call({ op: 'send', oid: 'o6', text: 'ORDER 66666', at: Date.now() + 36e5 }); call({ op: 'unsched', oid: 'o6' }); due(); R.ctx.doSchedTick();
ok('Cancel: the card stays hidden, no message', k6 && k6.closed === true && !has(cut(), 'ORDER 66666'));
const c7 = call({ op: 'card', oid: 'o7', mode: 'alm', fresh: true, no: '77777', name: 'SJ-77777 /N (60) pcs', later: 1 }), k7 = c7.card && W.trello.cards[c7.card.id];
call({ op: 'send', oid: 'o7', text: 'ORDER 77777', at: Date.now() + 36e5 }); call({ op: 'sendnow', oid: 'o7' });
ok('Send now: the card appears and the message goes at once', k7 && k7.closed === false && has(cut(), 'ORDER 77777') === 1);
const c8 = call({ op: 'card', oid: 'o8', mode: 'alm', fresh: true, no: '88888', name: 'SJ-88888 /N (60) pcs' }), k8 = c8.card && W.trello.cards[c8.card.id];
ok('a normal order: the card is visible at once', c8.ok && k8 && !k8.closed);

// ---------- part 2: the app ----------
const enc = { salt: '', iv: '', iter: 1, ct: '' };
const srv = http.createServer((rq, rs) => { const u = rq.url.split('?')[0]; if (u === '/memo-data.enc') { rs.statusCode = 404; return rs.end('nf'); }
  const f = path.join(DIR, u === '/' ? 'memo.html' : u.slice(1)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { rs.setHeader('content-type', u.endsWith('.html') ? 'text/html' : 'application/javascript'); return rs.end(fs.readFileSync(f)); } rs.statusCode = 404; rs.end('nf'); });
(async () => {
  await new Promise(r => srv.listen(0, r)); const URL0 = 'http://localhost:' + srv.address().port + '/memo.html';
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false }); const errs = [], dlg = [];
  let newRelay = false; const reqs = []; let log = [];
  await ctx.route(/script\.google\.com/, async r => { let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (b.job !== 'dorder') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], orders: [], names: [] }) });
    const q = JSON.parse(b.req); reqs.push(q); let j = { ok: true };
    if (q.op === 'list') j = newRelay ? { ok: true, sched: 1, log } : { ok: true, log };
    else if (q.op === 'mint') j = { ok: true, no: 'US-0777' };
    else if (q.op === 'card') j = { ok: true, card: { id: 'k1', name: 'US-0777 ALI', url: 'https://trello.com/c/x' }, notes: [] };
    else if (q.op === 'send') { j = { ok: true, card: { name: 'US-0777 ALI' } }; if (q.at && newRelay) { j.scheduled = q.at; log = [{ oid: q.oid, t: Date.now(), name: 'US-0777 ALI', url: 'https://trello.com/c/x', mode: 'out', files: 0, at: q.at }]; } }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(j) }); });
  await ctx.route(/ntfy\.sh|github/, r => r.abort());
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { dlg.push(d.message()); d.accept(); });
  await pg.goto(URL0); await pg.evaluate(pw => { localStorage.setItem('sj_memo_pw', pw); localStorage.setItem('sj_me', 'ABBAS'); localStorage.setItem('sj_owner_pin', 'owner-pin-test'); }, PW);
  await pg.reload(); await pg.waitForTimeout(2500);
  const openForm = async () => { await pg.evaluate(() => { document.getElementById('dor').hidden = false; }); await pg.click('#dor [data-dm="out"]'); await pg.fill('#dorperson', 'ALI'); };
  const hold = async () => { const bx = await pg.$eval('#dorsend', e => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pg.mouse.move(bx.x, bx.y); await pg.mouse.down(); await pg.waitForTimeout(800); await pg.mouse.up(); await pg.waitForTimeout(300); };
  await openForm();
  ok('the order screen offers ⏰ Send later', await pg.$eval('#dorlater', e => e.offsetHeight > 0 && /Send later/.test(e.textContent)));
  await hold();
  ok('holding Send order opens the time sheet and sends nothing', await pg.$eval('#dorsch', e => !e.hidden) && !reqs.some(q => q.op === 'card' || q.op === 'send') && await pg.$$eval('#dorschq button', b => b.length) >= 3);
  // old relay: refused before anything is made
  await pg.click('#dorschq button:has-text("Tomorrow 9 am")'); dlg.length = 0; await pg.click('#dorschgo'); await pg.waitForTimeout(800);
  ok('with the old relay it says the relay needs its new version and makes no card', dlg.some(m => /new relay version/.test(m)) && !reqs.some(q => q.op === 'card'));
  newRelay = true; await pg.evaluate(() => { window.__dorSchedReset = 1; }); await pg.evaluate(() => { /* forget the old answer */ }); await pg.reload(); await pg.waitForTimeout(2500); await openForm();
  await hold(); await pg.click('#dorschq button:has-text("Tomorrow 9 am")'); dlg.length = 0; await pg.click('#dorschgo'); await pg.waitForTimeout(2500);
  const want = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); })();
  const sent = reqs.filter(q => q.op === 'send');
  ok('Schedule: the card is asked for as hidden and the message is handed over with tomorrow 9 am (asked first)', reqs.some(q => q.op === 'card' && q.later === 1) && sent.length === 1 && sent[0].at === want && dlg.some(m => /Schedule this order for/.test(m)));
  ok('the screen says Scheduled and when', await pg.$eval('#dorprog', e => /Scheduled ✓/.test(e.textContent) && /appear on/.test(e.textContent) && /hidden until its time/.test(e.textContent)));
  ok('the list shows the waiting order with Send now / Cancel', await pg.$eval('#dorlog', e => /Card \+ message appear/.test(e.textContent) && !!e.querySelector('[data-dsn]') && !!e.querySelector('[data-dsc]')));
  await pg.click('#dorlog [data-dsc]'); await pg.waitForTimeout(800);
  ok('Cancel asks the relay to drop that order\'s message', reqs.some(q => q.op === 'unsched' && q.oid === sent[0].oid));
  await pg.click('#dorlog [data-dsn]'); await pg.waitForTimeout(800);
  ok('Send now asks the relay to send it', reqs.some(q => q.op === 'sendnow' && q.oid === sent[0].oid));
  // a plain tap still sends at once
  await pg.fill('#dorperson', 'ALI'); const n0 = reqs.length; await pg.click('#dorsend'); await pg.waitForTimeout(2500);
  const s2 = reqs.slice(n0).filter(q => q.op === 'send'), k2 = reqs.slice(n0).filter(q => q.op === 'card');
  ok('a normal tap on Send order sends at once (no time, card not hidden)', s2.length === 1 && !s2[0].at && k2.length === 1 && !k2[0].later && await pg.$eval('#dorsch', e => e.hidden));
  ok('no page errors', !errs.length);
  out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed'); if (errs.length) console.log('errors', errs.slice(0, 3));
  await br.close(); srv.close(); if (!out.every(o => o[1])) process.exit(1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
