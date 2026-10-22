// Catalogue builder (22 Oct 2026, Abbas: "cut it so perfectly and keep the numbers so perfectly"): a sold-out colour is cut out of the
// photo at the real dress edge, the rest joined, the card's own colour numbers kept. Fake card (0/14/16/0/4/8) + a synthetic six-dress
// photo (CAT_LOCAL mode, no Trello), then the page is driven; plus the real 57026 studio photo as a guard on the cutter.
const { chromium } = require('playwright'); const { execFileSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const DIR = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sjcat-')), L = path.join(T, 'local'); fs.mkdirSync(L);
// a 1200x800 "line-up": six coloured dresses on a white wall
execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (1200, 800), (245, 243, 238)); d = ImageDraw.Draw(im)
cols = [(200,160,80),(30,30,35),(230,225,120),(150,170,120),(90,40,90),(200,90,120)]
for i, c in enumerate(cols): x = 40 + i * 190; d.rectangle([x, 120, x + 140, 720], fill=c)
im.save('${L}/p1.jpg', 'JPEG', quality=90)
import json; json.dump([{'id': 'abc123abc123abc123abc101', 'name': 'SJ-57026 (42) colour = (6) (0/14/16/0/4/8)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc102', 'name': 'SJ-48188 (12) colour = (3) (4/4/4)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]}], open('${L}/cards.json', 'w'))
`]);
const env = Object.assign({}, process.env, { CAT_LOCAL: L, PYTHONPATH: path.join(DIR, 'tools') + ':' + path.join(DIR, 'tools/catalog'), REQ: JSON.stringify({ id: 't1', name: 'TEST CUSTOMER', items: [{ no: '57026', mode: 'S' }] }), SIG: '' });
let out = execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env }).toString();
const res = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t1.json')));
const outs = []; const ok = (n, v) => outs.push([n, !!v]);
ok('page built', res.ok === true && fs.existsSync(path.join(T, res.page)));
const html = fs.existsSync(path.join(T, res.page || 'x')) ? fs.readFileSync(path.join(T, res.page), 'utf8') : '';
const ph = (html.match(/<div class="photo"[^>]*>/) || [''])[0];
ok('kept dresses carry the card numbers 2,3,5,6', ph.indexOf('data-nums="2,3,5,6"') >= 0);
const wm = html.match(/alt="Design 57026" width="(\d+)" height="800"/);
ok('photo cut to the four kept dresses (about 4/6 of the width)', wm && +wm[1] > 700 && +wm[1] < 900);
const cm = ph.match(/data-cols="([^"]+)"/); const cc = cm ? cm[1].split(';').map(p => p.split(',').map(Number)) : [];
ok('four columns of sensible width', cc.length === 4 && cc.every(([l, r]) => r - l > 0.15 && r - l < 0.40));
ok('order rows = colours 2, 3, 5, 6 with the card numbers', /data-k="57026:2"/.test(html) && /data-k="57026:6"/.test(html) && !/data-k="57026:1"/.test(html) && !/data-k="57026:4"/.test(html));
ok('report says 4 colours, flag says cut out', (res.report || []).join().indexOf('4 colours') >= 0 && (res.flags || []).join().indexOf('cut out') >= 0);
// the real 57026 studio photo (six dresses, sleeves touching): the cuts must land on the dress edges, checked by eye on 22 Oct 2026
const cuts = JSON.parse(execFileSync('python3', ['-c', `import sys; sys.path.insert(0, '${path.join(DIR, 'tools/catalog')}'); sys.path.insert(0, '${path.join(DIR, 'tools')}')
from PIL import Image; import build, json; im = Image.open('${path.join(DIR, 'tests/fixtures/lineup-57026.jpg')}'); print(json.dumps([x / im.width for x in build.find_bounds(im, 6)]))`]).toString());
const want = [0, 0.2425, 0.3787, 0.4988, 0.6225, 0.7438, 1];
ok('real photo: six dress edges found (within 1.5%)', cuts.length === 7 && cuts.every((x, i) => Math.abs(x - want[i]) < 0.015));
// sizes catalogue from an invoice: colours 2 and 5 billed → card numbers kept, others faded
const env2 = Object.assign({}, env, { REQ: JSON.stringify({ id: 't2', kind: 'sizes', ref: 'INV-1', cust: 'X', items: [{ card: 'abc123abc123abc123abc101', no: '57026', c: 2, pcs: 4 }, { card: 'abc123abc123abc123abc101', no: '57026', c: 5, pcs: 2 }] }) });
execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env: env2 });
const r2 = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t2.json')));
const h2 = r2.ok ? fs.readFileSync(path.join(T, r2.page), 'utf8') : '';
ok('sizes page: colours keep the card numbers 2 and 5, photo cut to two', r2.ok && /data-c="57026:2"/.test(h2) && /data-c="57026:5"/.test(h2) && !/data-c="57026:1"/.test(h2) && /<span>2<\/span><span>5<\/span>/.test(h2));
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(T, res.page)); await pg.waitForTimeout(400);
  ok('page shows 4 choosable rows', (await pg.$$eval('.colours .row', L => L.length)) === 4);
  ok('number badges 2 3 5 6 under the photo', (await pg.$eval('.photo .nums', e => e.textContent)) === '2356');
  await pg.click('#b-57026-2-1'); await pg.click('#ok'); await pg.waitForTimeout(1200);
  ok('order page opens with colour 2', !(await pg.$eval('#done', e => e.hidden)) && (await pg.evaluate(() => JSON.stringify(window.SJ_ORDER || {}))).indexOf('"c":2') >= 0);
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  // sizes page: pick 2 pcs of size M in colour 5 → the order line says colour 5
  if (r2.ok) { const p2 = await br.newPage({ viewport: { width: 390, height: 844 } }); await p2.goto('file://' + path.join(T, r2.page)); await p2.waitForTimeout(300);
    await p2.click('.sz[data-k="57026:5:0"] .pl'); await p2.click('#ok'); await p2.waitForTimeout(600);
    ok('sizes order line = colour 5', (await p2.$eval('#cards', e => e.textContent)).indexOf('colour 5') >= 0); }
  await br.close(); fs.rmSync(T, { recursive: true, force: true });
  let fail = 0; outs.forEach(([n, v]) => { if (!v) fail++; console.log((v ? 'ok   ' : 'FAIL ') + n); }); console.log(`\n${outs.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
