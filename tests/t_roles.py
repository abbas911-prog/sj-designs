"""tools/roles.py: a real JAMAL studio photo (gold logo in the top third) is a lineup, whatever CLIP or an old hand label said
(23 Oct 2026, SJ-79623: the Stock app put colours 7-9 on a shop photo because the JAMAL 3-dress photo was labelled 'cover')."""
import importlib.util, json, os, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
spec = importlib.util.spec_from_file_location('roles', os.path.join(ROOT, 'tools', 'roles.py')); roles = importlib.util.module_from_spec(spec); spec.loader.exec_module(roles)
T = tempfile.mkdtemp(); os.makedirs(os.path.join(T, 'thumbs')); cwd = os.getcwd(); os.chdir(T)
try:
    ids = []
    for f in os.listdir(os.path.join(ROOT, 'tests', 'fixtures', '79623')):
        shutil.copy(os.path.join(ROOT, 'tests', 'fixtures', '79623', f), 'thumbs/' + f); ids.append(f[:-4])
    ids.sort()
    R = {'6a368bee72fb291b1477f713': ['shot'], '6a381658df3773d1ea5397da': ['lineup'], '6a38168c84e0eb6464b9ab4d': ['lineup'], '6a58efc843b0bc351f6ed77f': ['cover', 0.98], '6a58efd612e8e3518909c3bb': ['lineup']}
    n = roles.jamal_pass(ids, R, {'6a58efc843b0bc351f6ed77f': 'cover'})
    assert n == 2, n
    assert R['6a58efc843b0bc351f6ed77f'][0] == 'lineup' and R['6a58efc843b0bc351f6ed77f'][2] == 'jamal', R
    assert R['6a58efd612e8e3518909c3bb'][0] == 'lineup' and R['6a58efd612e8e3518909c3bb'][2] == 'jamal', R
    assert R['6a381658df3773d1ea5397da'] == ['lineup'] and R['6a38168c84e0eb6464b9ab4d'] == ['lineup'] and R['6a368bee72fb291b1477f713'] == ['shot'], R
    L = json.load(open('thumbs/logo.json')); assert len(L) == 5 and L['6a58efd612e8e3518909c3bb'] >= 0.9 and L['6a38168c84e0eb6464b9ab4d'] < 0.55, L
    # second run: nothing new to check, nothing changes
    assert roles.jamal_pass(ids, R, {}) == 0
    print('t_roles: both JAMAL photos of 79623 = lineup (jamal), shop photos untouched, logo checked once — ok')
finally:
    os.chdir(cwd); shutil.rmtree(T, ignore_errors=True)
