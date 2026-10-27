// Catalogue builder (22 Oct 2026, Abbas: "cut it so perfectly and keep the numbers so perfectly"): a sold-out colour is cut out of the
// photo at the real dress edge, the rest joined, the card's own colour numbers kept. Fake card (0/14/16/0/4/8) + a synthetic six-dress
// photo (CAT_LOCAL mode, no Trello), then the page is driven; plus the real 57026 studio photo as a guard on the cutter.
const { chromium } = require('playwright'); const { execFileSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const DIR = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sjcat-')), L = path.join(T, 'local'); fs.mkdirSync(L); const F79 = path.join(__dirname, 'fixtures/79623');
// a 1200x800 "line-up": six coloured dresses on a white wall
execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (1200, 800), (245, 243, 238)); d = ImageDraw.Draw(im)
cols = [(200,160,80),(30,30,35),(230,225,120),(150,170,120),(90,40,90),(200,90,120)]
for i, c in enumerate(cols): x = 40 + i * 190; d.rectangle([x, 120, x + 140, 720], fill=c)
im.save('${L}/p1.jpg', 'JPEG', quality=90)
# the real SJ-79623 card (Nasir, 23 Oct 2026): 5 Trello photos (shop shot, shop 3, shop 6, JAMAL 3, JAMAL 6) as the repo's thumbnails
import shutil, os, json; os.makedirs('${T}/thumbs', exist_ok=True)
for f in os.listdir('${F79}'): shutil.copy(os.path.join('${F79}', f), '${L}/' + f)
json.dump({'6a368bee72fb291b1477f713': ['shot'], '6a381658df3773d1ea5397da': ['lineup'], '6a38168c84e0eb6464b9ab4d': ['lineup'], '6a58efc843b0bc351f6ed77f': ['cover'], '6a58efd612e8e3518909c3bb': ['lineup']}, open('${T}/thumbs/roles.json', 'w'))
att79 = [('6a368bee72fb291b1477f713', 'photo.jpeg', '2026-06-20T12:47:42Z'), ('6a381658df3773d1ea5397da', 'photo.jpeg', '2026-06-21T16:50:32Z'), ('6a38168c84e0eb6464b9ab4d', 'photo.jpeg', '2026-06-21T16:51:24Z'), ('6a58efc843b0bc351f6ed77f', 'photo.png', '2026-07-16T14:50:48Z'), ('6a58efd612e8e3518909c3bb', 'photo.png', '2026-07-16T14:51:02Z')]
json.dump([{'id': '6a324a6384a02f213399fefe', 'name': 'SJ = **(79623)** (96) pcs color = (9) ,,,, (16/8/8/8/16/16)..(8/8/8)', 'attachments': [{'id': i, 'name': n, 'mimeType': 'image/jpeg', 'date': d, 'url': 'x'} for i, n, d in att79]},
  {'id': '6a324a6384a02f213399feff', 'name': 'SJ = **(79624)** (96) pcs color = (9) (8/8/8) (16/8/8/8/16/16)', 'attachments': [{'id': i, 'name': n, 'mimeType': 'image/jpeg', 'date': d, 'url': 'x'} for i, n, d in att79[1:3]]},
  {'id': 'abc123abc123abc123abc101', 'name': 'SJ-57026 (42) colour = (6) (0/14/16/0/4/8)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc102', 'name': 'SJ-48188 (12) colour = (3) (4/4/4)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc201', 'name': 'Sj 6668 (40) 5 colors (8/8/8/8/8)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc203', 'name': 'Sj 6668 (70 pcs) 5 colors (14/14/14/14/14)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc202', 'name': 'Sj = **(6668)**(65pcs) 5 color (13/13/13/13/13)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc204', 'name': 'Sj 6668 (pcs67) 5 colors.     (14/13/14/14/12/)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc205', 'name': 'SJ = **6668** (60) pcs ,,, colors = (5) ,,,,,,', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]},
  {'id': 'abc123abc123abc123abc301', 'name': 'Sj = **(57027)** (38) pcs __ Colour= (6)__(0-3/14-3/16-3/0-3/8-3//0-3)', 'attachments': [{'id': 'p1', 'name': 'file_x.jpg', 'mimeType': 'image/jpeg', 'date': '2026-10-01', 'url': 'x'}]}], open('${L}/cards.json', 'w'))
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
// "6668 all" (23 Oct 2026): every READY card of that number, each its own design, oldest card first
const env3 = Object.assign({}, env, { REQ: JSON.stringify({ id: 't3', name: 'ALL TEST', items: [{ no: '6668 all', mode: 'S' }, { no: '57026', mode: 'S' }, { no: '57027', mode: 'S' }] }) });
execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env: env3 });
const r3 = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t3.json'))); const h3 = r3.ok ? fs.readFileSync(path.join(T, r3.page), 'utf8') : '';
ok('"6668 all" → designs 6668_01…_04 + 57026 + 57027; the card with no colour counts (_05) is left out, the page is still made', r3.ok && (h3.match(/<article class="design" data-no="([^"]+)"/g) || []).map(x => x.match(/data-no="([^"]+)"/)[1]).join() === '6668_01,6668_02,6668_03,6668_04,57026,57027');
// 27 Oct 2026 (Abbas, 57026 "(0-3/14-3/16-3/0-3/8-3//0-3)": "why 7 when colours are 6?"): the double slash is not a colour — 6 colours, kept 2, 3, 5
ok('"(8-3//0-3)" = 6 colours: kept dresses 2, 3, 5', /data-no="57027"[\s\S]*?data-nums="2,3,5" data-n="3"/.test(h3) && (r3.report || []).some(l => /57027 SETS +0\+14\+16\+0\+8\+0 = 38 ✓ \(card: 38\) → 3 colours/.test(l)));
ok('oldest card is _01 (40 pcs), _03 (70 pcs)', /data-no="6668_01"[\s\S]*?data-k="6668_01:1"/.test(h3) && (r3.report || []).some(l => /6668 all: 5 READY cards/.test(l)) && /data-c="6668_03:1"|data-k="6668_03:1"/.test(h3));
// 23 Oct 2026 (Abbas: "the numbers add up, why does it say they don't?"): "(pcs67)" reads as 67, the stray slash in "(14/13/14/14/12/)" is not a 6th colour
ok('"(pcs67) … (14/13/14/14/12/)" = 5 colours, 67 pcs, photo NOT cut', /data-no="6668_04"[\s\S]*?data-nums="1,2,3,4,5" data-n="5"><img/.test(h3) && (r3.report || []).some(l => /6668_04 SETS +14\+13\+14\+14\+12 = 67 ✓ \(card: 67\) → 5 colours/.test(l)));
ok('the unreadable card is named in the flags with its title', (r3.flags || []).some(f => /6668_05 LEFT OUT: "SJ = \*\*6668\*\* \(60\) pcs/.test(f) && /no colour counts in the title/.test(f)));
// Nasir / SJ-79623 (23 Oct 2026): groups 6 + 3 colours; the old pick (shop line-ups first, newest first) gave the 3-colour group a
// 6-dress shop photo. Now each group gets the photo that splits into its dress count: JAMAL 6 (500x359) and JAMAL 3 (500x368).
const env4 = Object.assign({}, env, { REQ: JSON.stringify({ id: 't4', name: 'NASIR TEST', items: [{ no: '79623', mode: 'S' }] }) });
execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env: env4 });
const r4 = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t4.json'))); const h4 = r4.ok ? fs.readFileSync(path.join(T, r4.page), 'utf8') : '';
const ph4 = [...h4.matchAll(/<div class="photo"[^>]*data-nums="([^"]*)"[^>]*>\s*<img[^>]*width="(\d+)" height="(\d+)"/g)].map(m => [m[1], Math.round(100 * m[2] / m[3])]);
ok('79623: 6-colour group = the 6-dress JAMAL photo, 3-colour group = the 3-dress JAMAL photo', r4.ok && ph4.length === 2 && ph4[0][0] === '1,2,3,4,5,6' && ph4[0][1] === 139 && ph4[1][0] === '7,8,9' && ph4[1][1] === 136);
ok('79623: both are JAMAL photos (the 6-dress one found by its logo, the sorter had called it a shop photo) - no warning', !(r4.flags || []).some(f => /79623/.test(f)));
// the same card with only the two shop photos and the groups the other way round (3 first, then 6): the upload sequence rules
// (newest photo = first group) even though the counts disagree - and the job warns
const env5 = Object.assign({}, env, { REQ: JSON.stringify({ id: 't5', name: 'SEQ TEST', items: [{ no: '79624', mode: 'S' }] }) });
execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env: env5 });
const r5 = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t5.json'))); const h5 = r5.ok ? fs.readFileSync(path.join(T, r5.page), 'utf8') : '';
const ph5 = [...h5.matchAll(/<div class="photo"[^>]*data-nums="([^"]*)"[^>]*>\s*<img[^>]*width="(\d+)" height="(\d+)"/g)].map(m => [m[1], Math.round(100 * m[2] / m[3])]);
ok('no JAMAL photo: the newest photo goes to the first group, whatever the counts (sequence kept)', r5.ok && ph5.length === 2 && ph5[0][0] === '1,2,3' && ph5[0][1] === 157 && ph5[1][0] === '4,5,6,7,8,9' && ph5[1][1] === 79);
ok('... and the job warns that the photos may not match the groups', (r5.flags || []).some(f => /79624: the photos may not match the colour groups \(3 \+ 6\)/.test(f)) && (r5.flags || []).some(f => /79624: no JAMĀL photo/.test(f)));
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
