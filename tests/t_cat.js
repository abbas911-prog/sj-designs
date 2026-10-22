// Catalogue builder (22 Oct 2026, Abbas: 57026 "it's half ... very confusing"): a sold-out colour is never cut out of the photo any more.
// Builds a page from a fake card (0/14/16/0/4/8) with a synthetic six-dress photo (CAT_LOCAL mode, no Trello), then drives the page.
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
ok('all six dresses numbered, nothing cut', ph.indexOf('data-nums="1,2,3,4,5,6"') >= 0 && /width="1200" height="800"/.test(html));
ok('two sold-out veils (colours 1 and 4)', (html.match(/<i class="sold"/g) || []).length === 2 && /<span class="out">1<\/span>/.test(html) && /<span class="out">4<\/span>/.test(html));
ok('veil sits over the first dress', /<i class="sold" style="left:0\.00%;width:1[4-9]\.\d\d%"/.test(html));
ok('order rows = colours 2, 3, 5, 6 with the card numbers', /data-k="57026:2"/.test(html) && /data-k="57026:6"/.test(html) && !/data-k="57026:1"/.test(html) && !/data-k="57026:4"/.test(html));
ok('report says 4 colours, flag says faded not cut', (res.report || []).join().indexOf('4 colours') >= 0 && (res.flags || []).join().indexOf('shown faded') >= 0 && (res.flags || []).join().indexOf('cut out') < 0);
// sizes catalogue from an invoice: colours 2 and 5 billed → card numbers kept, others faded
const env2 = Object.assign({}, env, { REQ: JSON.stringify({ id: 't2', kind: 'sizes', ref: 'INV-1', cust: 'X', items: [{ card: 'abc123abc123abc123abc101', no: '57026', c: 2, pcs: 4 }, { card: 'abc123abc123abc123abc101', no: '57026', c: 5, pcs: 2 }] }) });
execFileSync('python3', [path.join(DIR, 'tools/catalog/build.py')], { cwd: T, env: env2 });
const r2 = JSON.parse(fs.readFileSync(path.join(T, 'jobs/t2.json')));
const h2 = r2.ok ? fs.readFileSync(path.join(T, r2.page), 'utf8') : '';
ok('sizes page: colours keep the card numbers 2 and 5', r2.ok && /data-c="57026:2"/.test(h2) && /data-c="57026:5"/.test(h2) && !/data-c="57026:1"/.test(h2) && (h2.match(/<i class="sold"/g) || []).length === 4);
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(T, res.page)); await pg.waitForTimeout(400);
  ok('page shows 4 choosable rows', (await pg.$$eval('.colours .row', L => L.length)) === 4);
  ok('veils visible on the photo', (await pg.$$eval('.photo .sold', L => L.filter(e => e.getClientRects().length).length)) === 2);
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
