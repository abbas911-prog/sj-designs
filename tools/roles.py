#!/usr/bin/env python3
"""Sort every photo in thumbs/ into a role for memo.html, once per photo (results kept in thumbs/roles.json):
  lineup = real shop photo of several colours side by side  -> carries the colour numbers
  detail = real close-up / single dress / sleeve             -> shown, no numbers
  cover  = JAMAL AI cover                                     -> hidden when a lineup exists
  shot   = screenshot of a card / chat                        -> never shown
Uses the free CLIP image model on GitHub's servers. No Claude, no AI tokens."""
import json, os, sys
ROLES = 'thumbs/roles.json'
PROMPTS = {
    'cover':  ['a polished AI generated advertisement of dresses on mannequins in a luxury boutique with a golden JAMAL logo on the wall',
               'a digital render of gowns in an elegant showroom with gold lettering and white flowers'],
    'lineup': ['a real phone photo of four or five dresses in different colours standing side by side on mannequins in a shop',
               'a photo of a row of long dresses on mannequins, each a different colour'],
    'detail': ['a close-up photo of a sleeve, embroidery or fabric of a dress held by a hand',
               'a photo of one single dress on one mannequin'],
    'shot':   ['a screenshot of a mobile app or chat message with lines of text',
               'a screenshot of a Trello card or Slack message with small photos and text'],
}
ORDER = ['cover', 'lineup', 'detail', 'shot']

def load():
    try:
        return json.load(open(ROLES))
    except Exception:
        return {}

def main():
    roles = load()
    ids = sorted(f[:-4] for f in os.listdir('thumbs') if f.endswith('.jpg'))
    roles = {k: v for k, v in roles.items() if k in ids}
    todo = [i for i in ids if i not in roles]
    if '--check' in sys.argv:
        out = os.environ.get('GITHUB_OUTPUT')
        line = 'need=%d' % (1 if todo else 0)
        if out:
            open(out, 'a').write(line + '\n')
        print(line, len(todo), 'to sort')
        if not todo:
            json.dump(roles, open(ROLES, 'w'), separators=(',', ':'), sort_keys=True)
        return
    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor
    name = 'openai/clip-vit-base-patch32'
    model, proc = CLIPModel.from_pretrained(name).eval(), CLIPProcessor.from_pretrained(name)
    texts = [t for k in ORDER for t in PROMPTS[k]]
    with torch.no_grad():
        for n in range(0, len(todo), 16):
            batch = todo[n:n + 16]
            ims = [Image.open('thumbs/%s.jpg' % i).convert('RGB') for i in batch]
            out = model(**proc(text=texts, images=ims, return_tensors='pt', padding=True))
            te = out.text_embeds / out.text_embeds.norm(dim=-1, keepdim=True)
            cls = torch.stack([te[2 * i:2 * i + 2].mean(0) for i in range(len(ORDER))])
            cls = cls / cls.norm(dim=-1, keepdim=True)
            ie = out.image_embeds / out.image_embeds.norm(dim=-1, keepdim=True)
            p = (100 * ie @ cls.T).softmax(-1)
            for i, im, row in zip(batch, ims, p.tolist()):
                roles[i] = [ORDER[max(range(4), key=lambda k: row[k])]] + [round(x, 2) for x in row] + [round(im.width / im.height, 2)]
    json.dump(roles, open(ROLES, 'w'), separators=(',', ':'), sort_keys=True)
    from collections import Counter
    print('sorted', len(todo), dict(Counter(v[0] for v in roles.values())))

if __name__ == '__main__':
    main()
