#!/usr/bin/env python3
"""python3 tests/t_facthumbs.py - the factory photo job (tools/facthumbs.py) against a small fake Trello.
24 Nov 2026: a card in Cutting///START, RETURNS or RETURNS BACK must get its cover on the site like every other list the app shows."""
import io, json, os, sys, tempfile, threading, http.server, importlib.util
from PIL import Image

START, CS, RET, RETB, OTHER = '6527c572b12b208471c080cb', '6ae07f38a77a2321736ef9da', 'aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2', 'bbbbbbbbbbbbbbbbbbbbbbb1'
CARDS = [('c1', START, 'att1'), ('c2', CS, 'att2'), ('c3', RET, 'att3'), ('c4', RETB, 'att4'), ('c5', OTHER, 'att5')]
buf = io.BytesIO(); Image.new('RGB', (900, 700), (120, 20, 40)).save(buf, 'JPEG'); JPG = buf.getvalue()

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if '/lists' in self.path:
            body = json.dumps([{'id': START, 'name': 'START'}, {'id': CS, 'name': 'Cutting///START'}, {'id': RET, 'name': 'RETURNS'}, {'id': RETB, 'name': 'RETURNS BACK'}, {'id': OTHER, 'name': 'OLD STUFF'}]).encode(); ct = 'application/json'
        elif '/cards' in self.path:
            base = 'https://trello.com/att/'
            body = json.dumps([{'id': c, 'idList': l, 'idAttachmentCover': a, 'attachments': [{'id': a, 'mimeType': 'image/jpeg', 'url': base + a, 'previews': []}]} for c, l, a in CARDS]).encode(); ct = 'application/json'
        else:
            body = JPG; ct = 'image/jpeg'
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

srv = http.server.HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ['TRELLO_TOKEN'] = 'test-token-not-real'; os.environ['TRELLO_API'] = 'http://127.0.0.1:%d' % srv.server_port
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('facthumbs', os.path.join(root, 'tools', 'facthumbs.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = tempfile.mkdtemp(); os.chdir(tmp); os.makedirs('facthumbs'); open('facthumbs/stale.jpg', 'wb').write(JPG)
m.main(); have = sorted(os.listdir('facthumbs')); fails = 0
def ok(c, what):
    global fails
    print(('PASS ' if c else 'FAIL ') + what); fails += 0 if c else 1
ok('att1.jpg' in have, 'a START card has its cover')
ok('att2.jpg' in have, 'a Cutting///START card has its cover (was left out)')
ok('att3.jpg' in have and 'att4.jpg' in have, 'RETURNS and RETURNS BACK cards have their covers, found by the list name (were left out)')
ok('att5.jpg' not in have and 'stale.jpg' not in have, 'a list the app does not show is still left out; a cover no card uses is removed')
ok(max(Image.open('facthumbs/att2.jpg').size) <= 640, 'thumbnail size as before (640 px)')
print('%d failed' % fails); sys.exit(1 if fails else 0)
