#!/usr/bin/env python3
"""Sort every photo in thumbs/ into a role for memo.html, once per photo (results kept in thumbs/roles.json):
  lineup = real shop photo of several colours side by side  -> carries the colour numbers
  detail = real close-up / single dress / sleeve             -> shown, no numbers
  cover  = JAMAL AI cover (made by ChatGPT)                   -> hidden when a lineup exists
           (a REAL JAMAL studio photo, with the gold logo, is a lineup: found by tools/catalog/jamal.py, 23 Oct 2026)
  shot   = screenshot of a card / chat                        -> never shown
Uses the free CLIP image model on GitHub's servers: each new photo gets the role of the checked photos it looks most like. No Claude, no AI tokens."""
import json, os, sys
ROLES = 'thumbs/roles.json'
ORDER = ['cover', 'lineup', 'detail', 'shot']
LABELS = 'tools/labels.json'   # photos checked by eye (6 Oct 2026); new photos are sorted by likeness to these
REF = 'tools/ref.json'         # image fingerprints of the checked photos, made once, so it keeps working after cards leave READY

def load(p, d):
    try:
        return json.load(open(p))
    except Exception:
        return d

LOGOS = 'thumbs/logo.json'    # id -> JAMAL logo score, each photo checked once (23 Oct 2026)
def jamal_pass(ids, roles, labels):
    """23 Oct 2026 (Abbas, SJ-79623: the Stock app put 7-9 on a shop photo; the two JAMAL photos were hand-labelled lineup AND cover):
    a photo with the real JAMAL logo is a real photo of several colours = lineup, whatever CLIP or an old label said. Each photo
    is checked once (thumbs/logo.json); numpy + pillow only, ~0.1 s per new photo."""
    logos = load(LOGOS, {})
    new = [i for i in ids if i not in logos]
    if new:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'catalog'))
        from jamal import logo_score
        from PIL import Image, ImageOps
        for i in new:
            try: logos[i] = round(logo_score(ImageOps.exif_transpose(Image.open('thumbs/%s.jpg' % i)).convert('RGB')), 3)
            except Exception as e: print('logo', i, e); logos[i] = 0.0
        json.dump({k: v for k, v in logos.items() if k in ids}, open(LOGOS, 'w'), separators=(',', ':'), sort_keys=True)
    from jamal import JAMAL_MIN
    n = 0
    for i in ids:
        if logos.get(i, 0) >= JAMAL_MIN and (i not in roles or roles[i][0] != 'lineup' or len(roles[i]) < 3):
            roles[i] = ['lineup', logos[i], 'jamal']; n += 1
    return n

def main():
    roles, labels, ref = load(ROLES, {}), load(LABELS, {}), load(REF, None)
    ids = sorted(f[:-4] for f in os.listdir('thumbs') if f.endswith('.jpg'))
    roles = {k: v for k, v in roles.items() if k in ids}
    for i in ids:                                   # a checked photo always keeps its checked role
        if i in labels and (i not in roles or roles[i][0] != labels[i]) and not (len(roles.get(i, [])) > 2 and roles[i][2] == 'jamal'):
            roles[i] = [labels[i]]
    jamal_pass(ids, roles, labels)                  # ... unless the real JAMAL logo is in it: then it is a lineup
    todo = [i for i in ids if i not in roles]
    need = bool(todo) or ref is None
    if '--check' in sys.argv:
        out = os.environ.get('GITHUB_OUTPUT')
        if out:
            open(out, 'a').write('need=%d\n' % need)
        print('need=%d' % need, len(todo), 'to sort')
        json.dump(roles, open(ROLES, 'w'), separators=(',', ':'), sort_keys=True)
        return
    import base64, numpy as np, torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor
    name = 'openai/clip-vit-base-patch32'
    model, proc = CLIPModel.from_pretrained(name).eval(), CLIPProcessor.from_pretrained(name)
    def embed(paths):
        vecs = []
        with torch.no_grad():
            for n in range(0, len(paths), 16):
                ims = [Image.open(p).convert('RGB') for p in paths[n:n + 16]]
                v = model.vision_model(**proc(images=ims, return_tensors='pt'))
                e = model.visual_projection(v.pooler_output)
                vecs.append((e / e.norm(dim=-1, keepdim=True)).numpy())
        return np.concatenate(vecs) if vecs else np.zeros((0, 512), 'float32')
    if ref is None:
        have = [i for i in sorted(labels) if os.path.exists('thumbs/%s.jpg' % i)]
        emb = embed(['thumbs/%s.jpg' % i for i in have]).astype('float16')
        ref = {'roles': [labels[i] for i in have], 'emb': base64.b64encode(emb.tobytes()).decode()}
        json.dump(ref, open(REF, 'w'))
        print('reference made from', len(have), 'checked photos')
    R = np.frombuffer(base64.b64decode(ref['emb']), dtype='float16').astype('float32').reshape(len(ref['roles']), -1)
    rr = ref['roles']
    if todo:
        E = embed(['thumbs/%s.jpg' % i for i in todo])
        S = E @ R.T
        for i, row in zip(todo, S):
            top = np.argsort(-row)[:7]
            vote = {}
            for j in top:
                vote[rr[j]] = vote.get(rr[j], 0) + float(row[j]) ** 4
            best = max(vote, key=vote.get)
            roles[i] = [best, round(float(row[top[0]]), 3)]
    json.dump(roles, open(ROLES, 'w'), separators=(',', ':'), sort_keys=True)
    from collections import Counter
    print('sorted', len(todo), dict(Counter(v[0] for v in roles.values())))

if __name__ == '__main__':
    main()
