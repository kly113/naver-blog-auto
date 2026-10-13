#!/usr/bin/env bash
set -euo pipefail
cd /workspace/naver-blog-auto
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ required")'
python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
npm ci --cache /workspace/.cache/npm --no-audit --no-fund
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --cache-dir /workspace/.cache/pip -r python/requirements.txt
npm run db:init
# The cloud image provides Chromium. Prefer it without extra browser downloads.
if [ -x /usr/bin/chromium ]; then
  /usr/bin/chromium --version
else
  npx playwright install chromium
fi
