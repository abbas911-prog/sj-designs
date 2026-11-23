"""23 Nov 2026 (Abbas, catalogue abbas-1114): (1) the cutter on real studio photos - SJ-90856 showed three dresses over the numbers 3 and 4;
(2) live catalogues - a page is built again in place when its cards change. CAT_LOCAL mode: no Trello."""
import json, os, re, shutil, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); FX = os.path.join(ROOT, 'tests', 'fixtures', '1123')
BUILD = os.environ.get('BUILD_PY') or os.path.join(ROOT, 'tools', 'catalog', 'build.py')
T = tempfile.mkdtemp(prefix='sjlive-'); L = os.path.join(T, 'local'); os.makedirs(L); os.makedirs(os.path.join(T, 'thumbs'))
for f in os.listdir(FX): shutil.copy(os.path.join(FX, f), L)
json.dump({'6adc812fcdc75172938cbf66': ['cover', 0.878], '6a6e2305c8e609c4171220a5': ['cover'], '6a5de1326624758a7c05e0b3': ['cover'], '6a5de12f5f989f4e59527466': ['lineup', 0.907, 'jamal']}, open(os.path.join(T, 'thumbs', 'roles.json'), 'w'))
def att(i, d): return {'id': i, 'name': 'photo.png', 'mimeType': 'image/png', 'date': d, 'url': 'x'}
CARDS = [
  {'id': '6a6e2242b816c732e2d4ab86', 'pos': 1, 'name': 'Sj = **(90856)** (32) pcs color = (4) ,,,,(0/0/8/8/0)—(8/0/8)', 'attachments': [att('6adc812fcdc75172938cbf66', '2026-10-24T09:58:07Z'), att('6a6e2305c8e609c4171220a5', '2026-08-01T16:47:01Z')]},
  {'id': '69d7a921e01bbe6a83809626', 'pos': 2, 'name': 'Sj = **65082** (36) pcs (5) colors (12/4/0/16/4)', 'attachments': [att('6a5de1326624758a7c05e0b3', '2026-07-20T08:49:54Z')]},
]
def cards(c): json.dump(c, open(os.path.join(L, 'cards.json'), 'w'))
ENV = dict(os.environ, CAT_LOCAL=L)
def py(code):
    r = subprocess.run([sys.executable, '-c', 'import sys, os, importlib.util\nsys.argv=["x"]\nspec = importlib.util.spec_from_file_location("build", %r)\nB = importlib.util.module_from_spec(spec); sys.modules["build"] = B; sys.path.insert(0, %r); spec.loader.exec_module(B)\n' % (BUILD, os.path.dirname(os.path.join(ROOT, 'tools', 'catalog', 'x'))) + code], cwd=T, env=ENV, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:])
    return r.stdout
out = []
def ok(name, v): out.append((name, bool(v)))
# ---- 1. the cutter on the real photos
cards(CARDS)
w = json.loads(py('''
from PIL import Image
import json
res = {}
for i, n in [("6adc812fcdc75172938cbf66", 5), ("6a5de1326624758a7c05e0b3", 5), ("6a5de12f5f989f4e59527466", 6), ("6a6e2305c8e609c4171220a5", 3)]:
    im = Image.open(os.path.join(os.environ["CAT_LOCAL"], i + ".jpg")).convert("RGB"); c = B.find_cuts(im, n); ws = [c[k+1] - c[k] for k in range(n)]
    res[i] = max(ws) / min(ws)
print(json.dumps(res))''') or '{}')
ok('SJ-90856 studio photo (white dress on a white wall): the five dresses come out about evenly (widest/narrowest %.2f)' % w.get('6adc812fcdc75172938cbf66', 99), w.get('6adc812fcdc75172938cbf66', 99) < 1.6)
ok('SJ-65082 "SAYED JAMAL" photo: even too (%.2f)' % w.get('6a5de1326624758a7c05e0b3', 99), w.get('6a5de1326624758a7c05e0b3', 99) < 1.6)
ok('SJ-65082 six-dress studio photo: even too (%.2f)' % w.get('6a5de12f5f989f4e59527466', 99), w.get('6a5de12f5f989f4e59527466', 99) < 1.6)
ok('a photo the cutter already got right is left alone (%.2f)' % w.get('6a6e2305c8e609c4171220a5', 99), w.get('6a6e2305c8e609c4171220a5', 99) < 1.2)
# ---- 2. live: make a page the normal way, then change the cards
req = {'id': 'zt1', 'name': 'Abbas', 'country': 'Qatar', 'items': [{'no': '90856', 'mode': 'S'}, {'no': '65082', 'mode': 'S'}]}
subprocess.run([sys.executable, BUILD], cwd=T, env=dict(ENV, REQ=json.dumps(req), SIG='x'), capture_output=True, text=True)
res = json.load(open(os.path.join(T, 'jobs', 'zt1.json'))) if os.path.exists(os.path.join(T, 'jobs', 'zt1.json')) else {}
page = os.path.join(T, res.get('page', 'none.html')); stem = res.get('page', 'x.html')[:-5]
def nums():
    s = open(page, encoding='utf-8').read(); pos = [(m.start(), m.group(1)) for m in re.finditer(r'data-no="(\d[^"]*)"', s)]; r = {}
    for m in re.finditer(r'<div class="photo" data-nums="([\d,]*)"', s):
        no = [n for p, n in pos if p < m.start()]; r.setdefault(no[-1] if no else '?', []).append(m.group(1))
    return r
cj = os.path.join(T, 'cat', stem + '.json')
ok('a new catalogue keeps its request in cat/<page>.json, each design with its card', res.get('ok') and os.path.exists(cj) and [i.get('card') for i in json.load(open(cj))['items']] == ['6a6e2242b816c732e2d4ab86', '69d7a921e01bbe6a83809626'])
n0 = nums() if res.get('ok') else {}
ok('built: 90856 shows colours 3,4 and 6,8; 65082 shows 1,2,4,5 (%s)' % n0, n0.get('90856') == ['3,4', '6,8'] and n0.get('65082') == ['1,2,4,5'])
LIVE = 'import runpy\nsys.argv=["live.py"]\nsys.path.insert(0, %r)\nrunpy.run_path(%r, run_name="__main__")' % (os.path.join(ROOT, 'tools', 'catalog'), os.path.join(ROOT, 'tools', 'catalog', 'live.py'))
m0 = os.path.getmtime(page); o = py(LIVE)
ok('nothing changed on Trello: the page is not touched', os.path.getmtime(page) == m0 and 'nothing changed' in o)
# a sale: 90856 colour 3 sold out, colour 7 comes back; 65082 leaves READY
c2 = json.loads(json.dumps(CARDS)); c2[0]['name'] = 'Sj = **(90856)** (28) pcs color = (4) ,,,,(0/0/0/8/0)—(8/4/8)'; cards([c2[0]])
o = py(LIVE); n1 = nums()
ok('after a sale the SAME page is built again by itself: 90856 now 4 and 6,7,8; 65082 (left READY) is gone (%s)' % n1, 'built again' in o and n1.get('90856') == ['4', '6,7,8'] and '65082' not in n1)
ok('same link: no second page was made', len([f for f in os.listdir(T) if f.endswith('.html')]) == 1)
m1 = os.path.getmtime(page); py(LIVE)
ok('and it is not built a second time for the same change', os.path.getmtime(page) == m1)
cards([]); o = py(LIVE)
ok('everything sold: the page is left as it is, not emptied', os.path.getmtime(page) == m1 and 'left as it is' in o)
for n, v in out: print(('PASS ' if v else 'FAIL ') + n)
print('%d passed, %d failed' % (sum(1 for _, v in out if v), sum(1 for _, v in out if not v)))
sys.exit(0 if all(v for _, v in out) else 1)
