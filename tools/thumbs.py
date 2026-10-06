#!/usr/bin/env python3
"""Copy every photo on the Trello READY list into thumbs/<attachmentId>.jpg (max 900 px) for memo.html.
Runs on GitHub Actions every 20 min (approved by Abbas 6 Oct 2026). Needs secret TRELLO_TOKEN (read-only). No AI."""
import io, json, os, sys, urllib.request, urllib.parse
from PIL import Image

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
TOKEN = os.environ['TRELLO_TOKEN'].strip()
API = os.environ.get('TRELLO_API', 'https://api.trello.com')
LIST = '66254dc6f8ade3c3a0c9b7d4'
OUT = 'thumbs'
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

def main():
    os.makedirs(OUT, exist_ok=True)
    q = urllib.parse.urlencode({'fields': 'name', 'attachments': 'true',
                                'attachment_fields': 'id,name,mimeType,url,previews', 'key': KEY, 'token': TOKEN})
    cards = json.loads(get(f'{API}/1/lists/{LIST}/cards?{q}'))
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
    print(f'cards {len(cards)} photos {len(want)} new {made} failed {failed} removed {len(gone)}')

if __name__ == '__main__':
    main()
