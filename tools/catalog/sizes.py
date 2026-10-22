#!/usr/bin/env python3
"""SIZES CATALOGUE — made from an INVOICE (Abbas, 12 Oct 2026).

"When a bill is generated ... send him a catalog of those designs with the quantity and video just like we do ... instead of
sets or complete he will have options of 4 sizes below it for his customers to choose." Then: "SJ TRADING for name · sizes
M, L, XL, XXL or FREE SIZE (free size is written on the Trello card if so; otherwise the sizes written on the card) · a number
option — a customer might want 2 medium, 3 large · include the video · a tick to not send it · this applies to ALL customers."

Input (from memo.html on Include & share, tick on): REQ = {"id","kind":"sizes","ref","cust","items":[{"card","no","c","pcs"}]}
  card = Trello card id, c = colour position in the card title (same numbering as the stock job), pcs = pieces on the invoice.
The card is read BY ID, so it is found even after the stock job has moved it to FINISH.
Page: only the colours on the invoice can be chosen (the others stay in the photo, faded; every colour keeps the card's number - 22 Oct 2026), the card video,
under each colour its piece count and one number box per size. Send order = one PDF (reopen link inside). Share on every
photo/video. Cover og-<page>.jpg with SJ TRADING. Rule Eight is lifted here by his own words ("with the quantity").
"""
import html as H, io, json, math, os, re, urllib.parse, base64, datetime
from PIL import Image
import build as B
from stock import parse

DEFAULT = ['M', 'L', 'XL', 'XXL']
AR_D = '٠١٢٣٤٥٦٧٨٩'
def arD(n): return ''.join(AR_D[int(c)] if c.isdigit() else c for c in str(n))
def arPcs(n): return 'قطعة واحدة' if n == 1 else ('قطعتان' if n == 2 else arD(n) + (' قطع' if n <= 10 else ' قطعة'))

def sizes_of(title):
    """FREE SIZE when the card says free; else the sizes written on the card; else M, L, XL, XXL."""
    m = re.search(r'\bsizes?\b\s*[:=\-]*\s*(.*)', title, re.I)
    if not m: return list(DEFAULT), 'default'
    rest = m.group(1)
    if re.search(r'free', rest, re.I): return ['FREE SIZE'], 'card says free size'
    toks = []
    for t in re.findall(r'(?<![A-Z0-9])(4XL|3XL|2XL|XXXL|XXL|XL|XS|S|M|L|5[0-9]|6[0-4])(?![A-Z0-9])', rest.upper()):
        if t not in toks: toks.append(t)
    return (toks, 'sizes on the card') if toks else (list(DEFAULT), 'default')

def card_by_id(cid):
    if B.LOCAL:
        for c in json.load(open(os.path.join(B.LOCAL, 'cards.json'))):
            if c['id'] == cid: return c
        raise KeyError(cid)
    q = urllib.parse.urlencode({'fields': 'name,idShort,idList', 'attachments': 'true',
                                'attachment_fields': 'id,name,mimeType,date,url,bytes', 'key': B.KEY, 'token': B.TOKEN})
    return json.loads(B.get('https://api.trello.com/1/cards/%s?%s' % (cid, q)))

def stem_for():
    base = 'sz-' + datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=4))).strftime('%m%d')
    stem, i = base, 0
    while os.path.exists(stem + '.html'):
        i += 1; stem = base + 'bcdefghijklmnopqrstuvwxyz'[i - 1]
    return stem

def build_sizes(req):
    items = [it for it in req.get('items', []) if str(it.get('card', '')).strip() and int(it.get('pcs', 0) or 0) > 0]
    if not items: return {'ok': False, 'error': 'No designs on the invoice.'}
    by, order = {}, []
    for it in items:
        cid = re.sub(r'[^0-9a-f]', '', str(it['card']))[:24]
        if cid not in by: by[cid] = {}; order.append(cid)
        c = int(it['c']); by[cid][c] = by[cid].get(c, 0) + int(it['pcs'])
    designs, report, flags, errors, used = [], [], [], [], {}
    for cid in order:
        try: card = card_by_id(cid)
        except Exception as e: errors.append('Card %s could not be read (%s).' % (cid, type(e).__name__)); continue
        p = parse(card['name']); no = p['no'] or '?'
        cells = [c[0] for c in p['cells']]
        if not cells: errors.append('SJ-%s: no colour numbers in the card title.' % no); continue
        billed = [0] * len(cells)
        for c, q in by[cid].items():
            if 1 <= c <= len(cells): billed[c - 1] += q
            else: flags.append('SJ-%s: colour %d is not on the card — left out.' % (no, c))
        if not any(billed): errors.append('SJ-%s: nothing billed on this card.' % no); continue
        groups, k = [], 0
        for g in B.group_sizes(card['name']):
            groups.append(list(range(k, k + g))); k += g
        if k < len(cells): groups.append(list(range(k, len(cells))))
        att = sorted(card.get('attachments', []), key=lambda a: a.get('date', ''), reverse=True)
        imgs = [a for a in att if str(a.get('mimeType', '')).startswith('image/')]
        covers = [a for a in imgs if B.role(a) == 'cover']; lineups = [a for a in imgs if B.role(a) == 'lineup']
        if len(covers) >= len(groups): pick = covers[:len(groups)]
        elif lineups: pick = (lineups + covers)[:len(groups)]; flags.append('SJ-%s: no JAMĀL photo for every colour group — shop photo used.' % no)
        else: pick = imgs[:len(groups)]
        if not pick: errors.append('SJ-%s: no photo on the card.' % no); continue
        while len(pick) < len(groups): groups[-2] = groups[-2] + groups[-1]; groups.pop()
        key = no if no not in used else '%s-%d' % (no, used[no] + 1)
        used[no] = used.get(no, 0) + 1
        photos, pcs, cs = [], [], []
        for a, g in zip(pick, groups):
            mask = [billed[i] for i in g]
            if not any(mask): continue
            im, kept, cols = B.keep_columns(B.photo(a), mask)
            nums, sold = [], []
            for i, q in zip(g, kept):
                nums.append(i + 1)                                   # the card's own colour number (22 Oct 2026)
                if q > 0: pcs.append(q); cs.append(i + 1)
                else: sold.append(i + 1)
            photos.append((im, nums, cols, sold))
        sizes, why = sizes_of(card['name'])
        vids = [a for a in att if str(a.get('mimeType', '')).startswith('video/')]
        vid = bool(vids) and B.video(no, vids[0])
        designs.append({'key': key, 'no': no, 'photos': photos, 'pcs': pcs, 'cs': cs, 'sizes': sizes, 'vid': vid})
        report.append('SJ-%s  %s → %d colour%s on the bill, %d pcs · sizes %s (%s)%s' % (no, '+'.join(str(b) for b in billed), len(pcs), '' if len(pcs) == 1 else 's',
                      sum(pcs), ' '.join(sizes), why, '' if vid else ' · no video on the card'))
    if errors: return {'ok': False, 'error': ' '.join(errors), 'errors': errors, 'report': report}
    stem = stem_for()
    html = render(stem, designs)
    open(stem + '.html', 'w', encoding='utf-8').write(html)
    n = len(designs)
    en = '%d DESIGN%s  ·  TAP TO CHOOSE COLOUR &amp; SIZE' % (n, '' if n == 1 else 'S')
    ar = ('تصميم واحد' if n == 1 else 'تصميمان' if n == 2 else arD(n) + ' تصاميم') + '، اضغط لاختيار اللون والمقاس'
    B.og_cover(html, stem, 'SJ TRADING', '', en=en, ar=ar, brand='')
    html = B.og_meta(html, stem, 'SJ TRADING', '', n, title='SJ TRADING — %d design%s' % (n, '' if n == 1 else 's'),
                     desc='Tap to choose colour, size and number of pieces. اضغط لاختيار اللون والمقاس وعدد القطع')
    open(stem + '.html', 'w', encoding='utf-8').write(html)
    return {'ok': True, 'kind': 'sizes', 'page': stem + '.html', 'url': B.BASE + stem + '.html?v=1', 'cover': 'og-%s.jpg' % stem,
            'name': 'SJ TRADING', 'country': '', 'ref': str(req.get('ref', ''))[:30], 'cust': str(req.get('cust', ''))[:60],
            'designs': [d['no'] for d in designs], 'report': report, 'flags': flags, 'bytes': os.path.getsize(stem + '.html')}

def img_src(im):
    if im.width > 1200: im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=82, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode(), im.width, im.height

def size_ar(s): return 'مقاس حر' if s == 'FREE SIZE' else 'مقاس ' + arD(s)

def render(stem, designs):
    arts, data = [], []
    for d in designs:
        k = d['key']; ph_html = []; dd = {'key': k, 'no': d['no'], 'sizes': d['sizes'], 'pcs': d['pcs'], 'cs': d['cs'], 'photos': []}
        for im, nums, cols, sold in d['photos']:
            src, w, h = img_src(im)
            gtc = ' '.join('%.4ffr' % (r - l) for l, r in cols)
            ph_html.append('<div class="photo"><img src="%s" alt="Design %s" width="%d" height="%d">%s<div class="nums" style="grid-template-columns:%s">%s</div></div>'
                           % (src, d['no'], w, h, B.sold_html(cols, nums, sold), gtc, ''.join(('<span class="out">%d</span>' if x in sold else '<span>%d</span>') % x for x in nums)))
            dd['photos'].append({'nums': nums, 'cols': [[round(l, 4), round(r, 4)] for l, r in cols], 'w': w, 'h': h})
        n_s = len(d['sizes'])
        rows = []
        for i, p in enumerate(d['pcs']):
            c = d['cs'][i]; per = p if n_s == 1 else math.ceil(p / n_s)
            each_en = (' · %d of each size' % (p // n_s)) if n_s > 1 and p % n_s == 0 else ''
            each_ar = ('، %s من كل مقاس' % arPcs(p // n_s)) if n_s > 1 and p % n_s == 0 else ''
            cells = ''.join(
                '<div class="sz" data-k="%s:%d:%d" data-max="%d"><div class="szl">%s<small>%s</small></div>'
                '<div class="qty"><button type="button" class="mi" aria-label="less">−</button><input type="text" inputmode="numeric" pattern="[0-9]*" placeholder="0" aria-label="%s pieces"><button type="button" class="pl" aria-label="more">+</button></div></div>'
                % (k, c, si, per, H.escape(s), size_ar(s), H.escape(s)) for si, s in enumerate(d['sizes']))
            rows.append('<div class="colour" data-c="%s:%d" data-max="%d"><div class="chead"><div class="badge">%d</div><div class="stock">Colour %d · %d pc%s%s<span class="ar">لون %s، %s%s</span></div></div>'
                        '<div class="sizes%s">%s</div><div class="cmsg" hidden></div></div>'
                        % (k, c, p, c, c, p, '' if p == 1 else 's', each_en, arD(c), arPcs(p), each_ar, ' one' if n_s == 1 else '', cells))
        vid = ('<div class="vid"><video src="vid/%s.mp4" controls playsinline preload="metadata" controlslist="nodownload noplaybackrate" disablepictureinpicture></video></div>' % d['no']) if d['vid'] else ''
        arts.append('<article class="design" data-no="%s" data-key="%s">\n%s\n%s\n<div class="head"><div><div class="lbl">Design</div><div class="no">%s</div></div><div class="ar">اختر اللون والمقاس وعدد القطع</div></div>\n%s\n</article>'
                    % (d['no'], k, '\n'.join(ph_html), vid + B.tryon_html(d['no'], stem + '.html'), d['no'], '\n'.join(rows)))
        data.append(dd)
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sizes.html'), encoding='utf-8').read()
    src = src.replace('%FEED%', '\n'.join(arts)).replace('%DATA%', json.dumps(data, ensure_ascii=False)).replace('%PAGE%', json.dumps(stem + '.html'))
    share = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'share1.js'), encoding='utf-8').read()
    i = src.rindex('</body>')
    return B.tryon_css(src[:i] + share + '\n' + src[i:])
