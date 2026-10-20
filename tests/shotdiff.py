# Compare two screenshot folders: python3 tests/shotdiff.py before after  -> per-screen differing pixels (0 = identical)
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]; bad = 0
for f in sorted(os.listdir(a)):
    if not f.endswith('.png'): continue
    if not os.path.exists(os.path.join(b, f)): print('MISSING', f); bad += 1; continue
    x, y = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(os.path.join(b, f)).convert('RGB')
    if x.size != y.size: print('SIZE', f, x.size, y.size); bad += 1; continue
    d = ImageChops.difference(x, y); n = sum(1 for p in d.getdata() if p != (0, 0, 0))
    print(('SAME ' if n == 0 else 'DIFF ') + f + (' ' + str(n) + ' px' if n else '')); bad += 1 if n > 0 else 0
print('screens differing:', bad); sys.exit(1 if bad else 0)
