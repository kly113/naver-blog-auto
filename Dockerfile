# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS worker
WORKDIR /app
# .dockerignore excludes credentials, local photos, browser sessions and generated outputs.
COPY . .
# Keep a single dependency layer: small build hosts using the vfs driver otherwise duplicate
# Chromium/Python for every following COPY. Optional CA trust is temporary and verified.
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca PIP_CERT=/run/secrets/build_ca; fi; \
    set -eu; \
    apt-get update && \
    apt-get install -y --no-install-recommends chromium python3 python3-venv fonts-noto-cjk gosu ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm && \
    python3 -m venv /opt/blog-python && \
    /opt/blog-python/bin/python -m pip install --no-cache-dir -r python/requirements.txt && \
    cp deploy/worker-entrypoint.sh /usr/local/bin/worker-entrypoint && \
    chmod 755 /usr/local/bin/worker-entrypoint && \
    mkdir -p /var/lib/blog-worker && \
    chown -R node:node /app /var/lib/blog-worker
ENV NODE_ENV=production DATA_DIR=/var/lib/blog-worker PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium PYTHON_EXECUTABLE=/opt/blog-python/bin/python WORKER_HOST=0.0.0.0 PORT=4000
EXPOSE 4000
ENTRYPOINT ["worker-entrypoint"]
CMD ["node", "--experimental-strip-types", "worker/server.ts"]
