#!/bin/zsh
set -e
cd "$(dirname "$0")"
git submodule update --init --recursive -- vendor/segment-anything
mkdir -p models
if [[ ! -f models/sam_vit_b_01ec64.pth ]]; then
  curl -fL --retry 2 --connect-timeout 15 --max-time 900 https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth -o models/sam_vit_b_01ec64.pth.part
  mv models/sam_vit_b_01ec64.pth.part models/sam_vit_b_01ec64.pth
fi
echo 'SAM ViT-B 已准备完成；复用现有 PyTorch 环境，无需升级 Ultralytics。请重启 start.command。'
