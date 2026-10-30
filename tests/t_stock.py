import importlib.util, json
spec = importlib.util.spec_from_file_location('st', __import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'tools', 'stock.py')); st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)
cards = {'A': {'id':'A','name':'SJ-48293 (16) colour = (2) (8/8)','idList':st.FINISH,'closed':False},
         'B': {'id':'B','name':'SJ-6668-1 (10) colour = (2) (5/5)','idList':st.READY,'closed':False},
         'C': {'id':'C','name':'SJ-6668 (6) colour = (2) (3/3)','idList':st.READY,'closed':False}}
comments = {'A':[], 'B':[], 'C':[]}; log=[]
def call(m, path, **q):
    log.append((m, path, {k:v for k,v in q.items() if k not in ('key','token')}))
    if path.startswith('/lists/'):
        lid = path.split('/')[2]; return [c for c in cards.values() if c['idList']==lid]
    if path.endswith('/actions/comments'):
        cid = path.split('/')[2]; comments[cid].append(q['text']); return {}
    if path.endswith('/actions'):
        cid = path.split('/')[2]; return [{'data':{'text':t}} for t in comments[cid]]
    cid = path.split('/')[2]
    if m=='PUT':
        for k,v in q.items():
            if k=='name': cards[cid]['name']=v
            if k=='idList': cards[cid]['idList']=v
        return {}
    return dict(cards[cid])
st.call = call
r1 = st.run({'op':'retbill','ref':'RET-0001','dev':'d1','who':'Musalim','lines':[{'card':'','no':'48293','c':1,'pcs':3},{'card':'','no':'6668-1','c':2,'pcs':2},{'card':'','no':'6668','c':1,'pcs':1},{'card':'','no':'99999','c':1,'pcs':1}]})
print(json.dumps(r1, ensure_ascii=False, indent=0))
print(cards['A'], cards['B']['name'], cards['C']['name'])
r2 = st.run({'op':'retbill','ref':'RET-0001','dev':'d1','lines':[{'card':'A','no':'48293','c':1,'pcs':3}]}); print('again:', r2)
# 23 Oct 2026 (Abbas, "6668 all": "the numbers add up, why does it say they don't?"): titles as the shop really types them
for t, want in [('Sj 6668 (pcs67) 5 colors.      (14/13/14/14/12)', (67, [14, 13, 14, 14, 12])), ('Sj 6668 (pcs 60 ) 5 colors.  (12/12/12/12/12)', (60, [12] * 5)),
                ('Sj  6668  (20pcc) 5 colors.  (4/4/4/4/4)', (20, [4] * 5)), ('Sj 6668(70pcs)5 colors.   (14/14/14/14/14/)', (70, [14] * 5)),
                ('Sj= **6668** pcs (46) 5 colors.   (8/10/10/8/10)', (46, [8, 10, 10, 8, 10])),
                ('Sj = **(57026)** (38) pcs __ Colour= (6)__(0-3/14-3/16-3/0-3/8-3//0-3)', (38, [0, 14, 16, 0, 8, 0])),   # 27 Oct 2026: "//" showed 7 colours
                ('Sj= (40032) ..(60) pcs colour= 1 ___(60)', (60, [60])),                                          # 30 Oct 2026: a plain "(60)" is the one colour
                ('Sj = **(51862)** (48) pcs __ colour _(5)__(8/4/12/8)_(16)', (48, [8, 4, 12, 8, 16])),            # …and "(16)" the 5th colour, "(5)" the colour number
                ('Sj = **(71352)** (32) pcs colour = (5) ,,,,,(8/4/8/8/4)', (32, [8, 4, 8, 8, 4])),
                ('Sj 83942 (8pcs) 1 colour', (8, [8])), ('Sj = (12345) (20) pcs colour = (1)', (20, [20]))]:   # 30 Oct 2026: one colour, no count bracket = the total
    p = st.parse(t); got = (p['total'] and p['total'][0], [c[0] for c in p['cells']])
    assert p['ok'] and got == want, (t, got)
for t in ['Sj = **(6668) ', 'SJ = **6668** (60) pcs ,,, colors = (5) ,,,,,,', 'Sj = (12345) (20) pcs colour = 10']:
    assert not st.parse(t)['ok'], t
for t, sold, want in [('Sj= (40032) ..(60) pcs colour= 1 ___(60)', [56], 'Sj= (40032) ..(56) pcs colour= 1 ___(56)'),
                      ('Sj = **(51862)** (48) pcs __ colour _(5)__(8/4/12/8)_(16)', [8, 4, 12, 8, 12], 'Sj = **(51862)** (44) pcs __ colour _(5)__(8/4/12/8)_(12)'),
                      ('Sj 83942 (8pcs) 1 colour', [4], 'Sj 83942 (4pcs) 1 colour')]:
    assert st.rewrite(t, st.parse(t), sold) == want, (t, st.rewrite(t, st.parse(t), sold))   # a sale changes only that colour's number and the total
print('parse: shop-typed titles ok')
# 28 Oct 2026: a return line whose colour is not on the card (colour 3 on a 2-colour card) changes nothing and comes back as an error —
# before, the card was marked done for that return and the phone showed "Back on Trello ✓" although nothing went back
cards['D'] = {'id': 'D', 'name': 'SJ-61111 (12) colour = (2) (6/6)', 'idList': st.READY, 'closed': False}; comments['D'] = []
r3 = st.run({'op': 'retbill', 'ref': 'RET-0009', 'dev': 'd1', 'lines': [{'card': 'D', 'no': '61111', 'c': 1, 'pcs': 2}, {'card': 'D', 'no': '61111', 'c': 3, 'pcs': 2}]})
assert any('not on the card' in (x.get('err') or '') for x in r3), r3
assert cards['D']['name'] == 'SJ-61111 (12) colour = (2) (6/6)' and comments['D'] == [], (cards['D'], comments['D'])
r4 = st.run({'op': 'retbill', 'ref': 'RET-0009', 'dev': 'd1', 'lines': [{'card': 'D', 'no': '61111', 'c': 1, 'pcs': 2}]})   # fixed line: goes through, not skipped
assert not any(x.get('err') or x.get('skip') for x in r4) and cards['D']['name'] == 'SJ-61111 (14) colour = (2) (8/6)', (r4, cards['D'])
print('retbill: colour not on the card → error, card untouched; fixed line then goes through — ok')
