#!/usr/bin/env bash
# SJ photo try-on — one-time setup on a rented GPU box (RunPod "PyTorch" template, 24 GB GPU is plenty).
# Run in the pod's web terminal:   bash <(curl -sL https://abbas911-prog.github.io/sj-designs/gpu/setup.sh)
set -e
cd /workspace
if [ ! -d Leffa ]; then git clone --depth 1 https://github.com/franciszzj/Leffa.git; fi
cd Leffa
pip install -q -r requirements.txt flask huggingface_hub
python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download(repo_id="franciszzj/Leffa", local_dir="./ckpts")   # ~15 GB, once
EOF
mkdir -p /workspace/garments
# garments + server come from the sj-designs site
curl -sL https://abbas911-prog.github.io/sj-designs/gpu/server.py -o /workspace/server.py
curl -sL https://abbas911-prog.github.io/sj-designs/gpu/garments.tar -o /tmp/g.tar && tar -xf /tmp/g.tar -C /workspace/garments
echo "---- setup done. start with:  bash /workspace/start.sh"
cat > /workspace/start.sh <<'EOS'
#!/usr/bin/env bash
cd /workspace && export LEFFA_DIR=/workspace/Leffa SJ_GARMENTS=/workspace/garments SJ_PORT=8000
nohup python server.py > /workspace/server.log 2>&1 &
sleep 2; echo "server starting — first load takes ~1 min. Log: tail -f /workspace/server.log"
EOS
chmod +x /workspace/start.sh
