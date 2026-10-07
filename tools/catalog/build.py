#!/usr/bin/env python3
"""CATALOGUE from the order memo (Abbas, 7 Oct 2026: "when I press it and I write down design numbers ... complete or sets
you need to generate a catalog in link inside that HTML ... the exact same thing ... so everything happens in one place").

The same customer page the chat runs built (sj-1005b, sj-1005, sj-1003, ahmad-libya, sj-18634), by the same rules
(project doc "Customer Order Page - RULES"), now built here on GitHub Actions — no Claude, no AI:
  * customer name (+ country) at the top, nothing else written across the top (Rule Ten)
  * per design SETS or COMPLETE, page can mix them, designs in the order given (Rules Twelve, Sixteen)
  * newest READY card for a design number; photos JAMAL first (Rule Two), newest photo = first colour group (Rule One)
  * the sum is run and must match the card, or nothing is built (Rule Three); a 0 colour is CUT OUT of the photo, the rest renumbered
  * chips by Rule Four (leftover rides on the top chip), pre-rendered in the HTML (Rule Five)
  * the card video under the photos, re-encoded to ~4-6 MB, served from vid/<no>.mp4 (Rule Eleven)
  * no prices, no piece counts on the page (Rule Eight); Send order = one PDF (Seven-A); Share button on every photo/video
  * link preview cover og-<page>.jpg + tags, so the link arrives like a catalogue
Input: env REQ = {"id","name","country","items":[{"no":"46209","mode":"C"|"S"}]}, SIG = HMAC-SHA256(shop password, REQ).
Output: <page>.html, og-<page>.jpg, vid/*.mp4, jobs/<id>.json (read by memo.html)."""
import base64, datetime, hashlib, hmac, io, json, os, re, subprocess, sys, tempfile, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
from stock import parse                      # the one card-title reader shared with the stock job
from apply import apply as _apply

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
TOKEN = os.environ.get('TRELLO_TOKEN', '').strip()
READY = '66254dc6f8ade3c3a0c9b7d4'
BASE = 'https://abbas911-prog.github.io/sj-designs/'
AUTH = {'Authorization': f'OAuth oauth_consumer_key="{KEY}", oauth_token="{TOKEN}"'}
LOCAL = os.environ.get('CAT_LOCAL')          # test mode: a folder holding cards.json + photos, no Trello

def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=120) as r:
        return r.read()
def api_url(u):
    for pre in ('https://trello.com', 'https://api.trello.com'):
        if u.startswith(pre): return 'https://api.trello.com' + u[len(pre):]
    return u

# ---------- reading Trello ----------
def ready_cards():
    if LOCAL: return json.load(open(os.path.join(LOCAL, 'cards.json')))
    q = urllib.parse.urlencode({'fields': 'name,idShort', 'attachments': 'true',
                                'attachment_fields': 'id,name,mimeType,date,url,bytes', 'key': KEY, 'token': TOKEN})
    return json.loads(get(f'https://api.trello.com/1/lists/{READY}/cards?{q}'))

def photo(a):
    if LOCAL: return ImageOps.exif_transpose(Image.open(os.path.join(LOCAL, a['id'] + '.jpg'))).convert('RGB')
    return ImageOps.exif_transpose(Image.open(io.BytesIO(get(api_url(a['url']), AUTH)))).convert('RGB')

ROLES = {}
try: ROLES = json.load(open('thumbs/roles.json'))
except Exception: pass
try:
    for k, v in json.load(open('tools/labels.json')).items(): ROLES[k] = [v]
except Exception: pass
def role(a):
    r = ROLES.get(a['id'])
    if r: return r[0]
    n = a.get('name', '').lower()
    return 'cover' if n.startswith('file_') or 'chatgpt' in n else 'lineup'

# ---------- cutting a sold-out (0) dress out of the photo (Rule Three; same edge finder as the sj-1003 run) ----------
def find_bounds(im, n, band=(0.45, 0.80), search=0.30):
    W, H = im.size
    a = np.asarray(im.resize((800, max(1, int(800 * H / W)))), dtype=np.float32)
    h, w = a.shape[0], a.shape[1]
    col = a[int(h * band[0]):int(h * band[1])].mean(axis=0)
    d = np.linalg.norm(col[4:] - col[:-4], axis=1); d = np.pad(d, (2, 2)); d = np.convolve(d, np.ones(9) / 9, 'same')
    span, out = w / n, []
    for i in range(1, n):
        g = span * i; lo, hi = int(g - span * search), int(g + span * search)
        out.append((lo + int(np.argmax(d[lo:hi]))) * W / w)
    return [0.0] + out + [float(W)]

def keep_columns(im, pcs):
    """pcs = pieces per dress left->right. Returns (image with the 0 dresses removed, kept pcs, column fractions)."""
    n = len(pcs)
    if all(p > 0 for p in pcs): return im, pcs, None
    b = find_bounds(im, n)
    parts = [(int(round(b[i])), int(round(b[i + 1]))) for i in range(n) if pcs[i] > 0]
    W = sum(r - l for l, r in parts)
    out = Image.new('RGB', (W, im.height), 'white'); x = 0; cols = []
    for l, r in parts:
        out.paste(im.crop((l, 0, r, im.height)), (x, 0)); cols.append((x / W, (x + r - l) / W)); x += r - l
    return out, [p for p in pcs if p > 0], cols

# ---------- page text (same as build6 / sj-1005b) ----------
AR_D = '٠١٢٣٤٥٦٧٨٩'
def arD(n): return ''.join(AR_D[int(c)] for c in str(n))
def arFull(n): return {1: 'طقم كامل', 2: 'طقمان كاملان'}.get(n, arD(n) + ' أطقم كاملة')
def arSets(n): return 'طقم واحد' if n == 1 else ('طقمان' if n == 2 else arD(n) + ' أطقم')
def arPcs(n): return 'قطعة واحدة' if n == 1 else ('قطعتان' if n == 2 else arD(n) + (' قطع' if n <= 10 else ' قطعة'))
def opts(p, unit):
    full, r = p // unit, p % unit
    if full > 4: return [1, 2, 3, 4]
    if full == 0: return ['F'] if r else []
    if r == 0: return list(range(1, full + 1))
    return list(range(1, full)) + ['F']

def build(req):
    name = re.sub(r'\s+', ' ', str(req.get('name', ''))).strip().upper()[:60]
    sub = re.sub(r'\s+', ' ', str(req.get('country', ''))).strip().upper()[:40]
    items, seen = [], set()
    for it in req.get('items', []):
        no = re.sub(r'\D', '', str(it.get('no', '')))
        if no and no not in seen: seen.add(no); items.append((no, 'C' if str(it.get('mode', 'S')).upper().startswith('C') else 'S'))
    if not items: return {'ok': False, 'error': 'No design numbers.'}
    cards = ready_cards()
    errors, report, flags = [], [], []
    MODE, TOT, COLS, PCSS, PHOTOS, VIDS, ORDER = {}, {}, {}, {}, {}, {}, []
    for no, mode in items:
        mine = [c for c in cards if parse(c['name'])['no'] == no]
        if not mine: errors.append('SJ-%s is not in READY on Trello.' % no); continue
        mine.sort(key=lambda c: c['id'], reverse=True)            # "the last one added in trello" = newest card id
        card = mine[0]
        if len(mine) > 1: flags.append('SJ-%s has %d READY cards — used the newest: %s' % (no, len(mine), card['name']))
        p = parse(card['name'])
        cells = [c[0] for c in p['cells']]
        tot = p['total'][0] if p['total'] else None
        line = '%s = %d %s (card: %s)' % ('+'.join(map(str, cells)) or '—', sum(cells), '✓' if p['ok'] else '✗', tot if tot is not None else '?')
        if not p['ok']:
            errors.append('SJ-%s: %s — the colours do not add up to the card total. Fix the card in Trello, then make the catalogue again.' % (no, line)); continue
        if sum(cells) == 0: errors.append('SJ-%s: every colour is 0 — nothing to offer.' % no); continue
        # colour groups, in title order
        groups, k = [], 0
        for g in group_sizes(card['name']):
            groups.append(cells[k:k + g]); k += g
        if k < len(cells): groups.append(cells[k:])
        att = sorted(card.get('attachments', []), key=lambda a: a.get('date', ''), reverse=True)    # newest first = first group
        imgs = [a for a in att if str(a.get('mimeType', '')).startswith('image/')]
        covers = [a for a in imgs if role(a) == 'cover']; lineups = [a for a in imgs if role(a) == 'lineup']
        if len(covers) >= len(groups): pick = covers[:len(groups)]
        elif lineups: pick = (lineups + covers)[:len(groups)]; flags.append('SJ-%s: no JAMĀL photo for every colour group — shop photo used.' % no)
        else: pick = imgs[:len(groups)]
        if not pick: errors.append('SJ-%s: no photo on the card.' % no); continue
        while len(pick) < len(groups):                             # fewer photos than groups: the rest ride on the last photo
            groups[-2] = groups[-2] + groups[-1]; groups.pop()
        ORDER.append(no); MODE[no] = mode; PHOTOS[no] = []
        cut = []
        if mode == 'C':
            live = [q for q in cells if q > 0]
            TOT[no], COLS[no] = sum(live), len(live)
            for a, g in zip(pick, groups):
                im, kept, cols = keep_columns(photo(a), g)
                if not kept: continue
                if len(kept) < len(g): cut.append(len(g) - len(kept))
                PHOTOS[no].append((im, list(range(1, len(kept) + 1)), cols))
            u = COLS[no] * 4
            report.append('SJ-%s COMPLETE  %s → %d complete sets%s' % (no, line, TOT[no] // u, (' + %d pcs' % (TOT[no] % u)) if TOT[no] % u else ''))
        else:
            c, PCSS[no] = 0, {}
            for a, g in zip(pick, groups):
                im, kept, cols = keep_columns(photo(a), g)
                if not kept: continue
                if len(kept) < len(g): cut.append(len(g) - len(kept))
                nums = []
                for q in kept: c += 1; PCSS[no][c] = q; nums.append(c)
                PHOTOS[no].append((im, nums, cols))
            report.append('SJ-%s SETS  %s → %d colours' % (no, line, c))
        if cut: flags.append('SJ-%s: %d sold-out colour%s cut out of the photo and the rest renumbered — check the photo.' % (no, sum(cut), '' if sum(cut) == 1 else 's'))
        vids = [a for a in att if str(a.get('mimeType', '')).startswith('video/')]
        if vids and video(no, vids[0]): VIDS[no] = 1
    if errors: return {'ok': False, 'error': ' '.join(errors), 'errors': errors, 'report': report}
    stem = page_stem(name)
    html = render(stem, name, sub, ORDER, MODE, TOT, COLS, PCSS, PHOTOS, VIDS)
    html = _apply(html)                                            # PDF-only send + Share on every photo/video
    open(stem + '.html', 'w', encoding='utf-8').write(html)
    n = og_cover(html, stem, name, sub)
    html = og_meta(html, stem, name, sub, n)
    open(stem + '.html', 'w', encoding='utf-8').write(html)
    return {'ok': True, 'page': stem + '.html', 'url': BASE + stem + '.html?v=1', 'cover': 'og-%s.jpg' % stem,
            'name': name, 'country': sub, 'designs': ORDER, 'report': report, 'flags': flags,
            'videos': sorted(VIDS), 'bytes': os.path.getsize(stem + '.html')}

def group_sizes(title):
    s = title.replace('**', '  ').replace('{', '(').replace('}', ')')
    ci = re.search(r'colou?rs?', s, re.I); tail = (s[ci.start():] if ci else s) + ')'
    return [len(g.group(1).split('/')) for g in re.finditer(r'\(([^()]*/[^()]*?)\)', tail)]

def page_stem(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:30] or 'sj'
    base = '%s-%s' % (slug, datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=4))).strftime('%m%d'))
    stem, i = base, 0
    while os.path.exists(stem + '.html'):
        i += 1; stem = base + 'bcdefghijklmnop'[i - 1]
    return stem

def video(no, a):
    """Rule Eleven: re-encode to 640-720 px short side, H.264, ~4-6 MB, vid/<no>.mp4; reused when it is the same clip."""
    os.makedirs('vid', exist_ok=True)
    mark = 'vid/%s.src' % no
    if os.path.exists('vid/%s.mp4' % no) and os.path.exists(mark) and open(mark).read().strip() == a['id']: return True
    if LOCAL: return os.path.exists('vid/%s.mp4' % no)
    try:
        with tempfile.TemporaryDirectory() as t:
            src = os.path.join(t, 'in'); open(src, 'wb').write(get(api_url(a['url']), AUTH))
            for crf in (29, 32, 35):
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
                                '-c:v', 'libx264', '-preset', 'medium', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-b:a', '64k',
                                '-movflags', '+faststart', 'vid/%s.mp4' % no], check=True)
                if os.path.getsize('vid/%s.mp4' % no) < 9_000_000: break
        open(mark, 'w').write(a['id'])
        return True
    except Exception as e:
        print('video', no, 'failed:', e)
        return os.path.exists('vid/%s.mp4' % no)

def img_tag(im, nums, no, cols=None):
    if im.width > 1200: im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82, optimize=True, progressive=True)
    d = base64.b64encode(b.getvalue()).decode(); n = len(nums)
    cells = ''.join('<span>%d</span>' % x for x in nums)
    if cols:
        gtc = ' '.join('%.4ffr' % (r - l) for l, r in cols); cattr = ' data-cols="%s"' % ';'.join('%.4f,%.4f' % (l, r) for l, r in cols)
    else:
        gtc = 'repeat(%d,1fr)' % n; cattr = ''
    return ('<div class="photo" data-nums="%s" data-n="%d"%s><img src="data:image/jpeg;base64,%s" alt="Design %s" width="%d" height="%d">\n'
            '        <div class="nums" style="grid-template-columns:%s">%s</div></div>' % (','.join(map(str, nums)), n, cattr, d, no, im.width, im.height, gtc, cells))

def render(PAGE, CUSTOMER, CUSTOMER_SUB, ORDER, MODE, TOT, COLS, PCSS, PHOTOS, VIDS):
    def labEn(no, c, v):
        C = MODE[no] == 'C'; unit = COLS[no] * 4 if C else 4; p = TOT[no] if C else PCSS[no][c]
        if v != 'F': return '%d complete set%s' % (v, '' if v == 1 else 's') if C else '%d set%s' % (v, '' if v == 1 else 's')
        st, r = p // unit, p % unit; rl = '%d pc%s' % (r, '' if r == 1 else 's')
        if not st: return rl
        return ('%d complete set%s' % (st, '' if st == 1 else 's') if C else '%d set%s' % (st, '' if st == 1 else 's')) + ' + ' + rl
    def labAr(no, c, v):
        C = MODE[no] == 'C'; unit = COLS[no] * 4 if C else 4; p = TOT[no] if C else PCSS[no][c]
        if v != 'F': return arFull(v) if C else arSets(v)
        st, r = p // unit, p % unit
        if not st: return arPcs(r)
        return (arFull(st) if C else arSets(st)) + ' + ' + arPcs(r)
    def seg_buttons(no, c, vals):
        out = []
        for v in vals:
            cls = ' class="tail"' if v == 'F' else ''
            face = str(v)
            if v == 'F':
                C = MODE[no] == 'C'; unit = COLS[no] * 4 if C else 4; p = TOT[no] if C else PCSS[no][c]
                st, r = p // unit, p % unit; face = ('%d + %d' % (st, r)) if st else ('%d pcs' % r)
            out.append('<button type="button"%s id="b-%s-%d-%s" aria-pressed="false" data-k="%s:%d" data-v="%s">%s<small>%s</small></button>'
                       % (cls, no, c, v, no, c, v, face, labAr(no, c, v)))
        return ''.join(out)
    arts = []
    for no in ORDER:
        C = MODE[no] == 'C'
        photos = ''.join('      ' + img_tag(im, nums, no, cols) + '\n' for im, nums, cols in PHOTOS[no])
        vid = ('      <div class="vid"><video src="vid/%s.mp4" controls playsinline preload="metadata" controlslist="nodownload noplaybackrate" disablepictureinpicture></video></div>\n' % no) if no in VIDS else ''
        if C:
            head = ('      <div class="head"><div><div class="lbl">Design</div><div class="no">%s</div></div>'
                    '<div style="text-align:right"><div class="ar">الطقم الكامل = كل الألوان</div></div></div>\n' % no)
            rows = '        <div class="row full"><div class="seg">%s</div></div>\n' % seg_buttons(no, 0, opts(TOT[no], COLS[no] * 4))
            dlist = ','.join(str(i) for i in range(1, COLS[no] + 1))
        else:
            head = ('      <div class="head"><div><div class="lbl">Design</div><div class="no">%s</div></div>'
                    '<div style="text-align:right"><div class="ar">اختر اللون والأطقم</div></div></div>\n' % no)
            cs = sorted(PCSS[no])
            rows = ''.join('        <div class="row"><div class="n">%d</div><div class="seg">%s</div></div>\n' % (c, seg_buttons(no, c, opts(PCSS[no][c], 4))) for c in cs)
            dlist = ','.join(str(c) for c in cs)
        arts.append('    <article class="design" data-no="%s" data-mode="%s" data-list="%s">\n%s%s%s      <div class="colours">\n%s      </div>\n    </article>\n'
                    % (no, MODE[no], dlist, photos, vid, head, rows))
    FEED = '\n'.join(arts)
    import html as H
    HEADER = ('  <header>\n' + ('    <h1>%s<span class="sub">%s</span></h1>\n' % (H.escape(CUSTOMER), H.escape(CUSTOMER_SUB)) if CUSTOMER else '') +
              '    <p>Tap what you want under each design, then OK.</p>\n    <p class="ar">اختر ما تريد تحت كل تصميم، ثم اضغط OK</p>\n  </header>')
    src = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
    src = re.sub(r'  <header>.*?</header>', lambda m: HEADER, src, count=1, flags=re.S)
    src = src.replace('  header h1{', '  header h1 .sub{display:block;font-family:var(--body);font-size:12px;font-weight:600;letter-spacing:.16em;color:var(--muted);margin-top:5px}\n  header h1{', 1)
    src = src.replace('header h1{font-family:var(--display);font-weight:500;font-size:24px;margin:0 0 6px;letter-spacing:.01em;text-wrap:balance}',
                      'header h1{font-family:var(--display);font-weight:500;font-size:27px;margin:0 0 10px;letter-spacing:.01em;text-wrap:balance}', 1)
    src = re.sub(r'(<main class="feed" id="feed">\n).*?(\n  </main>)', lambda m: m.group(1) + '\n' + FEED + m.group(2), src, count=1, flags=re.S)
    E = json.load(open(os.path.join(HERE, 'engine.json'), encoding='utf-8'))      # the JS blocks of build6.py, verbatim
    old_head = re.search(r'  var PCS  = \{"81016": 75\};.*?function labAr\(no,c,v\)\{\n.*?\n  \}\n', src, re.S).group(0)
    src = src.replace(old_head, E['head'] % (json.dumps(MODE), json.dumps(TOT), json.dumps(COLS),
                      json.dumps({k: {str(a): b for a, b in v.items()} for k, v in PCSS.items()})), 1)
    for k, pat in (('refresh', r'  function refresh\(\)\{\n.*?\n  \}\n'), ('mark', r'  function markPhoto\(photoEl, chosen\)\{\n.*?\n  \}\n'),
                   ('ok', r"  ok\.addEventListener\('click', function\(\)\{\n.*?\n  \}\);\n")):
        old = re.search(pat, src, re.S).group(0); src = src.replace(old, E[k], 1)
    src = src.replace("  var SETS_AR = {1:'طقم واحد', 2:'طقمان', 3:'٣ أطقم', 4:'٤ أطقم'};",
                      "  var SETS_AR = {1:'طقم واحد', 2:'طقمان', 3:'٣ أطقم', 4:'٤ أطقم'};\n  var PAGE_ORDER = " + json.dumps(ORDER) + ";\n  var PAGE_FILE = " + json.dumps(PAGE + '.html') + ";", 1)
    assert E['old_date'] in src, 'date block not found'
    if CUSTOMER: src = src.replace(E['old_date'], E['new_date'], 1)        # name on the order PDF too (Rule Ten)
    src = src.replace("  var PAGE_ORDER = ", "  var CUSTOMER = " + json.dumps(CUSTOMER) + ", CUSTOMER_SUB = " + json.dumps(CUSTOMER_SUB) + ";\n  var PAGE_ORDER = ", 1)
    src = src.replace('Chosen colours stay in full colour; the rest are faded. Save these pictures for your records.',
                      'Your choice is marked on each picture. Save these pictures for your records.')
    return src

# ---------- link preview: cover picture + tags (og.py of 4 Oct 2026) ----------
AR_DIG = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')
def ar_count(n):
    if n == 1: return 'تصميم جديد'
    if n == 2: return 'تصميمان جديدان'
    return ('%d' % n).translate(AR_DIG) + (' تصاميم جديدة' if n <= 10 else ' تصميماً جديداً')
def og_cover(src, stem, customer, sub):
    import html as H
    ph = []
    for m in re.finditer(r'<article class="design" data-no="(\d+)"', src):
        i = src.index('<img src="', m.end()) + 10; ph.append(src[i:src.index('"', i)])
    n = len(ph); k = n if n <= 5 else (6 if n <= 6 else 10)
    cols = k if k <= 5 else (3 if k == 6 else 5); rows = 1 if k <= 5 else 2
    tiles = ''.join('<div class="t" style="background-image:url(%s)"></div>' % u for u in ph[:k])
    who = H.escape(customer or 'NEW COLLECTION'); subl = H.escape(sub or '')
    en = '%d NEW DESIGN%s  ·  TAP TO VIEW &amp; ORDER' % (n, '' if n == 1 else 'S')
    ar = ar_count(n) + ' · اضغط للمشاهدة والطلب'
    page = f'''<!doctype html><meta charset="utf-8"><style>
    body{{margin:0;position:relative;width:1200px;height:630px;background:#F4F2ED;font-family:Arial,Helvetica,sans-serif;overflow:hidden}}
    .g{{display:grid;grid-template-columns:repeat({cols},1fr);grid-template-rows:repeat({rows},1fr);gap:6px;height:452px;padding:6px 6px 0}}
    .t{{background-size:cover;background-position:center 22%;border-radius:4px}}
    .b{{position:absolute;left:0;right:0;bottom:0;height:172px;background:#234C47;color:#F3F6F5;padding:0 40px;box-sizing:border-box}}
    .top{{height:6px;background:#8A6A2A;position:absolute;left:0;right:0;bottom:172px}}
    .who{{position:absolute;left:40px;top:28px;font:bold 46px Arial;letter-spacing:1px}}
    .who small{{font:bold 22px Arial;color:#CFE0DC;margin-left:14px;letter-spacing:3px}}
    .en{{position:absolute;left:40px;bottom:30px;font:bold 25px Arial;color:#E9D9B4;letter-spacing:1px}}
    .ar{{position:absolute;right:40px;bottom:28px;font:bold 30px Arial;direction:rtl;color:#F3F6F5}}
    .brand{{position:absolute;right:40px;top:34px;font:bold 22px Arial;letter-spacing:4px;color:#CFE0DC}}
    </style><div class="g">{tiles}</div><div class="top"></div><div class="b">
    <div class="who">{who}<small>{subl}</small></div><div class="brand">SJ TRADING</div>
    <div class="en">{en}</div><div class="ar">{ar}</div></div>'''
    with tempfile.TemporaryDirectory() as t:
        f = os.path.join(t, 'c.html'); open(f, 'w', encoding='utf-8').write(page); png = os.path.join(t, 'c.png')
        chrome = os.environ.get('CHROME') or next(c for c in ('google-chrome', 'chromium', 'chromium-browser', '/opt/pw-browsers/chromium') if subprocess.run(['which', c], capture_output=True).returncode == 0 or os.path.exists(c))
        subprocess.run([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--window-size=1200,900', '--virtual-time-budget=3000', '--screenshot=' + png, 'file://' + f], check=True, capture_output=True)
        im = Image.open(png).convert('RGB').crop((0, 0, 1200, 630))
        q = 82
        while True:
            im.save('og-%s.jpg' % stem, quality=q, optimize=True)
            if os.path.getsize('og-%s.jpg' % stem) < 280_000 or q <= 50: break
            q -= 6
    return n
def og_meta(src, stem, customer, sub, n):
    import html as H
    title = (customer + (' · ' + sub if sub else '') + ' — ' if customer else '') + '%d new design%s' % (n, '' if n == 1 else 's')
    desc = 'Tap to view the catalogue and choose your colours. اضغط لمشاهدة الكتالوج واختيار الألوان'
    img = BASE + 'og-%s.jpg?v=1' % stem
    tags = ('<meta property="og:type" content="website">\n<meta property="og:site_name" content="SJ Trading">\n'
            '<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n<meta property="og:url" content="%s%s.html">\n'
            '<meta property="og:image" content="%s">\n<meta property="og:image:secure_url" content="%s">\n<meta property="og:image:type" content="image/jpeg">\n'
            '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="%s">\n'
            '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="%s">\n<meta name="description" content="%s">\n'
            ) % (H.escape(title), H.escape(desc), BASE, stem, img, img, H.escape(title), img, H.escape(desc))
    src = re.sub(r'<meta (property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\n', '', src)
    a = src.index('<head>') + 6
    src = src[:a] + '\n<meta charset="utf-8">\n' + tags + src[a:].replace('<meta charset="utf-8">', '', 1)
    return re.sub(r'<title>.*?</title>', lambda m: '<title>%s</title>' % H.escape(title), src, 1)

def save_costs(req):
    """Costs sync (7 Oct 2026: "from whichever device I upload the latest inventory, it is updated across all the other devices").
    The phone sends the costs ALREADY LOCKED with his owner password (AES-GCM); this job only stores the locked file as costs.enc.
    It cannot read it, and nor can anyone with only the shop password."""
    blob = req.get('blob') or {}
    if not all(isinstance(blob.get(k), str) and 8 <= len(blob[k]) <= 16000 for k in ('salt', 'iv', 'ct')):
        return {'ok': False, 'error': 'bad cost file'}
    out = {'v': 1, 'iter': int(req.get('iter', 200000)), 't': int(req.get('t', 0)), 'd': str(req.get('d', ''))[:10],
           'n': int(req.get('n', 0)), 'salt': blob['salt'], 'iv': blob['iv'], 'ct': blob['ct']}
    json.dump(out, open('costs.enc', 'w'))
    return {'ok': True, 'kind': 'costs', 'd': out['d'], 'n': out['n'], 't': out['t']}

def main():
    req_s, sig, pw = os.environ.get('REQ', ''), os.environ.get('SIG', ''), os.environ.get('MEMO_PASSWORD', '')
    req = json.loads(req_s)
    jid = re.sub(r'[^a-z0-9-]', '', str(req.get('id', '')))[:40] or 'x'
    if not LOCAL and not (pw and hmac.compare_digest(hmac.new(pw.encode(), req_s.encode(), hashlib.sha256).hexdigest(), sig)):
        res = {'ok': False, 'error': 'not signed with the shop password'}
    else:
        try: res = save_costs(req) if req.get('kind') == 'costs' else build(req)
        except Exception as e:
            import traceback; traceback.print_exc(); res = {'ok': False, 'error': 'Build failed: %s: %s' % (type(e).__name__, str(e)[:300])}
    res['id'] = jid
    os.makedirs('jobs', exist_ok=True)
    json.dump(res, open('jobs/%s.json' % jid, 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
