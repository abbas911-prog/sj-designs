#!/usr/bin/env python3
"""Swap ONE photo of ONE design inside an existing catalogue page, in place (same link). 23 Oct 2026, Abbas (Nasir, SJ-79623: the
3-colour group had the wrong photo): "fix the same catalogue, he will use the same link".
Usage: python3 tools/catalog/fixphoto.py <page.html> <design no> <photo slot 1,2,..> <Trello card id> <attachment id>
The attachment is downloaded from Trello (TRELLO_TOKEN), encoded exactly like the builder (img_tag: 1200 px wide JPEG), and the
slot's <div class="photo"> block is replaced; its colour numbers (data-nums) stay. FIX_LOCAL=<image file> = use that file instead
of Trello (tests). The cover picture is untouched (it shows each design's FIRST photo)."""
import io, os, re, sys
from PIL import Image, ImageOps
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

def fix(page, no, slot, card, att, src=None):
    h = open(page, encoding='utf-8').read()
    a = h.index('<article class="design" data-no="%s"' % no)
    b = h.find('<article class="design"', a + 10); b = len(h) if b < 0 else b
    blocks = list(re.finditer(r'<div class="photo" data-nums="([^"]*)" data-n="\d+"[^>]*><img [^>]*>\s*<div class="nums"[^>]*>.*?</div></div>', h[a:b], re.S))
    if not 1 <= slot <= len(blocks): raise SystemExit('design %s has %d photos, no slot %d' % (no, len(blocks), slot))
    m = blocks[slot - 1]; nums = [int(x) for x in m.group(1).split(',') if x]
    if src: im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    else:
        url = 'https://api.trello.com/1/cards/%s/attachments/%s/download/photo' % (card, att)
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(build.get(url, build.AUTH)))).convert('RGB')
    tag = build.img_tag(im, nums, no)
    h = h[:a + m.start()] + tag + h[a + m.end():]
    open(page, 'w', encoding='utf-8').write(h)
    print('%s: design %s photo %d replaced (%dx%d, numbers %s)' % (page, no, slot, min(im.width, 1200), round(im.height * min(1, 1200 / im.width)), nums))

if __name__ == '__main__':
    page, no, slot, card, att = sys.argv[1:6]
    fix(page, no, int(slot), card, att, os.environ.get('FIX_LOCAL'))
