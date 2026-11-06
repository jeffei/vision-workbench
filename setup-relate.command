#!/bin/zsh
set -e
cd "$(dirname "$0")"
git submodule update --init --recursive -- vendor/relate-anything
uv pip install --python .venv/bin/python onnxruntime==1.19.2
.venv/bin/python -c "from relation import ensure_bundle; print(ensure_bundle('relsgg-vits16plus'))"
echo 'RelateAnything 默认模型已就绪；其他可用模型在页面首次分析时自动下载。'
