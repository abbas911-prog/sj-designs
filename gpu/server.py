#!/usr/bin/env python3
"""SJ photo try-on server — runs on your own GPU box. Loads Leffa (MIT) once, answers POST /tryon.

  person photo + design number + colour index  ->  JPEG of the person wearing that colour

Env:  SJ_GARMENTS=/workspace/garments   SJ_ORIGINS=https://abbas911-prog.github.io   SJ_PORT=8000
      SJ_STUB=1 (no GPU: returns a quick paste-up, for testing the page)   SJ_DAILY_CAP=400   SJ_IP_HOURLY=30
"""
import io, os, time, threading, collections, json
from flask import Flask, request, Response, jsonify, abort
from PIL import Image, ImageOps
import numpy as np

GARMENTS = os.environ.get('SJ_GARMENTS', '/workspace/garments')
ORIGINS = [o.strip() for o in os.environ.get('SJ_ORIGINS', 'https://abbas911-prog.github.io').split(',')]
STUB = os.environ.get('SJ_STUB') == '1'
DAILY_CAP = int(os.environ.get('SJ_DAILY_CAP', '400'))
IP_HOURLY = int(os.environ.get('SJ_IP_HOURLY', '30'))
STEPS = int(os.environ.get('SJ_STEPS', '30'))

app = Flask(__name__)
@app.after_request
def cors(r):
    o = request.headers.get('Origin', '')
    if o in ORIGINS or o.startswith('http://localhost'):
        r.headers['Access-Control-Allow-Origin'] = o; r.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
        r.headers['Access-Control-Allow-Headers'] = '*'; r.headers['Access-Control-Expose-Headers'] = 'X-Seconds'
    return r
@app.route('/tryon', methods=['OPTIONS'])
def preflight(): return ('', 204)
lock = threading.Lock()                 # one GPU -> one job at a time
queue_len = 0
day = {'d': time.strftime('%Y-%m-%d'), 'n': 0}
hits = collections.defaultdict(list)    # ip -> timestamps

# ---------------- model ----------------
predictor = None
def load():
    global predictor
    if STUB:
        predictor = 'stub'; return
    import sys; sys.path.insert(0, os.environ.get('LEFFA_DIR', '/workspace/Leffa')); os.chdir(os.environ.get('LEFFA_DIR', '/workspace/Leffa'))
    from leffa.transform import LeffaTransform
    from leffa.model import LeffaModel
    from leffa.inference import LeffaInference
    from leffa_utils.densepose_predictor import DensePosePredictor
    from leffa_utils.utils import resize_and_center, get_agnostic_mask_dc
    from preprocess.humanparsing.run_parsing import Parsing
    from preprocess.openpose.run_openpose import OpenPose
    class P:
        def __init__(s):
            s.densepose = DensePosePredictor(config_path='./ckpts/densepose/densepose_rcnn_R_50_FPN_s1x.yaml', weights_path='./ckpts/densepose/model_final_162be9.pkl')
            s.parsing = Parsing(atr_path='./ckpts/humanparsing/parsing_atr.onnx', lip_path='./ckpts/humanparsing/parsing_lip.onnx')
            s.openpose = OpenPose(body_model_path='./ckpts/openpose/body_pose_model.pth')
            m = LeffaModel(pretrained_model_name_or_path='./ckpts/stable-diffusion-inpainting', pretrained_model='./ckpts/virtual_tryon_dc.pth', dtype='float16')
            s.inf = LeffaInference(model=m); s.T = LeffaTransform()
            s.rc, s.mask_dc = resize_and_center, get_agnostic_mask_dc
        def run(s, person: Image.Image, garment: Image.Image, seed=42):
            src = s.rc(person.convert('RGB'), 768, 1024); ref = s.rc(garment.convert('RGB'), 768, 1024)
            parse, _ = s.parsing(src.resize((384, 512))); kp = s.openpose(src.resize((384, 512)))
            mask = s.mask_dc(parse, kp, 'dresses').resize((768, 1024))
            iuv = s.densepose.predict_iuv(np.array(src)); seg = np.concatenate([iuv[:, :, 0:1]] * 3, axis=-1)
            data = s.T({'src_image': [src], 'ref_image': [ref], 'mask': [mask], 'densepose': [Image.fromarray(seg)]})
            out = s.inf(data, ref_acceleration=False, num_inference_steps=STEPS, guidance_scale=2.5, seed=seed, repaint=False)
            return out['generated_image'][0]
    predictor = P()

def stub_run(person, garment):
    # no GPU: paste the garment over the middle of the photo so the page can be tested end to end
    p = ImageOps.exif_transpose(person).convert('RGB'); p = ImageOps.fit(p, (768, 1024))
    g = garment.convert('RGBA'); g = ImageOps.contain(g, (560, 900))
    p.paste(g, ((768 - g.width) // 2, 90), g); return p

def garment_path(no, colour):
    p = os.path.join(GARMENTS, no, f'{colour}.png'); return p if os.path.exists(p) else None

@app.get('/health')
def health():
    return jsonify({'ok': predictor is not None, 'stub': STUB, 'queue': queue_len, 'designs': sorted(os.listdir(GARMENTS)) if os.path.isdir(GARMENTS) else []})

@app.get('/designs/<no>')
def design(no):
    d = os.path.join(GARMENTS, no)
    if not os.path.isdir(d): abort(404)
    meta = json.load(open(os.path.join(d, 'meta.json'))) if os.path.exists(os.path.join(d, 'meta.json')) else {}
    return jsonify({'no': no, 'colours': meta.get('colours', [])})

def err(code, msg): return (jsonify({'error': msg}), code)

@app.post('/tryon')
def tryon():
    global queue_len
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '?').split(',')[0].strip(); now = time.time()
    hits[ip] = [t for t in hits[ip] if now - t < 3600]
    if len(hits[ip]) >= IP_HOURLY: return err(429, 'Too many try-ons from this phone this hour')
    today = time.strftime('%Y-%m-%d')
    if day['d'] != today: day['d'] = today; day['n'] = 0
    if day['n'] >= DAILY_CAP: return err(503, 'Daily limit reached')
    no = request.form.get('no', ''); colour = request.form.get('colour', ''); seed = int(request.form.get('seed', '42'))
    gp = garment_path(no, colour)
    if not gp: return err(404, 'Unknown design or colour')
    f = request.files.get('photo')
    if not f: return err(400, 'No photo')
    raw = f.read()
    if len(raw) > 12_000_000: return err(413, 'Photo too large')
    try: person = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except Exception: return err(400, 'Not an image')
    garment = Image.open(gp)
    hits[ip].append(now); day['n'] += 1
    queue_len += 1
    try:
        with lock:
            t0 = time.time()
            out = stub_run(person, garment) if STUB else predictor.run(person, garment, seed)
            dt = time.time() - t0
    finally:
        queue_len -= 1
    b = io.BytesIO(); out.convert('RGB').save(b, 'JPEG', quality=90)
    return Response(b.getvalue(), mimetype='image/jpeg', headers={'X-Seconds': f'{dt:.1f}'})

load()
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('SJ_PORT', '8000')), threaded=True)
