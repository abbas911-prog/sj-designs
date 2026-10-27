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
                ('Sj = **(57026)** (38) pcs __ Colour= (6)__(0-3/14-3/16-3/0-3/8-3//0-3)', (38, [0, 14, 16, 0, 8, 0]))]:   # 27 Oct 2026: "//" showed 7 colours
    p = st.parse(t); got = (p['total'] and p['total'][0], [c[0] for c in p['cells']])
    assert p['ok'] and got == want, (t, got)
for t in ['Sj = **(6668) ', 'SJ = **6668** (60) pcs ,,, colors = (5) ,,,,,,']:
    assert not st.parse(t)['ok'], t
print('parse: shop-typed titles ok')
