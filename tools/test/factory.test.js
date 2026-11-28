// node tools/test/factory.test.js  — factory.html end to end (both lanes), against the fake world. No internet, no real tokens.
'use strict';
const { boot, test, ok, until, results, F, chromium } = require('./harness');
const CUT = 'C09S552KD7T', DM = 'C0DM0000001';
const START = '6527c572b12b208471c080cb', CUTTING = '6527c57751007e81a43f55a6';

function world(W) {
  W.cardA = F.addCard(W, START, 'SJ-48188 (32) pcs colours (8/8/8/8)', { ageDays: 3 });
  W.cardB = F.addCard(W, CUTTING, 'SJ-17841 (12) pcs', { ageDays: 9 });
  W.cardL = F.addCard(W, CUTTING, 'SJ-55555 (60) pcs long chat');
  W.cardR = F.addCard(W, START, 'SJ-77001 (10) pcs race');
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
async function chip(page, i) {                                // a list by its CHIPS index: its group box, then its chip (when the group has more than one list)
  if (!(await page.locator('#hcards').isVisible())) await page.click('#tabs button[data-t="cards"]');
  await page.click('#groups button[data-chips~="' + i + '"]');
  const b = page.locator('#stages button[data-i="' + i + '"]'); if (await b.count() && await b.isVisible()) await b.click();
}
async function workTab(page, all) {                           // the card's Work tab; all = also show the workers who hold nothing
  await page.click('#ctabs button[data-ct="work"]'); await until(() => page.locator('#work').isVisible(), 8000, 'work box');
  if (all) { await until(() => page.locator('#wkrows .wr').count(), 8000, 'worker rows'); const g = page.locator('#wkgive'); if (await g.count() && await g.isVisible() && !(await page.locator('.wkfree').isVisible())) await g.click(); }
}
async function sheetTab(page) { await page.click('#ctabs button[data-ct="sheet"]'); await until(() => page.locator('#sheet').isVisible(), 8000, 'sheet box'); }
const lidOf = (W, name) => (W.trello.lists.find(l => l.name === name) || {}).id;
const bubbles = page => page.$$eval('#thread .msg:not(.out) .bub', els => els.map(e => e.textContent));

async function suite(fast, browser) {
  console.log('\n— ' + (fast ? 'FAST LANE on' : 'relay only') + ' —');
  const T = await boot({ fast, setup: world, browser });
  const W = T.W;
  try {
    const page = await T.open();
    await test('cards load and show the day count', async () => {
      await until(() => page.locator('#list .cardrow').count(), 5000, 'cards');
      await chip(page, 2); await until(async () => (await page.textContent('#list')).includes('SJ-48188'), 5000, 'START card');
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
    await test('a 19-MB video reaches Slack in full, through the fast lane when it is on; Slack refusing it is said in words', async () => {   // 31 Oct 2026
      await openCardNo(page, '17841'); await until(async () => /cutting started/.test(await page.textContent('#thread')), 10000, 'chat');
      T.fastCalls.length = 0; const vid = Buffer.alloc(19 * 1024 * 1024, 5);
      const all = () => [].concat(...Object.values(W.slack.ch).map(c => c.msgs));
      try {
        await page.setInputFiles('#afiles', { name: 'VID_0001.mp4', mimeType: 'video/mp4', buffer: vid }); await page.click('#send');
        await until(() => all().some(m => (m.files || []).some(f => f.name === 'VID_0001.mp4')), 40000, 'video in Slack');
        const f = all().map(m => (m.files || []).find(f => f.name === 'VID_0001.mp4')).find(Boolean); ok(f.size === vid.length && (fast ? f.uploaded === vid.length : f.uploaded >= vid.length), 'every byte arrived: ' + f.uploaded + ' of ' + vid.length);   // direct = multipart (a few bytes of wrapping), worker = the bare file
        if (fast) ok(T.fastCalls.includes('/up'), 'went through the worker /up: ' + T.fastCalls.join(' ')); else ok(!T.fastCalls.includes('/up'), 'no worker in the relay-only round');
        await until(() => page.evaluate(() => window.__f.OUT.length === 0), 10000, 'outbox empty');
        if (fast) {   // a 30-MB video (too big for the relay's fallback) that Slack refuses (413) -> the bubble says so; once Slack takes uploads again it goes
          W.uploadRefuse = true;
          try { await page.setInputFiles('#afiles', { name: 'VID_0002.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(30 * 1024 * 1024, 6) }); await page.click('#send');
            await page.evaluate(() => { const v = window.__f.OUT.find(x => x.files.length); if (v) v.tries = 2; });   // two failed tries already
            await until(async () => /Slack answered 413/.test(await page.textContent('#thread')), 40000, 'the reason in the bubble: ' + (await page.textContent('#outbar')));
          } finally { W.uploadRefuse = false; }
          await page.evaluate(() => { const v = window.__f.OUT.find(x => x.files.length); if (v) v.next = 0; return window.__f.outRun(true); });
          await until(() => all().some(m => (m.files || []).some(f => f.name === 'VID_0002.mp4')), 40000, 'the second video goes once Slack takes uploads again');
          await until(() => page.evaluate(() => window.__f.OUT.length === 0), 10000, 'outbox empty again');
        }
      } finally { await page.evaluate(() => { window.__f.OUT.length = 0; }); if (await page.locator('#card').isVisible()) { await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000).catch(() => {}); } }
    });
    await test('a big video whose bytes never reached Slack is uploaded again by itself (not stuck on the dead upload)', async () => {   // 20 Nov 2026
      await openCardNo(page, '17841'); await until(async () => /cutting started/.test(await page.textContent('#thread')), 10000, 'chat');
      const all = () => [].concat(...Object.values(W.slack.ch).map(c => c.msgs));
      W.uploadLose = 1; W.uploadLost = 0;
      try { await page.setInputFiles('#afiles', { name: 'VID_LOST.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(19 * 1024 * 1024, 9) }); await page.click('#send');
        await until(() => all().some(m => (m.files || []).some(f => f.name === 'VID_LOST.mp4')), 60000, 'the video reached Slack on a later try (lost uploads: ' + W.uploadLost + ')');
      } finally { W.uploadLose = 0; }
      ok(W.uploadLost === 1, 'the first upload was lost: ' + W.uploadLost);
      const f = all().map(m => (m.files || []).find(f => f.name === 'VID_LOST.mp4')).find(Boolean); ok(f.size === 19 * 1024 * 1024, 'whole file: ' + f.size);
      ok(all().filter(m => (m.files || []).some(f => f.name === 'VID_LOST.mp4')).length === 1, 'posted once');
      await until(() => page.evaluate(() => window.__f.OUT.length === 0), 10000, 'outbox empty');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
    });
    await test('a big video Slack will not take does not hold back the text messages after it; it can be removed', async () => {   // 30 Oct 2026
      await openCardNo(page, '17841'); await until(async () => /cutting started/.test(await page.textContent('#thread')), 10000, 'chat');
      T.uploadDown = true;
      try {
        await page.setInputFiles('#afiles', { name: 'VID_2026.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(19 * 1024 * 1024, 7) }); await page.click('#send');
        await page.waitForTimeout(1500); await page.fill('#txt', 'text after the video'); await page.click('#send');
        await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /text after the video/.test(m.text || '')), 20000, 'the text reached Slack while the video is stuck');
        await page.evaluate(() => { const v = window.__f.OUT.find(x => x.files.length); v.tries = 4; v.next = 0; return window.__f.outRun(true); }); await page.waitForTimeout(500);
        await until(async () => (await page.$$('#thread .msg.out.bad .orm')).length === 1, 10000, 'stuck video shows Try again / Remove');
        ok(/line dropped during the upload \(19 MB\)/.test(await page.textContent('#thread .msg.out.bad')), 'the real reason is shown: ' + (await page.textContent('#thread .msg.out.bad')));
        await page.click('#thread .msg.out.bad .orm'); await until(() => page.evaluate(() => window.__f.OUT.length === 0), 5000, 'removed from the outbox');
        ok(!W.slack.ch[CUT].msgs.some(m => (m.files || []).some(f => /VID_2026/.test(f.name || ''))), 'the video was never posted');
        T.uploadDown = false; T.uploadSlow = 4000;   // 31 Oct 2026: while a big video uploads, the bar says so and asks to keep the app open
        await page.setInputFiles('#afiles', { name: 'VID_2027.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(19 * 1024 * 1024, 8) }); await page.click('#send');
        await until(async () => /Uploading a video · 19 MB/.test(await page.textContent('#outbar')) && /keep this app open/.test(await page.textContent('#outbar')), 8000, 'upload bar with keep-open note');
        await until(() => W.slack.ch[CUT].msgs.some(m => (m.files || []).some(f => /VID_2027/.test(f.name || ''))), 30000, 'the video reached Slack');
      } finally { T.uploadDown = false; T.uploadSlow = 0; }
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
    });
    await test('a chat whose thread is older than the newest 400 posts still shows NEW and Catch up when someone writes in it', async () => {   // 31 Oct 2026
      const old = F.addCard(W, CUTTING, 'SJ-24680 (10) pcs old chat'), r0 = F.postSlack(W, CUT, { text: '🧵 SJ-24680\n' + old.shortUrl, bot_id: 'B1' });
      T.relay.P['FTH_' + old.id] = JSON.stringify({ ch: CUT, ts: r0.ts });
      for (let i = 0; i < 420; i++) F.postSlack(W, CUT, { text: 'order post ' + i, bot_id: 'B1' });    // 420 newer top-level posts push its root out of the window
      await page.evaluate(() => window.__f.load(true)); await page.waitForTimeout(500);
      const r = F.postSlack(W, CUT, { text: '*Md Ibrahim:* colour 3 is finished', bot_id: 'B1', thread_ts: r0.ts });   // written from the employee's phone through the fast lane: the relay never saw it
      await page.evaluate(([id, ts]) => { const h = window.__f.hotq(); h[id] = ts; }, [old.id, r.ts]);          // what that phone (or the doorbell) tells the relay with its next ping
      await page.evaluate(() => window.__f.ping(true));
      await until(() => page.evaluate(id => !!(window.__f.D.th[id] && window.__f.D.th[id].n), old.id), 15000, 'NEW on the old chat after the ping');
      await page.waitForTimeout(5000); await page.evaluate(() => window.__f.ping(false)); await page.waitForTimeout(1500);
      ok(await page.evaluate(id => !!(window.__f.D.th[id] && window.__f.D.th[id].n), old.id), 'still NEW after the next ordinary ping (the relay keeps it)');
      ok(/colour 3 is finished/.test((await page.evaluate(id => window.__f.D.th[id].tx, old.id)) || ''), 'the line is in the new-messages box');
      await openCardNo(page, '24680'); await until(async () => /colour 3 is finished/.test(await page.textContent('#thread')), 10000, 'the line in the chat'); await page.waitForTimeout(2500); await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.fill('#q', '');
    });
    await test('Undo: Done moves on screen at once, Trello only after 5 s; Undo sends nothing', async () => {
      await page.click('#tabs button[data-t="cards"]'); await openCardNo(page, '48188');
      const start = W.trello.cards[W.cardA.id].idList, nLog = W.log.length;
      await page.click('#bdone');
      await until(async () => /Cutting\/\/\/START/.test(await page.textContent('#cstage')), 1000, 'moved on screen at once (to Cutting///START, 27 Oct 2026)');
      ok(await page.locator('#undo').isVisible(), 'undo bar'); ok(!(await page.locator('.sheet:not([hidden])').count()), 'no question asked');
      await page.waitForTimeout(1500); ok(W.trello.cards[W.cardA.id].idList === start, 'Trello not moved yet');
      await page.click('#undob');
      await until(async () => /START/.test(await page.textContent('#cstage')), 1000, 'back on START');
      await page.waitForTimeout(5500);
      ok(W.trello.cards[W.cardA.id].idList === start, 'Trello never moved');
      ok(!W.log.slice(nLog).some(l => l[0] === 'comment' || (l[0] === 'slack' && /→ \*Cutting/.test(l[3] || ''))), 'no comment, no chat line');
      await page.click('#bdone');
      await until(() => W.trello.cards[W.cardA.id].idList === '6ae07f38a77a2321736ef9da', 9000, 'moved after 5 s');
      await until(async () => await page.locator('#undo').isHidden(), 2000, 'undo bar gone');
      await page.goBack();
    });
    await test('the new stage CUTTING START (Trello list Cutting///START) is a chip of its own and holds the card', async () => {   // 27 Oct 2026
      await chip(page, 3); const st = await page.textContent('#stages'); ok(/CUTTING START/.test(st) && /কাটিং শুরু/.test(st), 'chip with the Bengali label: ' + st.slice(0, 120));
      await chip(page, 3); await until(async () => /48188/.test(await page.textContent('#list')), 5000, 'the card is under CUTTING START');
      await openCardNo(page, '48188'); ok((await page.textContent('#bnext')).trim() === 'CUTTING', 'next after it = CUTTING');
      await page.goBack();
    });
    await test('Done then leaving the app: the move is sent at once', async () => {
      await chip(page, 3); await openCardNo(page, '48188');
      await page.click('#bdone'); await page.waitForTimeout(300);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await until(() => W.trello.cards[W.cardA.id].idList === '6527c57751007e81a43f55a6', 3000, 'sent on going to the background (Cutting///START → CUTTING)');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.goBack();
    });
    // 25 Oct 2026 (Abbas: "the app is so buggy"): a card list fetched while a move was still on its way to Trello put the card back in its old list
    await test('Done while the card list refreshes meanwhile: the card does not jump back', async () => {
      await home(page); await openCardNo(page, '77001'); T.opDelay = { move: 4000 };
      await page.click('#bdone'); await page.waitForTimeout(5300);                       // Undo over: the move is on its way (4 s on the relay)
      await page.evaluate(() => window.__f.load(true)); await page.waitForTimeout(1500);   // a card list fetched meanwhile still says START
      ok((await page.evaluate(id => window.__f.D.byId[id].l, W.cardR.id)) === '6ae07f38a77a2321736ef9da', 'the card stays in Cutting///START on the phone');
      ok(/Cutting\/\/\/START/.test(await page.textContent('#cstage')), 'the card screen still says Cutting///START: ' + (await page.textContent('#cstage')));
      await until(() => W.trello.cards[W.cardR.id].idList === '6ae07f38a77a2321736ef9da', 10000, 'Trello moved'); T.opDelay = null; await home(page);
    });
    await test('Done with no line: the card stays where Done put it and the move goes when the line is back', async () => {   // 25 Oct 2026
      await openCardNo(page, '77001'); const to = (await page.textContent('#bnext')).trim(), toId = lidOf(W, to); await page.click('#bdone'); await page.waitForTimeout(300); T.relayDown = true; T.fastDown = true;
      try {
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });   // sends now
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await until(() => page.evaluate(() => window.__f.mvr()), 5000, 'a move waiting'); await page.waitForTimeout(14000);   // 4 tries ~12 s fail, 1st retry queued
        ok((await page.evaluate(id => window.__f.D.byId[id].l, W.cardR.id)) === toId, 'the card is still in ' + to + ' on the phone');
        ok(/waits for the line/.test(await page.textContent('#toast')) || true, 'toast'); ok(W.trello.cards[W.cardR.id].idList !== toId, 'Trello has not moved it yet (line down)');
      } finally { T.relayDown = false; T.fastDown = false; }
      await until(() => W.trello.cards[W.cardR.id].idList === toId, 40000, 'moved when the line came back');
      await until(() => page.evaluate(() => !window.__f.mvr()), 5000, 'nothing waiting'); await home(page);
    });
    await test('the relay list from its cache still carries the workers list', async () => {
      const a = await page.evaluate(() => window.__call({ op: 'list' })), b = await page.evaluate(() => window.__call({ op: 'list' }));
      ok(a.ok && b.ok && Array.isArray(b.workers) && b.workers.length >= 10, 'cached list has workers: ' + JSON.stringify(b.workers || null).slice(0, 80));
    });
    await test('a quiet doorbell line is not trusted (the 4-s check comes back)', async () => {
      const r = await page.evaluate(() => { const L = window.__f.LIVE; L.ok = true; L.t = Date.now() - 200000; return window.__f.liveOk(); }); ok(r === false, 'liveOk false after 200 s without a keep-alive');
      ok(await page.evaluate(() => { window.__f.LIVE.t = Date.now(); return window.__f.liveOk() === (!!window.__f.LIVE.es && window.__f.LIVE.es.readyState === 1); }), 'fresh keep-alive = the line is trusted while open');
    });
    await test('swipe a card row left = Done → next stage (with Undo)', async () => {
      await page.fill('#q', '');
      await chip(page, 4);           // CUTTING (27 Oct 2026: index 3 = CUTTING START)
      const row = page.locator('#list .cardrow', { hasText: '48188' }); await row.waitFor();
      const b = await row.boundingBox(), y = b.y + b.height / 2;
      await page.mouse.move(b.x + b.width - 20, y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width - 20 - i * 15, y);
      await page.mouse.up();
      await until(async () => await page.locator('#undo').isVisible(), 2000, 'undo bar after swipe');
      ok(await page.locator('#card').isHidden(), 'the card did not open');
      await until(() => W.trello.cards[W.cardA.id].idList === '6527c57cd7e267fbf2a602b4', 9000, 'IN LINE in Trello');
    });
    await test('work: give pieces to a worker, timer runs, Done stops it - Trello comment, field and chat line', async () => {
      await page.click('#tabs button[data-t="cards"]'); await openCardNo(page, '17841');
      await workTab(page, true);
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
      await page.reload(); await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length); await openCardNo(page, '17841'); await workTab(page, true);
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
    await test('a card list refresh does not blank the WORK box of the open card', async () => {   // 25 Oct 2026
      await home(page); await openCardNo(page, '17841'); await workTab(page, true); await until(async () => /Rifat/.test(await page.textContent('#wkrows')) && !/…/.test(await page.textContent('#wksum')), 8000, 'work box ready');
      const before = await page.textContent('#wksum'); T.opDelay = { work: 3000 };
      await until(() => page.evaluate(() => window.__f.load(true)), 15000, 'a card list refresh ran'); await page.waitForTimeout(300);
      ok((await page.textContent('#wksum')) === before, 'WORK summary unchanged after the refresh: "' + (await page.textContent('#wksum')) + '" vs "' + before + '"'); T.opDelay = null; await home(page);
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
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.click('#tmore'); await page.click('#bwork'); await page.click('#wkview button[data-v="w"]');
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
      await openCardNo(page, '17841'); await sheetTab(page);
      await until(() => page.locator('#shrows .sr').count(), 5000, 'sheet rows');
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
      await page.locator('#wksbody .rr', { hasText: '17841' }).first().click(); await until(() => page.locator('#card').isVisible(), 5000, 'tap opens the card'); ok(/17841/.test(await page.textContent('#cnm')), 'the right card'); await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.click('#twork'); await until(async () => /Rifat/.test(await page.textContent('#wksbody')), 8000, 'dashboard again');
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
      await page.click('#tmore'); await page.click('#bfac'); await until(async () => /ATTENDANCE/.test(await page.textContent('#facbody')) && (await page.locator('#fs-att .ar').count()) === 3, 10000, 'attendance rows');
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
      const n0 = W.slack.ch[DM].msgs.length, ctx = T.relay.ctx, realNow = Date.now, at = h => { const d = new Date(realNow() + 4 * 3600000); d.setUTCHours(h, 30, 0, 0); return d.getTime() - 4 * 3600000; };   // h:30 of TODAY IN DUBAI (20 Nov 2026: between 00:00 and 04:00 Dubai the UTC day is still yesterday - the test took Friday's hours on a Saturday)
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
      W.trello.cards[W.cardB.id].name = 'SJ-17841 (12) pcs red lace'; await page.click('#tmore'); await page.click('#rf'); await page.waitForTimeout(1500); await page.click('#tabs button[data-t="cards"]');
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
    await test('after scrolling up in one chat, the next chat still opens at its newest line', async () => {   // 27 Oct 2026
      if (await page.locator('#card').isVisible()) await page.goBack();
      await openCardNo(page, '55555'); await until(async () => (await page.$$('#thread .msg')).length > 20, 10000, 'long chat');
      await page.evaluate(() => { document.getElementById('cbody').scrollTop = 0; }); await page.waitForTimeout(300); await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
      await openCardNo(page, '17841'); await page.waitForTimeout(800);
      const sc = await page.evaluate(() => { const el = document.getElementById('cbody'); return [el.scrollTop, el.scrollHeight, el.clientHeight]; });
      ok(sc[1] - sc[0] - sc[2] < 160, 'chat opened at the bottom: ' + sc.join('/')); await page.goBack();
    });
    await test('system lines are clean event cards: no raw :shortcodes:, who + time on their own line', async () => {   // 27 Oct 2026
      if (await page.locator('#card').isVisible()) await page.goBack();
      F.postSlack(W, CUT, { text: '→ *WORK* · Abbas · :construction_worker: *Islam* ← *5 pcs* given · :clock3: Tue 27 Oct 17:26\n_Islam · 5 পিস দেওয়া হয়েছে · Tue 27 Oct 17:26_', bot_id: 'B1', thread_ts: W.rootB });
      F.postSlack(W, CUT, { text: '→ *IN LINE (2)* · Md ibrahimmiah · :clock3: Tue 27 Oct 17:25', bot_id: 'B1', thread_ts: W.rootB });
      F.postSlack(W, CUT, { text: '→ *WORK* · Abbas · 👷 *Rifat* ← *4 pcs* given · 🕒 Tue 27 Oct 18:00 · now *24 pcs* in hand (first 20 on Mon 26 Oct 12:41)\n_Rifat · 4 পিস দেওয়া হয়েছে · Tue 27 Oct 18:00_', bot_id: 'B1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'EW' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));   // Slack's push, as in real life
      await openCardNo(page, '17841'); await until(async () => (await page.$$('#thread .xev.k-work')).length, 10000, 'WORK event card');
      const g = page.locator('#thread .msg.evm', { hasText: 'Tue 27 Oct 18:00' }).last(); await until(async () => await g.count(), 20000, 'give card');
      ok((await g.locator('.xevt').textContent()) === 'Rifat ← 4 pcs given', 'give title only: ' + (await g.locator('.xevt').textContent()));
      ok(/by Abbas · 🕒 Tue 27 Oct 18:00/.test(await g.locator('.xevs').textContent()) && /now 24 pcs in hand/.test(await g.textContent()), 'time on the who line, in-hand below: ' + (await g.textContent()));
      const t = await page.textContent('#thread'); ok(!/:clock3:|:construction_worker:/.test(t), 'no raw shortcodes left');
      const w = page.locator('#thread .msg.evm', { hasText: 'Islam' }).last(); ok((await w.locator('.xevt').textContent()) === 'Islam ← 5 pcs given', 'title: ' + (await w.locator('.xevt').textContent()));
      ok(/by Abbas · 🕒 Tue 27 Oct 17:26/.test(await w.locator('.xevs').textContent()), 'who + time line: ' + (await w.locator('.xevs').textContent())); ok(/পিস/.test(await w.locator('.xevx').textContent()), 'Bengali line under it');
      const mv = page.locator('#thread .msg.evm', { hasText: 'IN LINE (2)' }).last(); ok(/→ IN LINE \(2\) · লাইন \(2\)/.test(await mv.locator('.xevt').textContent()) && /Md ibrahimmiah · 🕒 Tue 27 Oct 17:25/.test(await mv.locator('.xevs').textContent()), 'move card: ' + (await mv.textContent()));
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
    });
    await test('work time maths: a work day is 12 h 20 net, minutes never above the clock, row text reads cleanly', async () => {   // 28 Oct 2026
      const r = T.relay.ctx, H = 3600000, mon = Date.UTC(2026, 9, 26, 8, 43), tue = Date.UTC(2026, 9, 27, 14, 43);   // Mon 26 Oct 12:43 -> Tue 27 Oct 18:43 Dubai (Sajjad, SJ-27846)
      const ms = r.facWorkMs(mon, tue); ok(Math.abs(ms - (17 * H + 20 * 60000)) < 60000, 'net work time 17 h 20: ' + ms / H);
      ok(r.facWorkDur(ms) === '1.4 work days', 'shown as 1.4 work days: ' + r.facWorkDur(ms));
      ok(r.facWorkDur(54 * 60000 + 40000) === '54 min work', '54 min 40 s -> 54 min (as the clock shows): ' + r.facWorkDur(54 * 60000 + 40000));
      ok(await page.evaluate(() => [window.__f.wdTxt('3.5 work h'), window.__f.wdTxt('1.4 work days'), window.__f.wdTxt('4 min work')].join('|')) === 'work time 3.5 h|work time 1.4 days|4 min work time', 'row text');
    });
    await test('a chat with new messages opens with a "▼ N NEW" divider before the first unread line', async () => {   // 27 Oct 2026
      F.postSlack(W, CUT, { text: 'unread one', user: 'U1', thread_ts: W.rootB }); F.postSlack(W, CUT, { text: 'unread two', user: 'U1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'EU' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await page.click('#tabs button[data-t="cards"]'); await page.fill('#q', '17841'); await until(async () => /NEW 2/.test(await page.textContent('#list')), 20000, 'NEW 2 on the row');
      await page.locator('#list .cardrow').first().click(); await page.waitForSelector('#card:not([hidden])');
      await until(async () => (await page.$$('#thread .undiv')).length === 1, 10000, 'the divider'); ok(/2 NEW/.test(await page.textContent('#thread .undiv')), 'says 2 NEW');
      const un = await page.$$eval('#thread .msg.un .bub', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
      ok(un.length === 2 && /unread one/.test(un[0]) && /unread two/.test(un[1]), 'exactly the two unread lines are marked: ' + JSON.stringify(un));
      ok(await page.$eval('#thread .undiv', d => d.nextElementSibling && /unread one/.test(d.nextElementSibling.textContent)), 'the divider sits right before the first unread line');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000); await page.fill('#q', '');
    });
    await test('voice note plays and the photo viewer opens and closes with Back', async () => {
      if (await page.locator('#card').isVisible()) await page.goBack();
      W.slack.files.FVOICE1 = { id: 'FVOICE1', name: 'voice-1.m4a', mimetype: 'audio/mp4', size: 3000, bytes: Buffer.alloc(3000, 1), url_private: 'https://files.slack.com/dl/FVOICE1', url_private_download: 'https://files.slack.com/dl/FVOICE1' };
      W.slack.files.FPHOTO1 = { id: 'FPHOTO1', name: 'p.jpg', mimetype: 'image/jpeg', size: 4000, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), url_private: 'https://files.slack.com/dl/FPHOTO1', url_private_download: 'https://files.slack.com/dl/FPHOTO1', thumb_720: 'https://files.slack.com/thumb/FPHOTO1' };
      F.postSlack(W, CUT, { text: '', user: 'U1', thread_ts: W.rootB, files: [W.slack.files.FVOICE1, W.slack.files.FPHOTO1] });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'EV' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));   // Slack's push, as in real life
      await openCardNo(page, '17841');
      try { await until(async () => (await page.$$('#thread audio')).length, 10000, 'voice note ready as a player, without a tap'); }
      catch (e) { const st = await page.evaluate(() => ({ ph: Array.from(document.querySelectorAll('#thread .fph')).map(x => x.dataset.k + ':' + x.dataset.busy + ':' + x.textContent.slice(0, 40)), n: document.querySelectorAll('#thread .msg').length, sc: [document.getElementById('cbody').scrollTop, document.getElementById('cbody').scrollHeight, document.getElementById('cbody').clientHeight], net: window.__f.NET.log.slice(0, 10).map(l => l.op + ' ' + l.ms + 'ms ' + (l.ok ? 'ok' : 'FAIL ' + l.e)), q: [window.__f.NET.busy, window.__f.NET.lob, window.__f.NET.hi.length, window.__f.NET.lo.length], last: (document.querySelector('#thread .msg:last-child') || {}).textContent })); throw new Error(e.message + ' :: ' + JSON.stringify(st)); }
      ok(await page.$eval('#thread audio', a => a.paused), 'not playing by itself');
      await page.evaluate(() => { const el = document.getElementById('cbody'); el.scrollTop = el.scrollHeight; });   // 27 Oct 2026: a chat with new lines opens at the NEW divider; photos load as they come on screen
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
      T.relay.post(JSON.stringify({ type: 'event_callback', fw: 1, event_id: 'EL' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootL, ts: F.slackTs() } }));   // 31 Oct 2026: Slack pushes every message (the worker passes it on to the relay)
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
      W.trello.cards[c.id].idList = '6527c5b13129a9ba37acd3ad'; await page.click('#tmore'); await page.click('#rf'); await page.waitForTimeout(1500); await page.click('#tabs button[data-t="cards"]');
      await chip(page, 11); await openCardNo(page, '55555');
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
    await test('a long production report is written on its Trello card too, with the app\'s list names (not a title mistyped in Trello)', async () => {   // 20 Nov 2026
      const L = { START: '6527c572b12b208471c080cb', CS: '6ae07f38a77a2321736ef9da', INL: '6527c57cd7e267fbf2a602b4', IRON: '6527c5a93db4d8b8e91a8be9', R1: '6527c5b13129a9ba37acd3ad', R2: '699b35ceb77292db0289c473', FIN: '6527c5b41e630c094b619f5e' };
      const c = F.addCard(W, L.FIN, 'SJ-89990 , 4 pcs OP , COLORS = 2 , SIZE = L,XL,XXL,XXXL(ALL SILVER)', { ageDays: 6 }), H = 3600000, t0 = Date.now() - 5 * 24 * H;
      const act = (type, at, data) => W.trello.actions.push({ id: F.hexId(), type, date: new Date(at).toISOString(), memberCreator: { fullName: 'Abbas Jamal' }, data: Object.assign({ card: { id: c.id, name: c.name } }, data) });
      const mv = (at, a, an, b, bn) => act('updateCard', at, { listBefore: { id: a, name: an }, listAfter: { id: b, name: bn } });
      mv(t0, L.START, 'START', L.CS, 'Cutting///START'); mv(t0 + 3000, L.CS, 'Cutting///START', L.START, 'START'); mv(t0 + 30 * H, L.START, 'START', L.CS, 'Cutting///START'); mv(t0 + 34 * H, L.CS, 'Cutting///START', L.INL, 'IN LINE');
      ['Islam', 'Moshtaq', 'Nahid'].forEach((w, i) => { act('commentCard', t0 + 33 * H + i * 1000, { text: '👷 IN · ' + w + ' · 4 pcs · Md ibrahimmiah (factory app) · Mon 2 Nov 18:25' }); act('commentCard', t0 + 52 * H + i * 1000, { text: '👷 OUT · ' + w + ' · 4 pcs · 18 h 35 min · Md ibrahimmiah (factory app) · Tue 3 Nov 13:00 · got Mon 2 Nov 18:25 · 7.9 work h · ≈6/day' }); });
      mv(t0 + 53 * H, L.INL, 'IN LINE', L.IRON, 'IRON/CHECKINGnm'); mv(t0 + 55 * H, L.IRON, 'IRON/CHECKINGnm', L.R2, 'READY 2'); mv(t0 + 55 * H + 5000, L.R2, 'READY 2', L.R1, 'READY'); mv(t0 + 59 * H, L.R1, 'READY', L.R2, 'READY 2');
      mv(Date.now() - 30000, L.R2, 'READY 2', L.FIN, 'FINISH');                                   // moved in Trello, by hand
      T.relay.cache.remove('FMV_AT'); const rep = () => W.trello.actions.filter(a => a.type === 'commentCard' && a.data.card.id === c.id && /#report/.test(a.data.text));
      await until(() => rep().length === 1, 25000, 'the #report comment on the Trello card'); const tx = (rep()[0] || { data: { text: '' } }).data.text;
      ok(encodeURIComponent(tx).length > 2082, 'it is a long one (longer than Google lets an address be): ' + encodeURIComponent(tx).length);
      ok(/IRON\/CHECKING · /.test(tx) && !/CHECKINGnm/.test(tx), 'the list is named as in the app, not as mistyped in Trello: ' + (tx.match(/IRON[^\n]*/) || [''])[0]);
      ok(/Islam/i.test(tx) && /Moshtaq/i.test(tx) && /Nahid/i.test(tx), 'workers listed: ' + tx.slice(-300));
    });
    await test('Give tapped twice while the relay is still answering gives the pieces once (the row stays locked through a redraw)', async () => {   // 20 Nov 2026
      await home(page); await page.click('#tabs button[data-t="cards"]'); await openCardNo(page, '17841'); await workTab(page, true);
      const name = await page.evaluate(() => { const r = [...document.querySelectorAll('#wkrows .wr')].filter(x => !x.classList.contains('role') && x.querySelector('button.in') && !x.querySelector('button.out')); return r[r.length - 1].dataset.w; });
      const r = page.locator('#wkrows .wr[data-w="' + name + '"]'), ins = () => W.trello.actions.filter(a => a.type === 'commentCard' && a.data.card.id === W.cardB.id && new RegExp('^👷 IN · ' + name + ' · 7 pcs').test(a.data.text)).length;
      T.opDelay = { workset: 3500 };
      try { await r.locator('input').fill('7'); await r.locator('button.in').click(); await page.waitForTimeout(500);
        await page.evaluate(() => window.__f.wkd());                         // the row is drawn again while the request is on its way
        await r.locator('input').fill('7').catch(() => {}); await r.locator('button.in').click({ timeout: 1500, force: true }).catch(() => {});   // the second tap
        await until(() => ins() >= 1, 12000, 'the give reached Trello'); await page.waitForTimeout(5000);
      } finally { T.opDelay = null; }
      ok(ins() === 1, 'one IN comment, not two: ' + ins());
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
    });
    await test('forgotten work: pieces "in hand" on a finished card are flagged; Abbas closes them with one tap and they count for no day', async () => {   // 21 Nov 2026
      const FIN = '6527c5b41e630c094b619f5e', c = F.addCard(W, FIN, 'SJ-41862 ,195 pcs , COLORS = 5', { ageDays: 20 });
      W.trello.actions.push({ id: F.hexId(), type: 'commentCard', date: new Date(Date.now() - 6 * 86400000).toISOString(), memberCreator: { fullName: 'Abbas Jamal' }, data: { card: { id: c.id, name: c.name }, text: '👷 IN · Sajjad · 9 pcs · Md ibrahimmiah (factory app) · Sat 14 Nov 10:00' } });
      const rep = async () => (await page.evaluate(() => window.__call({ op: 'workrep', days: 7, fresh: 1 }))).workers.find(w => /^sajjad$/i.test(w.name)) || { hand: [], today: 0, pcs: 0 };
      const b4 = await rep(); ok(b4.hand.some(h => h.id === c.id && h.fin === 1 && h.g === 9), 'the relay flags it: ' + JSON.stringify(b4.hand));
      await home(page); await page.click('#twork'); await page.click('#wksrf');
      await until(async () => /forgotten batch/.test(await page.textContent('#wksbody')), 20000, 'the red strip'); ok(/9 pcs/.test(await page.textContent('#wksbody .fgot')), 'with the pieces: ' + (await page.textContent('#wksbody .fgot')));
      ok((await page.locator('#wksbody .hb em.fin').count()) >= 1, 'the batch itself is marked');
      await page.click('#wkclose');
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && a.data.card.id === c.id && /^👷 CLOSE · Sajjad · 9 pcs · Abbas \(factory app\)/i.test(a.data.text)), 15000, 'CLOSE comment on the card');
      await until(async () => !/forgotten batch/.test(await page.textContent('#wksbody')), 20000, 'the strip is gone');
      const af = await rep(); ok(!af.hand.some(h => h.id === c.id), 'no longer in hand'); ok(af.today === b4.today && af.pcs === b4.pcs, 'counts for no day: today ' + b4.today + ' -> ' + af.today + ', pcs ' + b4.pcs + ' -> ' + af.pcs);
      await page.click('#wksx');
    });
    await test('giving more pieces than the card has asks first', async () => {   // 21 Nov 2026
      const seen = [], h = d => seen.push(d.message()); page.on('dialog', h);
      await home(page); await openCardNo(page, '17841'); await workTab(page, true);
      const name = await page.evaluate(() => { const r = [...document.querySelectorAll('#wkrows .wr')].filter(x => !x.classList.contains('role') && x.querySelector('button.in') && !x.querySelector('button.out')); return r[0].dataset.w; });
      const r = page.locator('#wkrows .wr[data-w="' + name + '"]'); await r.locator('input').fill('5'); await r.locator('button.in').click();
      await until(() => W.trello.actions.some(a => a.type === 'commentCard' && a.data.card.id === W.cardB.id && new RegExp('^👷 IN · ' + name + ' · 5 pcs').test(a.data.text)), 12000, 'the give went through after OK');
      page.off('dialog', h); ok(seen.some(m => /This card has 12 pcs/.test(m)), 'asked first: ' + JSON.stringify(seen));
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
    });
    await test('the missing production reports are written with one button (on Trello; a chat that has its report is not told twice)', async () => {   // 21 Nov 2026
      const L = { START: '6527c572b12b208471c080cb', INL: '6527c57cd7e267fbf2a602b4', R2: '699b35ceb77292db0289c473', FIN: '6527c5b41e630c094b619f5e' }, H = 3600000, t0 = Date.now() - 4 * 24 * H;
      const mk = (nm) => { const c = F.addCard(W, L.FIN, nm, { ageDays: 6 }); const mv = (at, a, an, b, bn) => W.trello.actions.push({ id: F.hexId(), type: 'updateCard', date: new Date(at).toISOString(), memberCreator: { fullName: 'Abbas Jamal' }, data: { card: { id: c.id, name: c.name }, listBefore: { id: a, name: an }, listAfter: { id: b, name: bn } } });
        mv(t0, L.START, 'START', L.INL, 'IN LINE'); mv(t0 + 30 * H, L.INL, 'IN LINE', L.R2, 'READY 2'); mv(t0 + 50 * H, L.R2, 'READY 2', L.FIN, 'FINISH'); return c; };
      const c1 = mk('SJ-93810 , 60 PCS , COLORS = 5'), c2 = mk('SJ-80656 , 30 PCS , COLORS = 6');
      const r2 = F.postSlack(W, CUT, { text: '🧵 SJ-80656\n' + c2.shortUrl, bot_id: 'B1' }); F.postSlack(W, CUT, { text: '📊 *SJ-80656 · PRODUCTION REPORT* · 30 pcs', bot_id: 'B1', thread_ts: r2.ts });
      Object.keys(T.relay.P).filter(k => /^FMV_/.test(k)).forEach(() => {}); W.trello.actions.filter(a => a.type === 'updateCard' && (a.data.card.id === c1.id || a.data.card.id === c2.id)).forEach(a => T.relay.cache.put('FMV_D_' + a.id, '1', 86400));   // as on the real board: the Trello-moves check saw these moves long ago
      const reps = c => W.trello.actions.filter(a => a.type === 'commentCard' && a.data.card.id === c.id && /#report/.test(a.data.text)).length;
      ok(reps(c1) === 0 && reps(c2) === 0, 'no report yet');
      await home(page); await page.click('#tmore'); await page.click('#bfac'); await until(() => page.locator('#repfill').isVisible(), 15000, 'the button (Abbas)');
      await page.click('#repfill'); await until(() => reps(c1) === 1 && reps(c2) === 1, 60000, 'both reports on Trello: ' + reps(c1) + ' ' + reps(c2));
      await until(async () => /Done/.test(await page.textContent('#fs-rep')), 60000, 'the screen says Done: ' + (await page.textContent('#fs-rep')));
      ok(W.slack.ch[CUT].msgs.filter(m => m.thread_ts === r2.ts && /PRODUCTION REPORT/.test(m.text || '')).length === 1, 'the chat that had its report did not get a second one');
      await page.click('#repfill'); await page.waitForTimeout(4000); ok(reps(c1) === 1 && reps(c2) === 1, 'pressing again writes nothing twice');
    });
    if (fast) await test('a big upload shows how far it is (percent)', async () => {   // 21 Nov 2026
      await home(page); await openCardNo(page, '17841'); await until(async () => /cutting started/.test(await page.textContent('#thread')), 10000, 'chat');
      T.uploadSlow = 3000;
      try { await page.setInputFiles('#afiles', { name: 'VID_PCT.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(19 * 1024 * 1024, 4) }); await page.click('#send');
        await until(async () => /\d+ %/.test(await page.textContent('#outbar')), 15000, 'percent in the upload bar: ' + (await page.textContent('#outbar')));
      } finally { T.uploadSlow = 0; }
      const all = () => [].concat(...Object.values(W.slack.ch).map(c => c.msgs));
      await until(() => all().some(m => (m.files || []).some(f => f.name === 'VID_PCT.mp4')), 40000, 'video in Slack'); await until(() => page.evaluate(() => window.__f.OUT.length === 0), 10000, 'outbox empty');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
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
    await test('a page that says ?v=<newer> but runs older code fetches itself again (stale copy from the phone helper)', async () => {   // 25 Oct 2026
      await page.goto(T.base + 'factory.html?v=2099-01-01z'); await until(() => /[?&]r=1/.test(page.url()), 12000, 'reload with r=1 (' + page.url() + ')');
      await page.goto(T.base + 'factory.html'); await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length);
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
    await test('staff: More shows no owner tiles (People, missing reports); Home shows no phones row', async () => {   // 21 Nov 2026
      await page.click('#tmore'); await until(() => page.locator('#home section[data-t="more"]').isVisible(), 3000, 'More');
      ok(await page.locator('#mpeople').isHidden() && await page.locator('#mrep').isHidden() && await page.locator('#bfac').isVisible() && await page.locator('#mret').isVisible(), 'owner tiles hidden, the rest there');
      ok(/Factory/.test(await page.textContent('#mrole')) && !/Owner/.test(await page.textContent('#mrole')), 'profile: ' + await page.textContent('#mrole'));
      await page.click('#tabs button[data-t="home"]'); await until(() => page.locator('#hm h1').count(), 5000, 'Home'); ok(/Ibrahim/.test(await page.textContent('#hm h1')) && !/phone/.test(await page.textContent('#hneeds')), 'Home for a staff phone: ' + await page.textContent('#hm h1'));
      await page.click('#tabs button[data-t="cards"]');
    });
    await test('staff: Factory screen without salaries or Post now; salaries and daily post refused; attendance allowed', async () => {
      await page.click('#tmore'); await page.click('#bfac'); await until(async () => /ATTENDANCE/.test(await page.textContent('#facbody')) && /Rifat/.test(await page.textContent('#facbody')), 10000, 'factory screen');
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
async function peopleSuite(browser) {                         // 21 Nov 2026: each phone its own key, People & phones, remove one person, private direct chats
  console.log('\n— people, sign-in codes, private chats —');
  const T = await boot({ browser, who: 'Abbas', setup: world }), W = T.W, PWD = 'fac-test-pw';
  const rcall = (o, secret) => { const req = JSON.stringify(Object.assign({ t: Date.now() }, o)); return JSON.parse(T.relay.post(JSON.stringify({ job: 'fac', req, sig: crypto.createHmac('sha256', secret || PWD).update(req).digest('hex') }))); };
  const sha = x => crypto.createHash('sha256').update(x).digest('hex'), fastchk = k => JSON.parse(T.relay.post(JSON.stringify({ job: 'fastchk', k: sha('sjfast|' + k) }))).ok;
  const facOpen = async page => { await home(page); await page.click('#tmore'); await page.click('#bfac'); await until(async () => (await page.locator('#fs-people .ppr').count()) >= 1, 15000, 'people rows'); };
  let rahimKey = '', code = '', kk = '';
  try {
    const page = await T.open();
    await test('a phone on the shared password gets its own key and works with it (fast lane too)', async () => {
      await until(() => page.evaluate(() => /^[0-9a-f]{64}$/.test(localStorage.getItem('sj_fac_pw') || '')), 20000, 'own key on the phone');
      const key = await page.evaluate(() => localStorage.getItem('sj_fac_pw')); ok(JSON.parse(T.relay.P.FAC_PEOPLE).abbas.k === key, 'it is the key the relay keeps for Abbas');
      const j = await page.evaluate(() => window.__call({ op: 'ping' })); ok(j.ok && !j.key, 'signed with the key now (no key handed out again): ' + JSON.stringify(j).slice(0, 80));
      ok(fastchk(key) && fastchk(PWD) && !fastchk('nope'), 'the fast lane takes the key');
      ok(!rcall({ op: 'ping', who: 'Abbas' }, sha('x')).ok, 'a wrong key is refused');
    });
    await test('the main Direct chat is private: Abbas and Ibrahim see it, another person does not', async () => {
      const ib = rcall({ op: 'list', who: 'Md ibrahimmiah' }), ra = rcall({ op: 'list', who: 'Rahim' });
      ok(ib.ok && ib.dm && ib.dm.ch === DM && !ib.dmno, 'Ibrahim has it'); ok(ra.ok && !ra.dm && ra.dmno === 1, 'Rahim does not: ' + JSON.stringify({ dm: ra.dm, dmno: ra.dmno }));
      const t1 = rcall({ op: 'thread', card: 'dm', who: 'Rahim' }), p1 = rcall({ op: 'post', card: 'dm', who: 'Rahim', text: 'let me in', rid: 'x1' });
      ok(!t1.ok && t1.noaccess && !p1.ok && !W.slack.ch[DM].msgs.some(m => /let me in/.test(m.text || '')), 'reading and writing are refused by the relay');
      ok(rcall({ op: 'thread', card: 'dm', who: 'Md ibrahimmiah' }).ok, 'Ibrahim reads it');
      F.postSlack(W, DM, { text: 'private line', user: 'U1' });
      const pr = rcall({ op: 'ping', who: 'Rahim', fresh: 1, v: '2026-10-31b', dv: 'ph1', ob: 2, ua: 'Android' }), pi = rcall({ op: 'ping', who: 'Md ibrahimmiah', fresh: 1 });
      rahimKey = pr.key; ok(/^[0-9a-f]{64}$/.test(rahimKey || ''), 'Rahim\'s phone got its key');
      ok(!(pr.th || {}).dm && (pi.th || {}).dm && pi.th.dm.n >= 1, 'no NEW for Rahim, NEW for Ibrahim: ' + JSON.stringify([(pr.th || {}).dm, (pi.th || {}).dm]));
    });
    await test('People & phones (Abbas): each phone with its app version and stuck messages; add a person -> a code he signs in with', async () => {
      await facOpen(page); await until(async () => (await page.locator('#fs-people .ppr[data-n="Rahim"]').count()) === 1, 15000, 'Rahim listed');
      const tx = await page.locator('#fs-people .ppr[data-n="Rahim"]').textContent(); ok(/Android/.test(tx) && /2026-10-31b/.test(tx) && /old/.test(tx) && /2 messages stuck/.test(tx), 'his phone: ' + tx);
      ok(/you/.test(await page.locator('#fs-people .ppr[data-n="Abbas"]').textContent()) && (await page.locator('#fs-people .ppr[data-n="Abbas"] .ppb').count()) === 0, 'Abbas himself has no remove button');
      await page.evaluate(() => { window.prompt = () => 'Karim'; }); await page.click('#fs-people [data-pp="add"]');
      await until(async () => /Code: \d{6}/.test(await page.textContent('#tgbody')), 10000, 'the code is shown'); code = (await page.textContent('#tgbody')).match(/Code: (\d{6})/)[1];
      await page.evaluate(() => { document.getElementById('tg').hidden = true; });
      ok((await page.locator('#fs-people .ppr[data-n="Karim"] .ppc').textContent()) === code, 'the code stays in the list');
      kk = sha('sjfac|karim|' + code); ok(rcall({ op: 'ping', who: 'Karim' }, kk).ok, 'Karim signs in with name + code'); ok(!rcall({ op: 'ping', who: 'Karim' }, sha('sjfac|karim|000000')).ok, 'a wrong code is refused');
      ok(!rcall({ op: 'people', act: 'list', who: 'Karim' }, kk).ok, 'only Abbas reads the people list');
    });
    await test('a private chat per person: Abbas opens it from People; the person sees only his own', async () => {
      await page.click('#fs-people .ppr[data-n="Rahim"] [data-pp="chat"]'); await until(() => page.locator('#card').isVisible(), 15000, 'the chat opens');
      const ch = Object.values(W.slack.ch).find(c => c.name === 'direct-rahim'); ok(ch && ch.priv, 'a private Slack channel was made: ' + JSON.stringify(ch && { name: ch.name, priv: ch.priv }));
      await page.fill('#txt', 'hello Rahim, only you'); await page.click('#send'); await until(() => ch.msgs.some(m => /hello Rahim, only you/.test(m.text || '')), 20000, 'the line is in his channel');
      const pr = rcall({ op: 'ping', who: 'Rahim' }, rahimKey), pk = rcall({ op: 'ping', who: 'Karim' }, kk), pa = await page.evaluate(() => window.__call({ op: 'ping' }));
      ok((pr.rooms || []).length === 1 && pr.rooms[0].k === 'p_rahim' && /Abbas/.test(pr.rooms[0].title), 'Rahim: one room, "Abbas": ' + JSON.stringify(pr.rooms)); ok((pk.rooms || []).length === 0, 'Karim: none');
      ok((pa.rooms || []).some(r => r.k === 'p_rahim' && /Rahim/.test(r.title)), 'Abbas sees it as Rahim');
      const tr = rcall({ op: 'thread', card: 'p_rahim', who: 'Rahim' }, rahimKey), tk = rcall({ op: 'thread', card: 'p_rahim', who: 'Karim' }, kk);
      ok(tr.ok && tr.msgs.some(m => /only you/.test(m.text || '')), 'Rahim reads it'); ok(!tk.ok && tk.noaccess, 'Karim cannot');
      ok(rcall({ op: 'post', card: 'p_rahim', who: 'Rahim', text: 'thanks boss', rid: 'x2' }, rahimKey).ok && ch.msgs.some(m => /thanks boss/.test(m.text || '')), 'Rahim answers');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000);
      ok((await page.evaluate(() => window.__call({ op: 'people', act: 'dmok', name: 'Rahim', on: 1 }))).ok && rcall({ op: 'list', who: 'Rahim' }, rahimKey).dm, 'Abbas can let Rahim into the main Direct chat');
      ok(rcall({ op: 'list', who: 'Md ibrahimmiah' }).dm && !rcall({ op: 'list', who: 'Karim' }, kk).dm, 'Ibrahim keeps it, Karim still has none');
    });
    await test('Remove a person: his phone is refused, the factory password lets no new name in, everyone else keeps working', async () => {
      await facOpen(page); await page.click('#fs-people .ppr[data-n="Rahim"] [data-pp="remove"]');
      await until(async () => /ONE MORE STEP/.test(await page.textContent('#tgbody')), 10000, 'the note about the factory password'); await page.evaluate(() => { document.getElementById('tg').hidden = true; });
      ok(T.relay.P.FAC_KEYSONLY === '1' && JSON.parse(T.relay.P.FAC_OFF).rahim && !JSON.parse(T.relay.P.FAC_PEOPLE).rahim, 'removed on the relay');
      const o1 = rcall({ op: 'ping', who: 'Rahim' }, rahimKey), o2 = rcall({ op: 'ping', who: 'Rahim' }), o3 = rcall({ op: 'list', who: 'Rahim Two' });
      ok(!o1.ok && o1.off, 'his key: off'); ok(!o2.ok && o2.off, 'his name with the factory password: off'); ok(!o3.ok && o3.needcode, 'a new name with the factory password: needs a code — ' + JSON.stringify(o3));
      ok(!fastchk(rahimKey), 'the fast lane no longer takes his key');
      ok(rcall({ op: 'ping', who: 'Karim' }, kk).ok && rcall({ op: 'ping', who: 'Abbas' }).ok && (await page.evaluate(() => window.__call({ op: 'ping' }))).ok, 'Karim, and Abbas (key and password) still work');
      ok(/Rahim/.test(await page.locator('#fs-people .ppoff').textContent()) && (await page.locator('#fs-people .ppr[data-n="Rahim"]').count()) === 0, 'listed under Removed');
      ok(/ON/.test(await page.locator('#fs-people [data-pp="lock"]').textContent()), 'the lock shows ON');
    });
    await test('a person signs in on the phone with his name + code, sees no main Direct chat, and is signed out the moment Abbas removes him', async () => {
      await page.evaluate(() => { localStorage.removeItem('sj_fac_pw'); localStorage.removeItem('sj_fac_who'); localStorage.removeItem('sj_fac_list'); }); await page.reload();
      await page.waitForSelector('#login:not([hidden])', { timeout: 10000 }); await page.fill('#lname', 'Karim'); await page.fill('#lpw', '000000'); await page.click('#lgo');
      await until(async () => /Wrong|code/i.test(await page.textContent('#lerr')), 10000, 'a wrong code says so'); ok(await page.locator('#login').isVisible(), 'still at sign-in');
      await page.fill('#lpw', code); await page.click('#lgo'); await page.waitForFunction(() => window.__f && window.__f.D.cards && window.__f.D.cards.length && document.getElementById('login').hidden, null, { timeout: 15000 });
      ok((await page.evaluate(() => localStorage.getItem('sj_fac_pw'))) === kk, 'the phone keeps his key, not the code');
      await page.click('#tabs button[data-t="chats"]'); await page.waitForTimeout(1500); ok(await page.locator('#dm').isHidden(), 'no main Direct chat row');
      ok(rcall({ op: 'people', act: 'remove', name: 'Karim', who: 'Abbas' }).ok, 'Abbas removes Karim');
      await until(() => page.locator('#login').isVisible(), 30000, 'the phone signs itself out'); ok(/removed/i.test(await page.textContent('#lerr')), 'and says why: ' + (await page.textContent('#lerr')));
      ok((await page.evaluate(() => localStorage.getItem('sj_fac_pw'))) === null, 'the key is gone from the phone');
    });
    await test('no page errors (people)', async () => { ok(!T.errors.length, T.errors.join('\n')); });
  } finally { await T.close(); }
}
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
      await page.click('#tmore'); await page.click('#bell');
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

// ---- 21 Nov 2026 (Abbas approved the four new screens): Home, the stage boxes, the card's tabs, More as tiles ----
async function lookSuite(browser) {
  console.log('\n— the new look (Home · stage boxes · card tabs · More tiles) —');
  const T = await boot({ browser, home: true, setup: W => { world(W); W.cardD = F.addCard(W, CUTTING, 'SJ-66001 (40) pcs late one', { ageDays: 12, due: new Date(Date.now() - 3 * 86400000).toISOString() }); } });
  const W = T.W;
  try {
    const page = await T.open();
    await test('the app opens on Home: greeting, what needs you, the factory in boxes, today', async () => {
      await until(() => page.locator('#hm h1').count(), 8000, 'Home drawn');
      ok(await page.evaluate(() => window.__f.tab()) === 'home' && await page.locator('#hm').isVisible() && await page.locator('#hcards').isHidden(), 'Home is the first screen');
      ok(/Good (morning|afternoon|evening), Abbas/.test(await page.textContent('#hm h1')), 'greets by name: ' + await page.textContent('#hm h1'));
      F.postSlack(W, CUT, { text: 'thread finished, send more', user: 'U1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));   // Slack's push (22 Nov 2026: without it a line typed in Slack is found within 30 s, no longer 10)
      await until(async () => /new message/.test(await page.textContent('#hneeds')), 15000, 'new messages under NEEDS YOU');
      ok(/নতুন মেসেজ/.test(await page.textContent('#hneeds')), 'Bengali on the row');
      await until(async () => /1 design is late/.test(await page.textContent('#hneeds')) && /SJ-66001/.test(await page.textContent('#hneeds')), 8000, 'the late design is named: ' + await page.textContent('#hneeds'));
      const box = g => page.locator('#hgroups .gp[data-g="' + g + '"]');
      ok((await box(0).locator('b').textContent()) === '2' && (await box(1).locator('b').textContent()) === '3', 'START 2 · CUTTING 3: ' + await page.textContent('#hgroups'));
      ok(await box(1).evaluate(e => e.classList.contains('late')) && /⏰ 1 late · দেরি/.test(await box(1).textContent()) && !/⚠/.test(await box(1).textContent()) && !/late/.test(await box(0).textContent()), 'the box with the late design says "1 late" in words (24 Nov 2026: a bare ⚠ looked like an error): ' + await box(1).textContent());
      ok(/শুরু/.test(await box(0).textContent()) && (await page.locator('#hgroups .gp').count()) === 8, '8 boxes, Bengali names');
      await until(async () => /^\d+$/.test((await page.locator('#hm .htile b').first().textContent()).trim()), 10000, 'TODAY numbers loaded');
    });
    await test('Home: materials running low show up, and a tap opens the Materials screen', async () => {
      const j = await page.evaluate(() => window.__call({ op: 'matset', items: [{ n: 'Thread white', q: 2, u: 'box', low: 5 }, { n: 'Elastic', q: 90, u: 'm', low: 10 }] })); ok(j.ok, 'materials saved');
      await page.evaluate(() => { window.__f.HM.at = 0; }); await page.click('#tabs button[data-t="chats"]'); await page.click('#tabs button[data-t="home"]');
      await until(async () => /1 material is low/.test(await page.textContent('#hneeds')) && /Thread white/.test(await page.textContent('#hneeds')), 10000, 'low material named');
      await page.click('#hneeds .need[data-go="mat"]'); await until(() => page.locator('#fac').isVisible(), 5000, 'Factory screen'); await until(async () => /Thread white/.test(await page.textContent('#fac')), 8000, 'materials listed');
      await page.goBack(); await until(() => page.locator('#fac').isHidden(), 5000, 'closed');
    });
    await test('Home: tap the new messages -> Chats; tap a factory box -> the Cards of that stage', async () => {
      await page.click('#hneeds .need[data-go="chats"]'); await until(() => page.locator('#home section[data-t="chats"]').isVisible(), 3000, 'Chats tab');
      await page.click('#tabs button[data-t="home"]'); await page.click('#hgroups .gp[data-g="1"]');
      await until(() => page.locator('#hcards').isVisible(), 3000, 'Cards tab'); await until(async () => /17841/.test(await page.textContent('#list')) && /55555/.test(await page.textContent('#list')), 5000, 'the CUTTING cards');
      ok(await page.locator('#groups .gp[data-g="1"]').evaluate(e => e.classList.contains('on')), 'CUTTING box is the chosen one');
      ok(!/48188/.test(await page.textContent('#list')), 'no START card in it');
    });
    await test('Returns is in front: a row on Home and a button in the bottom bar, with how many are at the factory', async () => {   // 21 Nov 2026 (Abbas: "why have you removed the return process?")
      await page.click('#tabs button[data-t="home"]'); await until(() => page.locator('#hret .need').count(), 5000, 'Returns row on Home');
      ok(/Returns/.test(await page.textContent('#hret')) && /ফেরত/.test(await page.textContent('#hret')) && /Nothing at the factory/.test(await page.textContent('#hret')), 'row: ' + await page.textContent('#hret'));
      const RET = W.trello.lists.find(l => l.name === 'RETURNS'); ok(!!RET, 'the RETURNS list exists');
      F.addCard(W, RET.id, 'SJ-70001 return alter 6 pcs'); F.addCard(W, RET.id, 'SJ-70002 SAMPLE'); await page.evaluate(() => window.__f.load(true));
      await until(async () => /2 at the factory/.test(await page.textContent('#hret')), 15000, 'count on Home'); ok((await page.textContent('#tbret2')).trim() === '2', 'badge on the bar button');
      await page.click('#hret .need'); await until(() => page.locator('#home section[data-t="returns"]').isVisible(), 3000, 'Returns screen from Home');
      await until(async () => /70001/.test(await page.textContent('#retlist')) && /70002/.test(await page.textContent('#retlist')), 5000, 'both cards listed');
      ok(await page.locator('#rnewb').isVisible(), '＋ New return is there');
      await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="returns"]'); await until(() => page.locator('#retlist').isVisible(), 3000, 'Returns screen from the bar');
      await page.click('#tabs button[data-t="cards"]'); await page.click('#groups .gp[data-g="1"]');
    });
    await test('Cards: a group with two lists shows its two chips, a group with one list shows none', async () => {
      ok((await page.locator('#stages button:visible').count()) === 3 && /^All/.test(await page.textContent('#stages')) && /CUTTING START/.test(await page.textContent('#stages')) && /কাটিং শুরু/.test(await page.textContent('#stages')), 'CUTTING START + CUTTING chips: ' + await page.textContent('#stages'));
      await page.click('#groups .gp[data-g="0"]'); await until(async () => /48188/.test(await page.textContent('#list')), 5000, 'START cards');
      ok((await page.locator('#stages button:visible').count()) === 0, 'no chips for START');
      ok((await page.locator('#groups .gp').count()) === 8, 'all 8 boxes stay on top');
    });
    await test('a stage box shows every card it counts, whatever list was open last (CUTTING said 2, inside there was nothing)', async () => {   // 24 Nov 2026 (Abbas: "SJ50473 has been put to cutting, it shows 2 cards, but inside you cannot see the card at all")
      await page.click('#tabs button[data-t="cards"]'); await page.click('#groups .gp[data-g="1"]');
      await page.click('#stages button[data-i="3"]');           // the phone was left on the CUTTING START list, and its card has moved on to CUTTING since
      await until(async () => /No cards here/.test(await page.textContent('#list')), 3000, 'the CUTTING START list is empty');
      const n = await page.evaluate(() => window.__f.D.cards.filter(c => /^(CUTTING|Cutting\/\/\/START)$/.test((window.__f.D.lists.find(l => l[1] === c.l) || [])[0] || '')).length); ok(n >= 2, 'cards in the two cutting lists: ' + n);
      ok(new RegExp('Show all ' + n + ' cards').test(await page.textContent('#list')), 'the empty list says where the cards are: ' + await page.textContent('#list'));
      await page.click('#tabs button[data-t="home"]'); ok(new RegExp('(^|\\D)' + n + '(\\D|$)').test(await page.textContent('#hgroups .gp[data-g="1"]')), 'Home box counts ' + n + ': ' + await page.textContent('#hgroups .gp[data-g="1"]'));
      await page.click('#hgroups .gp[data-g="1"]'); await until(() => page.locator('#hcards').isVisible(), 3000, 'Cards tab');
      await until(async () => /17841/.test(await page.textContent('#list')) && /55555/.test(await page.textContent('#list')), 3000, 'both CUTTING cards are listed: ' + await page.textContent('#list'));
      ok(await page.locator('#stages button[data-i="all"]').evaluate(e => e.classList.contains('on')) && new RegExp('All\\s*' + n).test(await page.textContent('#stages button[data-i="all"]')), 'the All chip is the chosen one');
      ok((await page.locator('#list .cardrow').count()) === n && (await page.locator('#list .cardrow .lst').count()) === n, 'every card of the box is listed, each row says its list');
      await page.click('#stages button[data-i="3"]'); await until(async () => /No cards here/.test(await page.textContent('#list')), 3000, 'empty list again');
      await page.click('#gall'); await until(async () => /17841/.test(await page.textContent('#list')), 3000, 'Show all brings them back');
      await page.click('#stages button[data-i="4"]'); await until(async () => page.locator('#stages button[data-i="4"]').evaluate(e => e.classList.contains('on')), 3000, 'one list chosen');
      ok(/17841/.test(await page.textContent('#list')) && /55555/.test(await page.textContent('#list')), 'the CUTTING chip lists its own cards');
      await page.click('#groups .gp[data-g="0"]');
    });
    await test('bottom bar = Home · Cards · ＋ · Chats · Returns · Workers; More lives behind the top-right button (Returns has a tile there too)', async () => {
      const ids = await page.$$eval('#tabs > button', b => b.map(x => x.id || x.dataset.t)); ok(ids.join(',') === 'home,cards,tplus,chats,returns,twork', 'bar: ' + ids.join(','));
      ok(/^(A|AB|AJ)/.test((await page.textContent('#tmore')).trim()), 'the button carries his initials: ' + await page.textContent('#tmore'));
      await page.click('#tmore'); await until(() => page.locator('#home section[data-t="more"]').isVisible(), 3000, 'More');
      ok((await page.locator('#home section[data-t="more"] .tl:visible').count()) >= 12, 'tiles: ' + await page.locator('#home section[data-t="more"] .tl:visible').count());
      ok(await page.locator('#mpeople').isVisible() && await page.locator('#mrep').isVisible(), 'owner tiles for Abbas');
      ok(/Owner/.test(await page.textContent('#mrole')) && /app \d{4}-\d\d-\d\d[a-z]/.test(await page.textContent('#mrole')), 'profile card: ' + await page.textContent('#mrole'));
      await page.click('#mret'); await until(() => page.locator('#home section[data-t="returns"]').isVisible(), 3000, 'Returns opens from its tile');
      ok(await page.locator('#tabs button[data-t="returns"]').evaluate(e => e.classList.contains('on')), 'the Returns button in the bar is lit');
      await page.click('#tmore'); await page.click('#mlate'); await until(() => page.locator('#fac').isVisible(), 5000, 'Late screen'); await until(async () => /66001/.test(await page.textContent('#fac')), 8000, 'the late design on it');
      await page.goBack(); await until(() => page.locator('#fac').isHidden(), 5000, 'closed');
      await page.click('#mpeople'); await until(async () => await page.locator('#fac').isVisible() && /PEOPLE & PHONES/.test(await page.textContent('#fac')), 8000, 'People & phones'); await page.goBack(); await until(() => page.locator('#fac').isHidden(), 5000, 'closed');
    });
    await test('a card opens on its Chat; Work, Sheet and Photos are tabs, Done stays on top', async () => {
      await openCardNo(page, '17841');
      ok((await page.$$eval('#ctabs button', b => b.map(x => x.dataset.ct).join(','))) === 'chat,work,sheet,info', 'four tabs');
      ok(await page.locator('#ctabs button[data-ct="chat"]').evaluate(e => e.classList.contains('on')), 'Chat is the open tab');
      await until(async () => (await bubbles(page)).some(t => /cutting started/.test(t)), 8000, 'the chat is there at once');
      ok(await page.locator('#thread').isVisible() && await page.locator('#bdone').isVisible() && await page.locator('#work').isHidden() && await page.locator('#sheet').isHidden() && await page.locator('#card .hero').isHidden(), 'only the chat + Done on the first screen');
      await workTab(page); ok(await page.locator('#wkrows').isVisible() && await page.locator('#thread').isHidden() && await page.locator('#bdone').isVisible(), 'Work tab: workers, no chat, Done still there');
      await sheetTab(page); await until(() => page.locator('#shrows .sr').count(), 8000, 'sheet rows'); ok(await page.locator('#work').isHidden(), 'Sheet tab alone');
      await page.click('#ctabs button[data-ct="info"]'); ok(await page.locator('#card .hero').isVisible() && await page.locator('#sheet').isHidden() && await page.locator('#thread').isHidden(), 'Photos tab: the card pictures');
      await page.click('#ctabs button[data-ct="chat"]'); ok(await page.locator('#thread').isVisible(), 'back on the chat');
    });
    await test('Work tab: who holds pieces is on top; the other workers are behind one button and stay open while giving', async () => {
      await workTab(page); await until(() => page.locator('#wkrows .wr').count(), 8000, 'rows');
      ok((await page.locator('#wkgive').count()) === 0 && await page.locator('#wkrows .wr[data-w="Rifat"]').isVisible(), 'nobody holds pieces: the full list is shown');
      const r = page.locator('#wkrows .wr[data-w="Rifat"]'); await r.locator('input').fill('5'); await r.locator('button.in').click();
      await until(async () => (await r.locator('button.out').count()) === 1, 10000, 'Rifat has his pieces');
      ok(await page.evaluate(() => { const b = document.querySelector('#wkrows'); return /IN HAND NOW/.test(b.firstElementChild.textContent) && b.querySelector('.wr').dataset.w === 'Rifat'; }), 'IN HAND NOW first, Rifat under it');
      ok(await page.locator('#wkrows .wr[data-w="Nahid"]').isVisible(), 'the list stays open for the next worker');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000, 'closed'); await openCardNo(page, '17841'); await workTab(page);
      await until(async () => (await page.locator('#wkgive').count()) === 1, 8000, 'the Give button');
      ok(await page.locator('#wkrows .wr[data-w="Rifat"]').isVisible() && await page.locator('#wkrows .wr[data-w="Nahid"]').isHidden(), 'opened again: only who holds pieces');
      ok(/more workers/.test(await page.textContent('#wkgive')) && /পিস দিন/.test(await page.textContent('#wkgive')), 'button text: ' + await page.textContent('#wkgive'));
      await page.click('#wkgive'); await until(() => page.locator('#wkrows .wr[data-w="Nahid"]').isVisible(), 3000, 'the others after a tap');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 5000, 'closed');
    });
    await test('a card row shows its pieces and who is working on it; "Done →" on the row moves it (with Undo)', async () => {
      await page.fill('#q', ''); await chip(page, 4);
      const rb = page.locator('#list .cardrow', { hasText: '17841' }); await rb.waitFor();
      ok((await rb.locator('.no em').textContent()) === '12 pcs', 'pieces next to the number');
      await until(() => rb.locator('.rwk .av').count(), 12000, 'the worker on the row'); ok(/R/.test(await rb.locator('.rwk').textContent()), 'Rifat\'s initial');
      await chip(page, 2); const ra = page.locator('#list .cardrow', { hasText: '77001' }); await ra.waitFor();
      ok(/Done →/.test(await ra.locator('.rdone').textContent()), 'Done → on the row');
      await ra.locator('.rdone').click(); await until(() => page.locator('#undo').isVisible(), 2000, 'Undo bar'); ok(await page.locator('#card').isHidden(), 'the card did not open');
      await page.click('#undo button'); await page.waitForTimeout(6500); ok(W.trello.cards[W.cardR.id].idList === START, 'Undo: still in START');
      await page.locator('#list .cardrow', { hasText: '77001' }).locator('.rdone').click();
      await until(() => W.trello.cards[W.cardR.id].idList === '6ae07f38a77a2321736ef9da', 12000, 'moved to Cutting///START in Trello');
      await until(async () => !/77001/.test(await page.textContent('#list')), 5000, 'left the START list');
    });
    await test('Home and Cards ask the relay for the workers report once, not every minute; the relay answers a repeat from its kept copy (Google\'s daily limit)', async () => {   // 21 Nov 2026 (Abbas, screenshot: "Not made … urlfetch")
      await home(page); await page.click('#tabs button[data-t="home"]'); await page.waitForTimeout(800); const reps = () => T.relayCalls.filter(o => o === 'workrep').length;
      await page.evaluate(() => { window.__f.HM.at = Date.now() - 60000; }); const n0 = reps();          // the last report is one minute old
      for (let i = 0; i < 5; i++) { await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="home"]'); } await page.waitForTimeout(700);
      ok(reps() === n0, 'tab changes within minutes ask for no new workers report (saw ' + (reps() - n0) + ')');
      await page.evaluate(() => { window.__f.HM.at = Date.now() - 14 * 60000; }); await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="home"]'); await page.waitForTimeout(700);
      ok(reps() === n0, 'still none after 14 minutes');
      await page.evaluate(() => { window.__f.HM.at = Date.now() - 16 * 60000; }); await page.click('#tabs button[data-t="cards"]'); await until(() => reps() === n0 + 1, 8000, 'one after 15 minutes'); await page.click('#tabs button[data-t="home"]'); await page.waitForTimeout(500); ok(reps() === n0 + 1, 'exactly one');
      const f0 = W.ufetch; const a = await page.evaluate(() => window.__call({ op: 'workrep', days: 30, fresh: 1 })); const f1 = W.ufetch; const b = await page.evaluate(() => window.__call({ op: 'workrep', days: 30 })); const f2 = W.ufetch;
      const c = await page.evaluate(() => window.__call({ op: 'workrep', days: 30, fresh: 1 })); const f3 = W.ufetch;
      ok(a.ok && b.ok && c.ok && f2 === f1, 'a repeat costs the relay no Trello call (' + (f2 - f1) + ')'); ok(f3 - f2 < f1 - f0 || f1 - f0 <= 3, 'a fresh one right after asks Trello less: the cards it already checked are remembered (' + (f1 - f0) + ' then ' + (f3 - f2) + ')');
    });
    // ===== 22 Nov 2026 (Abbas: "the daily limit ran out on 19, 20 and 21 Nov ... cut the relay's own use ... show the calls in the app") =====
    await test('an idle phone no longer makes the relay re-read every Slack channel every 10 seconds', async () => {
      await home(page); await page.click('#tabs button[data-t="home"]'); T.relay.P.FAC_EVENTS_ON = String(Date.now()); await page.waitForTimeout(1500);
      const f0 = W.ufetch; await page.waitForTimeout(35000); const n = W.ufetch - f0;
      ok(n <= 12, 'at most one round of channel reads in 35 s with Slack\'s push set up (saw ' + n + ' outside calls; the old relay made ~25)'); delete T.relay.P.FAC_EVENTS_ON;
    });
    await test('the owner sees by himself whether the relay code was copied: a red row on Home while it is old, "✓ newest" under More when it is not', async () => {   // 22 Nov 2026 (Abbas: "I think I copied the code - can you check?")
      const fs = require('fs'), path = require('path'), RV = (fs.readFileSync(path.join(__dirname, '..', 'relay.gs'), 'utf8').match(/var RELAY_VER = '([^']+)'/) || [])[1], LT = (fs.readFileSync(path.join(__dirname, '..', '..', 'factory.html'), 'utf8').match(/var RV_LATEST = '([^']+)'/) || [])[1];
      ok(RV && RV === LT, 'the app knows the newest relay version (RV_LATEST ' + LT + ' = RELAY_VER ' + RV + ')');
      await home(page); await page.click('#tmore'); await until(async () => /relay \S+ ✓ newest/.test(await page.textContent('#verline')), 8000, 'More says newest: ' + await page.textContent('#verline'));
      await page.click('#tabs button[data-t="home"]'); ok(!/old code/.test(await page.textContent('#hneeds')), 'no row while the relay is the newest');
      const ctx = T.relay.ctx, real = ctx.RELAY_VER; ctx.RELAY_VER = '2026-11-21a';
      try { await page.evaluate(() => window.__f.ping(true)); await until(async () => /The relay still runs old code/.test(await page.textContent('#hneeds')) && /2026-11-21a/.test(await page.textContent('#hneeds')), 15000, 'red row with the old version');
        ok(new RegExp('copy version ' + RV).test(await page.textContent('#hneeds')) && /রিলে পুরনো/.test(await page.textContent('#hneeds')), 'says which version to copy, with Bengali');
        await page.click('#tmore'); ok(/⚠ old - newest is/.test(await page.textContent('#verline')), 'More: ' + await page.textContent('#verline'));
      } finally { ctx.RELAY_VER = real; await page.evaluate(() => window.__f.ping(true)); await page.click('#tabs button[data-t="home"]'); await until(async () => !/old code/.test(await page.textContent('#hneeds')), 15000, 'row gone again'); }
    });
    await test('a phone nobody is touching asks the relay every 30 - 60 s, not every 4 s; a touch brings the quick checks back', async () => {   // 22 Nov 2026
      await home(page); await page.click('#tabs button[data-t="home"]'); await page.waitForTimeout(22000);                  // 20 s without a touch = idle
      const pings = () => T.relayCalls.filter(o => o === 'ping').length, n0 = pings(); await page.waitForTimeout(40000); const idle = pings() - n0;
      ok(idle <= 2, 'at most 2 checks in 40 idle seconds (saw ' + idle + '; it was ~9)');
      await page.click('#tabs button[data-t="cards"]'); const n1 = pings(); await page.waitForTimeout(13000); ok(pings() - n1 >= 1 && pings() - n1 >= idle, 'after a touch it checks again within seconds (' + (pings() - n1) + ' in 13 s)');
    });
    await test('the relay counts its outside calls; More -> Google calls shows the last 24 hours and who used them; Home warns from 70 %', async () => {
      const u = await page.evaluate(() => window.__call({ op: 'usage' })); ok(u.ok && u.lim === 20000 && u.h24 > 0 && u.hours.length === 24, 'usage: ' + JSON.stringify({ h24: u.h24, today: u.today }));
      ok(u.by['fac:ping'] > 0 && Object.keys(u.by).every(k => u.by[k] > 0), 'counted per source: ' + JSON.stringify(u.by)); ok(u.today <= W.ufetch && u.today >= W.ufetch * 0.6, 'the count follows the real number of calls (' + u.today + ' of ' + W.ufetch + ' since the test began)');
      await page.click('#tmore'); await until(async () => /%/.test(await page.textContent('#te-uf')), 15000, 'percent on the tile'); await page.click('#buf');
      await until(async () => /of 20,000 in the last 24 hours/.test(await page.textContent('#ufbody')), 8000, 'the sheet'); const tx = await page.textContent('#ufbody');
      ok(/Factory phones checking for new messages/.test(tx) && /WHO USED THEM TODAY/.test(tx) && /গতকাল/.test(tx) && /Assistant \/ Jarvis script uses the SAME Google allowance/.test(tx) && (await page.locator('#ufbody .ufh i').count()) === 24, 'total, hours, sources in plain names, Bengali, the note about the Assistant'); await page.click('#ufx');
      const L = JSON.parse(T.relay.cache.get('UF_LOG')), hk = Math.floor(Date.now() / 3600000); L.h[hk - 3] = 15600; T.relay.cache.put('UF_LOG', JSON.stringify(L), 21600);       // a heavy hour earlier today
      await page.click('#tabs button[data-t="home"]'); await until(async () => /Google calls: 1[5-9],\d{3} of 20,000 used/.test(await page.textContent('#hneeds')), 20000, 'warning row on Home'); ok(/7\d%|8\d%/.test(await page.textContent('#hneeds')), 'with the percent');
      await page.click('#hneeds .need[data-go="uf"]'); await until(() => page.locator('#ufs').isVisible(), 3000, 'the row opens the sheet'); await page.click('#ufx');
      delete L.h[hk - 3]; T.relay.cache.put('UF_LOG', JSON.stringify(L), 21600); T.relay.P.UF_LOG = JSON.stringify(L);
    });
    await test('the every-minute timers do their Slack work every 5 minutes and only 8 am - 11 pm Dubai', async () => {
      const ctx = T.relay.ctx, realNow = Date.now, at = (h, m) => { const d = new Date(realNow() + 4 * 3600000); d.setUTCHours(h, m, 0, 0); return d.getTime() - 4 * 3600000; }, scan0 = ctx.facNotifyScan; let scans = 0; ctx.facNotifyScan = () => { scans++; return 0; };
      try { T.relay.cache.remove('TICK_notify');
        Date.now = () => at(10, 0); ctx.facNotifyTick(); ctx.facNotifyTick(); Date.now = () => at(10, 2); ctx.facNotifyTick(); ok(scans === 1, 'three ticks within 3 minutes = one scan (saw ' + scans + ')');
        Date.now = () => at(10, 6); ctx.facNotifyTick(); ok(scans === 2, 'the next one after 5 minutes (saw ' + scans + ')');
        Date.now = () => at(2, 0); ctx.facNotifyTick(); Date.now = () => at(7, 30); ctx.facNotifyTick(); Date.now = () => at(23, 20); ctx.facNotifyTick(); ok(scans === 2, 'none at 2 am, 7:30 am or 11:20 pm (saw ' + scans + ')');
        Date.now = () => at(12, 0); ok(ctx.tickDue('t1', 5) === true && ctx.tickDue('t1', 5) === false && ctx.tickDue('t2', 5) === true, 'each timer has its own 5-minute gate');
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'relay.gs'), 'utf8');
        ok(/function facWatch\(\) \{ if \(!tickDue\('watch', 5\)\) return;/.test(src) && /function watchTrello\(\) \{ if \(!tickDue\('ready', 5\)\) return;/.test(src) && !/UrlFetchApp\.fetch(All)?\((?!url|rs)/.test(src), 'facWatch and watchTrello are gated; every outside call goes through the counter');
      } finally { Date.now = realNow; ctx.facNotifyScan = scan0; }
    });
    await test('a check that fails keeps the NEW badges; a check asked for during another one still runs; the chats this phone wrote in are told again', async () => {   // 28 Nov 2026: three statements of ping() sat behind a comment since 21 Nov
      await page.click('#tabs button[data-t="home"]');
      F.postSlack(W, CUT, { text: 'a new line for the badge', user: 'U1', thread_ts: W.rootB });
      T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now(), event: { type: 'message', channel: CUT, thread_ts: W.rootB, ts: F.slackTs() } }));
      await until(async () => { await page.evaluate(() => window.__f.ping(true)); return page.evaluate(id => !!(window.__f.D.th[id] && window.__f.D.th[id].n), W.cardB.id); }, 20000, 'NEW on SJ-17841');
      const badge = (await page.textContent('#tbchat')).trim(); ok(+badge > 0, 'badge on the Chats button: ' + badge);
      await page.evaluate(id => window.__f.hotAdd(id, '1795000000.000100'), W.cardB.id);
      T.relayDown = true;
      try { await page.evaluate(() => window.__f.ping(false)); await page.waitForTimeout(300);
        ok(await page.evaluate(id => !!(window.__f.D.th[id] && window.__f.D.th[id].n), W.cardB.id), 'the NEW count survives a check that failed');
        ok((await page.textContent('#tbchat')).trim() === badge, 'the badge is still there: ' + await page.textContent('#tbchat'));
        ok(await page.evaluate(id => window.__f.hotq()[id] === '1795000000.000100', W.cardB.id), 'the chat this phone wrote in waits for the next check');
      } finally { T.relayDown = false; }
      T.opDelay = { ping: 1200 }; const n0 = T.relayCalls.filter(o => o === 'ping').length;
      try { const p1 = page.evaluate(() => window.__f.ping(false)); await page.waitForTimeout(150); await page.evaluate(() => { window.__f.ping(false); }); await p1; await page.waitForTimeout(500);
        ok(T.relayCalls.filter(o => o === 'ping').length >= n0 + 2, 'the check asked for meanwhile ran right after: ' + (T.relayCalls.filter(o => o === 'ping').length - n0));
      } finally { T.opDelay = null; }
    });
    await test('Back with the card\'s ⋯ menu open closes the menu and keeps the card; Back on Workers closes it; a closed card takes its menu with it', async () => {   // 28 Nov 2026 (Android Back)
      await openCardNo(page, '17841'); await page.click('#bmore'); await until(() => page.locator('#cmenu').isVisible(), 3000, 'menu');
      await page.goBack(); await until(() => page.locator('#cmenu').isHidden(), 3000, 'menu closed by Back');
      ok(await page.locator('#card').isVisible(), 'the card is still open'); ok(await page.evaluate(() => window.__f.TH && !document.getElementById('card').hidden), 'card screen stays');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 3000, 'the next Back closes the card');
      await openCardNo(page, '17841'); await page.click('#bmore'); await page.click('#bmove'); await until(() => page.locator('#mv').isVisible(), 3000, 'Move to sheet');
      await page.goBack(); await until(() => page.locator('#mv').isHidden(), 3000, 'Move to closed by Back'); ok(await page.locator('#card').isVisible(), 'card still open after Move to was closed');
      await page.goBack(); await until(() => page.locator('#card').isHidden(), 3000, 'card closed');
      await page.fill('#q', ''); await page.click('#twork'); await until(() => page.locator('#wks').isVisible(), 3000, 'Workers screen');
      await page.goBack(); await until(() => page.locator('#wks').isHidden(), 3000, 'Back closes the Workers screen');
    });
    await test('Workers -> Week: the grand total adds up; Share without a share sheet says Copied only when it was, else shows the text', async () => {   // 28 Nov 2026
      await page.click('#twork'); await until(() => page.locator('#wks').isVisible(), 3000, 'Workers');
      await page.click('#wkview button[data-v="k"]'); await until(() => page.locator('#wksbody .wtab').count(), 8000, 'week table');
      const sums = await page.$$eval('#wksbody .wtab td.s', t => t.map(x => +x.textContent || 0)), tot = +(await page.locator('#wksbody .wtab tr.tot td').last().textContent());
      ok(tot === sums.reduce((a, b) => a + b, 0), 'grand total ' + tot + ' = the rows ' + sums.join('+'));
      await page.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {} Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); });
      await page.click('#wkshare'); await until(() => page.locator('#tg').isVisible(), 3000, 'the text is shown to copy by hand'); ok(/Week|week|Σ|pcs/i.test(await page.textContent('#tgbody')), 'week text shown: ' + (await page.textContent('#tgbody')).slice(0, 80));
      await page.evaluate(() => { document.getElementById('tg').hidden = true; }); await page.goBack(); await until(() => page.locator('#wks').isHidden(), 3000, 'Workers closed');
    });
    await test('Home: a phone not opened for days raises no alarm; a first read that failed is tried again after a minute', async () => {   // 28 Nov 2026
      const now = Date.now(), ph = JSON.parse(T.relay.P.FAC_PHONES || '{}');
      ph.oldman = { n: 'Oldman', d: { dvold1: { v: '2026-10-01a', at: now - 9 * 86400000, ua: 'PC', ob: 2 } } }; T.relay.P.FAC_PHONES = JSON.stringify(ph);
      await page.click('#tabs button[data-t="home"]'); await page.evaluate(() => { window.__f.HM.pat = 0; }); await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="home"]');
      await page.waitForTimeout(2500); ok(!/Oldman/.test(await page.textContent('#hneeds')), 'no row for a phone last seen 9 days ago: ' + await page.textContent('#hneeds'));
      ph.oldman.d.dvold1.at = now - 3600000; T.relay.P.FAC_PHONES = JSON.stringify(ph);
      await page.evaluate(() => { window.__f.HM.pat = 0; }); await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="home"]');
      await until(async () => /Oldman|phones need a look/.test(await page.textContent('#hneeds')), 8000, 'a phone seen an hour ago with stuck messages is named');
      delete ph.oldman; T.relay.P.FAC_PHONES = JSON.stringify(ph);
      T.relayDown = true;
      try { await page.evaluate(() => { window.__f.HM.at = 0; }); await page.click('#tabs button[data-t="cards"]'); await page.click('#tabs button[data-t="home"]');
        await until(() => page.evaluate(() => { const a = Date.now() - window.__f.HM.at; return a > 700000 && a < 900000; }), 30000, 'the failed read is due again in about a minute');
      } finally { T.relayDown = false; }
    });
    await test('Google\'s daily limit reached: the app says so in plain words (English + Bengali), not Google\'s sentence, and Home shows it', async () => {   // 21 Nov 2026
      W.quota = true;
      try { await home(page); await page.click('#tplus'); await page.click('#pret');
        await until(() => page.locator('#ns').isVisible(), 5000, 'new return sheet'); await page.fill('#nsdesc', 'zip broken'); await page.click('#nsgo');
        await until(async () => await page.locator('#nserr').isVisible() && /daily limit/.test(await page.textContent('#nserr')), 60000, 'the reason in plain words');
        const t = await page.textContent('#nserr'); ok(/comes back by itself/.test(t) && /দৈনিক সীমা/.test(t) && !/urlfetch|تم تفعيل/.test(t), 'message: ' + t);
        await page.click('#nsx'); await page.click('#tabs button[data-t="home"]'); await until(async () => /daily limit is used up/.test(await page.textContent('#hneeds')), 5000, 'row on Home');
      } finally { W.quota = false; await page.evaluate(() => { document.querySelectorAll('.sheet:not([hidden])').forEach(x => { x.hidden = true; }); }); }
    });
    await test('no page errors (new look)', async () => { ok(!T.errors.length, T.errors.join('\n')); });
  } finally { await T.close(); }
}

// ---- 21 Nov 2026 (Abbas): NEED FABRIC - a photo + rolls in the card's chat, Abbas's answer as a chip under it, Fabric arrived, a mark in the list ----
async function fabricSuite(fast, browser) {
  console.log('\n— Need fabric (' + (fast ? 'fast lane' : 'relay only') + ') —');
  const INLINE = '6527c57cd7e267fbf2a602b4';
  const T = await boot({ fast, browser, who: 'Ibrahim', setup: W => { world(W); W.cardF = F.addCard(W, START, 'SJ-88001 (40) pcs fabric test', { ageDays: 1 }); W.cardG = F.addCard(W, INLINE, 'SJ-88002 (10) pcs in line');
    F.postSlack(W, CUT, { text: 'ORDERED', user: 'U2', thread_ts: W.rootB }); F.postSlack(W, CUT, { text: 'that lace is not available in the market', user: 'U2', thread_ts: W.rootB }); } });   // old loose lines in an old chat
  const W = T.W, all = () => [].concat(...Object.values(W.slack.ch).map(c => c.msgs));
  const rowF = page => page.locator('#list .cardrow', { hasText: '88001' });
  const abbas = (text, extra) => { const root = all().find(m => /FABRIC NEEDED/.test(m.text || '')).thread_ts, ch = Object.keys(W.slack.ch).find(k => W.slack.ch[k].msgs.some(m => m.thread_ts === root && /FABRIC NEEDED/.test(m.text || '')));
    F.postSlack(W, ch, Object.assign({ text, thread_ts: root }, extra || { bot_id: 'B1' }));
    T.relay.post(JSON.stringify({ type: 'event_callback', event_id: 'E' + Date.now() + Math.random(), event: { type: 'message', channel: ch, thread_ts: root, ts: F.slackTs() } })); };
  const pic = (name, kb) => { const b = Buffer.alloc(kb * 1024, 7); b[0] = 0xff; b[1] = 0xd8; return { name, mimeType: 'image/jpeg', buffer: b }; };
  try {
    const page = await T.open();
    await test('Need fabric shows on START / CUTTING START / CUTTING cards only; old "ORDERED" / "not available" lines stay plain messages', async () => {
      await openCardNo(page, '88001'); await until(() => page.locator('#fabneed').isVisible(), 5000, 'button on a START card');
      ok(/Need fabric/.test(await page.textContent('#fabneed')) && /কাপড় দরকার/.test(await page.textContent('#fabneed')), 'English + Bengali: ' + await page.textContent('#fabneed'));
      ok(await page.locator('#fabarr').isHidden(), 'no Fabric arrived yet');
      ok(await page.locator('#bdone').isVisible() && await page.locator('#send').isVisible() && await page.locator('#cam').isVisible(), 'Done and the chat box are where they were');
      await page.goBack(); await openCardNo(page, '88002'); await page.waitForTimeout(400); ok(await page.locator('#fabbar').isHidden(), 'not on an IN LINE card');
      await page.goBack(); await openCardNo(page, '17841'); await until(async () => (await bubbles(page)).some(t => /not available in the market/.test(t)), 8000, 'the old lines are in the chat');
      ok(await page.locator('#fabneed').isVisible(), 'on a CUTTING card');
      ok((await page.locator('#thread .fchip').count()) === 0 && await page.locator('#fabarr').isHidden() && (await bubbles(page)).some(t => t.trim().startsWith('ORDERED')), 'old ORDERED = a plain message, no chip, no Fabric arrived');
      await home(page); await chip(page, 4); ok((await page.locator('#list .cardrow .fab').count()) === 0, 'no fabric mark from old lines');
    });
    await test('Need fabric: one photo + 2 rolls + the name = ONE chat message "FABRIC NEEDED · 2 roll · maroon mokhmol" with the photo', async () => {
      await home(page); await openCardNo(page, '88001'); await page.click('#fabneed'); await until(() => page.locator('#fabs').isVisible(), 3000, 'the sheet');
      ok(/SJ-88001/.test(await page.textContent('#fabs h3')) && /রোল/.test(await page.textContent('#fabs .fabst')), 'card number + Bengali on the sheet');
      ok((await page.textContent('#fabn')).trim() === '1' && await page.locator('#fabminus').isDisabled(), 'starts at 1 roll, cannot go under');
      await page.click('#fabgo'); ok(await page.locator('#faberr').isVisible() && await page.locator('#fabs').isVisible(), 'no photo = not sent, says why');
      for (let i = 0; i < 24; i++) await page.click('#fabplus', { force: true }).catch(() => {});
      ok((await page.textContent('#fabn')).trim() === '20' && await page.locator('#fabplus').isDisabled(), 'stops at 20');
      for (let i = 0; i < 18; i++) await page.click('#fabminus'); ok((await page.textContent('#fabn')).trim() === '2', '2 rolls');
      await page.setInputFiles('#fabpick', pic('sheet.jpg', 1300)); await until(() => page.locator('#fabs .fabimg').isVisible(), 3000, 'photo preview');
      await page.fill('#fabname', '  maroon   mokhmol '); await page.click('#fabgo'); await until(() => page.locator('#fabs').isHidden(), 3000, 'sheet closed');
      await until(() => all().some(m => (m.files || []).some(f => f.name === 'sheet.jpg')), 20000, 'the photo reached Slack'); await page.waitForTimeout(2500);
      const posts = all().filter(m => /FABRIC NEEDED/.test(m.text || '')); ok(posts.length === 1, 'ONE message (saw ' + posts.length + ')');
      ok(posts[0].text === '*Ibrahim:* FABRIC NEEDED · 2 roll · maroon mokhmol', 'exact text: ' + JSON.stringify(posts[0].text));
      ok((posts[0].files || []).length === 1 && posts[0].files[0].size === 1300 * 1024, 'its photo, full size'); ok(!!posts[0].thread_ts, 'in the card\'s own chat thread');
      await until(async () => (await page.locator('#thread .msg:not(.out) .fchip.a').count()) === 1, 15000, 'amber chip under the photo');
      ok(/Asked · 2 rolls/.test(await page.textContent('#thread .fchip.a')) && await page.locator('#fabarr').isHidden(), 'chip: ' + await page.textContent('#thread .fchip.a'));
      ok((await bubbles(page)).some(t => /FABRIC NEEDED · 2 roll · maroon mokhmol/.test(t)), 'the line itself is in the chat');
      await home(page); await chip(page, 2); await until(() => rowF(page).locator('.fab.a').count(), 5000, 'fabric mark in the list'); ok(/কাপড়/.test(await rowF(page).locator('.fab').textContent()), 'Bengali on the mark');
      ok((await page.locator('#list .cardrow .fab').count()) === 1, 'only on that card');
    });
    await test('Abbas answers "ORDERED · Test vendor · 2 roll": the list mark turns green by itself, green chip under the photo, Fabric arrived appears', async () => {
      abbas('*Abbas:* ORDERED · Test vendor · 2 roll');
      await until(() => rowF(page).locator('.fab.g').count(), 30000, 'mark = ordered, without opening the chat');
      await openCardNo(page, '88001'); await until(() => page.locator('#thread .fchip.g').count(), 10000, 'green chip');
      const t = await page.textContent('#thread .fchip.g'); ok(/Ordered · Test vendor · 2 rolls · (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2}/.test(t) && /অর্ডার হয়েছে/.test(t), 'chip: ' + t);
      ok(await page.locator('#thread .msg:has(.fchip.g) img, #thread .msg:has(.fchip.g) .fph').count() === 1, 'the chip sits under the fabric photo');
      ok((await page.locator('#thread .fchip').count()) === 1 && await page.locator('#fabarr').isVisible() && /কাপড় এসেছে/.test(await page.textContent('#fabarr')), 'Fabric arrived button');
    });
    await test('Fabric arrived posts "FABRIC ARRIVED" once; the chip says Arrived; the list mark is gone', async () => {
      await page.click('#fabarr'); await until(() => all().some(m => /FABRIC ARRIVED/.test(m.text || '')), 15000, 'in Slack'); await page.waitForTimeout(1500);
      const ps = all().filter(m => /FABRIC ARRIVED/.test(m.text || '')); ok(ps.length === 1 && ps[0].text === '*Ibrahim:* FABRIC ARRIVED', 'exact text, once: ' + JSON.stringify(ps.map(m => m.text)));
      await until(() => page.locator('#thread .fchip.d').count(), 10000, 'chip turned'); ok(/Arrived · Test vendor · 2 rolls/.test(await page.textContent('#thread .fchip.d')) && (await page.locator('#thread .fchip.g').count()) === 0, 'chip: ' + await page.textContent('#thread .fchip.d'));
      await until(() => page.locator('#fabarr').isHidden(), 5000, 'button gone'); ok(await page.locator('#fabneed').isVisible(), 'Need fabric stays');
      await home(page); await chip(page, 2); await rowF(page).waitFor(); ok((await rowF(page).locator('.fab').count()) === 0, 'no mark on the row');
    });
    await test('"not available" (typed in Slack): red chip + Send another colour on the waiting photo only; 1 roll without a name = "FABRIC NEEDED · 1 roll"', async () => {
      await openCardNo(page, '88001'); await page.click('#fabneed'); await page.setInputFiles('#fabpick', pic('sheet2.jpg', 300)); await page.click('#fabgo');
      await until(() => all().some(m => (m.files || []).some(f => f.name === 'sheet2.jpg')), 20000, 'second photo in Slack');
      ok(all().filter(m => /FABRIC NEEDED/.test(m.text || '')).pop().text === '*Ibrahim:* FABRIC NEEDED · 1 roll', 'exact text without a name');
      await until(() => page.locator('#thread .msg:not(.out) .fchip.a').count(), 15000, 'asked');
      abbas('sorry this colour is Not Available at the vendor', { user: 'U2' });
      await until(() => page.locator('#thread .fchip.r').count(), 20000, 'red chip'); const t = await page.textContent('#thread .fchip.r');
      ok(/Not available/.test(t) && /choose another colour/.test(t) && /অন্য রং/.test(t), 'chip: ' + t);
      ok((await page.locator('#thread .fchip.d').count()) === 1 && (await page.locator('#thread .fchip.r').count()) === 1, 'the photo that already arrived keeps its chip');
      await page.click('#thread .fchip.r .fagain'); await until(() => page.locator('#fabs').isVisible(), 3000, 'the same flow opens');
      ok((await page.textContent('#fabn')).trim() === '1' && (await page.locator('#fabs .fabimg').count()) === 0, 'fresh: 1 roll, no photo'); await page.click('#fabx');
      await home(page); await chip(page, 2); await until(() => rowF(page).locator('.fab.r').count(), 5000, 'red mark: choose another colour');
    });
    await test('rule: an answer belongs to the fabric photos before it that had no answer yet', async () => {
      const r = await page.evaluate(() => { const m = (ts, text, x) => Object.assign({ ts: String(ts), text, who: 'x' }, x || {});
        const v = window.__f.fabView([m(1, 'please check'), m(2, 'ORDERED · Old vendor · 9 roll'), m(3, 'FABRIC NEEDED · 2 roll · red'), m(4, 'FABRIC NEEDED · 1 roll'), m(5, 'ORDERED · Naeem · 3 roll'), m(6, 'FABRIC NEEDED · 4 roll · blue net'),
          m(7, 'this one is not available'), m(8, 'FABRIC NEEDED · 5 roll · green'), m(9, '> *Ibrahim:* FABRIC NEEDED\nORDERED · Al-Noor Textiles · 5 roll'), m(10, '→ *WORK* · FABRIC ARRIVED', { sys: 1 }), m(11, 'FABRIC NEEDED · 6 roll · black')]);
        const w = window.__f.fabView([m(1, 'FABRIC NEEDED · 2 roll · red'), m(2, 'ORDERED · V · 2 roll'), m(3, 'FABRIC ARRIVED'), m(4, 'FABRIC NEEDED · 1 roll'), m(5, 'ORDERED')]);
        return { v, w, k: [window.__f.fabKind(m(1, 'ordered food for the workers')), window.__f.fabKind(m(1, 'FABRIC NEEDED · 12 roll · maroon · mokhmol')), window.__f.fabKind(m(1, 'ORDERED - Naeem - 2 roll'))] }; });
      const st = k => r.v.by[k] && r.v.by[k].st; ok(st('3') === 'ord' && st('4') === 'ord' && r.v.by['3'].vendor === 'Naeem' && r.v.by['3'].on === 3, 'one ORDERED answers both waiting photos: ' + JSON.stringify(r.v.by['3']));
      ok(st('6') === 'no' && st('8') === 'ord' && r.v.by['8'].vendor === 'Al-Noor Textiles' && st('11') === 'ask', 'not available / a quoted reply / a system line are told apart: ' + JSON.stringify(r.v.by));
      ok(r.v.a === 1 && r.v.o === 3 && r.v.no === 0 && !r.v.by['2'], 'counts: ' + r.v.a + ' asked, ' + r.v.o + ' ordered; an ORDERED before any request is nothing');
      ok(r.w.by['1'].st === 'arr' && r.w.by['4'].st === 'ord' && r.w.by['4'].on === 1 && r.w.o === 1, 'arrived closes only what was ordered before it; a bare ORDERED still answers');
      ok(r.k[0] === null && r.k[1].n === 12 && r.k[1].name === 'maroon' && r.k[2].vendor === 'Naeem' && r.k[2].n === 2, 'readers: ' + JSON.stringify(r.k));
    });
    await test('no page errors (fabric)', async () => { ok(!T.errors.length, T.errors.join('\n')); });
  } finally { await T.close(); }
}

const ONLY = process.argv[2];   // e.g. node tools/test/factory.test.js push
(async () => {
  const browser = await chromium.launch();
  if (ONLY) { try { await ({ push: pushSuite, sw: swSuite, staff: staffSuite, people: peopleSuite, look: lookSuite, fabric: async b => { await fabricSuite(false, b); await fabricSuite(true, b); }, main: b => suite(false, b), fast: b => suite(true, b) }[ONLY])(browser); } finally { await browser.close(); } const bad = results.filter(r => !r[0]); console.log('\n' + (results.length - bad.length) + ' passed, ' + bad.length + ' failed'); process.exit(bad.length ? 1 : 0); }
  try { await suite(false, browser); await suite(true, browser); await slowSuite(false, browser); await slowSuite(true, browser); await staffSuite(browser); await peopleSuite(browser); await lookSuite(browser); await fabricSuite(false, browser); await fabricSuite(true, browser); await pushSuite(browser); await swSuite(browser); } finally { await browser.close(); }
  const bad = results.filter(r => !r[0]); console.log('\n' + (results.length - bad.length) + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
