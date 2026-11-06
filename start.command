#!/bin/zsh
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo '请先按照 README.md 安装环境。'
  exit 1
fi
open http://127.0.0.1:8765
exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8765
