#!/usr/bin/env python3
"""For factory.html (13 Oct 2026, Abbas: 'the photos are not loading'): copy the COVER photo of every open card on the ALM board
into facthumbs/<attachmentId>.jpg (max 640 px), so the factory app shows photos straight from GitHub Pages instead of
asking the relay for each one. Runs on GitHub Actions every 20 min + whenever the factory app asks. Secrets: TRELLO_TOKEN. No AI."""
import io, json, os, sys, urllib.request, urllib.parse
from PIL import Image

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
TOKEN = os.environ['TRELLO_TOKEN'].strip()
API = os.environ.get('TRELLO_API', 'https://api.trello.com')
BOARD = '6527c52485d9627f63157296'                       # ALM
LISTS = {'65f8c9fd96d90dda4b355f0a', '65a121d2829a36ccacd05593', '6527c572b12b208471c080cb', '6527c57751007e81a43f55a6', '6527c57cd7e267fbf2a602b4',
         '6527c585b9300f804906d9bd', '6527c59b796865bd9639b0c3', '6602ad25e74db40a25ab0296', '6527c5a3964596815651a97f', '6527c5a93db4d8b8e91a8be9',
         '6527c5b13129a9ba37acd3ad', '699b35ceb77292db0289c473', '6527c5b41e630c094b619f5e', '68b77a221eef6fbb9a305e0e'}
OUT = 'facthumbs'
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
    q = urllib.parse.urlencode({'filter': 'open', 'limit': 1000, 'fields': 'idList,idAttachmentCover', 'attachments': 'cover',
                                'attachment_fields': 'id,mimeType,url,previews', 'key': KEY, 'token': TOKEN})
    cards = [c for c in json.loads(get(f'{API}/1/boards/{BOARD}/cards?{q}')) if c.get('idList') in LISTS]
    want, made, failed = set(), 0, 0
    for c in cards:
        for a in c.get('attachments', [])[:1]:
            if not (a.get('previews') or str(a.get('mimeType', '')).startswith('image/')):
                continue
            want.add(a['id'])
            dest = os.path.join(OUT, a['id'] + '.jpg')
            if os.path.exists(dest):
                continue
            prev = sorted([p for p in a.get('previews') or [] if 500 <= p.get('width', 0) <= 1100], key=lambda p: p['width'])
            srcs = ([api_url(prev[0]['url'])] if prev else []) + [api_url(a['url'])]
            for s in srcs:
                try:
                    im = Image.open(io.BytesIO(get(s, AUTH))).convert('RGB')
                    im.thumbnail((640, 640))
                    im.save(dest, 'JPEG', quality=80, optimize=True, progressive=True)
                    made += 1
                    break
                except Exception as e:
                    print('fail', c['id'], a['id'], type(e).__name__, str(e)[:80], file=sys.stderr)
            else:
                failed += 1
    gone = [f for f in os.listdir(OUT) if f.endswith('.jpg') and f[:-4] not in want]
    for f in gone:
        os.remove(os.path.join(OUT, f))
    print(f'cards {len(cards)} covers {len(want)} new {made} failed {failed} removed {len(gone)}')

if __name__ == '__main__':
    main()
