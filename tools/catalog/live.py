"""Live catalogues (23 Nov 2026, Abbas: "customers reply late and the quantities go up and down — whenever he opens the catalogue the
quantity must be sorted by itself, even the photos").

A catalogue page is a finished file, so "live" = it is built again IN PLACE, under the same link, whenever something it shows changed:
pieces sold or added (the card title), a card sold out / moved out of READY, a photo or video added or removed on the card.
build.py keeps each page's request in cat/<page>.json together with a mark of everything the page depends on (cat_fp). This script
(job memo-catalog-live: after every stock job, and once an hour) reads READY once, and builds again only the pages whose mark changed.

  * same link, same file name; the customer just opens it again
  * a design that is gone is left out; a page with nothing left is not touched
  * pages older than LIVE_DAYS (45) are left alone; at most LIVE_MAX (12) pages per run
  --backfill : make cat/<page>.json for pages built before this existed (from what the page itself says), so they go live too
"""
import datetime, glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build as B

DAYS = int(os.environ.get('LIVE_DAYS', '45')); MAXN = int(os.environ.get('LIVE_MAX', '12'))
def now(): return datetime.datetime.now(datetime.timezone.utc)
def iso(t): return t.strftime('%Y-%m-%dT%H:%M:%SZ')
def age_days(s):
    try: return (now() - datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)).total_seconds() / 86400
    except Exception: return 0

def backfill(days=21):
    """Pages made before 23 Nov 2026 have no saved request. What the page says about itself is enough: customer, country, the designs
    in order, which of them are COMPLETE-set designs (the COLS table), and a printed price."""
    os.makedirs('cat', exist_ok=True); made = []
    for f in sorted(glob.glob('*.html')):
        stem = f[:-5]
        if os.path.exists('cat/%s.json' % stem) or re.match(r'(sz-|my|memo|factory|jarvis|assistant|timo|tryon|relaycode|fastcode|assistantcode)', stem): continue
        s = open(f, encoding='utf-8', errors='ignore').read()
        m = re.search(r'CUSTOMER\s*=\s*("(?:[^"\\]|\\.)*")\s*,\s*CUSTOMER_SUB\s*=\s*("(?:[^"\\]|\\.)*")', s)
        if not m or 'class="nums"' not in s: continue
        t = datetime.datetime.fromtimestamp(os.path.getmtime(f), datetime.timezone.utc)
        md = re.search(r'-(\d\d)(\d\d)[a-p]?$', stem)                # the page's own date: name-MMDD
        if md:
            try:
                t0 = datetime.datetime(now().year, int(md.group(1)), int(md.group(2)), tzinfo=datetime.timezone.utc)
                if t0 > now(): t0 = t0.replace(year=t0.year - 1)
                t = t0
            except Exception: pass
        if (now() - t).days > days: continue
        cols = {}
        mc = re.search(r'COLS\s*=\s*(\{[^;]*?\})\s*[,;]', s)
        if mc:
            try: cols = json.loads(mc.group(1))
            except Exception: cols = {}
        order = []
        for no in re.findall(r'data-no="(\d[0-9A-Za-z_-]*)"', s):
            if no not in order: order.append(no)
        items, seen_all = [], set()
        for no in order:
            ma = re.match(r'(\d{3,6})_\d\d$', no)                    # 6668_01 … = one "6668 all" line
            if ma:
                if ma.group(1) not in seen_all: seen_all.add(ma.group(1)); items.append({'no': ma.group(1) + ' all', 'mode': 'C' if no in cols else 'S'})
                continue
            it = {'no': no, 'mode': 'C' if no in cols else 'S'}
            items.append(it)
        if not items: continue
        d = {'v': 1, 'page': f, 'made': iso(t), 'name': json.loads(m.group(1)), 'country': json.loads(m.group(2)), 'items': items,
             'prices': 0, 'fp': '', 'built': '', 'backfilled': 1}
        if 'class="price"' in s: d['hold'] = 'this page prints prices - they are not in the page request, so it is not rebuilt by itself'
        json.dump(d, open('cat/%s.json' % stem, 'w'), ensure_ascii=False, indent=1); made.append(stem)
    return made

def run():
    files = sorted(glob.glob('cat/*.json'))
    if not files: print('no saved catalogues'); return []
    cards = B.ready_cards(); done = []; left = MAXN
    for f in files:
        try: d = json.load(open(f))
        except Exception: continue
        stem = os.path.basename(f)[:-5]
        if d.get('hold') or d.get('off') or age_days(d.get('made', '')) > DAYS or not os.path.exists(stem + '.html'): continue
        fp = B.cat_fp(d.get('items'), cards)
        if fp == d.get('fp'): continue
        if left <= 0: print('more pages changed than one run takes - the rest next time'); break
        left -= 1
        req = {'name': d.get('name', ''), 'country': d.get('country', ''), 'items': d.get('items', []), 'prices': d.get('prices', 0), '_live': 1, '_stem': stem}
        try: res = B.build(req, cards)
        except Exception as e:
            import traceback; traceback.print_exc(); res = {'ok': False, 'error': '%s: %s' % (type(e).__name__, str(e)[:200])}
        d['fp'] = fp; d['checked'] = iso(now())                    # a page is tried once per change, never in a loop
        if res.get('ok'):
            d['built'] = iso(now()); d['n'] = int(d.get('n', 0)) + 1; d['flags'] = res.get('flags', [])[:20]; d.pop('err', None); d.pop('empty', None)
            print('LIVE %s: built again (%d designs)%s' % (stem, len(res.get('designs', [])), ''.join('\n   ' + x for x in res.get('flags', [])[:8])))
            done.append(stem)
        elif res.get('empty'):
            d['empty'] = 1; print('LIVE %s: nothing of it is in READY any more - page left as it is' % stem)
        else:
            d['err'] = str(res.get('error', ''))[:300]; print('LIVE %s: NOT built - %s' % (stem, d['err']))
        json.dump(d, open(f, 'w'), ensure_ascii=False, indent=1)
    if not done: print('nothing changed (%d catalogues looked at)' % len(files))
    return done

if __name__ == '__main__':
    if '--backfill' in sys.argv: print('backfilled:', backfill())
    else: run()
