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
async function openCardNo(page, no) {
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
      await until(() => W.slack.ch[CUT].msgs.some(m => m.thread_ts === W.rootB && /IN LINE/.test(m.text || '')), 8000, 'move line in chat');
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
    await test('search by words: "fabric" finds the card with that word, numbers as before', async () => {
      W.trello.cards[W.cardB.id].name = 'SJ-17841 (12) pcs red lace'; await page.click('#tabs button[data-t="more"]'); await page.click('#rf'); await page.waitForTimeout(1500); await page.click('#tabs button[data-t="cards"]');
      await page.fill('#q', 'LACE red');
      await until(async () => (await page.$$eval('#list .cardrow', r => r.map(x => x.textContent))).join('|').includes('17841'), 4000, 'word match');
      ok(!(await page.textContent('#list')).includes('48188'), 'other cards hidden');
      await page.fill('#q', 'sj48188'); await until(async () => (await page.textContent('#list')).includes('48188'), 3000, 'SJ + number');
      await page.fill('#q', 'nothinglikethis'); await until(async () => /কোনো কার্ড পাওয়া যায়নি/.test(await page.textContent('#list')), 3000, 'empty message');
      await page.fill('#q', '');
    });
    await test('reply to a message: quoted in Slack, shown as a quote box; & shown as &', async () => {
      await openCardNo(page, '17841');
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
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await until(async () => /No internet/.test(await page.textContent('#msg')), 8000, 'No internet');
      T.relayDown = false; T.fastDown = false;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await until(async () => /Up to date/.test(await page.textContent('#msg')), 15000, 'back to Up to date');
    });
    await test('a long chat shows all its messages, also after the app is reopened', async () => {
      await openCardNo(page, '55555');
      await until(async () => (await bubbles(page)).filter(t => /^line \d+/.test(t)).length >= 60, 10000, '60 lines');
      await page.goBack(); await page.waitForTimeout(1200);         // the copy on the phone is saved
      await page.reload(); await page.waitForSelector('#list .cardrow');
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
      if (await page.locator('#card').isVisible()) await page.goBack();
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
      await openCardNo(page, '17841'); await page.click('#bpin');
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

(async () => {
  const browser = await chromium.launch();
  try { await suite(false, browser); await suite(true, browser); await slowSuite(false, browser); await slowSuite(true, browser); } finally { await browser.close(); }
  const bad = results.filter(r => !r[0]); console.log('\n' + (results.length - bad.length) + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
