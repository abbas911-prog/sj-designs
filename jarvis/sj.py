#!/usr/bin/env python3
"""SJ tool for Jarvis (Claude Code on Abbas's PC) — 25 Oct 2026.
Talks to the Assistant's own Google script (tools/assistant.gs) with the Assistant password, exactly like assistant.html does.
Nothing is sent to Slack/email without an explicit `send` command — Claude must read the message back to Abbas and get his yes first.

Setup: copy config.example.json to config.json next to this file and fill in the Assistant link (…/exec), the Assistant password, your name.

Commands (print plain text, made for Claude to read):
  sj.py feed                      every chat with something new (Slack SJTC + Factory + Email), newest first
  sj.py chats                     all chats (names Claude can use)
  sj.py chat "<name>" [n]         last n messages of a chat (default 30)
  sj.py find "<chat>" "<text>" [n]   messages containing <text> (e.g. find "#sales-new" matiullah 2)
  sj.py ledger "<name>" [n]       SJ VENDOR LEDGER tab: balance + latest lines
  sj.py customer "<name>"         customer balance + saved bills (SJ Stock)
  sj.py card <design>             Trello: which list the design card is in
  sj.py factory [hours]           what happened at the factory (cards moved + factory Slack)
  sj.py send "<chat>" "<text>"    POST a message as Abbas into that chat (Slack thread/channel or email reply)  ← only after his yes
  sj.py file <chat> <fileId> <out>   download a photo/voice/file from a chat to <out>
  sj.py show "<name>"             open that chat on screen (Assistant page) — also: show find "<chat>:<text>", show ask "<question>"
  sj.py ask "<question>"          ask the Assistant's own AI (uses Abbas's key) — usually not needed, Claude IS the brain here
"""
import sys, os, json, time, hmac, hashlib, urllib.request, subprocess, webbrowser, random, string

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, 'config.json')
ASSISTANT_PAGE = 'https://abbas911-prog.github.io/sj-designs/assistant.html'

def cfg():
    if not os.path.exists(CFG):
        sys.exit('No config.json yet. Copy config.example.json to config.json and fill in the Assistant link, password and name.')
    with open(CFG, encoding='utf-8') as f:
        c = json.load(f)
    for k in ('url', 'pw'):
        if not c.get(k):
            sys.exit('config.json is missing "%s"' % k)
    c.setdefault('who', 'Abbas')
    return c

def api(op, **kw):
    c = cfg()
    req = dict(kw); req['op'] = op; req['t'] = int(time.time() * 1000); req['who'] = c['who']
    req['rid'] = ''.join(random.choices(string.ascii_lowercase + string.digits, k=12)) if op in ('post', 'up', 'mail') else ''
    body = json.dumps(req, separators=(',', ':'), ensure_ascii=False)
    sig = hmac.new(c['pw'].encode('utf-8'), body.encode('utf-8'), hashlib.sha256).hexdigest()
    data = json.dumps({'req': body, 'sig': sig}).encode('utf-8')
    r = urllib.request.Request(c['url'], data=data, headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        txt = resp.read().decode('utf-8')
    try:
        return json.loads(txt)
    except Exception:
        sys.exit('The Assistant link answered with a web page, not JSON — check the /exec link and that it is deployed for Anyone.')

def chats():
    j = api('feed')
    if not j.get('ok'): sys.exit('feed: ' + str(j.get('error')))
    return j['chats']

def norm(s): return str(s or '').lower().replace('#', '').replace('sj-', '').strip()

def find_chat(name):
    L = chats(); q = norm(name)
    for c in L:
        if norm(c['title']) == q or (c.get('kind') == 'channel' and norm(c['chn']) == q): return c
    for c in L:
        if q in norm(c['title']) or q in norm(c.get('chn')): return c
    sys.exit('No chat like "%s". Try `sj.py chats`.' % name)

def when(ts):
    try: return time.strftime('%d %b %H:%M', time.localtime(float(ts)))
    except Exception: return '?'

def line(m):
    f = m.get('files') or []
    fs = (' [' + ', '.join((x.get('name') or 'file') for x in f) + ']') if f else ''
    who = '→' if m.get('sys') else (m.get('who') or '?') + ':'
    return '%s %s %s%s' % (when(m['ts']), who, (m.get('text') or '').replace('\n', ' / ')[:600], fs)

def main(a):
    if not a: print(__doc__); return
    cmd = a[0]
    if cmd == 'feed':
        L = [c for c in chats() if c.get('un')]
        if not L: print('Nothing new.'); return
        for c in L:
            src = 'Email · ' + c['chn'] if c['ws'] == 'e' else c['team'] + ' #' + c['chn']
            print('• %s [%s] · %s new' % (c['title'], src, c['un'] if c['un'] > 0 else '?'))
            for l in c.get('lines') or []: print('    %s %s: %s' % (when(l['ts']), l['who'], l['text']))
    elif cmd == 'chats':
        for c in chats(): print('%s  [%s]%s' % (c['title'], 'Email ' + c['chn'] if c['ws'] == 'e' else c['team'] + ' #' + c['chn'], ' · %s new' % c['un'] if c.get('un') else ''))
    elif cmd == 'chat':
        c = find_chat(a[1]); n = int(a[2]) if len(a) > 2 else 30
        j = api('thread', k=c['k'], look=0)
        if not j.get('ok'): sys.exit(j.get('error'))
        print('CHAT %s (%s)' % (c['title'], c['k']))
        for m in j['msgs'][-n:]: print(line(m) + ('   {file ids: %s}' % ', '.join(x['id'] for x in m.get('files') or []) if m.get('files') else ''))
    elif cmd == 'find':
        c = find_chat(a[1]); q = a[2].lower(); n = int(a[3]) if len(a) > 3 else 3
        j = api('thread', k=c['k'], look=0)
        if not j.get('ok'): sys.exit(j.get('error'))
        hits = [m for m in j['msgs'] if q in (m.get('text') or '').lower() or any(q in (f.get('name') or '').lower() for f in m.get('files') or [])]
        hits = sorted(hits, key=lambda m: float(m['ts']), reverse=True)[:n]
        if not hits: print('Nothing with "%s" in %s' % (a[2], c['title'])); return
        for m in hits: print(line(m) + ('   {file ids: %s}' % ', '.join(x['id'] for x in m.get('files') or []) if m.get('files') else ''))
    elif cmd in ('ledger', 'customer', 'card', 'factory'):
        q = {'ledger': 'balance and latest lines of the ledger tab "%s"' % (a[1] if len(a) > 1 else ''),
             'customer': 'balance and saved bills of the customer "%s"' % (a[1] if len(a) > 1 else ''),
             'card': 'where is the Trello card for design %s' % (a[1] if len(a) > 1 else ''),
             'factory': 'what happened at the factory in the last %s hours (use factory_status)' % (a[1] if len(a) > 1 else '24')}[cmd]
        j = api('ask', q='Use the right lookup tool and return its raw result verbatim, nothing else: ' + q)
        if not j.get('ok'): sys.exit(j.get('error'))
        print(j.get('text', ''))
    elif cmd == 'send':
        c = find_chat(a[1]); text = a[2]
        j = api('post', k=c['k'], text=text)
        if not j.get('ok'): sys.exit('NOT sent: ' + str(j.get('error')))
        print('Sent to %s: %s' % (c['title'], text))
    elif cmd == 'file':
        c = find_chat(a[1]); j = api('file', k=c['k'], id=a[2], thumb=0)
        if not j.get('ok'): sys.exit(j.get('error'))
        import base64
        out = a[3] if len(a) > 3 else j.get('name', 'file')
        with open(out, 'wb') as f: f.write(base64.b64decode(j['b64']))
        print('Saved %s (%s)' % (out, j.get('type')))
    elif cmd == 'show':
        what = a[1] if len(a) > 1 else ''
        if what == 'find' and len(a) > 2: url = ASSISTANT_PAGE + '#find=' + urllib.request.quote(a[2])
        elif what == 'ask' and len(a) > 2: url = ASSISTANT_PAGE + '#ask=' + urllib.request.quote(a[2])
        elif what == 'talk': url = ASSISTANT_PAGE + '#talk=1'
        else: url = ASSISTANT_PAGE + '#open=' + urllib.request.quote(what)
        webbrowser.open(url); print('Opened on screen: ' + url)
    elif cmd == 'ask':
        j = api('ask', q=a[1]); print(j.get('text') if j.get('ok') else 'error: ' + str(j.get('error')))
    else:
        print(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
