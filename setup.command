#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v uv >/dev/null; then
  echo '请先安装 uv：https://docs.astral.sh/uv/getting-started/installation/'
  exit 1
fi
git submodule update --init --recursive
uv venv --python python3 .venv
uv pip install --python .venv/bin/python 'setuptools<81' wheel
uv pip install --python .venv/bin/python --no-build-isolation -r requirements.txt
mkdir -p models
if [[ ! -f models/yoloe-v8s-seg.pt ]]; then
  curl -fL --retry 2 https://huggingface.co/jameslahm/yoloe/resolve/main/yoloe-v8s-seg.pt -o models/yoloe-v8s-seg.pt.part
  mv models/yoloe-v8s-seg.pt.part models/yoloe-v8s-seg.pt
fi
if [[ ! -f mobileclip_blt.pt ]]; then
  curl -fL --retry 2 https://docs-assets.developer.apple.com/ml-research/datasets/mobileclip/mobileclip_blt.pt -o mobileclip_blt.pt.part
  mv mobileclip_blt.pt.part mobileclip_blt.pt
fi
echo '安装完成，请双击 start.command 启动。'
