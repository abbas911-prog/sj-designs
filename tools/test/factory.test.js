// node tools/test/factory.test.js  — factory.html end to end (both lanes), against the fake world. No internet, no real tokens.
'use strict';
const { boot, test, ok, until, results, F, chromium } = require('./harness');
const CUT = 'C09S552KD7T', DM = 'C0DM0000001';
const START = '6527c572b12b208471c080cb', CUTTING = '6527c57751007e81a43f55a6';

function world(W) {
  W.cardA = F.addCard(W, START, 'SJ-48188 (32) pcs colours (8/8/8/8)', { ageDays: 3 });
  W.cardB = F.addCard(W, CUTTING, 'SJ-17841 (12) pcs', { ageDays: 9 });
  W.cardL = F.addCard(W, CUTTING, 'SJ-55555 (60) pcs long chat');
  // card B has a chat in #cutting; card L has a long chat (60 replies)
  const rb = F.postSlack(W, CUT, { text: '🧵 SJ-17841\n' + W.cardB.shortUrl, bot_id: 'B1' }); W.rootB = rb.ts;
  F.postSlack(W, CUT, { text: 'cutting started', user: 'U1', thread_ts: rb.ts });
  const rl = F.postSlack(W, CUT, { text: '🧵 SJ-55555\n' + W.cardL.shortUrl, bot_id: 'B1' }); W.rootL = rl.ts;
  for (let i = 1; i <= 60; i++) F.postSlack(W, CUT, { text: 'line ' + i, user: i % 2 ? 'U1' : 'U2', thread_ts: rl.ts });
  F.postSlack(W, DM, { text: 'hello from Ibrahim', user: 'U1' });
}
async function home(page) {                                   // back to the Cards tab with nothing open
  if (await page.locator('#card').isVisible()) { await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000, 'card closed'); }
  await page.evaluate(() => { document.querySelectorAll('.sheet:not([hidden]), #tg:not([hidden]), #wks:not([hidden]), #fac:not([hidden]), #mon:not([hidden])').forEach(x => { x.hidden = true; }); });
  await page.click('#tabs button[data-t="cards"]'); await page.fill('#q', '');
}
async function openCardNo(page, no) {
  if (!(await page.locator('#hcards').isVisible())) await page.click('#tabs button[data-t="cards"]');
  const q = page.locator('#q'); await q.fill(no); await page.locator('#list .cardrow').first().click(); await page.waitForSelector('#card:not([hidden])');
}
const bubbles = page => page.$$eval('#thread .msg:not(.out) .bub', els => els.map(e => e.textContent));

async function suite(fast, browser) {
  console.log('\n— ' + (fast ? 'FAST LANE on' : 'relay only') + ' —');
  const T = await boot({ fast, setup: world, browser });
  const W = T.W;
  try {
    const page = await T.open();
    await test('cards load and show the day count', async () => {
      await until(() => page.locator('#list .cardrow').count(), 5000, 'cards');
      await page.click('#stages button[data-i="2"]'); await until(async () => (await page.textContent('#list')).includes('SJ-48188'), 5000, 'START card');
      ok(/3 days/.test(await page.textContent('#list')), 'age badge "3 days"');
    });
    await test('open a card chat and see its messages', async () => {
      await openCardNo(page, '17841');
      await until(async () => (await bubbles(page)).some(t => /cutting started/.test(t)), 8000, 'thread line');
    });
    await test('send a text: it reaches Slack once and shows as mine', async () => {
      await page.fill('#txt', 'please hurry'); await page.click('#send');
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /please hurry/.test(m.text)), 8000, 'Slack got it');
      await until(async () => (await page.$$eval('#thread .msg.me .bub', e => e.map(x => x.textContent))).some(t => /please hurry/.test(t)), 8000, 'shown as mine');
      await page.waitForTimeout(1500);
      ok(W.slack.ch[CUT].msgs.filter(m => /please hurry/.test(m.text || '')).length === 1, 'posted exactly once');
      ok(!(await page.$$eval('#thread .msg', e => e.map(x => x.textContent))).some(t => /sending/.test(t)), 'no "sending…" left');
    });
    await test('a reply written in Slack shows up in the open chat', async () => {
      F.postSlack(W, CUT, { text: 'ok boss, 2 days', user: 'U1', thread_ts: W.rootB });
      // Slack's push: event -> relay (and -> worker /slack when the fast lane is on)
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await until(async () => (await bubbles(page)).some(t => /ok boss/.test(t)), 15000, 'Slack reply in the app');
    });
    await test('Done → next stage moves the Trello card and writes it in the chat', async () => {
      await page.click('#bdone');
      await until(() => W.trello.cards[W.cardB.id].idList === '6527c57cd7e267fbf2a602b4', 8000, 'card on IN LINE');
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /→ \*IN LINE\* · Abbas · 🕒 (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d/.test(m.text || '')), 8000, 'move line in chat, with the time (24 Oct 2026)');
      await page.goBack();
    });
    await test('a card made in Trello (no chat yet) gets its #cutting chat the moment it is opened', async () => {   // 24 Oct 2026
      if (await page.locator('#card').isVisible()) await page.goBack();
      ok(!W.slack.ch[CUT].msgs.some(m => (m.text || '').includes(W.cardA.shortUrl)), 'no root for card A before');
      await openCardNo(page, '48188');
      await until(() => W.slack.ch[CUT].msgs.some(m => (m.text || '').includes(W.cardA.shortUrl) && /card chat · factory app/.test(m.text)), 10000, 'root made in #cutting on open');
      await page.waitForTimeout(1200); ok(W.slack.ch[CUT].msgs.filter(m => (m.text || '').includes(W.cardA.shortUrl)).length === 1, 'made once');
      await page.goBack();
    });
    await test('send a photo: original size reaches Slack, once, and shows in the chat', async () => {
      if (!(await page.locator('#card').isVisible())) await openCardNo(page, '48188');
      else { await page.goBack(); await openCardNo(page, '48188'); }
      const big = Buffer.alloc(3 * 1024 * 1024, 9); big[0] = 0xff; big[1] = 0xd8;   // 3 MB "photo"
      await page.setInputFiles('#afiles', { name: 'IMG_1234.jpg', mimeType: 'image/jpeg', buffer: big });
      await page.click('#send');
      const all = () => [].concat(...Object.values(W.slack.ch).map(c => c.msgs));
      await until(() => all().some(m => (m.files || []).some(f => f.name === 'IMG_1234.jpg')), 15000, 'photo in Slack');
      await page.waitForTimeout(2500);
      const posts = all().filter(m => (m.files || []).some(f => f.name === 'IMG_1234.jpg'));
      ok(posts.length === 1, 'posted once (saw ' + posts.length + ')');
      ok(posts[0].files[0].size === big.length, 'full size kept (' + posts[0].files[0].size + ')');
      await until(async () => (await page.$$('#thread .msg:not(.out) .fph, #thread .msg:not(.out) img')).length > 0, 10000, 'photo bubble');
      ok(!(await page.textContent('#outbar')).trim() || await page.locator('#outbar').isHidden(), 'outbox empty');
      await page.goBack();
    });
    await test('Undo: Done moves on screen at once, Trello only after 5 s; Undo sends nothing', async () => {
      await page.click('#tabs button[data-t="cards"]'); await openCardNo(page, '48188');
      const start = W.trello.cards[W.cardA.id].idList, nLog = W.log.length;
      await page.click('#bdone');
      await until(async () => /CUTTING/.test(await page.textContent('#cstage')), 1000, 'moved on screen at once');
      ok(await page.locator('#undo').isVisible(), 'undo bar'); ok(!(await page.locator('.sheet:not([hidden])').count()), 'no question asked');
      await page.waitForTimeout(1500); ok(W.trello.cards[W.cardA.id].idList === start, 'Trello not moved yet');
      await page.click('#undob');
      await until(async () => /START/.test(await page.textContent('#cstage')), 1000, 'back on START');
      await page.waitForTimeout(5500);
      ok(W.trello.cards[W.cardA.id].idList === start, 'Trello never moved');
      ok(!W.log.slice(nLog).some(l => l[0] === 'comment' || (l[0] === 'slack' && /→ \*CUTTING/.test(l[3] || ''))), 'no comment, no chat line');
      await page.click('#bdone');
      await until(() => W.trello.cards[W.cardA.id].idList === '6527c57751007e81a43f55a6', 9000, 'moved after 5 s');
      await until(async () => await page.locator('#undo').isHidden(), 2000, 'undo bar gone');
      await page.goBack();
    });
    await test('Done then leaving the app: the move is sent at once', async () => {
      await page.click('#stages button[data-i="3"]'); await openCardNo(page, '48188');
      await page.click('#bdone'); await page.waitForTimeout(300);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await until(() => W.trello.cards[W.cardA.id].idList === '6527c57cd7e267fbf2a602b4', 3000, 'sent on going to the background');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.goBack();
    });
    await test('swipe a card row left = Done → next stage (with Undo)', async () => {
      await page.fill('#q', '');
      await page.click('#stages button[data-i="4"]');           // IN LINE
      const row = page.locator('#list .cardrow', { hasText: '48188' }); await row.waitFor();
      const b = await row.boundingBox(), y = b.y + b.height / 2;
      await page.mouse.move(b.x + b.width - 20, y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width - 20 - i * 15, y);
      await page.mouse.up();
      await until(async () => await page.locator('#undo').isVisible(), 2000, 'undo bar after swipe');
      ok(await page.locator('#card').isHidden(), 'the card did not open');
      await until(() => W.trello.cards[W.cardA.id].idList === '6527c5a93db4d8b8e91a8be9', 9000, 'IRON/CHECKING in Trello');
    });
    await test('work: give pieces to a worker, timer runs, Done stops it - Trello comment, field and chat line', async () => {
      await page.click('#tabs button[data-t="cards"]'); await openCardNo(page, '17841');
      await until(() => page.locator('#work').isVisible(), 8000, 'work box');
      const rows = page.locator('#wkrows .wr'); await until(async () => (await rows.count()) === 17, 8000, '17 workers (the sheet list minus Ibraheem and Waris - 23 Oct)');
      const wtxt = await page.textContent('#wkrows'); ok(!/Ibraheem|Waris/.test(wtxt) && /Checking · iron/.test(wtxt), 'Ibraheem / Waris gone, the role divider shown');
      ok(await page.locator('#wkrows .wr').last().evaluate(e => /Arif/.test(e.textContent) && /iron/.test(e.textContent) && e.classList.contains('role')), 'Arif (iron) is the last row, with his job');
      ok(/"Ram \(checking\)"/.test(T.relay.P.FAC_WORKERS) && T.relay.P.FAC_WORKERS_V === '2', 'the list on the relay was brought up to date once: ' + T.relay.P.FAC_WORKERS);
      ok(!(await page.textContent('#wkrows')).includes('TASLEEM'), 'hand-work names are NOT the workers');
      const r = page.locator('#wkrows .wr[data-w="Rifat"]'); await r.locator('input').fill('20'); await r.locator('button.in').click();
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && a.data.card.id === W.cardB.id && /^👷 IN · Rifat · 20 pcs · Abbas \(factory app\)/.test(a.data.text)), 10000, 'IN comment on Trello');
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /WORK\* · Abbas · 👷 \*Rifat\* ← \*20 pcs\* given · 🕒 (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d/.test(m.text || '')), 10000, 'chat line with the time it was given');
      await until(async () => /⏱/.test(await r.textContent()) && (await r.locator('button.out').count()) === 1, 8000, 'timer + Done button');
      // the 6th colour comes later: more pieces of the same design to the same worker = added to what he has (one timer)
      await r.locator('input').fill('4'); await r.locator('button.in').click();
      await until(() => W.trello.actions.filter(a => a.type === 'commentCard' && /^👷 IN · Rifat/.test(a.data.text)).length === 2, 10000, 'second IN comment');
      await until(async () => /24 pcs in hand/.test(await r.textContent()) && /\(20\+4\)/.test(await r.textContent()) && /since/.test(await r.textContent()), 8000, 'row shows 24 pcs in hand (20+4) and since when');
      // another worker gets the same design at the same time
      const r2 = page.locator('#wkrows .wr[data-w="Arif"]'); await r2.locator('input').fill('6'); await r2.locator('button.in').click();
      await until(async () => /6 pcs/.test(await r2.textContent()) && /since/.test(await r2.textContent()), 10000, 'Arif has 6 of the same card');
      W.trello.actions.filter(a => a.type === 'commentCard' && /👷 IN/.test(a.data.text)).forEach(a => a.date = new Date(Date.now() - 26 * 3600000).toISOString()); T.relay.cache.remove('FAC_WK_' + W.cardB.id);   // a day passes
      await page.reload(); await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length); await openCardNo(page, '17841');
      await until(async () => /1 d 2 h/.test(await r.textContent()), 10000, 'timer shows 1 d 2 h');
      // 23 Oct 2026 (Abbas: "20 given, 2 done, 18 remaining"): a PART delivery keeps the batch open
      await r.locator('input').fill('24'); await r.locator('button.part').click(); await until(async () => /All done/.test(await page.textContent('#toast')), 3000, 'part = all is refused'); 
      const RV = (require('fs').readFileSync(require('path').join(__dirname, '..', 'relay.gs'), 'utf8').match(/var RELAY_VER = '([^']+)'/) || [])[1]; ok(RV && (await page.textContent('#verline')).includes('relay ' + RV), 'More shows the relay version ' + RV + ': ' + (await page.textContent('#verline')));   // 24 Oct 2026
      await page.evaluate(() => { window.__f.D.rv = '2026-10-23b'; }); await r.locator('input').fill('5'); await r.locator('button.part').click(); await until(async () => /relay needs its new code/.test(await page.textContent('#toast')), 3000, 'Part refused on an old relay'); await page.evaluate(rv => { window.__f.D.rv = rv; }, RV);
      await r.locator('input').fill('5'); await r.locator('button.part').click();
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && /^👷 PART · Rifat · 5 pcs · Abbas \(factory app\) · .* · 19 pcs still in hand$/.test(a.data.text)), 10000, 'PART comment');
      await until(async () => /19 pcs in hand/.test(await r.textContent()) && /✓ 5 done so far/.test(await r.textContent()), 8000, 'row: 19 in hand, 5 done so far');
      ok(W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /Rifat\* ✓ \*5 pcs\* done \(part\) · \*19 pcs\* still in hand · 5 of 24 done so far/.test(m.text || '')), 'part line in the chat');
      await until(async () => /19 done/.test(await page.textContent('#wkprog')) || /5 done/.test(await page.textContent('#wkprog')), 5000, 'progress counts the part');
      await r.locator('input').fill('13'); await r.locator('button.out').click();
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && /^👷 OUT · Rifat · 13 pcs · 1 d 2 h · Abbas/.test(a.data.text) && /total 18 pcs/.test(a.data.text)), 10000, 'OUT comment with the total');
      await until(async () => /✓ 18 pcs/.test(await r.textContent()) && (await r.locator('button.out').count()) === 0, 8000, 'row shows done');
      const dl = W.slack.ch[CUT].msgs.map(m => m.text || '').find(t => /Rifat\* ✓ \*18 pcs\* done/.test(t));
      ok(dl && /\(13 now \+ 5 before\)/.test(dl) && /got (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d \(\+4 on .*\) → back (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d/.test(dl) && /on the clock/.test(dl) && /≈ \d+ pcs \/ day/.test(dl) && /of 24 given/.test(dl), 'Done line: 18 = 13 now + 5 before, got → back, time, rate:\n' + dl);
      ok(/→ /.test(await r.textContent()), 'row shows got → back times');
      ok(/6 pcs/.test(await r2.textContent()) && /since/.test(await r2.textContent()), 'Arif still has his 6');
      await page.goBack();
    });
    await test('Workers screen: pieces per day over 30 days', async () => {
      await page.click('#twork');                                // the 👷 icon in the bar opens the dashboard
      await until(async () => /Rifat/.test(await page.textContent('#wksbody')) && /18 pcs/.test(await page.textContent('#wksbody')), 10000, 'Rifat 18 pcs');
      ok(/today 18 pcs by 1 worker/.test(await page.textContent('#wksbody')), 'today line: ' + (await page.textContent('#wksbody')).slice(0, 300));
      // the dashboard: Arif still has 6 pcs of SJ-17841 in hand -> green card first, with the design, pieces and since when; tiles add up
      const body = await page.textContent('#wksbody');
      ok(/1\s*working/.test(body) && /6\s*pcs in hand/.test(body) && /18\s*pcs done/.test(body), 'tiles: 1 working, 6 in hand, 18 done — ' + body.slice(0, 120));
      ok(await page.locator('#wksbody .wkc').first().evaluate(e => e.classList.contains('busy') && /Arif/.test(e.textContent) && /SJ-17841/.test(e.textContent) && /6 pcs/.test(e.textContent) && /since/.test(e.textContent)), 'Arif first, with SJ-17841 · 6 pcs · since');
      await page.click('#wkview button[data-v="d"]');
      await until(async () => (await page.locator('#wksbody .dgc').count()) === 1, 5000, 'by design: one design in work');
      ok(await page.locator('#wksbody .dgc').first().evaluate(e => /SJ-17841/.test(e.textContent) && /Arif · 6/.test(e.textContent)), 'SJ-17841 with the Arif chip');
      await page.click('#wksbody .dgc'); await until(() => page.locator('#card').isVisible(), 5000, 'tapping the design opens its card'); ok(/17841/.test(await page.textContent('#cnm')), 'the right card');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.click('#tabs button[data-t="more"]'); await page.click('#bwork'); await page.click('#wkview button[data-v="w"]');
      await until(async () => /Rifat/.test(await page.textContent('#wksbody')), 8000, 'back on the dashboard');
      // pieces per day are counted over working hours (Dubai, Sat-Thu 8 am - 10 pm = 1 day, Fri 8 - 12): same sum as the relay, IN comment time -> OUT time
      const inT = Date.parse(W.trello.actions.find(a => a.type === 'commentCard' && /👷 IN · Rifat/.test(a.data.text)).date), outT = Date.parse(W.trello.actions.find(a => a.type === 'commentCard' && /👷 OUT · Rifat/.test(a.data.text)).date);
      const BR = [[9, 0, 9, 20], [13, 0, 14, 0], [19, 0, 19, 20]];   // 22 Oct 2026: breaks count for nothing
      const workMs = (a, b) => { const tz = 4 * 3600000; let t = a + tz, end = b + tz, tot = 0; while (t < end) { const day = Math.floor(t / 86400000) * 86400000, fri = new Date(day).getUTCDay() === 5, lo = Math.max(t, day + 8 * 3600000), hi = Math.min(end, day + (fri ? 12 : 22) * 3600000); if (hi > lo) { tot += hi - lo; BR.forEach(b => { tot -= Math.max(0, Math.min(hi, day + (b[2] * 60 + b[3]) * 60000) - Math.max(lo, day + (b[0] * 60 + b[1]) * 60000)); }); } t = day + 86400000; } return tot; };
      const want = Math.round(18 / Math.max(0.25, workMs(inT, outT) / (740 * 60000)));
      ok(new RegExp('≈ ' + want + ' /day').test(await page.textContent('#wksbody')), 'rate over working hours: want ' + want + ' — ' + (await page.textContent('#wksbody')).slice(0, 160));
      ok(/8 am – 10 pm/.test(await page.textContent('#wksbody')), 'says how a day is counted');
      await page.click('#wkedit'); ok(/Arif \(iron\)/.test(await page.inputValue('#wkenames')), 'the edit box shows the job in brackets'); await page.fill('#wkenames', 'Rifat\nArif (iron)\nNew Guy'); await page.click('#wkego');
      await until(() => JSON.stringify(JSON.parse(T.relay.P.FAC_WORKERS || '[]')) === '["Rifat","Arif (iron)","New Guy"]', 8000, 'list saved on the relay');
      await until(async () => /New Guy/.test(await page.textContent('#wksbody')), 8000, 'screen shows the new list');
      await page.click('#wksx'); await page.click('#tabs button[data-t="cards"]');
      await openCardNo(page, '17841'); await until(async () => (await page.locator('#wkrows .wr').count()) === 3, 8000, 'card shows the 3 workers'); await page.goBack();
    });
    // ===== 22 Oct 2026 (Abbas: "a complete factory app"): the card sheet, the Factory screen, the redone dashboard =====
    await test('card sheet: cut / rejected / first piece / due date -> Trello comments, chat lines, progress bar, late badge', async () => {
      await openCardNo(page, '17841'); await until(() => page.locator('#sheet').isVisible(), 8000, 'sheet box');
      await page.click('#shh'); await until(() => page.locator('#shrows .sr').count(), 5000, 'sheet rows');
      const row = k => page.locator('#shrows .sr[data-k="' + k + '"]');
      await row('cut').locator('input').fill('12'); await row('cut').locator('button').click();
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && a.data.card.id === W.cardB.id && /^📋 CUT · 12 pcs · Abbas \(factory app\)/.test(a.data.text)), 10000, 'CUT comment on Trello');
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /SHEET\* · Abbas · 📐 Cut \*12 pcs\*/.test(m.text || '')), 10000, 'chat line');
      await until(async () => /now 12 pcs/.test(await row('cut').textContent()), 8000, 'row shows 12');
      await row('rej').locator('input').fill('2'); await row('rej').locator('button').click();
      await until(async () => /now 2 pcs/.test(await row('rej').textContent()), 10000, 'rejected 2');
      await row('first').locator('button').click();                 // the confirm is auto-accepted
      await until(async () => /approved by Abbas/.test(await row('first').textContent()), 10000, 'first piece approved');
      // the WORK progress: 12 pcs on the card, Rifat did 18 (two batches counted in the earlier test), Arif holds 6, 2 rejected
      await until(async () => /18 done/.test(await page.textContent('#wkprog')) && /6 in hand/.test(await page.textContent('#wkprog')) && /2 rejected/.test(await page.textContent('#wkprog')), 8000, 'progress line: ' + (await page.textContent('#wkprog')));
      const y = new Date(Date.now() - 86400000 + 4 * 3600000).toISOString().slice(0, 10);     // yesterday (Dubai) -> late
      await row('due').locator('input').fill(y); await row('due').locator('button').click();
      await until(() => String(W.trello.cards[W.cardB.id].due || '').slice(0, 10) === y, 10000, 'Trello due date set');
      await until(async () => /late 1 day/.test(await page.textContent('#cnm')), 8000, 'card header says late');
      ok(W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /SHEET\* · Abbas · 📅 \*Due/.test(m.text || '')), 'due date line in the chat');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.fill('#q', '17841');
      await until(async () => /late 1 day/.test(await page.textContent('#list .cardrow[data-id="' + W.cardB.id + '"]')), 10000, 'row badge');
      await page.fill('#q', '55555'); await until(() => page.locator('#list .cardrow[data-id="' + W.cardL.id + '"]').count(), 5000, 'card L row');
      ok(!/late|due/.test(await page.textContent('#list .cardrow[data-id="' + W.cardL.id + '"]')), 'a card without a due date shows nothing new'); await page.fill('#q', '');
    });
    await test('Workers dashboard: tiles filter, sort, status chips, by-design bars, week table, late note', async () => {
      await page.click('#twork'); await until(async () => /Rifat/.test(await page.textContent('#wksbody')) && /1 late/.test(await page.textContent('#wksbody')), 10000, 'dashboard with the late note');
      ok(await page.locator('#wksbody .wkc[data-w="Arif"] .chip').evaluate(e => /Working/.test(e.textContent)), 'Arif: Working chip');
      // 23 Oct 2026: the remaining strip at the top - SJ-17841 (12 pcs, in IN LINE) has 18 done + 6 in hand -> 0 remaining
      const rem = await page.textContent('#wksbody .rem'); ok(/IN LINE · REMAINING/.test(rem) && /SJ-17841/.test(rem) && /12 pcs · given 24 \(⏳ 6 · ✓ 18\)/.test(rem) && /0\s*remaining/.test(rem), 'remaining strip: ' + rem.slice(0, 200));
      await page.click('#wksbody .rr'); await until(() => page.locator('#card').isVisible(), 5000, 'tap opens the card'); ok(/17841/.test(await page.textContent('#cnm')), 'the right card'); await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.click('#twork'); await until(async () => /Rifat/.test(await page.textContent('#wksbody')), 8000, 'dashboard again');
      ok(await page.locator('#wksbody .wkc[data-w="Rifat"] .chip').evaluate(e => /Free/.test(e.textContent)), 'Rifat: Free chip');
      ok(/2\s*free/.test(await page.textContent('#wksbody .dtiles')), 'free tile counts Rifat and New Guy (Arif has pieces; a role person is never "free")');
      await page.click('#wksbody .dtile[data-f="free"]'); await until(async () => (await page.locator('#wksbody .wkc').count()) === 2 && !/Arif/.test(await page.textContent('#wksbody .wkc')), 5000, 'free filter hides Arif');
      await page.click('#wksbody .dtile[data-f="free"]'); await until(async () => (await page.locator('#wksbody .wkc').count()) === 3, 5000, 'filter off');
      await page.click('#wksort button[data-s="done"]'); await until(async () => /Rifat/.test(await page.locator('#wksbody .wkc').first().textContent()), 5000, 'most done first = Rifat');
      await page.click('#wksort button[data-s="busy"]');
      await page.click('#wkview button[data-v="d"]'); await until(async () => /83 left|0 left/.test(await page.textContent('#wksbody')) || /left/.test(await page.textContent('#wksbody')), 5000, 'by design has a progress line');
      const dg = await page.locator('#wksbody .dgc').first().textContent(); ok(/12 pcs/.test(dg) && /done 18/.test(dg) && /in hand 6/.test(dg) && /Arif · 6/.test(dg) && /Rifat · 18/.test(dg), 'design card: 12 pcs · done 18 · in hand 6 · chips — ' + dg.slice(0, 200));
      await page.click('#wkview button[data-v="k"]'); await until(() => page.locator('#wksbody .wtab').count(), 5000, 'week table');
      const rr = await page.locator('#wksbody .wtab tr').filter({ hasText: 'Rifat' }).first().textContent(); ok(/18/.test(rr), 'Rifat row has 18 this week: ' + rr);
      ok(/Share this week/.test(await page.textContent('#wksbody')), 'share button');
      await page.click('#wksbody #wklate'); await until(() => page.locator('#fac').isVisible(), 5000, 'late note opens the Factory screen');
      await until(async () => /SJ-17841/.test(await page.textContent('#fs-late')), 8000, 'late list has SJ-17841'); await page.click('#facx'); await page.click('#tabs button[data-t="cards"]');
    });
    await test('Factory screen: attendance clock, month + salaries (Abbas), materials with a low alert, daily closing preview + post + the 10 pm tick', async () => {
      await home(page);
      await page.click('#tabs button[data-t="more"]'); await page.click('#bfac'); await until(async () => /ATTENDANCE/.test(await page.textContent('#facbody')) && (await page.locator('#fs-att .ar').count()) === 3, 10000, 'attendance rows');
      await page.locator('#fs-att .ar[data-n="Rifat"] button.in').click(); await page.locator('#fs-att .ar[data-n="Arif"] button.x').click();
      const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
      await until(() => { try { const a = JSON.parse(T.relay.P['FAC_ATT_' + today] || '{}'); return a.RIFAT && a.RIFAT.in > 0 && a.ARIF && a.ARIF.a === 1; } catch (e) { return false; } }, 8000, 'clock-in and absent saved on the relay');
      await until(async () => /1 in · 1 absent/.test(await page.textContent('#fs-att .dsub')), 5000, 'header counts');
      await until(async () => /in \d\d:\d\d/.test(await page.textContent('#fs-att .ar[data-n="Rifat"]')) && (await page.locator('#fs-att .ar[data-n="Rifat"] button.outb').count()) === 1, 5000, 'Rifat row: in time + Out button');
      await page.locator('#fs-att .ar[data-n="Rifat"] button.outb').click(); await until(async () => /→ out \d\d:\d\d/.test(await page.textContent('#fs-att .ar[data-n="Rifat"]')), 8000, 'out time shown');
      // yesterday, corrected by Abbas with typed times: in 08:30 = 15 min late, out 18:00 = 9.5 h
      const yd = new Date(Date.now() - 86400000 + 4 * 3600000).toISOString().slice(0, 10);
      let ja = await page.evaluate(d => window.__call({ op: 'attset', day: d, name: 'Rifat', kind: 'in', at: '08:30' }), yd); ok(ja.ok && ja.att.RIFAT.late === 30, 'late 30 min (08:30, counted from 08:00): ' + JSON.stringify(ja));
      ja = await page.evaluate(d => window.__call({ op: 'attset', day: d, name: 'Rifat', kind: 'out', at: '18:00' }), yd); ok(ja.ok && ja.att.RIFAT.out - ja.att.RIFAT.in === 9.5 * 3600000, 'out 18:00 (9.5 h on the clock, 8.2 h net of breaks)');
      ok(!(await page.evaluate(d => window.__call({ op: 'attset', day: d, name: 'Rifat', kind: 'in', at: '9h' }), yd)).ok, 'a bad time is refused');
      await page.click('#monbtn'); await until(async () => /Rifat/.test(await page.textContent('#monbody')) && (await page.locator('#monbody tr[data-w="Rifat"]').count()) === 1, 10000, 'month screen');
      const mrt = (await page.locator('#monbody tr[data-w="Rifat"]').textContent()).replace(/\s+/g, ''); ok(/Rifat20[12]·\d+min/.test(mrt), 'Rifat: 2 days, 0 absent, late once (yesterday) or twice (today too, if the test runs after 08:15 Dubai): ' + mrt);
      const art = (await page.locator('#monbody tr[data-w="Arif"]').textContent()).replace(/\s+/g, ''); ok(/Arif010/.test(art), 'Arif: 0 days, 1 absent: ' + art);
      await page.click('#saledit'); await until(() => page.locator('#sale').isVisible(), 3000); await page.fill('#saletxt', 'Rifat 3000\nArif 3000'); await page.click('#salego');
      await until(async () => /2900/.test(await page.locator('#monbody tr[data-w="Arif"]').textContent()), 8000, 'Arif pay = 3000 − 1 × 100 = 2900');
      ok(/30003000$/.test((await page.locator('#monbody tr[data-w="Rifat"]').textContent()).replace(/\s+/g, '')), 'Rifat pay 3000');
      ok(T.relay.P.FAC_SAL === '{"RIFAT":3000,"ARIF":3000}', 'salaries on the relay only: ' + T.relay.P.FAC_SAL);
      await page.click('#monbody tr[data-w="Rifat"]'); await until(async () => /in 08:30 ⏰ late 30 min → out 18:00 · 8\.2 h/.test(await page.textContent('#mondays')), 5000, 'his day list');
      await page.click('#monx');
      await page.click('#matedit'); await until(() => page.locator('#mate').isVisible(), 3000); const mr = page.locator('#materows .mrow').first();
      await mr.locator('input[data-f="n"]').fill('Thread black'); await mr.locator('input[data-f="q"]').fill('2'); await mr.locator('input[data-f="u"]').fill('cones'); await mr.locator('input[data-f="low"]').fill('5'); await page.click('#matego');
      await until(async () => /⚠ Thread black/.test(await page.textContent('#fs-mat')), 8000, 'low material shown'); ok(/"n":"Thread black"/.test(T.relay.P.FAC_MAT || ''), 'saved on the relay');
      ok(/SALARIES/.test(await page.textContent('#facbody')) && !/WAGES|piece rate/i.test(await page.textContent('#facbody')), 'Abbas sees the salaries note, no piece rates (the workers are on salary)');
      await page.click('#dailypv'); await until(async () => /DAILY CLOSING/.test(await page.textContent('#tgbody')), 10000, 'preview');
      const pv = await page.textContent('#tgbody'); ok(/18 pcs done today/.test(pv) && /Rifat 18/.test(pv) && /In hand.*Arif 6/.test(pv) && /Present 1/.test(pv) && /Absent 1 \(Arif\)/.test(pv) && /Late.*SJ-17841 \(1 d\)/.test(pv) && /Low stock.*Thread black 2 cones/.test(pv), 'preview text:\n' + pv);
      await page.click('#tgx');
      await page.click('#dailynow'); await until(() => W.slack.ch[DM].msgs.some(m => /DAILY CLOSING/.test(m.text || '') && /Abbas \(factory app\)/.test(m.text)), 10000, 'posted in the direct chat');
      // the timer: before 10 pm nothing; after 10 pm once (not twice); switched off -> nothing
      const n0 = W.slack.ch[DM].msgs.length, ctx = T.relay.ctx, realNow = Date.now, at = h => { const d = new Date(); d.setUTCHours(h - 4, 30, 0, 0); return d.getTime(); };
      delete T.relay.P.FAC_DAILY_LAST;
      const fri = new Date(Date.now() + 4 * 3600000).getUTCDay() === 5, hBefore = fri ? 10 : 15, hClose = fri ? 12 : 22, hAfter = fri ? 13 : 23;   // Friday closes at noon
      Date.now = () => at(hBefore); ctx.facNotifyTick(); ok(W.slack.ch[DM].msgs.length === n0, 'nothing before closing time');
      Date.now = () => at(hClose); ctx.facNotifyTick(); ok(W.slack.ch[DM].msgs.length === n0 + 1, 'the closing at ' + hClose + ':30');
      Date.now = () => at(hAfter); ctx.facNotifyTick(); ok(W.slack.ch[DM].msgs.length === n0 + 1, 'not a second time');
      Date.now = realNow;
      await page.click('#dailytgl'); await until(() => T.relay.P.FAC_DAILY_OFF === '1', 5000, 'switched off on the relay');
      delete T.relay.P.FAC_DAILY_LAST; Date.now = () => at(hClose); ctx.facNotifyTick(); Date.now = realNow; ok(W.slack.ch[DM].msgs.length === n0 + 1, 'off = no report');
      await page.click('#dailytgl'); await until(() => !T.relay.P.FAC_DAILY_OFF, 5000, 'on again');
      await page.click('#facx'); await page.click('#tabs button[data-t="cards"]');
    });
    await test('search by words: "fabric" finds the card with that word, numbers as before', async () => {
      await home(page);
      W.trello.cards[W.cardB.id].name = 'SJ-17841 (12) pcs red lace'; await page.click('#tabs button[data-t="more"]'); await page.click('#rf'); await page.waitForTimeout(1500); await page.click('#tabs button[data-t="cards"]');
      await page.fill('#q', 'LACE red');
      await until(async () => (await page.$$eval('#list .cardrow', r => r.map(x => x.textContent))).join('|').includes('17841'), 4000, 'word match');
      ok(!(await page.textContent('#list')).includes('48188'), 'other cards hidden');
      await page.fill('#q', 'sj48188'); await until(async () => (await page.textContent('#list')).includes('48188'), 3000, 'SJ + number');
      await page.fill('#q', 'nothinglikethis'); await until(async () => /কোনো কার্ড পাওয়া যায়নি/.test(await page.textContent('#list')), 3000, 'empty message');
      await page.fill('#q', '');
    });
    await test('reply to a message: quoted in Slack, shown as a quote box; & shown as &', async () => {
      await home(page); await openCardNo(page, '17841');
      F.postSlack(W, CUT, { text: 'fabric &amp; lace are short', user: 'U1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await until(async () => (await bubbles(page)).some(t => /fabric & lace are short/.test(t)), 15000, '& shown as &');
      await page.locator('#thread .msg', { hasText: 'fabric & lace' }).last().locator('.rp').click();
      ok(await page.locator('#rbar').isVisible(), 'reply bar');
      await page.fill('#txt', 'ok I will send more'); await page.click('#send');
      await until(() => W.slack.ch[CUT].msgs.some(m => /ok I will send more/.test(m.text || '')), 8000, 'in Slack');
      const sm = W.slack.ch[CUT].msgs.find(m => /ok I will send more/.test(m.text || ''));
      ok(/\n> \*Md:\* fabric & lace are short\nok I will send more$/.test(sm.text), 'Slack quote format: ' + JSON.stringify(sm.text));
      await until(async () => (await page.$$eval('#thread .msg .bub .q', q => q.map(x => x.textContent))).some(t => /Md: fabric & lace/.test(t)), 8000, 'quote box in the app');
      ok(await page.locator('#rbar').isHidden(), 'reply bar gone after sending');
      await page.goBack();
    });
    await test('status line: "Up to date", and "No internet" when the line is down', async () => {
      await until(async () => /Up to date/.test(await page.textContent('#msg')), 15000, 'Up to date');
      T.relayDown = true; T.fastDown = true;
      try { await page.waitForTimeout(1500);                       // answers already on their way arrive first
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await until(async () => /No internet/.test(await page.textContent('#msg')), 8000, 'No internet');
      } finally { T.relayDown = false; T.fastDown = false; }
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await until(async () => /Up to date/.test(await page.textContent('#msg')), 15000, 'back to Up to date');
    });
    await test('a long chat shows all its messages, also after the app is reopened', async () => {
      await openCardNo(page, '55555');
      await until(async () => (await bubbles(page)).filter(t => /^line \d+/.test(t)).length >= 60, 10000, '60 lines');
      await page.goBack(); await page.waitForTimeout(1200);         // the copy on the phone is saved
      await page.reload(); await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length);
      await openCardNo(page, '55555');
      await page.waitForTimeout(3000);
      const n = (await bubbles(page)).filter(t => /^line \d+/.test(t)).length;
      ok(n >= 60, 'all 60 lines after reopen (saw ' + n + ')');
      const order = (await bubbles(page)).filter(t => /^line \d+/.test(t)).map(t => +t.match(/\d+/)[0]);
      ok(order.every((v, i) => !i || v > order[i - 1]), 'oldest first, in order');
      await page.goBack();
    });
    await test('direct chat opens', async () => {
      if (await page.locator('#card').isVisible()) await page.goBack();
      await page.click('#tabs button[data-t="chats"]');
      await page.click('#dm'); await page.waitForSelector('#card:not([hidden])');
      await until(async () => (await bubbles(page)).some(t => /hello from Ibrahim/.test(t)), 8000, 'dm line');
      await page.goBack(); await page.click('#tabs button[data-t="cards"]');
    });
    await test('voice note plays and the photo viewer opens and closes with Back', async () => {
      if (await page.locator('#card').isVisible()) await page.goBack();
      W.slack.files.FVOICE1 = { id: 'FVOICE1', name: 'voice-1.m4a', mimetype: 'audio/mp4', size: 3000, bytes: Buffer.alloc(3000, 1), url_private: 'https://files.slack.com/dl/FVOICE1', url_private_download: 'https://files.slack.com/dl/FVOICE1' };
      W.slack.files.FPHOTO1 = { id: 'FPHOTO1', name: 'p.jpg', mimetype: 'image/jpeg', size: 4000, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), url_private: 'https://files.slack.com/dl/FPHOTO1', url_private_download: 'https://files.slack.com/dl/FPHOTO1', thumb_720: 'https://files.slack.com/thumb/FPHOTO1' };
      F.postSlack(W, CUT, { text: '', user: 'U1', thread_ts: W.rootB, files: [W.slack.files.FVOICE1, W.slack.files.FPHOTO1] });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'EV' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));   // Slack's push, as in real life
      await openCardNo(page, '17841');
      await until(async () => (await page.$$('#thread audio')).length, 10000, 'voice note ready as a player, without a tap');
      ok(await page.$eval('#thread audio', a => a.paused), 'not playing by itself');
      await until(async () => (await page.$$('#thread .bub img')).length, 10000, 'photo loaded');
      await page.click('#thread .bub img'); await until(() => page.locator('#viewer').isVisible(), 3000, 'viewer open');
      await page.goBack(); await until(async () => await page.locator('#viewer').isHidden(), 3000, 'viewer closed by Back');
      ok(await page.locator('#card').isVisible(), 'still in the card');
      await page.goBack(); await until(async () => await page.locator('#card').isHidden(), 3000, 'card closed');
      await page.click('#tabs button[data-t="cards"]');
    });
    await test('Catch up walks through the new messages, then all caught up', async () => {
      await home(page);
      F.postSlack(W, CUT, { text: 'catch me 1', user: 'U1', thread_ts: W.rootB });
      F.postSlack(W, CUT, { text: 'catch me 2', user: 'U1', thread_ts: W.rootL });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await page.click('#tabs button[data-t="chats"]');
      await until(async () => await page.locator('#bcatch2').isVisible() && /2 new/.test(await page.textContent('#bcatch2')), 20000, 'Catch up · 2 new');
      await page.click('#bcatch2'); await page.waitForSelector('#card:not([hidden])');
      await until(async () => /catch me/.test(await page.textContent('#thread')), 10000, 'first chat');
      await page.waitForTimeout(800); await page.click('#cunext');
      await until(async () => /catch me/.test(await page.textContent('#thread')) && /2 \/ 2/.test(await page.textContent('#cutxt')), 10000, 'second chat');
      await page.waitForTimeout(800); await page.click('#cunext');
      await until(async () => await page.locator('#card').isHidden(), 5000, 'back home');
      await page.waitForTimeout(3000);
      await until(async () => !(await page.locator('#bcatch2').isVisible()), 15000, 'no more Catch up');
      await page.click('#tabs button[data-t="cards"]');
    });
    await test('📌 Later pins a chat on top of Chats and unpins', async () => {
      await home(page); await openCardNo(page, '17841'); await page.click('#bpin');
      await until(() => Object.keys(JSON.parse(T.relay.P.FLATER_ABBAS || '{}')).includes(W.cardB.id), 8000, 'pinned on the relay');
      await page.goBack(); await page.click('#tabs button[data-t="chats"]');
      await until(async () => (await page.getAttribute('#chats .crow >> nth=0', 'data-id')) === W.cardB.id, 8000, 'pinned first');
      await page.click('#chats .crow >> nth=0'); await page.click('#bpin');
      await until(() => !Object.keys(JSON.parse(T.relay.P.FLATER_ABBAS || '{}')).includes(W.cardB.id), 8000, 'unpinned');
      await page.goBack(); await page.click('#tabs button[data-t="cards"]');
    });
    await test('new sample: card on SAMPLES + photo in #samples-discuss = its chat', async () => {
      await page.click('#tplus'); await page.click('#psample');
      await page.fill('#nsname', 'SJ-60001 test sample'); await page.fill('#nsdesc', 'long sleeves');
      const ph = Buffer.alloc(200000, 5); ph[0] = 0xff; ph[1] = 0xd8;
      await page.setInputFiles('#nsfiles', { name: 'sample.jpg', mimeType: 'image/jpeg', buffer: ph });
      await page.click('#nsgo');
      await until(() => Object.values(W.trello.cards).some(c => c.name === 'SJ-60001 test sample' && c.idList === '65f8c9fd96d90dda4b355f0a'), 20000, 'Trello card');
      const sc = Object.values(W.trello.cards).find(c => c.name === 'SJ-60001 test sample');
      await until(() => W.slack.ch.C09T1BGHC6L.msgs.some(m => (m.files || []).length && /SJ-60001/.test(m.text)), 10000, 'post in #samples-discuss');
      await until(async () => await page.locator('#card').isVisible() && /60001/.test(await page.textContent('#cnm')), 15000, 'opened the new card');
      await until(async () => /SAMPLE/.test(await page.textContent('#thread')), 10000, 'its chat shows the post');
      ok(W.slack.ch.C09T1BGHC6L.msgs.filter(m => /SJ-60001/.test(m.text || '')).length === 1, 'posted once');
      ok(sc.idAttachmentCover, 'cover on Trello');
      await page.goBack();
    });
    await test('new return: card on RETURNS, Done → RETURNS BACK, then delete', async () => {
      await page.click('#tplus'); await page.click('#pret');
      await page.fill('#nsdesc', 'stitching open on 3 pcs');
      const ph = Buffer.alloc(100000, 3); ph[0] = 0xff; ph[1] = 0xd8;
      await page.setInputFiles('#nsfiles', { name: 'ret.jpg', mimeType: 'image/jpeg', buffer: ph });
      await page.click('#nsgo');
      await until(async () => await page.locator('#card').isVisible() && /RETURNS/.test(await page.textContent('#cstage')), 25000, 'return card open');
      const rc = Object.values(W.trello.cards).find(c => /RETURN/.test(c.name));
      ok(rc, 'Trello return card');
      await page.click('#bdone');
      await until(async () => /RETURNS BACK/.test(await page.textContent('#cstage')), 10000, 'moved to RETURNS BACK');
      await until(async () => await page.locator('#bdel').isVisible(), 5000, 'delete button');
      await page.click('#bdel');
      await until(() => W.trello.cards[rc.id].closed, 10000, 'archived in Trello');
      await until(async () => await page.locator('#card').isHidden(), 5000, 'card closed');
    });
    if (fast) await test('fast lane down: the chat still opens and sends through the relay', async () => {
      T.fastDown = true; await page.click('#tabs button[data-t="cards"]');
      await openCardNo(page, '17841');
      await page.fill('#txt', 'via relay please'); await page.click('#send');
      await until(() => W.slack.ch[CUT].msgs.some(m => /via relay please/.test(m.text || '')), 20000, 'sent through the relay');
      await page.waitForTimeout(1500);
      ok(W.slack.ch[CUT].msgs.filter(m => /via relay please/.test(m.text || '')).length === 1, 'once');
      T.fastDown = false; await page.goBack();
    });
    await home(page); await test('production report posted once in the chat when a card reaches FINISH', async () => {
      const D = 86400000, H = 3600000, c = W.cardL, born = Date.parse(W.trello.actions.find(a => a.type === 'createCard' && a.data.card.id === c.id).date);
      const mv = (from, to, t) => W.trello.actions.push({ id: F.hexId(), type: 'updateCard', date: new Date(t).toISOString(), memberCreator: { fullName: 'Abbas Jamal' }, data: { card: { id: c.id, name: c.name }, listBefore: { name: from }, listAfter: { name: to } } });
      // the card was born 9 days ago in START, moved through the stages, and is on READY since yesterday
      W.trello.actions.find(a => a.type === 'createCard' && a.data.card.id === c.id).date = new Date(born - 9 * D).toISOString(); const b0 = born - 9 * D;
      mv('START', 'CUTTING', b0 + 1 * D + 3 * H); mv('CUTTING', 'IN LINE', b0 + 3 * D); mv('IN LINE', 'IRON/CHECKING', b0 + 7 * D); mv('IRON/CHECKING', 'READY', b0 + 8 * D);
      W.trello.cards[c.id].idList = '6527c5b13129a9ba37acd3ad'; await page.click('#tabs button[data-t="more"]'); await page.click('#rf'); await page.waitForTimeout(1500); await page.click('#tabs button[data-t="cards"]');
      await page.click('#stages button[data-i="10"]'); await openCardNo(page, '55555');
      await page.click('#bdone');                                 // READY → FINISH (Undo bar, then sent)
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootL && /PRODUCTION REPORT/.test(m.text || '')), 15000, 'report in the chat');
      const rp = W.slack.ch[CUT].msgs.find(m => /PRODUCTION REPORT/.test(m.text || '')).text;
      ok(/① \*START\* · 1 d 3 h · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d → /.test(rp) && /② \*CUTTING\* · 1 d 21 h/.test(rp) && /③ \*IN LINE\* · 4 d/.test(rp) && /④ \*IRON\/CHECKING\* · 1 d/.test(rp) && /→ READY .*\* · \*8 d\* total/.test(rp) && /✅ \*READY\* · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2} \d\d:\d\d/.test(rp) && !/READY\* · \d+ [dhm]/.test(rp), 'timeline with dates, totals, READY not a timed stage:\n' + rp);
      ok(/উৎপাদন রিপোর্ট/.test(rp), 'Bengali line');
      await until(async () => /PRODUCTION REPORT/.test(await page.textContent('#thread')), 15000, 'shown in the app');
      ok(W.trello.actions.some(a => a.type === 'commentCard' && a.data.card.id === c.id && /#report/.test(a.data.text)), 'Trello comment #report');
      await page.goBack();
    });
    await test('a card moved to FINISH straight in Trello gets its report too (once)', async () => {
      const c = W.cardA; W.trello.cards[c.id].idList = '6527c5b41e630c094b619f5e';
      W.trello.actions.push({ id: F.hexId(), type: 'updateCard', date: new Date(Date.now() - 30000).toISOString(), memberCreator: { fullName: 'Md Ibrahimmiah' }, data: { card: { id: c.id, name: c.name }, listBefore: { name: 'READY' }, listAfter: { name: 'FINISH' } } });
      T.relay.cache.remove('FMV_AT');
      await until(() => W.trello.actions.filter(a => a.type === 'commentCard' && a.data.card.id === c.id && /#report/.test(a.data.text)).length === 1, 20000, 'report comment');
      T.relay.cache.remove('FMV_AT'); await page.waitForTimeout(5000);
      ok(W.trello.actions.filter(a => a.type === 'commentCard' && a.data.card.id === c.id && /#report/.test(a.data.text)).length === 1, 'still one report');
    });
    await test('#cash and #expenses: Abbas sees them in Chats, reads and writes; the bot joins #cash by itself', async () => {
      await home(page); F.postSlack(W, 'C0EXP000001', { text: 'diesel 300', user: 'U1' }); const cm = F.postSlack(W, 'C0CASH00001', { text: 'cash in hand 5000', user: 'U1' });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: 'C0CASH00001', ts: cm.ts } }));   // Slack's push, as in real life
      await page.click('#tabs button[data-t="chats"]');
      await until(async () => (await page.locator('#xrooms .crow').count()) === 2, 20000, 'two room rows');
      ok(W.slack.ch.C0CASH00001.member, 'bot joined #cash');
      await page.click('#xrooms .crow[data-id="cash"]'); await page.waitForSelector('#card:not([hidden])');
      await until(async () => /cash in hand 5000/.test(await page.textContent('#thread')), 10000, 'cash line shown');
      await page.fill('#txt', 'noted, thanks'); await page.click('#send');
      await until(() => W.slack.ch.C0CASH00001.msgs.some(m => /noted, thanks/.test(m.text || '') && !m.thread_ts), 10000, 'posted in #cash');
      await page.goBack();
      // the rooms must STAY while the card list refreshes (21 Oct: they vanished for a few seconds after every fast-lane list refresh)
      for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__f.load(false)); await page.waitForTimeout(400); ok((await page.locator('#xrooms .crow').count()) === 2, 'rooms still there after a list refresh #' + i); }
      await page.click('#tabs button[data-t="cards"]');
    });
    await test('no page errors', async () => { ok(!T.errors.length, 'no errors:\n' + T.errors.join('\n')); });
  } finally { await T.close(); }
}

// the real Google relay takes 1-3 s per request: these run with a 2 s delay on every relay answer
async function slowSuite(fast, browser) {
  console.log('\n— slow relay (2 s)' + (fast ? ' + fast lane' : '') + ' —');
  const T = await boot({ fast, relayDelay: 2000, browser, setup: W => { W.c = F.addCard(W, START, 'SJ-48188 (32) pcs'); const r = F.postSlack(W, CUT, { text: 'x ' + W.c.shortUrl, bot_id: 'B1' }); W.root = r.ts; F.postSlack(W, CUT, { text: 'line 1', user: 'U1', thread_ts: r.ts }); } });
  const W = T.W;
  try {
    const page = await T.open(); await page.waitForTimeout(1500);
    await test('a message that arrives just after leaving a chat still shows NEW', async () => {
      await page.click('#list .cardrow'); await until(async () => /line 1/.test(await page.textContent('#thread')), 10000, 'chat');
      await page.waitForTimeout(3600);                              // a background pull of the chat is on its way to the relay
      await page.goBack(); await page.waitForTimeout(150);
      F.postSlack(W, CUT, { text: 'just after', user: 'U1', thread_ts: W.root });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.root, ts: F.slackTs() } }));
      await until(async () => /NEW/.test(await page.textContent('#list')), 20000, 'NEW badge');
      await page.waitForTimeout(6000);
      ok(/NEW/.test(await page.textContent('#list')), 'NEW badge stays');
      ok(+JSON.parse(T.relay.P.FSEEN_ABBAS)[W.c.id] < +W.slack.ch[CUT].msgs.slice(-1)[0].ts, 'the relay did not mark it seen');
    });
    await test('opening it marks it seen', async () => {
      await page.click('#list .cardrow'); await until(async () => /just after/.test(await page.textContent('#thread')), 10000, 'line');
      await until(() => +JSON.parse(T.relay.P.FSEEN_ABBAS)[W.c.id] >= +W.slack.ch[CUT].msgs.slice(-1)[0].ts, 10000, 'seen on the relay');
      await page.goBack(); await page.waitForTimeout(500);
      ok(!/NEW/.test(await page.textContent('#list')), 'no NEW after reading');
    });
    await test('no page errors (slow relay)', async () => { ok(!T.errors.length, 'no errors:\n' + T.errors.join('\n')); });
  } finally { await T.close(); }
}

// ---- a staff phone: no #cash / #expenses ----
async function staffSuite(browser) {
  console.log('\n— staff phone (Ibrahim) —');
  const T = await boot({ browser, who: 'Ibrahim', setup: world });
  const W = T.W;
  try {
    const page = await T.open(); F.postSlack(W, 'C0EXP000001', { text: 'rent 2000', user: 'U2' });
    await test('#cash / #expenses are not shown and not readable for staff', async () => {
      await page.click('#tabs button[data-t="chats"]'); await page.waitForTimeout(2500);
      ok((await page.locator('#xrooms .crow').count()) === 0, 'no room rows');
      const j = await page.evaluate(() => window.__call({ op: 'thread', card: 'exp' }));
      ok(!j.ok && j.noaccess, 'relay refuses: ' + JSON.stringify(j));
      const j2 = await page.evaluate(() => window.__call({ op: 'post', card: 'cash', text: 'hi' }));
      ok(!j2.ok, 'relay refuses a post too');
      ok(!T.errors.length, T.errors.join('\n'));
    });
    await test('staff: Factory screen without salaries or Post now; salaries and daily post refused; attendance allowed', async () => {
      await page.click('#tabs button[data-t="more"]'); await page.click('#bfac'); await until(async () => /ATTENDANCE/.test(await page.textContent('#facbody')) && /Rifat/.test(await page.textContent('#facbody')), 10000, 'factory screen');
      const body = await page.textContent('#facbody'); ok(!/SALARIES/.test(body) && !/Post now/.test(body), 'no salaries, no Post now');
      ok(!(await page.evaluate(() => window.__call({ op: 'daily', kind: 'now' }))).ok, 'daily post refused');
      await page.locator('#fs-att .ar[data-n="Rifat"] button.in').click();
      const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
      await until(() => { try { return JSON.parse(T.relay.P['FAC_ATT_' + today] || '{}').RIFAT.in > 0; } catch (e) { return false; } }, 8000, 'staff can clock a worker in');
      ok(!(await page.evaluate(() => window.__call({ op: 'attset', name: 'Rifat', kind: 'in', at: '08:00' }))).ok, 'staff cannot type a time');
      ok(!(await page.evaluate(() => window.__call({ op: 'sal' }))).ok, 'salaries refused');
      await page.click('#monbtn'); await until(async () => /Rifat/.test(await page.textContent('#monbody')), 8000, 'month screen'); ok(!/salary|pay/.test(await page.textContent('#monbody table')), 'no salary columns for staff'); await page.click('#monx');
      await page.click('#facx'); ok(!T.errors.length, T.errors.join('\n'));
    });
  } finally { await T.close(); }
}
// ---- Web Push: 🔔 → Turn on, then a Slack message arrives on the phone as a real (encrypted) notification ----
const crypto = require('crypto');
async function pushSuite(browser) {
  console.log('\n— phone notifications (Web Push) —');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  const SUB = { endpoint: 'https://push.test/phone-1', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const init = `(() => { const SUB = ${JSON.stringify(SUB)};
    const reg = { pushManager: { getSubscription: async () => window.__sub || null, subscribe: async o => (window.__sub = { endpoint: SUB.endpoint, options: o, toJSON: () => SUB, unsubscribe: async () => { window.__sub = null; return true; } }) } };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: true, get: () => ({ register: async () => reg, ready: Promise.resolve(reg), addEventListener() {} }) });
    window.PushManager = function () {}; window.Notification = { permission: 'default', requestPermission: async () => 'granted' }; })();`;
  const T = await boot({ fast: true, push: true, browser, init, setup: world });
  const W = T.W, open = b => { const salt = b.slice(0, 16), n = b[20], as = b.slice(21, 21 + n), ct = b.slice(21 + n), sh = ua.computeSecret(as);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', sh, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
    const k = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), iv = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', k, iv); d.setAuthTag(ct.slice(-16)); const pt = Buffer.concat([d.update(ct.slice(0, -16)), d.final()]); return JSON.parse(pt.slice(0, -1).toString()); };
  try {
    const page = await T.open();
    await test('🔔 Turn on (no extra app): the phone address is kept on the relay', async () => {
      await page.click('#tabs button[data-t="more"]'); await page.click('#bell');
      await until(() => page.locator('#wpon').isVisible(), 8000, 'Turn on button');
      await page.click('#wpon');
      await until(() => JSON.parse(T.relay.P.FWP_ABBAS || '[]').some(x => x.endpoint === SUB.endpoint), 15000, 'FWP_ABBAS');
      ok(T.relay.P.FAC_VAPID, 'push key made once by the worker');
      await until(() => page.locator('#wptest').isVisible(), 8000, 'test button');
      await page.click('#wptest'); await until(() => (W.pushes || []).length, 15000, 'test push sent');
      ok(/test/.test(open(W.pushes[0].body).title), 'test push readable: ' + JSON.stringify(open(W.pushes[0].body)));
      ok(T.relay.P.FNTFY === undefined || !JSON.parse(T.relay.P.FNTFY).ABBAS, 'ntfy untouched');
      await page.click('#tgx'); await page.click('#tabs button[data-t="cards"]');
    });
    await test('a new Slack message on a card arrives as a notification that opens that card', async () => {
      W.pushes.length = 0;
      F.postSlack(W, CUT, { text: 'need more thread', user: 'U1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await until(() => (W.pushes || []).length, 15000, 'push for the new message');
      const n = open(W.pushes[0].body); ok(/17841/.test(n.title) && /need more thread/.test(n.body) && n.url.endsWith('#card=' + W.cardB.id), 'notification: ' + JSON.stringify(n));
      F.postSlack(W, CUT, { text: 'x2', user: 'U1', thread_ts: W.rootL }); const before = W.pushes.length;
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E2' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootL, ts: F.slackTs() } }));
      await until(() => W.pushes.length > before, 15000, 'second push'); await new Promise(r => setTimeout(r, 1500));
      ok(W.pushes.filter(p => /need more thread/.test(open(p.body).body)).length === 1, 'the first message is notified once');
    });
    await test('a phone address that is gone (410) is dropped', async () => {
      W.fastSync.ctl({ pushStatus: 410 }); const st = await page.evaluate(() => window.__call({ op: 'wptest' })); W.fastSync.ctl({ pushStatus: 0 });
      ok(!st.ok && !(T.relay.P.FWP_ABBAS), 'dropped: ' + JSON.stringify(st) + ' ' + T.relay.P.FWP_ABBAS);
    });
    await test('no page errors (push)', async () => { ok(!T.errors.length, T.errors.join('\n')); });
  } finally { await T.close(); }
}
// ---- the phone helper (fac-sw.js): opens with no line, still updates, never looks after other pages ----
async function swSuite(browser) {
  console.log('\n— opens instantly / offline (helper) —');
  const T = await boot({ sw: true, browser, setup: world });
  try {
    const page = await T.open();
    await test('the helper looks after factory.html only', async () => {
      await until(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r && r.active && r.scope)), 15000, 'helper active');
      const sc = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.scope)); ok(/\/factory\.html$/.test(sc), 'scope ' + sc);
      const p2 = await T.ctx.newPage(); await p2.goto(T.base + 'factory-proto.html').catch(() => {}); ok(!(await p2.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))), 'other pages not controlled'); await p2.close();
    });
    await test('with the site unreachable the app still opens and shows the cards', async () => {
      await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
      T.offline = true; await page.reload();
      await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length, null, { timeout: 10000 });
      ok((await page.textContent('#list')).includes('SJ-'), 'cards shown'); T.offline = false;
    });
    await test('a new version still arrives (VER check reloads to it)', async () => {
      const fs = require('fs'), src = fs.readFileSync(F.ROOT + '/factory.html', 'utf8').replace(/var VER = '[^']+'/, "var VER = '2099-01-01z'");
      T.override = u => /\/factory\.html$/.test(u) ? src : null;
      await page.reload();
      await until(async () => /2099-01-01z/.test(await page.textContent('#verline').catch(() => '')), 20000, 'new version running');
      T.override = null;
    });
    await test('no page errors (helper)', async () => { ok(!T.errors.length, T.errors.join('\n')); });
  } finally { await T.close(); }
}

const ONLY = process.argv[2];   // e.g. node tools/test/factory.test.js push
(async () => {
  const browser = await chromium.launch();
  if (ONLY) { try { await ({ push: pushSuite, sw: swSuite, staff: staffSuite, main: b => suite(false, b), fast: b => suite(true, b) }[ONLY])(browser); } finally { await browser.close(); } const bad = results.filter(r => !r[0]); console.log('\n' + (results.length - bad.length) + ' passed, ' + bad.length + ' failed'); process.exit(bad.length ? 1 : 0); }
  try { await suite(false, browser); await suite(true, browser); await slowSuite(false, browser); await slowSuite(true, browser); await staffSuite(browser); await pushSuite(browser); await swSuite(browser); } finally { await browser.close(); }
  const bad = results.filter(r => !r[0]); console.log('\n' + (results.length - bad.length) + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
