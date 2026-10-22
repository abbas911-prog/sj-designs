// Direct chats Abbas ↔ Muhammad / Imran (22 Oct 2026) against the REAL relay.gs (fake Apps Script + fake Slack): the relay makes #sj-direct
// and one thread per person, Abbas sees all, a person sees only his own, a line posted by Abbas is "new" for Muhammad until he looks.
const crypto = require('crypto'), F = require('../tools/test/fakes');
const PW = 'shop-test-pw', props = { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-memo-test' };
const W = F.makeWorld(), relay = F.makeRelay(W, props);
W.slack.ch['C0BP6DSUHSA'] = { id: 'C0BP6DSUHSA', name: 'customer', member: true, msgs: [] }; W.slack.ch['C08EDKV94SV'] = { id: 'C08EDKV94SV', name: 'godown', member: true, msgs: [] };
const call = o => { const req = JSON.stringify(Object.assign({ t: Date.now() }, o)); return JSON.parse(relay.post(JSON.stringify({ job: 'cchat', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const out = []; const ok = (n, v) => out.push([n, !!v]);
const a = call({ op: 'list', who: 'Abbas' });
ok('Abbas sees two direct chats: Muhammad, Imran', a.ok && (a.dms || []).map(x => x.name).join() === 'Muhammad,Imran' && a.dms.every(x => /^\d+\.\d+$/.test(x.root)));
const dmch = Object.values(W.slack.ch).find(c => c.name === 'sj-direct');
ok('#sj-direct made as a private channel, one root post per person', !!dmch && dmch.priv && dmch.msgs.length === 2 && /Abbas ↔ Muhammad/.test(dmch.msgs[0].text));
const m = call({ op: 'list', who: 'Muhammad' }), i = call({ op: 'list', who: 'Imran' }), r = call({ op: 'list', who: 'Rifat' });
ok('Muhammad sees only his own', m.ok && m.dms.length === 1 && m.dms[0].name === 'Muhammad');
ok('Imran sees only his own; Rifat none', i.ok && i.dms.length === 1 && i.dms[0].name === 'Imran' && r.ok && r.dms.length === 0);
const rootM = a.dms[0].root;
const p1 = call({ op: 'post', ch: 'direct', root: rootM, name: 'Muhammad', text: 'Please check the 48188 cutting', who: 'Abbas', rid: 'r1' });
ok('Abbas posts into the Muhammad thread', p1.ok && dmch.msgs.length === 3 && dmch.msgs[2].thread_ts === rootM && /\*Abbas:\* Please check/.test(dmch.msgs[2].text));
const m2 = call({ op: 'list', who: 'Muhammad' });
ok('Muhammad: 1 new, the line shown', m2.dms[0].un === 1 && /Abbas: Please check/.test(m2.dms[0].tx));
ok('Imran cannot read Muhammad\'s chat', call({ op: 'thread', ch: 'direct', root: rootM, name: 'Muhammad', who: 'Imran' }).ok === false);
const th = call({ op: 'thread', ch: 'direct', root: rootM, name: 'Muhammad', who: 'Muhammad', look: 1 });
ok('Muhammad reads it: the message, without the root line', th.ok && th.msgs.length === 1 && !th.msgs[0].root && /Please check/.test(th.msgs[0].text) && th.msgs[0].who === 'Abbas');
const m3 = call({ op: 'list', who: 'Muhammad' }); ok('after looking: nothing new', m3.dms[0].un === 0);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2300);   // a reply never lands within 2 s of your own line (the relay's "my own line is never new for me" mark)
const p2 = call({ op: 'post', ch: 'direct', root: rootM, name: 'Muhammad', text: 'Done, 20 pcs cut', who: 'Muhammad', rid: 'r2' });
const a2 = call({ op: 'list', who: 'Abbas' });
ok('Abbas: 1 new from Muhammad, nothing from Imran', p2.ok && a2.dms[0].un === 1 && /Muhammad: Done/.test(a2.dms[0].tx) && a2.dms[1].un === 0);
ok('people list is owner-only', call({ op: 'dmpeople', who: 'Abbas', people: ['Muhammad', 'Imran', 'Rifat'] }).ok === false);
// a bot without the scopes: the reason reaches the app; the owner pastes the channel id instead
const W2 = F.makeWorld(), relay2 = F.makeRelay(W2, { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-memo-test', VAULT_CHK: crypto.createHash('sha256').update('ownerchk-32-chars-long-xxxxxxxxxxxx').digest('hex') });
W2.slack.ch['C0BP6DSUHSA'] = { id: 'C0BP6DSUHSA', name: 'customer', member: true, msgs: [] }; W2.slack.ch['C08EDKV94SV'] = { id: 'C08EDKV94SV', name: 'godown', member: true, msgs: [] };
W2.slack.ch['C0DIRECT001'] = { id: 'C0DIRECT001', name: 'sj-direct', member: true, priv: true, msgs: [] }; W2.slackNoCreate = true;
const call2 = o => { const req = JSON.stringify(Object.assign({ t: Date.now() }, o)); return JSON.parse(relay2.post(JSON.stringify({ job: 'cchat', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const d1 = call2({ op: 'dmset', who: 'Abbas', ch: 'C0DIRECT001', chk: 'ownerchk-32-chars-long-xxxxxxxxxxxx' });
ok('owner pastes the channel id → accepted', d1.ok && d1.name === 'sj-direct');
ok('a wrong id is refused', call2({ op: 'dmset', who: 'Abbas', ch: 'hello', chk: 'ownerchk-32-chars-long-xxxxxxxxxxxx' }).ok === false);
const l2 = call2({ op: 'list', who: 'Abbas' }); ok('chats then run in that channel', l2.ok && l2.dms.length === 2 && W2.slack.ch['C0DIRECT001'].msgs.length === 2 && !l2.dmerr);
// Abbas made a private channel "muhammad" with the bot in it (22 Oct 2026): Muhammad's chat lives there, Imran's in #sj-direct
const W3 = F.makeWorld(), relay3 = F.makeRelay(W3, { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-memo-test' });
W3.slack.ch['C0BP6DSUHSA'] = { id: 'C0BP6DSUHSA', name: 'customer', member: true, msgs: [] }; W3.slack.ch['C08EDKV94SV'] = { id: 'C08EDKV94SV', name: 'godown', member: true, msgs: [] };
W3.slack.ch['C0MUHAMMAD1'] = { id: 'C0MUHAMMAD1', name: 'muhammad', member: true, priv: true, msgs: [] };
const call3 = o => { const req = JSON.stringify(Object.assign({ t: Date.now() }, o)); return JSON.parse(relay3.post(JSON.stringify({ job: 'cchat', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const l3 = call3({ op: 'list', who: 'Abbas' });
ok('channel named after the person is used for him', l3.ok && l3.dms.length === 2 && W3.slack.ch['C0MUHAMMAD1'].msgs.length === 1 && /Abbas ↔ Muhammad/.test(W3.slack.ch['C0MUHAMMAD1'].msgs[0].text));
const sjd = Object.values(W3.slack.ch).find(c => c.name === 'sj-direct'); ok('the other person falls back to #sj-direct', !!sjd && sjd.msgs.length === 1 && /Imran/.test(sjd.msgs[0].text));
const p3 = call3({ op: 'post', ch: 'direct', root: l3.dms[0].root, name: 'Muhammad', text: 'Salaam', who: 'Abbas', rid: 'r9' });
ok('a line to Muhammad lands in his channel', p3.ok && W3.slack.ch['C0MUHAMMAD1'].msgs.length === 2 && call3({ op: 'list', who: 'Muhammad' }).dms[0].un === 1);
out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); if (!out.every(o => o[1])) { console.log(JSON.stringify({ a, m, i, r, p1, m2, th, a2 }).slice(0, 2500)); process.exit(1); }
