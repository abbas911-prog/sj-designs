#!/usr/bin/env python3
"""Jarvis phone bridge (26 Oct 2026) — runs on Abbas's PC next to sj.py.

The phone page (https://abbas911-prog.github.io/sj-designs/jarvis.html) sends what Abbas said; this server runs
Jarvis = Claude Code in my-agent (the brain file + sj.py, same as the Home-key voice) and sends the answer back.
Every request is signed with the Assistant password (HMAC, like sj.py / assistant.html) — nothing else is accepted.

Run:  python jarvis\\bridge.py            (from C:\\Users\\<you>\\my-agent)
It also starts a Cloudflare quick tunnel (cloudflared) so the phone can reach it, and prints the link to paste
into the phone page once. The link changes every time the bridge restarts — the page asks again when it changes.
"""
import sys, os, json, time, hmac, hashlib, subprocess, threading, re, shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.dirname(HERE)                       # my-agent
PORT = 8792   # 8790/8791 are used by the face / voice
OUT = os.path.join(HERE, 'out')                      # files Jarvis fetched for the phone (voice notes, photos)
os.makedirs(OUT, exist_ok=True)
PHONE = ('[From the PHONE page, not the PC screen. Rules for this answer: no sj.py show, no start, nothing opened on the PC screen. '
         'To let Abbas hear or see a file: sj.py file "<chat>" <fileId> jarvis/out/<short-name.ext> and then put [[file:<short-name.ext>]] on its own line in the answer; '
         'the phone shows a player/photo there. Answer in plain short sentences — it is read aloud.] ')
cfg = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
PW = cfg['pw']
SEEN = set()
LOCK = threading.Lock()
STATE = {'started': False, 'tunnel': ''}

def claude_exe():
    c = shutil.which('claude')
    if c: return c
    for cand in [os.path.join(os.path.expanduser('~'), '.local', 'bin', 'claude.exe'), os.path.join(os.path.expanduser('~'), '.local', 'bin', 'claude'),
                 os.path.join(os.environ.get('APPDATA', ''), 'npm', 'claude.cmd'), '/usr/local/bin/claude']:
        if cand and os.path.exists(cand): return cand
    return 'claude'

def jarvis(text):
    """One turn with Jarvis. --continue keeps the conversation (memory of the last turns) between calls."""
    cmd = [claude_exe(), '-p', PHONE + text, '--output-format', 'text']
    if STATE['started']: cmd.append('--continue')
    try:
        r = subprocess.run(cmd, cwd=AGENT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)
    except subprocess.TimeoutExpired:
        return 'Jarvis took too long on that one. Ask again, or ask something smaller.'
    except FileNotFoundError:
        return 'The bridge cannot find the claude program on this PC (looked for %s). Start phone.bat from my-agent, or add %s to PATH.' % (claude_exe(), os.path.join(os.path.expanduser('~'), '.local', 'bin'))
    STATE['started'] = True
    out = (r.stdout or '').strip()
    if not out: out = 'Jarvis gave no answer. ' + (r.stderr or '').strip()[-300:]
    return out

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self._send(200, {'ok': True})
    def do_GET(self):
        from urllib.parse import urlparse, parse_qs, unquote
        u = urlparse(self.path)
        if not u.path.startswith('/f/'): return self._send(200, {'ok': True, 'jarvis': 'bridge', 'tunnel': STATE['tunnel']})
        name = os.path.basename(unquote(u.path[3:])); want = hmac.new(PW.encode('utf-8'), name.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(want, (parse_qs(u.query).get('s') or [''])[0]): return self._send(403, {'ok': False, 'error': 'bad link'})
        fp = os.path.join(OUT, name)
        if not os.path.isfile(fp): return self._send(404, {'ok': False, 'error': 'no such file'})
        ext = name.rsplit('.', 1)[-1].lower()
        ct = {'m4a': 'audio/mp4', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'webm': 'audio/webm', 'wav': 'audio/wav', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'pdf': 'application/pdf'}.get(ext, 'application/octet-stream')
        with open(fp, 'rb') as f: b = f.read()
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n).decode('utf-8'))
            req, sig = body.get('req', ''), body.get('sig', '')
            want = hmac.new(PW.encode('utf-8'), req.encode('utf-8'), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(want, sig): return self._send(403, {'ok': False, 'error': 'wrong password'})
            o = json.loads(req)
            if abs(time.time() * 1000 - float(o.get('t', 0))) > 10 * 60 * 1000: return self._send(403, {'ok': False, 'error': 'old request'})
            rid = o.get('rid', '')
            if rid in SEEN: return self._send(200, {'ok': True, 'text': '(already answered)'})
            SEEN.add(rid)
            if o.get('op') == 'ping': return self._send(200, {'ok': True})
            text = str(o.get('text', '')).strip()
            if not text: return self._send(400, {'ok': False, 'error': 'nothing said'})
            print('[you]   ', text, flush=True)
            with LOCK: ans = jarvis(text)
            print('[Jarvis]', ans[:400].replace('\n', ' '), flush=True)
            self._send(200, {'ok': True, 'text': ans})
        except Exception as e:
            self._send(500, {'ok': False, 'error': str(e)})

def tunnel():
    exe = shutil.which('cloudflared') or os.path.expandvars(r'%ProgramFiles(x86)%\cloudflared\cloudflared.exe')
    if not os.path.exists(exe) and not shutil.which('cloudflared'):
        print('cloudflared not found — install it once: winget install Cloudflare.cloudflared   (then run this again)', flush=True); return
    p = subprocess.Popen([exe, 'tunnel', '--url', 'http://localhost:%d' % PORT, '--no-autoupdate'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
    for line in p.stdout:
        m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
        if m and not STATE['tunnel']:
            STATE['tunnel'] = m.group(0)
            print('\n==> PHONE LINK (paste once into jarvis.html on the phone):\n    %s\n' % STATE['tunnel'], flush=True)

if __name__ == '__main__':
    threading.Thread(target=tunnel, daemon=True).start()
    print('Jarvis bridge on http://localhost:%d  (brain = %s)' % (PORT, AGENT), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), H).serve_forever()
