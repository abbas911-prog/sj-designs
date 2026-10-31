# 31 Oct 2026 (Abbas, SJ-12151 sold: "why can't I see the photo, neither in the invoice nor in the order?"): the photo job deleted a card's
# thumbnails the minute it left READY / SAMPLES. Now a thumbnail off the lists is kept until its photo is 180 days old.
import os, sys, datetime
os.environ.setdefault('TRELLO_TOKEN', 'x'); sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import thumbs
now = datetime.datetime(2026, 10, 31, 16, 25, tzinfo=datetime.timezone.utc).timestamp()
sold_today = '6ae5ebbfac48871be1de1504'                                   # SJ-12151's photo, uploaded 31 Oct 2026 12:15
old = '%08x%s' % (int(now - 200 * 86400), 'ac48871be1de1504')               # a photo from 200 days ago
assert thumbs.stale(sold_today, set(), now) is False, 'a sold card\'s fresh thumbnail must be kept'
assert thumbs.stale(sold_today, {sold_today}, now) is False
assert thumbs.stale(old, set(), now) is True, 'a 200-day-old thumbnail off the lists goes'
assert thumbs.stale(old, {old}, now) is False, 'but never while its card is on the list'
assert thumbs.stale('not-an-id', set(), now) is True
print('t_thumbs: sold card keeps its thumbnail, 180-day cleanup — ok')
