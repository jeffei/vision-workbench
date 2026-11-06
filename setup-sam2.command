#!/bin/zsh
set -e
cd "$(dirname "$0")"
git submodule update --init --recursive -- vendor/sam2
uv pip install --python .venv/bin/python --target vendor/sam2-deps 'hydra-core==1.3.2' 'iopath==0.1.10' 'omegaconf==2.3.1'
mkdir -p models
if [[ ! -f models/sam2.1_hiera_tiny.pt ]]; then
  curl -fL --retry 2 --connect-timeout 15 --max-time 900 https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt -o models/sam2.1_hiera_tiny.pt.part
  mv models/sam2.1_hiera_tiny.pt.part models/sam2.1_hiera_tiny.pt
fi
echo 'SAM 2.1 Tiny 图片模型已准备完成；未升级现有 PyTorch / Ultralytics。'
