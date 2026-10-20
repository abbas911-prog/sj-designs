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
