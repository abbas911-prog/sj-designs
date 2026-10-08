#!/usr/bin/env python3
"""For memo.html (owner only): the COSTING of every design on the Trello ALM board, so Abbas can type a design number in the
memo and see its cost breakdown (fabric 1, fabric 2, lace 1, lace 2 ... LINK, LINK 2, RATE, STONE) with its photo, and try
"remove lace 1", "+20" on it. Asked by Abbas 8 Oct 2026 ("just like the Order 2 chat").

- Reads every OPEN card of the ALM board (6527c52485d9627f63157296) with its custom fields and description.
- Keeps the cost fields RAW (custom field wins over the description, field by field - ALM Rule Three);
  the memo decodes the letter cipher itself (A=7 B=2 C=9 D=4 E=8 F=1 G=6 H=5 I=0 J=3).
- Copies each costed design's first photo to cthumbs/<attachmentId>.jpg (small, for the memo).
- Publishes costing.enc locked with the OWNER password (GitHub secret OWNER_PASSWORD, typed in by Abbas) - never the shop
  password, because staff know that one. No secret -> nothing is published.
Runs on GitHub Actions after memo-thumbs (workflow memo-costing). Secrets: TRELLO_TOKEN (read), OWNER_PASSWORD. No AI."""
import base64, datetime, hashlib, hmac, io, json, os, re, sys, urllib.parse, urllib.request

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
TOKEN = os.environ.get('TRELLO_TOKEN', '').strip()
API = 'https://api.trello.com'
BOARD = '6527c52485d9627f63157296'
OUT, DATA, ITER = 'cthumbs', 'costing.enc', 200000
PASSWORD = os.environ.get('OWNER_PASSWORD', '')
AUTH = {'Authorization': f'OAuth oauth_consumer_key="{KEY}", oauth_token="{TOKEN}"'}
COSTKEYS = ['LINK', 'LINK 2', 'RATE', 'STONE', 'FABRIC', 'FABRIC 2', 'FABRIC 3', 'FABRIC 4', 'LAIS 1', 'LAIS 2', 'LAIS 3',
            'BUTTONS', 'MAGHRIBI 1', 'MAGHRIBI 2', 'BELT']

def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=90) as r:
        return r.read()

def api(path, **q):
    q.update(key=KEY, token=TOKEN)
    return json.loads(get(f'{API}/1{path}?{urllib.parse.urlencode(q)}'))

def norm(k):
    """'FABRIC : ~' -> 'FABRIC', 'LAIS 1~~' -> 'LAIS 1', 'RATE //' -> 'RATE', 'FABRIC 1' -> 'FABRIC', 'MAGHRIBI' -> 'MAGHRIBI 1'"""
    k = re.sub(r'[^A-Z0-9 ]', ' ', k.upper())
    k = re.sub(r'\s+', ' ', k).strip()
    k = re.sub(r'^(LACE|LAIS|LAISE)\b', 'LAIS', k)
    if k == 'FABRIC 1': k = 'FABRIC'
    if k == 'LAIS': k = 'LAIS 1'
    if k == 'MAGHRIBI': k = 'MAGHRIBI 1'
    if k == 'LINK 1': k = 'LINK'
    return k

def design_no(name):
    s = name.replace('**', ' ').replace('{', '(').replace('}', ')')
    m = re.search(r'(?:SJ|SH|Sj|sj)\s*[-=:.]*\s*\(?\s*(\d{3,6})(-[A-Za-z](?![A-Za-z]))?', s) or re.search(r'\b(\d{4,6})\b', s)
    if not m: return ''
    no = m.group(1)
    if m.lastindex and m.lastindex >= 2 and m.group(2): no += '-' + m.group(2).strip(' -').upper()
    return no

def fields(card, cfname):
    f = {}
    for line in (card.get('desc') or '').splitlines():           # description first ...
        if ':' not in line: continue
        k, v = line.split(':', 1)
        k = norm(k)
        if k in COSTKEYS and v.strip(' ~=:'):
            f[k] = v.strip()
    for it in card.get('customFieldItems') or []:                  # ... then custom fields win, field by field
        k = norm(cfname.get(it.get('idCustomField'), ''))
        v = (it.get('value') or {})
        v = v.get('text') if v.get('text') is not None else v.get('number')
        if k in COSTKEYS and v not in (None, '') and str(v).strip(' ~=:'):
            f[k] = str(v).strip()
    return f

def main():
    if not TOKEN:
        print('no TRELLO_TOKEN'); return
    if not PASSWORD:
        print('OWNER_PASSWORD secret not set - costing not published'); return
    cfname = {c['id']: c['name'] for c in api(f'/boards/{BOARD}/customFields')}
    lists = {l['id']: l['name'] for l in api(f'/boards/{BOARD}/lists', filter='all')}
    cards = api(f'/boards/{BOARD}/cards', filter='open', fields='name,desc,idList,dateLastActivity', customFieldItems='true',
                attachments='true', attachment_fields='id,mimeType,date,url,previews')
    by = {}
    for c in cards:
        no = design_no(c['name'])
        f = fields(c, cfname)
        if not no or not f: continue
        imgs = sorted([a for a in c.get('attachments') or [] if str(a.get('mimeType', '')).startswith('image/')], key=lambda a: a.get('date') or '')
        by.setdefault(no, []).append({'id': c['id'], 'name': c['name'][:80], 'list': lists.get(c['idList'], ''), 'at': c.get('dateLastActivity', ''),
                                      'f': f, 'ph': imgs[0]['id'] if imgs else '', '_img': imgs[0] if imgs else None})
    os.makedirs(OUT, exist_ok=True)
    want, made, failed = set(), 0, 0
    for no, cs in by.items():
        cs.sort(key=lambda x: x['id'], reverse=True)               # newest card first (Trello ids grow with time)
        del cs[4:]
        for x in cs:
            a = x.pop('_img')
            if not a: continue
            want.add(a['id'])
            dest = os.path.join(OUT, a['id'] + '.jpg')
            if os.path.exists(dest): continue
            prev = sorted([p for p in a.get('previews') or [] if 400 <= p.get('width', 0) <= 1300], key=lambda p: p['width'])
            srcs = ([prev[0]['url']] if prev else []) + [a['url']]
            for s in srcs:
                try:
                    from PIL import Image
                    im = Image.open(io.BytesIO(get(s.replace('https://trello.com', API), AUTH))).convert('RGB')
                    im.thumbnail((640, 640)); im.save(dest, 'JPEG', quality=78, optimize=True, progressive=True); made += 1
                    break
                except Exception as e:
                    print('photo fail', no, a['id'], type(e).__name__, str(e)[:80], file=sys.stderr)
            else:
                failed += 1; x['ph'] = ''
    for fn in os.listdir(OUT):
        if fn.endswith('.jpg') and fn[:-4] not in want: os.remove(os.path.join(OUT, fn))
    body = json.dumps(by, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    if os.path.exists(DATA):
        try:
            old = json.load(open(DATA))
            k = hashlib.pbkdf2_hmac('sha256', PASSWORD.encode(), base64.b64decode(old['salt']), old['iter'], 32)
            if hmac.compare_digest(old.get('mac', ''), hmac.new(k, body, 'sha256').hexdigest()):
                print('costing unchanged', len(by), 'designs'); return
        except Exception as e:
            print('old costing unreadable, rewriting:', type(e).__name__)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv = os.urandom(16), os.urandom(12)
    k = hashlib.pbkdf2_hmac('sha256', PASSWORD.encode(), salt, ITER, 32)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    ct = AESGCM(k).encrypt(iv, json.dumps({'updated': now, 'd': by}, ensure_ascii=False).encode(), None)
    json.dump({'v': 1, 'iter': ITER, 'salt': base64.b64encode(salt).decode(), 'iv': base64.b64encode(iv).decode(),
               'ct': base64.b64encode(ct).decode(), 'mac': hmac.new(k, body, 'sha256').hexdigest()}, open(DATA, 'w'))
    print(f'costing published: {len(by)} designs, {len(cards)} cards read, photos new {made} failed {failed}')

if __name__ == '__main__':
    main()
