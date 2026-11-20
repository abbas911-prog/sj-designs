// 20 Nov 2026: owner-only customer actions are refused by the relay itself (real relay.gs + fake Sheets), and the daily backup copy.
const path = require('path'), crypto = require('crypto'), F = require(path.join(__dirname, '..', 'tools', 'test', 'fakes'));
const PW = 'shop-test-pw', W = F.makeWorld(), relay = F.makeRelay(W, { MEMO_PASSWORD: PW });
function fakeSS(id){ const sheets = {}; const mk = name => { let rows = []; const sh = { get rows(){ return rows; }, getName: () => name, setName: n => { name = n; return sh; }, appendRow: r => { rows.push(r.map(x => String(x == null ? '' : x))); return sh; }, setFrozenRows: () => sh, clearContents: () => { rows = []; return sh; },
    getRange: (a, b) => { if (typeof a === 'string') return { setNumberFormat: () => {} }; const r0 = a - 1, c0 = b - 1; return { setValue: v => { rows[r0][c0] = String(v); }, setValues: vs => { vs.forEach((vr, i) => { rows[r0 + i] = rows[r0 + i] || []; vr.forEach((v, j) => { rows[r0 + i][c0 + j] = String(v == null ? '' : v); }); }); }, setNumberFormat: () => {} }; },
    getDataRange: () => ({ getDisplayValues: () => { const w = Math.max(0, ...rows.map(r => r.length)); return rows.map(r => { const x = r.slice(); while (x.length < w) x.push(''); return x; }); } }), getLastRow: () => rows.length }; return sh; };
  const ss = { getId: () => id, getName: () => id, getUrl: () => 'http://x/' + id, getSheets: () => Object.values(sheets), getSheetByName: n => Object.values(sheets).find(x => x.getName() === n) || null, insertSheet: n => (sheets[n] = mk(n)) }; sheets.Sheet1 = mk('Sheet1'); return ss; }
const SS = {}; let n = 0; relay.ctx.SpreadsheetApp = { openById: id => { if (!SS[id]) throw new Error('none'); return SS[id]; }, create: () => { const id = 'ss' + (++n), ss = fakeSS(id); SS[id] = ss; return ss; } };
const CHK = crypto.createHmac('sha256', '1234').update('sj-vault-owner').digest('hex');
const call = (dev, o, owner) => { const req = JSON.stringify(Object.assign({ t: Date.now(), dev, by: owner ? 'Abbas' : 'Muhammad' }, owner ? { chk: CHK } : {}, o)); return JSON.parse(relay.post(JSON.stringify({ job: 'cust', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }))); };
const out = []; const ok = (t, v) => out.push([t, !!v]);
call('own', { op: 'names' }, true);                                   // the owner phone is known to the relay first (as in real life)
let r = call('stf', { op: 'post', name: 'Matiullah', id: 'rv:RV-0001:stf', type: 'rv', ref: 'RV-0001', recv: 1000, open: 5000, date: '2026-11-20' });
ok('a staff receipt is posted and makes the customer (opening 5000 → balance 4000)', r.ok && r.bal === 4000);
r = call('stf', { op: 'post', name: 'Matiullah', id: 'adj:RV-0002:stf', type: 'adj', ref: 'RV-0002 adjust', adj: 9000, open: 13000, date: '2026-11-20' });
ok('staff "adjust" line: answered ok but left out — the balance stays 4000', r.ok && r.skipped && r.bal === 4000 && call('stf', { op: 'get', name: 'Matiullah' }).bal === 4000);
r = call('stf', { op: 'post', name: 'Matiullah', id: 'disc:RV-0001:stf', type: 'adj', ref: 'RV-0001 discount', adj: -100, date: '2026-11-20' });
ok('a staff discount line still goes (3900)', r.ok && !r.skipped && r.bal === 3900);
r = call('stf', { op: 'post', name: 'Matiullah', id: 'rn:RET-0001:stf', type: 'adj', ref: 'RET-0001 return', adj: -400, date: '2026-11-20' });
ok('a staff return line still goes (3500)', r.ok && r.bal === 3500);
ok('staff cannot change an opening balance', !call('stf', { op: 'setopen', name: 'Matiullah', open: 1 }).ok && call('stf', { op: 'get', name: 'Matiullah' }).bal === 3500);
ok('staff cannot delete a customer', !call('stf', { op: 'delcust', name: 'Matiullah' }).ok && call('stf', { op: 'get', name: 'Matiullah' }).found);
ok('another phone cannot delete this phone\'s line', !call('oth', { op: 'void', id: 'rv:RV-0001:stf' }).ok && call('stf', { op: 'get', name: 'Matiullah' }).bal === 3500);
ok('a phone can take back its own line (Undo): return voided → 3900', call('stf', { op: 'void', id: 'rn:RET-0001:stf' }).ok && call('stf', { op: 'get', name: 'Matiullah' }).bal === 3900);
r = call('own', { op: 'post', name: 'Matiullah', id: 'adj:RV-0003:own', type: 'adj', ref: 'RV-0003 adjust', adj: 100, date: '2026-11-20' }, true);
ok('the owner phone\'s adjust line is taken (4000)', r.ok && !r.skipped && r.bal === 4000);
ok('the owner changes the opening (6000 → 5000)', call('own', { op: 'setopen', name: 'Matiullah', open: 6000 }, true).bal === 5000);
ok('the owner deletes another phone\'s line', call('own', { op: 'void', id: 'rv:RV-0001:stf' }, true).ok);
ok('a wrong owner proof counts as staff', !JSON.parse(relay.post((() => { const req = JSON.stringify({ t: Date.now(), dev: 'x', op: 'setopen', name: 'Matiullah', open: 1, chk: 'f'.repeat(64) }); return JSON.stringify({ job: 'cust', req, sig: crypto.createHmac('sha256', PW).update(req).digest('hex') }); })())).ok);
// backup: one copy per day, tabs named by weekday, a second post the same day makes no second copy
const bk = Object.values(SS).find(s => s.getSheets().some(x => /ENTRIES$/.test(x.getName()) && x.getName() !== 'ENTRIES'));
const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.now() + 4 * 3600e3).getUTCDay()];
ok('a backup sheet exists with today\'s tabs (' + dow + ' CUSTOMERS / ENTRIES)', !!bk && !!bk.getSheetByName(dow + ' CUSTOMERS') && !!bk.getSheetByName(dow + ' ENTRIES'));
ok('the backup was taken BEFORE the day\'s first change (headers only, no lines yet)', !!bk && bk.getSheetByName(dow + ' ENTRIES').rows.length === 1 && bk.getSheetByName(dow + ' ENTRIES').rows[0][0] === 'ID');
relay.ctx.PropertiesService.getScriptProperties().setProperty('CUST_BK_DAY', '2000-01-01'); call('stf', { op: 'post', name: 'Matiullah', id: 'rv:RV-0009:stf', type: 'rv', ref: 'RV-0009', recv: 1, date: '2026-11-20' });
ok('next day: the copy is refreshed with every line so far', !!bk && bk.getSheetByName(dow + ' ENTRIES').rows.length >= 5 && bk.getSheetByName(dow + ' CUSTOMERS').rows.some(x => x[1] === 'Matiullah'));
out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed');
if (!out.every(o => o[1])) process.exit(1);
