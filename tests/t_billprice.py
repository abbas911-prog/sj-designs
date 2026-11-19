# 50-50: a bill that went through the green button with NO price (19 Nov 2026, Nawroz INV-0056: SJ-65082 · 4 pcs at 0 -> 50-50 and Jarvis showed 0).
# The stock job's op billprice puts the typed price INTO bills.enc (every phone and Jarvis read it), the bill's total follows; a posted bill is not touched.
import os, sys, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import stock
d = tempfile.mkdtemp(); os.chdir(d); PW = 'test-pw'; fails = 0
def ok(n, v):
    global fails
    print(('ok   ' if v else 'FAIL ') + n); fails += 0 if v else 1
L = {'bills': [{'ref': 'INV-0056', 'dev': 'seklcj', 'st': 'open', 'name': '#47 Nawroz naif', 'lines': [{'no': '65082', 'qty': 4, 'rate': 0, 'amount': 0}], 'sub': 0, 'total': 0, 'pcs': 4},
               {'ref': 'INV-0040', 'dev': 'x', 'st': 'posted', 'name': 'Y', 'lines': [{'no': '1', 'qty': 2, 'rate': 0, 'amount': 0}], 'sub': 0, 'total': 0, 'pcs': 2}], 'batches': []}
stock.ledger_save(PW, L)
note = stock.ledger({'op': 'billprice', 'ref': 'PRICE', 'dev': 'abbas', 'refs': [['INV-0056', 'seklcj'], ['INV-0040', 'x']], 'rates': {'0': 125}}, PW, [])
L2 = stock.ledger_load(PW); b = [x for x in L2['bills'] if x['ref'] == 'INV-0056'][0]; p = [x for x in L2['bills'] if x['ref'] == 'INV-0040'][0]
ok('INV-0056: 4 pcs now at 125 = 500, total 500 (%s)' % note, b['lines'][0]['rate'] == 125 and b['lines'][0]['amount'] == 500 and b['total'] == 500 and b['sub'] == 500)
ok('a bill already posted to #sales is not changed', p['lines'][0]['rate'] == 0 and p['total'] == 0)
stock.ledger({'op': 'billprice', 'ref': 'PRICE', 'dev': 'abbas', 'refs': [['INV-0056', 'seklcj']], 'rates': {'0': 0, '5': 99}}, PW, [])
b = [x for x in stock.ledger_load(PW)['bills'] if x['ref'] == 'INV-0056'][0]
ok('a 0 or a line that does not exist changes nothing', b['lines'][0]['rate'] == 125 and b['total'] == 500 and len(b['lines']) == 1)
print('%d failed' % fails); sys.exit(1 if fails else 0)
