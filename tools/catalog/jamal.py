#!/usr/bin/env python3
"""Is this a real JAMAL studio photo? The gold JAMAL mark + the word (tools/catalog/jamal-logo.png) sits in the top third of every
JAMAL line-up photo. logo_score(im) = normalised cross-correlation with that logo at 7 sizes, 1 = perfect: JAMAL studio photos score
0.8-1.0, every shop photo and every AI cover of the 493 thumbnails checked on 23 Oct 2026 stays under 0.55. JAMAL_MIN = 0.6.
Used by the catalogue builder (which photo is the JAMAL one) and by tools/roles.py (a real JAMAL photo is a lineup, never an AI cover)."""
import os
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
JAMAL_MIN = 0.6
LOGO = None
def logo_score(im, width=600):
    """How strongly the real JAMAL logo (the gold mark + the word, tools/catalog/jamal-logo.png) shows in the top third of the photo:
    normalised cross-correlation at several logo sizes, 1 = perfect. A JAMAL studio photo scores 0.8-1.0, every shop photo and
    every AI cover checked (493 thumbnails, 23 Oct 2026) stays under 0.55."""
    global LOGO
    if LOGO is None: LOGO = np.asarray(Image.open(os.path.join(HERE, 'jamal-logo.png')).convert('L'), dtype=np.float32)
    W, H = im.size
    g = np.asarray(im.convert('L').resize((width, max(1, int(width * H / W)))), dtype=np.float32)
    band = g[:int(g.shape[0] * 0.34)]
    best = 0.0
    for sc in (0.55, 0.7, 0.85, 1.0, 1.2, 1.45, 1.75):
        tw, th = max(8, int(LOGO.shape[1] * sc)), max(12, int(LOGO.shape[0] * sc))
        t = np.asarray(Image.fromarray(LOGO.astype('uint8')).resize((tw, th)), dtype=np.float32)
        Hb, Wb = band.shape
        if Hb < th + 2 or Wb < tw + 2: continue
        t = t - t.mean(); tn = np.sqrt((t * t).sum()) or 1.0
        fh, fw = Hb + th - 1, Wb + tw - 1
        corr = np.fft.irfft2(np.fft.rfft2(band, (fh, fw)) * np.fft.rfft2(t[::-1, ::-1], (fh, fw)), (fh, fw))[th - 1:Hb, tw - 1:Wb]
        I = np.pad(band, ((1, 0), (1, 0))).cumsum(0).cumsum(1); I2 = np.pad(band * band, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        s1 = I[th:, tw:] - I[:-th, tw:] - I[th:, :-tw] + I[:-th, :-tw]
        s2 = I2[th:, tw:] - I2[:-th, tw:] - I2[th:, :-tw] + I2[:-th, :-tw]
        var = np.maximum(s2 - s1 * s1 / (th * tw), 16.0 * th * tw)    # a window flatter than 4 grey levels never matches
        best = max(best, float((corr / (np.sqrt(var) * tn)).max()))
    return best

