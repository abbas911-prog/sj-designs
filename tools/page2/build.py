#!/usr/bin/env python3
"""tools/page2/build.py — the customer's own LINK PAGE of the new catalogue, with his picture card (Jarvis, 23 Nov 2026).

Abbas: "when I copy the link to paste it, it's not showing the pictures like a catalog … I want it like that, because the catalog looks more
appealing and his name on it … improvise the look".

WhatsApp builds the picture of a link from a file on the site. So every customer gets his own small file there:
    my-<name>-<4 letters>.html     his link. It carries his picture card (name, how many new designs) and loads his page from the relay.
    og-my-<name>-<4 letters>.jpg   the picture of the card: his newest designs, his name.
The page itself (designs, stock, prices) still lives on the relay and is always fresh; this file never holds any of it.

Started by Jarvis on the PC through the relay (op=cjob) -> the workflow memo-page2.yml. The request is signed with the shop password
(MEMO_PASSWORD), the same way the catalogue and stock jobs are. This file writes ONLY those two files and jobs/<id>.json; it reads the
photos in thumbs/ and the Arabic font in tools/catalog/fonts. It does not touch the old catalogue.

REQ (JSON): {id, kind: 'page2', t: the page's code, stem: 'nasir-v2zo', name, country, n: new designs, ph: [photo ids], r: relay link, ts}
The same file is jarvis/page2_build.py on the PC, where cat2.py uses cover_html() for the picture it shows Abbas."""
import os, re, sys, json, hmac, hashlib, pathlib, subprocess, tempfile, html as H

BASE = 'https://abbas911-prog.github.io/sj-designs/'
HERE = os.path.dirname(os.path.abspath(__file__))
AR_DIG = str.maketrans('0123456789', '٠١٢٣٤٥٦٧٨٩')

def ar_count(n):
    if n == 1: return 'تصميم جديد'
    if n == 2: return 'تصميمان جديدان'
    return ('%d' % n).translate(AR_DIG) + (' تصاميم جديدة' if n <= 10 else ' تصميماً جديداً')

def cover_html(name, country, n, photos, arfont='', arname=''):
    """The picture of the link, 1200 x 630: the newest designs across the whole picture, a dark green shade rising from the bottom,
    the customer's name large on it, a gold line, and what to do in English and Arabic. photos = picture addresses (1 to 8 are used).
    arname (24 Nov 2026, Abbas: "you automatically write Arabic names as well. It will be very appealing for the customers") = his name
    or company in Arabic, written on the right at the height of his name."""
    k = len(photos)
    if k > 4: k = 6 if k <= 6 else 8
    cols = k if k <= 4 else (3 if k == 6 else 4); rows = 1 if k <= 4 else 2
    tiles = ''.join('<div class="t" style="background-image:url(\'%s\')"></div>' % H.escape(u, quote=True) for u in photos[:k])
    font = ("@font-face{font-family:'SJArabic';src:url('%s') format('truetype')}" % arfont) if arfont else ''
    who = H.escape(name or 'NEW COLLECTION'); sub = H.escape(country or '')
    big = 78 if len(name or '') <= 14 else 62 if len(name or '') <= 22 else 48
    badge = ('<div class="new">%d NEW DESIGN%s</div>' % (n, '' if n == 1 else 'S')) if n else ''
    ar = (ar_count(n) + ' · ' if n else '') + 'اضغط للمشاهدة والطلب'
    wa = ('<div class="wa" style="font-size:%dpx">%s</div>' % (50 if len(arname) <= 16 else 40 if len(arname) <= 24 else 32, H.escape(arname))) if arname else ''
    wr = 500 if arname else 40                                # his Latin name leaves the right side to the Arabic one
    return '''<!doctype html><meta charset="utf-8"><style>
%s
html,body{margin:0}
body{position:relative;width:1200px;height:630px;background:#0f2a24;font-family:Arial,Helvetica,sans-serif;overflow:hidden;color:#fff}
.g{position:absolute;inset:0;display:grid;grid-template-columns:repeat(%d,1fr);grid-template-rows:repeat(%d,1fr);gap:4px}
.t{background-size:cover;background-position:center 20%%}
.sh{position:absolute;left:0;right:0;bottom:0;height:400px;background:linear-gradient(to top,rgba(12,34,29,.97) 0,rgba(12,34,29,.93) 38%%,rgba(12,34,29,.55) 68%%,rgba(12,34,29,0) 100%%)}
.tag{position:absolute;left:36px;top:30px;padding:9px 18px;border-radius:999px;background:rgba(12,34,29,.78);border:1.5px solid #C9A961;color:#E9D9B4;font:bold 20px Arial;letter-spacing:4px}
.new{position:absolute;right:36px;top:30px;padding:10px 20px;border-radius:999px;background:#C9A961;color:#14251f;font:bold 22px Arial;letter-spacing:2px}
.who{position:absolute;left:40px;right:%dpx;bottom:118px;font:bold %dpx Arial;letter-spacing:1px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 14px rgba(0,0,0,.45)}
.who small{font:bold 26px Arial;color:#E9D9B4;margin-left:18px;letter-spacing:5px}
.wa{position:absolute;right:40px;bottom:108px;max-width:440px;font-family:'SJArabic','Segoe UI',Arial;font-weight:bold;direction:rtl;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 14px rgba(0,0,0,.45)}
.ln{position:absolute;left:40px;bottom:96px;width:120px;height:4px;background:#C9A961;border-radius:2px}
.en{position:absolute;left:40px;bottom:38px;font:bold 25px Arial;color:#E9D9B4;letter-spacing:1.5px}
.ar{position:absolute;right:40px;bottom:32px;font:bold 32px 'SJArabic','Segoe UI',Arial;direction:rtl;color:#fff}
</style><div class="g">%s</div><div class="sh"></div><div class="tag">SJ TRADING · DUBAI</div>%s%s
<div class="who">%s<small>%s</small></div><div class="ln"></div>
<div class="en">TAP TO VIEW &amp; ORDER</div><div class="ar">%s</div>''' % (font, cols, rows, wr, big, tiles, badge, wa, who, sub, ar)

def page_html(code, stem, name, country, n, relay, v, arname=''):
    """The customer's link: his picture card for WhatsApp, and a few lines that fetch his page from the relay and show it.
    While his page loads he sees his name, in Arabic too (arname), on the catalogue's own colours."""
    who = (name or 'SJ Trading') + (' · ' + country if country else '')
    title = who + (' · ' + arname if arname else '') + ' — SJ Trading'
    desc = (('%d new design%s · ' % (n, '' if n == 1 else 's')) if n else '') + 'Tap to view your catalogue and order. ' + ((ar_count(n) + ' · ') if n else '') + 'اضغط لمشاهدة الكتالوج والطلب'
    img = BASE + 'og-my-%s.jpg?v=%s' % (stem, v)
    e = lambda s: H.escape(s, quote=True)
    return ('<!doctype html>\n<html lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<title>%s</title>\n<meta property="og:type" content="website">\n<meta property="og:site_name" content="SJ Trading">\n'
            '<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n<meta property="og:url" content="%smy-%s.html">\n'
            '<meta property="og:image" content="%s">\n<meta property="og:image:secure_url" content="%s">\n<meta property="og:image:type" content="image/jpeg">\n'
            '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="%s">\n'
            '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="%s">\n<meta name="description" content="%s">\n'
            '<meta name="robots" content="noindex">\n'
            '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F5EFEC;color:#241616}#w{min-height:100vh;box-sizing:border-box;padding:22vh 22px 40px;text-align:center}'
            '#w small{display:block;font-size:11px;font-weight:700;letter-spacing:.28em;color:#B08D3C;margin-bottom:16px}#w h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:34px;margin:0;letter-spacing:.02em}'
            '#w h3{font-family:"Geeza Pro","Noto Naskh Arabic","Segoe UI",serif;font-weight:600;font-size:28px;margin:10px 0 0;color:#6B1F2C}#w i{display:block;width:56px;height:2px;background:#B08D3C;margin:18px auto}'
            '#w p{color:#7A6663;font-size:14px;margin:0;animation:sjp 1.2s ease-in-out infinite alternate}@keyframes sjp{from{opacity:.35}to{opacity:1}}</style>\n'
            '</head><body><div id="w"><small>SJ TRADING · DUBAI</small><h2>%s</h2>%s<i></i><p id="m"><span dir="rtl" lang="ar">جاري تحميل الكتالوج</span> · Loading your catalogue</p></div>\n<script>\n'
            '// The customer\'s own page of the new catalogue (job %s). This file only fetches the page from the relay and shows it; it holds no data.\n'
            '(function () {\n  var R = %s, c = %s, m = document.getElementById(\'m\');\n'
            '  function bad() { m.innerHTML = \'This link is not ready. Please message us on WhatsApp.<br><span dir="rtl" lang="ar">الرابط غير جاهز · يرجى التواصل معنا عبر واتساب</span>\'; }\n'
            '  if (!window.fetch) return bad();\n'
            '  fetch(R + \'?op=cget&pg=\' + c).then(function (r) { return r.json(); }).then(function (j) {\n'
            '    if (!j || !j.ok || !j.page) return bad();\n'
            '    document.open(); document.write(\'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>\' + j.page + \'</body></html>\'); document.close();\n'
            '  }).catch(bad);\n})();\n</script></body></html>\n') % (
        e(title), e(title), e(desc), BASE, stem, e(img), e(img), e(title), e(img), e(desc), e(who), ('<h3 dir="rtl" lang="ar">%s</h3>' % e(arname)) if arname else '', e(v), json.dumps(relay), json.dumps(code))

def shot(page, out):
    """the cover's HTML -> a 1200 x 630 JPEG under 280 KB (Chrome on the runner, as the catalogue job does it)"""
    from PIL import Image
    with tempfile.TemporaryDirectory() as t:
        f = os.path.join(t, 'c.html'); open(f, 'w', encoding='utf-8').write(page); png = os.path.join(t, 'c.png')
        chrome = os.environ.get('CHROME') or next(c for c in ('google-chrome', 'chromium', 'chromium-browser', '/opt/pw-browsers/chromium') if subprocess.run(['which', c], capture_output=True).returncode == 0 or os.path.exists(c))
        subprocess.run([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
                        '--window-size=1200,900', '--virtual-time-budget=6000', '--screenshot=' + png, pathlib.Path(f).as_uri()], check=True, capture_output=True, timeout=120)
        im = Image.open(png).convert('RGB').crop((0, 0, 1200, 630)); q = 84
        while True:
            im.save(out, quality=q, optimize=True)
            if os.path.getsize(out) < 280_000 or q <= 50: break
            q -= 6

# ---------- 27 Nov 2026: the videos of his designs (Abbas: "there is no video with the design?" -> "I want the videos just like before").
# Until now only the old catalogue's job (tools/catalog/build.py, video()) made vid/<no>.mp4. The request may name designs of his page that
# have no video yet: vids = ['48188:<the id of its card on the SJTC board>', …]. For each one the card's first video is taken from Trello and
# made small exactly the way the old catalogue did it. Only cards of the SJTC board, never one of its SAMPLES list; only vid/<no>.mp4 and
# vid/<no>.src are written. Run as the job's second part ("build.py videos"), after his link page is published, so the link never waits.
SJTC, SAMPLES = '66254d970f894fea0c7cebae', '6824cdd97bb99de098f1b7ae'
def _trello():
    key = os.environ.get('TRELLO_KEY', '')
    if not key:                                             # the same key the catalogue job has; read from its file, not written a second time
        try: key = re.search(r"TRELLO_KEY',\s*'([0-9a-f]{32})'", open(os.path.join(os.path.dirname(HERE), 'catalog', 'build.py'), encoding='utf-8').read()).group(1)
        except Exception: key = ''
    return {'Authorization': 'OAuth oauth_consumer_key="%s", oauth_token="%s"' % (key, os.environ.get('TRELLO_TOKEN', '').strip())}
def _fetch(url, headers=None, timeout=180):
    import urllib.request
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as r: return r.read()
def _ffmpeg():
    import shutil
    p = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if p: return p
    try:
        import imageio_ffmpeg; return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception: return 'ffmpeg'
def videos(req, budget=16 * 60):
    "-> {ok, kind: 'page2-videos', made: [numbers], same: [already there], none: [the card has no video], bad: ['number: why']}"
    import time, shutil
    t0 = time.time(); A = _trello(); made, same, none, bad = [], [], [], []
    os.makedirs('vid', exist_ok=True)
    for v in (req.get('vids') or [])[:10]:
        m = re.fullmatch(r'(\d{3,6}(?:-[A-Za-z0-9]{1,3})?):([0-9a-f]{24})', str(v))
        if not m: continue
        no, cid = m.group(1), m.group(2)
        if time.time() - t0 > budget: bad.append(no + ': no time left in this run, it comes with the next one'); continue
        try:
            c = json.loads(_fetch('https://api.trello.com/1/cards/%s?fields=idBoard,idList,name&attachments=true&attachment_fields=id,name,mimeType,url,bytes' % cid, A, 60))
            if c.get('idBoard') != SJTC or c.get('idList') == SAMPLES or not re.search(r'(?<!\d)%s(?!\d)' % re.escape(no.split('-')[0]), str(c.get('name') or '')):
                bad.append(no + ': that card is not this design on the SJTC board'); continue
            vs = [a for a in c.get('attachments') or [] if str(a.get('mimeType') or '').startswith('video/')]
            if not vs: none.append(no); continue
            a = vs[0]; out, mark = 'vid/%s.mp4' % no, 'vid/%s.src' % no
            if os.path.exists(out) and os.path.exists(mark) and open(mark).read().strip() == a['id']: same.append(no); continue
            u = str(a.get('url') or '')
            for pre in ('https://trello.com', 'https://api.trello.com'):
                if u.startswith(pre): u = 'https://api.trello.com' + u[len(pre):]; break
            with tempfile.TemporaryDirectory() as t:
                src, tmp = os.path.join(t, 'in'), os.path.join(t, 'out.mp4'); open(src, 'wb').write(_fetch(u, A, 300))
                for crf in (29, 32, 35):                    # the old catalogue's own settings (Rule Eleven): 720 px on the short side, H.264, under 9 MB
                    subprocess.run([_ffmpeg(), '-y', '-loglevel', 'error', '-i', src, '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
                                    '-c:v', 'libx264', '-preset', 'medium', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-b:a', '64k',
                                    '-movflags', '+faststart', tmp], check=True, timeout=600)
                    if os.path.getsize(tmp) < 9_000_000: break
                shutil.move(tmp, out)
            open(mark, 'w').write(a['id']); made.append(no)
        except Exception as e: bad.append('%s: %s: %s' % (no, type(e).__name__, str(e)[:120]))
    return {'ok': True, 'kind': 'page2-videos', 'made': made, 'same': same, 'none': none, 'bad': bad}

def build(req):
    if req.get('kind') != 'page2': return {'ok': False, 'error': 'not a page2 request'}
    stem, code, relay = str(req.get('stem') or ''), str(req.get('t') or ''), str(req.get('r') or '')
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', stem) or len(stem) > 40: return {'ok': False, 'error': 'bad page name'}
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,40}', code): return {'ok': False, 'error': 'bad page code'}
    if not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec', relay): return {'ok': False, 'error': 'bad relay link'}
    name = re.sub(r'[\x00-\x1f<>]', ' ', str(req.get('name') or '')).strip()[:60]; country = re.sub(r'[\x00-\x1f<>]', ' ', str(req.get('country') or '')).strip()[:40]
    arname = re.sub(r'[\x00-\x1f<>]', ' ', str(req.get('ar') or '')).strip()[:60]
    try: n = max(0, min(99, int(req.get('n') or 0)))
    except (TypeError, ValueError): n = 0
    ph = [a for a in (req.get('ph') or []) if isinstance(a, str) and re.fullmatch(r'[0-9a-f]{24}', a)][:8]
    if not ph: return {'ok': False, 'error': 'no photo for the picture'}
    photos = [pathlib.Path(os.path.abspath('thumbs/%s.jpg' % a)).as_uri() if os.path.exists('thumbs/%s.jpg' % a) else BASE + 'thumbs/%s.jpg' % a for a in ph]
    font = os.path.join(os.path.dirname(HERE), 'catalog', 'fonts', 'NotoNaskhArabic-Regular.ttf')
    v = re.sub(r'[^a-z0-9-]', '', str(req.get('id') or ''))[:40] or 'x'
    shot(cover_html(name, country, n, photos, pathlib.Path(font).as_uri() if os.path.exists(font) else '', arname), 'og-my-%s.jpg' % stem)
    open('my-%s.html' % stem, 'w', encoding='utf-8').write(page_html(code, stem, name, country, n, relay, v, arname))
    return {'ok': True, 'kind': 'page2', 'page': 'my-%s.html' % stem, 'cover': 'og-my-%s.jpg' % stem, 'url': BASE + 'my-%s.html' % stem, 'bytes': os.path.getsize('og-my-%s.jpg' % stem)}

def main():
    req_s, sig, pw = os.environ.get('REQ', ''), os.environ.get('SIG', ''), os.environ.get('MEMO_PASSWORD', '')
    req = json.loads(req_s)
    jid = re.sub(r'[^a-z0-9-]', '', str(req.get('id', '')))[:40] or 'x'
    if sys.argv[1:2] == ['videos']:                         # the job's second part: never fails the job, writes jobs/<id>-v.json
        if not req.get('vids'): print('no videos asked for'); return
        if not (pw and hmac.compare_digest(hmac.new(pw.encode(), req_s.encode(), hashlib.sha256).hexdigest(), sig)): res = {'ok': False, 'kind': 'page2-videos', 'error': 'not signed with the shop password'}
        else:
            try: res = videos(req)
            except Exception as e: res = {'ok': False, 'kind': 'page2-videos', 'error': '%s: %s' % (type(e).__name__, str(e)[:300])}
        res['id'] = jid; os.makedirs('jobs', exist_ok=True)
        json.dump(res, open('jobs/%s-v.json' % jid, 'w'), ensure_ascii=False, indent=1); print(json.dumps(res, ensure_ascii=False, indent=1)); return
    if not (pw and hmac.compare_digest(hmac.new(pw.encode(), req_s.encode(), hashlib.sha256).hexdigest(), sig)):
        res = {'ok': False, 'error': 'not signed with the shop password'}
    else:
        try: res = build(req)
        except Exception as e:
            import traceback; traceback.print_exc(); res = {'ok': False, 'error': 'Not made: %s: %s' % (type(e).__name__, str(e)[:300])}
    res['id'] = jid
    os.makedirs('jobs', exist_ok=True)
    json.dump(res, open('jobs/%s.json' % jid, 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
