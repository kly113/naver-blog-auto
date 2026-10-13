"""Exercise real production web/worker images with an isolated Docker volume."""
import io
import json
import os
import secrets
import subprocess
import time
import urllib.request
import urllib.error
import uuid
import zipfile
from PIL import Image

suffix = uuid.uuid4().hex[:10]
network = f"blog-smoke-{suffix}"
worker = f"blog-worker-{suffix}"
web = f"blog-web-{suffix}"
volume = f"blog-data-{suffix}"
port = 3456
base = f"http://127.0.0.1:{port}"
environment = {**os.environ, "DOCKER_CONFIG": "/workspace/.cache/docker",
               "WORKER_AUTH_TOKEN": secrets.token_urlsafe(32),
               "SESSION_ENCRYPTION_KEY": secrets.token_urlsafe(32),
               "APP_OWNER_PASSWORD": secrets.token_urlsafe(24)}
cookie = ""


def docker(*args):
    return subprocess.check_output(["docker", *args], env=environment, text=True).strip()


def request(path, payload=None, raw=None, content_type="application/json", authenticated=True):
    headers = {"Origin": base, "Content-Type": content_type}
    if authenticated and cookie:
        headers["Cookie"] = cookie
    body = json.dumps(payload).encode() if payload is not None else raw
    req = urllib.request.Request(base + path, data=body, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, dict(response.headers), response.read()


def ready():
    for _ in range(40):
        try:
            if request("/api/health", authenticated=False)[0] == 200:
                return
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.5)
    raise AssertionError("production health check failed")


try:
    docker("network", "create", network)
    docker("volume", "create", volume)
    docker("run", "-d", "--name", worker, "--network", network,
           "-e", "WORKER_AUTH_TOKEN", "-e", "SESSION_ENCRYPTION_KEY", "-e", "APP_OWNER_PASSWORD",
           "-v", f"{volume}:/var/lib/blog-worker", "naver-blog-worker:local")
    docker("run", "-d", "--name", web, "--network", network,
           "-p", f"127.0.0.1:{port}:3000", "-e", "WORKER_AUTH_TOKEN",
           "-e", f"WORKER_URL=http://{worker}:4000", "-e", f"APP_PUBLIC_URL={base}",
           "naver-blog-web:local")
    ready()
    assert request("/api/jobs", authenticated=False)[0] == 401
    status, headers, _ = request("/api/auth/login", {"password": environment["APP_OWNER_PASSWORD"]}, authenticated=False)
    assert status == 200
    set_cookie = headers.get("Set-Cookie") or headers.get("set-cookie")
    assert "HttpOnly" in set_cookie and "Secure" in set_cookie and "SameSite=strict" in set_cookie
    cookie = set_cookie.split(";", 1)[0]
    image = io.BytesIO()
    Image.new("RGB", (8, 6), (100, 70, 40)).save(image, format="PNG")
    boundary = "blog-smoke-" + suffix
    source = "https://www.instagram.com/p/SMOKE_" + suffix + "/"

    def field(name, value):
        return f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()

    body = field("requestId", str(uuid.uuid4())) + field("input", json.dumps({"sourceUrl": source, "rightsConfirmed": True, "mode": "draft"}))
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="images"; filename="owned.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + image.getvalue() + f"\r\n--{boundary}--\r\n".encode()
    status, _, raw = request("/api/jobs", raw=body, content_type=f"multipart/form-data; boundary={boundary}")
    assert status == 201, (status, raw)
    job_id = json.loads(raw)["job"]["id"]
    for _ in range(40):
        status, _, raw = request(f"/api/jobs/{job_id}")
        detail = json.loads(raw)
        if detail["job"]["status"] == "awaiting_ai":
            break
        time.sleep(0.5)
    assert detail["job"]["status"] == "awaiting_ai", detail["job"]["status"]
    assert detail["assets"][0]["upscaled"] is True
    status, _, raw = request(detail["assets"][0]["url"]+"?variant=upscaled")
    assert status == 200
    with Image.open(io.BytesIO(raw)) as enlarged:
        assert enlarged.size == (16, 12)
        assert enlarged.getpixel((8, 6))[:3] == (100, 70, 40)
    draft = {"title": "실제 컨테이너 검증", "blocks": [{"text": "확인한 사진 기록", "imageIndex": 0}], "hashtags": ["사진기록"], "origin": "manual"}
    assert request(f"/api/jobs/{job_id}/draft", draft)[0] == 200
    status, _, raw = request(f"/api/jobs/{job_id}/export")
    assert status == 200
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert "photos/01.png" in archive.namelist()
        assert "미리보기.html" in archive.namelist()
        assert b"text-align:center" in archive.read("미리보기.html")
    assert request(f"/api/jobs/{job_id}/publish", {"automaticPublishingEnabled": True})[0] == 409
    docker("restart", worker)
    ready()
    status, _, raw = request(f"/api/jobs/{job_id}")
    assert status == 200 and json.loads(raw)["job"]["status"] == "ready"
    assert request(detail["assets"][0]["url"])[0] == 200
    assert request("/api/auth/logout", {})[0] == 200
    assert request("/api/jobs")[0] == 401
    print("Production Docker smoke passed: authentication, real Python 2x + color preservation, manual draft, ZIP, publication gate, restart persistence and session revocation.")
except Exception:
    for name in (worker, web):
        result = subprocess.run(["docker", "logs", "--tail", "30", name], env=environment, text=True, capture_output=True)
        print(f"Container diagnostics ({name}):\n{result.stdout}{result.stderr}")
    raise
finally:
    for name in (web, worker):
        subprocess.run(["docker", "rm", "-f", name], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for kind, name in (("volume", volume), ("network", network)):
        subprocess.run(["docker", kind, "rm", name], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
