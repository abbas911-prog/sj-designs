// SJ Stock 🔔 "Send a test" against the REAL relay.gs (fake Apps Script + fake ntfy): ok when ntfy takes it; the real reason when ntfy refuses.
const crypto = require('crypto'), F = require('../tools/test/fakes');
const PW = 'shop-test-pw', props = { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-memo-test', CCNTFY: JSON.stringify({ ABBAS: 'sjstock-testtopic' }) };
const W = F.makeWorld(), relay = F.makeRelay(W, props);
const call = o => { const req = JSON.stringify(Object.assign({ t: Date.now() }, o)); return JSON.parse(relay.post(JSON.stringify({ job: 'cchat', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const out = [];
const a = call({ op: 'ntfytest', who: 'Abbas' }); out.push(['test reaches ntfy', a.ok === true && W.ntfy.length === 1 && W.ntfy[0].body.indexOf('Notifications are on for Abbas') >= 0]);
W.ntfyFail = true; const b = call({ op: 'ntfytest', who: 'Abbas' }); out.push(['refused test says why (429 + ntfy reason)', b.ok === false && /429/.test(b.error) && /quota/.test(b.error)]);
const c = call({ op: 'ntfytest', who: 'Musalim' }); out.push(['not turned on → says so', c.ok === false && /off for/.test(c.error)]);
out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); if (!out.every(o => o[1])) { console.log(a, b, c); process.exit(1); }
