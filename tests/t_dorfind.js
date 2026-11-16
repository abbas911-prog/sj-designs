// New design order: which ALM card is copied (16 Nov 2026, Abbas: "when I add a new design card it does not copy the custom fields — e.g. SJ-12151").
// The real relay.gs `doFindCard`, with Trello's search answered by the real SJ-12151 cards of 14 Nov 2026: the newest one was the
// "SJ-12151 SAMPLE" card #samplesneed puts on RETURNS (no custom fields), and the order card copied from it carried its "From #samplesneed" text.
const path = require('path'), F = require(path.join(__dirname, '..', 'tools', 'test', 'fakes'));
const W = F.makeWorld(), R = F.makeRelay(W, { FRET_LISTS: JSON.stringify({ ret: '6ad16cc3bc43bdd2db0a1730', back: '6ad16cc39383dbae8291b7a2' }) });
const out = []; const ok = (n, v) => out.push([n, !!v]);
let CARDS = [];
R.ctx.trApi = (m, p, q) => { if (p === '/search') return { cards: CARDS.filter(c => c.name.indexOf(String(q.query).replace(/^SJ-/, '')) >= 0) }; throw new Error('not in this test: ' + p); };
const real = [
  { id: '6af870df2f48ba6d1f8dbfdc', name: 'SJ-12151 SAMPLE', idList: '6ad16cc3bc43bdd2db0a1730', desc: 'SJ-12151 SAMPLE\n\n_From #samplesneed · 14 Nov 2026 18:31_' },
  { id: '6af870b204323dd020ae2f57', name: 'SJ-12151 , OP , COLORS = 3 , SIZE = M,L,XL,XXL', idList: '6527c572b12b208471c080cb', desc: 'SJ-12151 SAMPLE\n\n_From #samplesneed · 10 Nov 2026 22:02_' },
  { id: '6af35c70405b3358951c84c6', name: 'SJ-12151 SAMPLE', idList: '6ad16cc39383dbae8291b7a2', desc: 'SJ-12151 SAMPLE\n\n_From #samplesneed · 10 Nov 2026 22:02_' },
  { id: '6aec7b5fa84b8d28e1021072', name: 'SJ-12151 SAMPLE', idList: '6ad16cc39383dbae8291b7a2', desc: 'SJ-12151 SAMPLE\n\n_From #samplesneed · 5 Nov 2026 16:49_' },
  { id: '6aec7b2f4f82bd2e31e9dce2', name: 'SJ-12151 , 16 PCS , COLORS = 3(BLACK=8,MEHROON=4,GREEN=4) , SIZE =M,L,XL,XXL', idList: '6527c5b41e630c094b619f5e', desc: '' },
  { id: '6ad110280fa319a309ffcea9', name: 'SJ-12151', idList: '68b77a221eef6fbb9a305e0e', desc: '' },
];
CARDS = real;
const a = R.ctx.doFindCard('12151', 't');
ok('SJ-12151: the real order card of 5 Nov (with its custom fields) is copied, not a #samplesneed SAMPLE card (' + (a && a.name) + ')', a && a.id === '6aec7b2f4f82bd2e31e9dce2');
const b = R.ctx.doFindCard('SJ-12151', 't');
ok('typed as SJ-12151 gives the same card', b && b.id === a.id);
CARDS = real.filter(c => /SAMPLE$/.test(c.name));
const c = R.ctx.doFindCard('12151', 't');
ok('only #samplesneed cards exist: the newest of them is still used (nothing else to copy)', c && c.id === '6af870df2f48ba6d1f8dbfdc');
CARDS = [{ id: '6b0000000000000000000001', name: 'SJ-77001 (40) pcs colour = (5) (8/8/8/8/8)', idList: '6527c5b41e630c094b619f5e', desc: '' }, { id: '6a0000000000000000000001', name: 'SJ-77001', idList: '68b77a221eef6fbb9a305e0e', desc: '' }];
const d = R.ctx.doFindCard('77001', 't');
ok('a design with no sample cards: the newest card, as before', d && d.id === '6b0000000000000000000001');
out.forEach(o => console.log((o[1] ? 'PASS ' : 'FAIL ') + o[0])); console.log(out.filter(o => o[1]).length + ' passed, ' + out.filter(o => !o[1]).length + ' failed');
if (!out.every(o => o[1])) process.exit(1);
