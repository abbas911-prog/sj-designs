#!/usr/bin/env python3
"""For memo.html: copy every photo on the Trello READY list into thumbs/<attachmentId>.jpg (max 900 px) and publish the list itself
as memo-data.enc, locked with the shop password (AES-256-GCM, key from PBKDF2-SHA256).
Runs on GitHub Actions every 20 min (approved by Abbas 6 Oct 2026). Secrets: TRELLO_TOKEN (read-only), MEMO_PASSWORD. No AI."""
import base64, datetime, hashlib, hmac, io, json, os, sys, urllib.request, urllib.parse
from PIL import Image
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
TOKEN = os.environ['TRELLO_TOKEN'].strip()
API = os.environ.get('TRELLO_API', 'https://api.trello.com')
LIST = '66254dc6f8ade3c3a0c9b7d4'
SAMPLES = '6824cdd97bb99de098f1b7ae'   # SAMPLES list (7 Oct 2026): one sample piece per card, shown in the memo's SAMPLES tab
OUT = 'thumbs'
PASSWORD = os.environ.get('MEMO_PASSWORD', '')
DATA = 'memo-data.enc'
ITER = 200000
AUTH = {'Authorization': f'OAuth oauth_consumer_key="{KEY}", oauth_token="{TOKEN}"'}

def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def api_url(u):
    for pre in ('https://trello.com', 'https://api.trello.com'):
        if u.startswith(pre):
            return API + u[len(pre):]
    return u

def derive(pw, salt):
    return hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, ITER, 32)

def publish(cards):
    """Write memo-data.enc only when the list content changed (so there is no commit every 20 min for nothing)."""
    if not PASSWORD:
        print('MEMO_PASSWORD not set - list not published')
        return
    slim = [{'id': c['id'], 'name': c['name'], 'pos': c.get('pos'), 'idShort': c.get('idShort'), **({'list': 's'} if c.get('_s') else {}),
             'attachments': [{'id': a['id'], 'name': a.get('name', ''), 'mimeType': a.get('mimeType', ''), 'date': a.get('date', '')}
                             for a in c.get('attachments', []) if str(a.get('mimeType', '')).startswith('image/')]} for c in cards]
    body = json.dumps(slim, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    salt = os.urandom(16)
    if os.path.exists(DATA):
        try:
            old = json.load(open(DATA))
            osalt = base64.b64decode(old['salt'])
            if old.get('iter') == ITER and hmac.compare_digest(old.get('mac', ''), hmac.new(derive(PASSWORD, osalt), body, 'sha256').hexdigest()):
                print('list unchanged')
                return
        except Exception as e:
            print('old data unreadable, rewriting:', type(e).__name__)
    key = derive(PASSWORD, salt)
    iv = os.urandom(12)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    pt = json.dumps({'updated': now, 'cards': slim}, ensure_ascii=False).encode()
    ct = AESGCM(key).encrypt(iv, pt, None)
    out = {'v': 1, 'iter': ITER, 'salt': base64.b64encode(salt).decode(), 'iv': base64.b64encode(iv).decode(),
           'ct': base64.b64encode(ct).decode(), 'mac': hmac.new(key, body, 'sha256').hexdigest()}
    json.dump(out, open(DATA, 'w'))
    print('list published', len(slim), 'cards')

def main():
    os.makedirs(OUT, exist_ok=True)
    q = urllib.parse.urlencode({'fields': 'name,pos,idShort', 'attachments': 'true',
                                'attachment_fields': 'id,name,mimeType,date,url,previews', 'key': KEY, 'token': TOKEN})
    cards = json.loads(get(f'{API}/1/lists/{LIST}/cards?{q}'))
    samples = json.loads(get(f'{API}/1/lists/{SAMPLES}/cards?{q}'))
    for c in samples:
        c['_s'] = True
    cards += samples
    want, made, failed = set(), 0, 0
    for c in cards:
        for a in c.get('attachments', []):
            if not str(a.get('mimeType', '')).startswith('image/'):
                continue
            want.add(a['id'])
            dest = os.path.join(OUT, a['id'] + '.jpg')
            if os.path.exists(dest):
                continue
            prev = sorted([p for p in a.get('previews') or [] if 600 <= p.get('width', 0) <= 1300], key=lambda p: p['width'])
            srcs = ([api_url(prev[0]['url'])] if prev else []) + [api_url(a['url'])]
            for s in srcs:
                try:
                    im = Image.open(io.BytesIO(get(s, AUTH))).convert('RGB')
                    im.thumbnail((900, 900))
                    im.save(dest, 'JPEG', quality=82, optimize=True, progressive=True)
                    made += 1
                    break
                except Exception as e:
                    print('fail', c['name'][:30], a['id'], type(e).__name__, str(e)[:80], file=sys.stderr)
            else:
                failed += 1
    gone = [f for f in os.listdir(OUT) if f.endswith('.jpg') and f[:-4] not in want]
    for f in gone:
        os.remove(os.path.join(OUT, f))
    publish(cards)
    print(f'cards {len(cards)} photos {len(want)} new {made} failed {failed} removed {len(gone)}')

if __name__ == '__main__':
    main()
