// Bill numbers: ONE series for the whole shop (relay `bills` op "next"), run against the REAL relay.gs with a fake Google Sheet.
const crypto = require('crypto'), F = require('../tools/test/fakes');
const PW = 'shop-test-pw', props = { MEMO_PASSWORD: PW, SLACK_BOT_TOKEN: 'xoxb-memo-test' };
const W = F.makeWorld(), relay = F.makeRelay(W, props);
function fakeSS(){ const sheets = {}; const mk = name => { const rows = []; const sh = { getName: () => name, setName: n => { name = n; return sh; }, appendRow: r => { rows.push(r.map(x => String(x == null ? '' : x))); return sh; }, setFrozenRows: () => sh,
    getRange: (a, b, c, d) => { if (typeof a === 'string') return { setNumberFormat: () => {} }; const r0 = a - 1, c0 = b - 1; return { setValue: v => { rows[r0][c0] = String(v); }, setValues: vs => { vs.forEach((vr, i) => { rows[r0 + i] = rows[r0 + i] || []; vr.forEach((v, j) => { rows[r0 + i][c0 + j] = String(v == null ? '' : v); }); }); }, setNumberFormat: () => {} }; },
    getDataRange: () => ({ getDisplayValues: () => rows.map(r => r.slice()) }), getLastRow: () => rows.length }; return sh; };
  const ss = { getId: () => 'ss1', getName: () => 'fake', getUrl: () => 'http://x', getSheets: () => Object.values(sheets), getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mk(n)) }; sheets.Sheet1 = mk('Sheet1'); return ss; }
const SS = {}; relay.ctx.SpreadsheetApp = { openById: id => SS[id], create: () => { const ss = fakeSS(); SS.ss1 = ss; return ss; } };
const call = (dev, o) => { const req = JSON.stringify(Object.assign({ t: Date.now(), dev, by: 'T' }, o)); return JSON.parse(relay.post(JSON.stringify({ job: 'bills', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const list = () => call('phA', { op: 'list' }).bills || [];
const out = [];
const a1 = call('phA', { op: 'next', type: 'inv', ref: 'INV-0001', name: 'X' }); out.push(['first number is kept (nobody used it)', a1.ok && a1.ref === 'INV-0001']);
const p1 = call('phA', { op: 'put', type: 'inv', ref: 'INV-0001', name: 'X', status: 'included', data: '{"v":1}' });
const b1 = call('phB', { op: 'next', type: 'inv', ref: 'INV-0001', name: 'Y' }); out.push(['another phone with the same number gets the next free one', p1.ok && b1.ok && b1.ref === 'INV-0002']);
const a2 = call('phA', { op: 'next', type: 'inv', ref: 'INV-0002', name: 'X' }); out.push(['a number reserved by another phone is never given twice', a2.ok && a2.ref === 'INV-0003']);
const b2 = call('phB', { op: 'next', type: 'inv', ref: 'INV-0002', name: 'Y' }); out.push(["a draft behind the shop's last number moves ahead; its old draft row is cleared", b2.ok && b2.ref === 'INV-0004' && !list().some(b => b.ref === 'INV-0002') && list().some(b => b.ref === 'INV-0004')]);
const b3 = call('phB', { op: 'next', type: 'inv', ref: 'INV-0004', name: 'Y' }); out.push(['asking again for your own reserved number keeps it', b3.ok && b3.ref === 'INV-0004']);
const r1 = call('phB', { op: 'next', type: 'rv', ref: 'RV-0001', name: 'Y' }); out.push(['receipts have their own series', r1.ok && r1.ref === 'RV-0001']);
out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); if (!out.every(o => o[1])) { console.log(a1, b1, a2, b2, b3, r1, list()); process.exit(1); }
