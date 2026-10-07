#!/usr/bin/env python3
"""Order memo -> Trello stock. When an INVOICE is sent from memo.html, the pieces sold come off the Trello card title
(asked by Abbas 7 Oct 2026: "deduct those two specific colors quantity from Trello yourself ... synchronized properly").
  - the colour counts in the card title, e.g. (8/8/8/8), and the total, e.g. (32) pcs, are rewritten in place
  - a comment is left on the card: who, invoice no., colour by colour before -> after
  - a card with every colour at 0 moves to the TOP of the FINISH list (his answer, 7 Oct 2026)
  - the same invoice from the same phone is never taken twice (marker in the comment); "return" puts it back once
Runs on GitHub Actions (workflow memo-stock), started by memo.html. Secrets: TRELLO_TOKEN (read+write), MEMO_PASSWORD. No AI."""
import hashlib, hmac, json, os, re, sys, urllib.parse, urllib.request

KEY = os.environ.get('TRELLO_KEY', '83fea3748717dd1e3fe28a15f2371759')
API = 'https://api.trello.com/1'
READY, FINISH = '66254dc6f8ade3c3a0c9b7d4', '66254dd30f4c624619d009d8'
SAMPLES = '6824cdd97bb99de098f1b7ae'   # one sample piece per card (7 Oct 2026): selling it moves the card to FINISH, a return moves it back

# ---------- the card title: same reading as memo.html parseTitle(), but keeping where each number sits ----------
def parse(t):
    s = t.replace('**', '  ').replace('{', '(').replace('}', ')')          # same length as t, so spans point into t
    m = re.search(r'(?:SJ|SH|Sj|sj)\s*[-=:]*\s*\(?\s*(\d{3,6})', s) or re.search(r'\b(\d{4,6})\b', s)
    no = m.group(1) if m else ''
    ci = re.search(r'colou?rs?', s, re.I); ci = ci.start() if ci else -1
    head, off = (s[:ci], ci) if ci >= 0 else (s, 0)
    hn = [(int(x.group(1)), x.span(1)) for x in re.finditer(r'\((\s*\d+\s*),?\)', head)]
    hn = [(v, (a + len(x) - len(x.lstrip()), b - (len(x) - len(x.rstrip())))) for (v, (a, b)), x in zip(hn, [head[a:b] for _, (a, b) in hn])]
    if no and hn and hn[0][0] == int(no): hn.pop(0)
    total = hn[0] if hn else None
    if total is None:
        m2 = re.search(r'(\d+)\s*\)?\s*pcs', head, re.I)
        if m2: total = (int(m2.group(1)), m2.span(1))
    tail = (s[ci:] if ci >= 0 else s) + ')'
    cells = []                                              # one per colour: [pcs, (start, end) in t, pure_number]
    groups = 0
    for g in re.finditer(r'\(([^()]*/[^()]*?)\)', tail):
        groups += 1
        pos = g.start(1)
        for tok in g.group(1).split('/'):
            d = re.search(r'\d+', tok)
            if d:
                a, b = off + pos + d.start(), off + pos + d.end()
                cells.append([int(d.group()), (a, b) if b <= len(t) else None, bool(re.fullmatch(r'\s*\d+\s*', tok))])
            else:
                cells.append([0, None, False])
            pos += len(tok) + 1
    ncol = re.search(r'colou?rs?\.?\s*=?\s*\(\s*(\d+)\s*\)', tail, re.I)
    sm = sum(c[0] for c in cells)
    return {'no': no, 'total': total, 'cells': cells, 'groups': groups, 'sum': sm,
            'ok': total is not None and sm == total[0] and groups > 0}

def rewrite(t, p, new):
    """new = list of piece counts, one per colour; returns the new title text with only those numbers changed"""
    edits = [(c[1], str(v)) for c, v in zip(p['cells'], new) if c[1] and c[0] != v]
    tot = sum(new)
    if p['total'] and p['total'][0] != tot: edits.append((p['total'][1], str(tot)))
    for (a, b), txt in sorted(edits, key=lambda e: -e[0][0]):
        t = t[:a] + txt + t[b:]
    return t

# ---------- Trello ----------
TOKEN = os.environ.get('TRELLO_TOKEN', '').strip()
def call(method, path, **q):
    q.update(key=KEY, token=TOKEN)
    url = API + path + '?' + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, method=method, data=b'' if method in ('PUT', 'POST') else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b'null')

def run(req):
    op, ref, dev = req.get('op', 'sell'), str(req.get('ref', '')).strip(), str(req.get('dev', ''))[:16]
    who = str(req.get('who', '')).strip()[:60]
    tag = '#memo %s %s %s' % (op, ref, dev)
    by_card = {}
    for l in req.get('lines', []):
        if int(l.get('pcs', 0)) > 0:
            by_card.setdefault(l['card'], []).append((int(l['c']), int(l['pcs']), str(l.get('no', ''))))
    out = []
    for cid, lines in by_card.items():
        r = {'card': cid, 'no': lines[0][2]}
        try:
            card = call('GET', '/cards/' + cid, fields='name,idList,closed')
            r['no'] = parse(card['name'])['no'] or r['no']
            notes = [a['data']['text'] for a in call('GET', '/cards/%s/actions' % cid, filter='commentCard', limit=1000)]
            if op != 'check' and any(n.splitlines()[-1].strip() == tag for n in notes if n.strip()):
                r.update(skip='already done for ' + ref); out.append(r); continue
            if op == 'return':                                            # put back exactly what that invoice took
                sold = [n for n in notes if n.strip() and n.splitlines()[-1].strip() == '#memo sell %s %s' % (ref, dev)]
                if not sold: r.update(err='no sale for %s on this card' % ref); out.append(r); continue
                lines = [(int(a), int(b), r['no']) for a, b in re.findall(r'colour (\d+): \d+ → \d+ \(−(\d+)\)', sold[0])]
            if card['idList'] == SAMPLES or (op == 'return' and any('SAMPLE' in n.splitlines()[0] for n in notes if n.strip() and n.splitlines()[-1].strip() == '#memo sell %s %s' % (ref, dev))):
                out.append(sample(cid, card, op, ref, who, tag, r)); continue
            p = parse(card['name'])
            if not p['ok']:
                r.update(err='card title does not add up (%s = %d, card says %s) — not changed' %
                         ('+'.join(str(c[0]) for c in p['cells']), p['sum'], p['total'][0] if p['total'] else '?')); out.append(r); continue
            new = [c[0] for c in p['cells']]; desc = []
            for c, pcs, _ in sorted(lines):
                if not 1 <= c <= len(new) or not p['cells'][c - 1][1]:
                    desc.append('colour %d: not on the card' % c); continue
                b = new[c - 1]
                if op == 'return':
                    new[c - 1] = b + pcs; desc.append('colour %d: %d → %d (+%d)' % (c, b, new[c - 1], pcs))
                else:
                    take = min(b, pcs); new[c - 1] = b - take
                    desc.append('colour %d: %d → %d (−%d)%s' % (c, b, new[c - 1], take, '' if take == pcs else ' · %d short' % (pcs - take)))
            name = rewrite(card['name'], p, new)
            check = parse(name)
            assert [c[0] for c in check['cells']] == new and check['ok'], 'rewrite check failed'
            if op == 'check':                                             # test run: say what would change, write nothing
                r.update(before=card['name'], after=name, left=sum(new), lines=desc, moved='(check only — Trello not changed)'); out.append(r); continue
            if name != card['name']:
                call('PUT', '/cards/' + cid, name=name)
            moved = ''
            if op == 'sell' and sum(new) == 0 and card['idList'] != FINISH:
                call('PUT', '/cards/' + cid, idList=FINISH, pos='top'); moved = 'moved to FINISH (sold out)'
            if op == 'return' and card['idList'] == FINISH and sum(new) > 0:
                call('PUT', '/cards/' + cid, idList=READY, pos='top'); moved = 'moved back to READY'
            head = ('SOLD' if op == 'sell' else 'RETURNED') + ' · %s%s · from the order memo' % (ref, ' · ' + who if who else '')
            text = '\n'.join([head] + desc + ([moved] if moved else []) + ['%d pcs left' % sum(new), tag])
            call('POST', '/cards/%s/actions/comments' % cid, text=text)
            r.update(before=card['name'], after=name, left=sum(new), lines=desc, moved=moved)
        except Exception as e:
            r.update(err='%s: %s' % (type(e).__name__, str(e)[:200]))
        out.append(r)
    return out

def sample(cid, card, op, ref, who, tag, r):
    """A SAMPLES card is one piece and its title has no counts: a sale moves it to the TOP of FINISH, a return puts it back on SAMPLES."""
    if op == 'check':
        r.update(before=card['name'], after=card['name'], left=0, lines=['sample: 1 → 0 (−1)'], moved='(check only — would move to FINISH)'); return r
    if op == 'sell':
        if card['idList'] != SAMPLES:
            r.update(skip='sample is not on the SAMPLES list any more'); return r
        call('PUT', '/cards/' + cid, idList=FINISH, pos='top'); moved, line, left = 'moved to FINISH (sample sold)', 'sample: 1 → 0 (−1)', 0
    else:
        if card['idList'] == SAMPLES:
            r.update(skip='sample is already on SAMPLES'); return r
        call('PUT', '/cards/' + cid, idList=SAMPLES, pos='top'); moved, line, left = 'moved back to SAMPLES', 'sample: 0 → 1 (+1)', 1
    head = ('SOLD SAMPLE' if op == 'sell' else 'RETURNED SAMPLE') + ' · %s%s · from the order memo' % (ref, ' · ' + who if who else '')
    call('POST', '/cards/%s/actions/comments' % cid, text='\n'.join([head, line, moved, '%d pcs left' % left, tag]))
    r.update(before=card['name'], after=card['name'], left=left, lines=[line], moved=moved)
    return r

def main():
    req_s, sig = os.environ.get('REQ', ''), os.environ.get('SIG', '')
    pw = os.environ.get('MEMO_PASSWORD', '')
    req = json.loads(req_s)
    jid = re.sub(r'[^a-z0-9-]', '', str(req.get('id', '')))[:40] or 'x'
    good = bool(pw) and hmac.compare_digest(hmac.new(pw.encode(), req_s.encode(), hashlib.sha256).hexdigest(), sig)
    res = {'id': jid, 'op': req.get('op'), 'ref': req.get('ref')}
    if not good:
        res.update(ok=False, error='not signed with the shop password')
    else:
        cards = run(req)
        res.update(ok=not any('err' in c for c in cards), cards=cards)
    os.makedirs('jobs', exist_ok=True)
    json.dump(res, open('jobs/%s.json' % jid, 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
