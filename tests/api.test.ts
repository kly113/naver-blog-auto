import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { WorkerRuntime } from "../worker/runtime";
import {
  getJob,
  listAssets,
  transition,
  claimPublication,
  recoverInterruptedJobs,
  listJobs,
} from "../src/lib/workflow/store";
import { sameOrigin } from "../src/lib/server/gateway";
let directory: string;
let runtime: WorkerRuntime;
let session: string;
const names = [
  "DATA_DIR",
  "WORKER_AUTH_TOKEN",
  "APP_OWNER_PASSWORD",
  "NAVER_AUTOPUBLISH_VERIFIED",
  "APP_PUBLIC_URL",
];
const original = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const workerToken = "isolated-unit-worker-token-123456789";
const ownerPassword = "isolated-owner-password";
const headers = () => ({
  authorization: `Bearer ${workerToken}`,
  "x-owner-session": session,
});
async function call(path: string, body?: unknown) {
  return runtime.handle(
    new Request(`http://worker${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function submit(
  url: string,
  bytes?: Buffer,
  requestId = randomUUID(),
  rightsConfirmed = true,
) {
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("input", JSON.stringify({ sourceUrl: url, rightsConfirmed }));
  if (bytes)
    form.append(
      "images",
      new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" }),
    );
  return runtime.handle(
    new Request("http://worker/jobs", {
      method: "POST",
      headers: headers(),
      body: form,
    }),
  );
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "blog-worker-test-"));
  process.env.DATA_DIR = directory;
  process.env.WORKER_AUTH_TOKEN = workerToken;
  process.env.APP_OWNER_PASSWORD = ownerPassword;
  delete process.env.NAVER_AUTOPUBLISH_VERIFIED;
  delete process.env.APP_PUBLIC_URL;
  runtime = new WorkerRuntime({
    aiReady: () => false,
    extract: async () => {
      throw new Error("blocked");
    },
  });
  const response = await runtime.handle(
    new Request("http://worker/auth/login", {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: ownerPassword }),
    }),
  );
  session = (await response.json()).session;
});
afterEach(async () => {
  await runtime.close();
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  rmSync(directory, { recursive: true, force: true });
});

it("requires both the internal service token and a revocable owner session", async () => {
  expect((await runtime.handle(new Request("http://worker/jobs"))).status).toBe(
    401,
  );
  expect(
    (
      await runtime.handle(
        new Request("http://worker/jobs", {
          headers: { authorization: `Bearer ${workerToken}` },
        }),
      )
    ).status,
  ).toBe(401);
  expect((await call("/jobs")).status).toBe(200);
  expect((await call("/auth/logout", {})).status).toBe(200);
  expect((await call("/jobs")).status).toBe(401);
});
it("requires explicit photo rights and rejects URL duplicates while replaying the same request safely", async () => {
  expect(
    (
      await submit(
        "https://instagram.com/p/owned/",
        undefined,
        randomUUID(),
        false,
      )
    ).status,
  ).toBe(400);
  const requestId = randomUUID();
  const first = await submit(
    "https://instagram.com/p/owned/?utm_source=copy",
    undefined,
    requestId,
  );
  expect(first.status).toBe(201);
  const firstJob = (await first.json()).job;
  const replay = await submit(
    "https://www.instagram.com/p/owned/",
    undefined,
    requestId,
  );
  expect((await replay.json()).job.id).toBe(firstJob.id);
  expect((await submit("https://www.instagram.com/p/owned/")).status).toBe(409);
});
it("offers upload fallback after extraction fails without pretending that photographs were fetched", async () => {
  const response = await submit("https://instagram.com/p/manual_fallback/");
  const job = (await response.json()).job;
  await runtime.tick();
  expect(getJob(job.id)?.status).toBe("waiting_images");
  expect(listAssets(job.id)).toHaveLength(0);
});
it("runs the real Python 2x pipeline, keeps manual drafting available without an AI key, and exports a ZIP", async () => {
  const bytes = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: 100, g: 70, b: 40 },
    },
  })
    .png()
    .toBuffer();
  const response = await submit(
    "https://instagram.com/p/real_pipeline/",
    bytes,
  );
  const job = (await response.json()).job;
  await runtime.tick();
  expect(getJob(job.id)?.status).toBe("awaiting_ai");
  const assets = listAssets(job.id);
  expect(assets[0].upscaled_path).toBeTruthy();
  const metadata = await sharp(assets[0].upscaled_path!).metadata();
  expect([metadata.width, metadata.height]).toEqual([16, 12]);
  const draft = {
    title: "확인한 스타일",
    blocks: [{ text: "확인한 사실만 기록합니다.", imageIndex: 0 }],
    hashtags: ["스타일"],
    origin: "manual",
  };
  expect((await call(`/jobs/${job.id}/draft`, draft)).status).toBe(200);
  expect(getJob(job.id)?.status).toBe("ready");
  const bundle = await call(`/jobs/${job.id}/export`);
  expect(bundle.headers.get("content-type")).toBe("application/zip");
  const archive = Buffer.from(await bundle.arrayBuffer());
  expect(archive.subarray(0, 2).toString()).toBe("PK");
  expect(archive.includes(Buffer.from("photos/01.png"))).toBe(true);
});
it("blocks unvalidated publication and prevents a retry of an ambiguous publication attempt", async () => {
  const response = await submit("https://instagram.com/p/no_repeat/");
  const job = (await response.json()).job;
  transition(job.id, "ready", "fixture");
  expect(
    (
      await call(`/jobs/${job.id}/publish`, {
        automaticPublishingEnabled: true,
      })
    ).status,
  ).toBe(409);
  process.env.NAVER_AUTOPUBLISH_VERIFIED = "true";
  expect(runtime.publishingEnabled()).toBe(false);
  expect(claimPublication(job.id)).toBe(true);
  expect(claimPublication(job.id)).toBe(false);
  recoverInterruptedJobs();
  expect(getJob(job.id)?.status).toBe("verification_required");
  expect((await call(`/jobs/${job.id}/retry`, {})).status).toBe(409);
});
it("does not trust a cross-origin mutation even with an internal bind address", () => {
  const request = new Request("http://0.0.0.0:3000/api/jobs", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  });
  expect(sameOrigin(request)).toBe(true);
  expect(
    sameOrigin(
      new Request(request.url, {
        headers: { host: "127.0.0.1:3000", origin: "https://evil.test" },
      }),
    ),
  ).toBe(false);
});
it("serializes concurrent uploads to the same job without duplicated or partially queued photos", async () => {
  const response = await submit("https://instagram.com/p/concurrent_upload/");
  const job = (await response.json()).job;
  await runtime.tick();
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "brown" },
  })
    .png()
    .toBuffer();
  const upload = () => {
    const form = new FormData();
    form.set("rightsConfirmed", "true");
    form.append(
      "images",
      new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" }),
    );
    return runtime.handle(
      new Request(`http://worker/jobs/${job.id}/upload`, {
        method: "POST",
        headers: headers(),
        body: form,
      }),
    );
  };
  const results = await Promise.all([upload(), upload()]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(listAssets(job.id)).toHaveLength(1);
  expect(getJob(job.id)?.status).toBe("queued");
});
it("keeps a partially failed multi-photo upload blocked until the missing originals are supplied", async () => {
  const bytes = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "brown" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("requestId", randomUUID());
  form.set(
    "input",
    JSON.stringify({
      sourceUrl: "https://instagram.com/p/incomplete_upload/",
      rightsConfirmed: true,
    }),
  );
  form.append(
    "images",
    new File([new Uint8Array(bytes)], "good.png", { type: "image/png" }),
  );
  form.append(
    "images",
    new File(["corrupt"], "bad.png", { type: "image/png" }),
  );
  const response = await runtime.handle(
    new Request("http://worker/jobs", {
      method: "POST",
      headers: headers(),
      body: form,
    }),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  const job = listJobs()[0];
  expect(job.status).toBe("waiting_images");
  expect(listAssets(job.id)).toHaveLength(1);
  expect(
    (await call(`/jobs/${job.id}/confirm-photos`, { allPhotosConfirmed: true }))
      .status,
  ).toBe(409);
  await runtime.tick();
  expect(getJob(job.id)?.status).toBe("waiting_images");
});
