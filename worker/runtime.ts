import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { NaverBrowser } from "../src/lib/workflow/browser.ts";
import {
  extractInstagram,
  type Extraction,
} from "../src/lib/workflow/extraction.ts";
import { generateDraft, hasAiKey } from "../src/lib/workflow/writer.ts";
import {
  loginOwner,
  isOwnerSession,
  logoutOwner,
  tokenMatches,
} from "../src/lib/workflow/auth.ts";
import {
  initWorkflow,
  createJob,
  getJob,
  listJobs,
  listAssets,
  getAsset,
  transition,
  setDraft,
  saveExtractedCaption,
  saveReviewedDraft,
  recordDuplicates,
  getSetting,
  setSetting,
  blogs,
  historyCoverage,
  claimPublication,
  markPublished,
  recoverInterruptedJobs,
  claimNextJob,
  claimPhotoUpload,
  events,
} from "../src/lib/workflow/store.ts";
import {
  storePhoto,
  upscalePhoto,
  findPhotoDuplicates,
} from "../src/lib/workflow/photos.ts";
import {
  draftSchema,
  jobInputSchema,
  selectionSchema,
  remoteActionSchema,
} from "../src/lib/workflow/validation.ts";
import { exportBundle } from "../src/lib/workflow/export.ts";
import {
  syncHistory,
  verifyPublishedPost,
} from "../src/lib/workflow/history.ts";
import { openEditor, clickPublish } from "../src/lib/workflow/editor.ts";
import {
  getProfile,
  saveProfile,
  listPosts,
  listImages,
  dataDirectory,
} from "../src/lib/db.ts";
import { profileSchema } from "../src/lib/validation.ts";
import type { Asset, Draft, Job } from "../src/lib/workflow/types.ts";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Buffer> {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new Error("BODY_TOO_LARGE");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("BODY_TOO_LARGE");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts);
}
async function readJson(request: Request) {
  return JSON.parse((await boundedBody(request, 64 * 1024)).toString("utf8"));
}
async function readForm(request: Request) {
  const body = await boundedBody(request, 80 * 1024 * 1024);
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") || "" },
    body: new Uint8Array(body),
  }).formData();
}
const publicAsset = (asset: Asset) => ({
  id: asset.id,
  ordinal: asset.ordinal,
  name: asset.original_name,
  width: asset.width,
  height: asset.height,
  upscaled: Boolean(asset.upscaled_path),
  url: `/api/assets/${asset.id}/image`,
});
type Services = {
  extract?: (url: string) => Promise<Extraction>;
  write?: (job: Job, assets: Asset[]) => Promise<Draft>;
  aiReady?: () => boolean;
  browser?: NaverBrowser;
};

export class WorkerRuntime {
  browser: NaverBrowser;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private auxiliary = false;
  private services: Services;
  constructor(services: Services = {}) {
    this.services = services;
    this.browser = services.browser || new NaverBrowser();
    initWorkflow();
    recoverInterruptedJobs();
  }
  liveVerification() {
    return getSetting<{
      blogId: string;
      editor: boolean;
      category: boolean;
      sticker: boolean;
      publishing: boolean;
      evidencePostUrl: string | null;
    }>("live-naver-verification", {
      blogId: "",
      editor: false,
      category: false,
      sticker: false,
      publishing: false,
      evidencePostUrl: null,
    });
  }
  publishingEnabled() {
    const proof = this.liveVerification();
    return (
      process.env.NAVER_AUTOPUBLISH_VERIFIED === "true" &&
      proof.blogId === getSetting("selectedBlog", null) &&
      proof.editor &&
      proof.category &&
      proof.sticker &&
      proof.publishing &&
      Boolean(proof.evidencePostUrl)
    );
  }
  aiReady() {
    return this.services.aiReady ? this.services.aiReady() : hasAiKey();
  }
  start() {
    if (!this.timer)
      this.timer = setInterval(() => {
        void this.tick();
      }, 1000);
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.browser.shutdown();
  }
  async tick() {
    if (this.running || this.auxiliary) return;
    this.running = true;
    try {
      const job = claimNextJob();
      if (job) await this.process(job);
    } finally {
      this.running = false;
    }
  }
  async process(job: Job) {
    try {
      if (job.publication_attempted) {
        transition(
          job.id,
          "verification_required",
          "발행 결과를 먼저 확인하세요. 자동 재발행하지 않습니다.",
        );
        return;
      }
      let assets = listAssets(job.id);
      if (!assets.length) {
        if (!job.input.sourceUrl) {
          transition(job.id, "waiting_images", "원본 사진을 업로드해 주세요.");
          return;
        }
        transition(
          job.id,
          "extracting",
          "SaveFrom에서 사진 추출을 시도하고 있습니다.",
        );
        try {
          const extracted = await (this.services.extract || extractInstagram)(
            job.input.sourceUrl,
          );
          if (extracted.caption)
            saveExtractedCaption(job.id, extracted.caption);
          for (const photo of extracted.photos) await storePhoto(job.id, photo);
          if (!extracted.completenessVerified) {
            transition(
              job.id,
              "waiting_images",
              `${extracted.photos.length}장의 사진을 찾았습니다. 원본 게시물의 모든 사진인지 확인하고 계속하거나 직접 업로드해 주세요.`,
            );
            return;
          }
          setSetting(`photos-confirmed:${job.id}`, true);
          assets = listAssets(job.id);
        } catch {
          transition(
            job.id,
            "waiting_images",
            "자동 추출을 완료하지 못했습니다. 보안 절차를 우회하지 않습니다. 원본 사진을 모두 직접 업로드해 주세요.",
          );
          return;
        }
      }
      if (!getSetting(`photos-confirmed:${job.id}`, false)) {
        transition(
          job.id,
          "waiting_images",
          "모든 원본 사진이 포함됐는지 확인해 주세요.",
        );
        return;
      }
      let matches = findPhotoDuplicates(job.id);
      if (matches.length) {
        recordDuplicates(job.id, matches);
        transition(
          job.id,
          "duplicate",
          "사용한 사진 또는 유사한 사진이 감지되어 자동 진행을 중단했습니다.",
        );
        return;
      }
      transition(
        job.id,
        "processing",
        "사진을 순서대로 2배 확대하고 있습니다. 생성형 보정은 사용하지 않습니다.",
      );
      for (const asset of assets) await upscalePhoto(asset);
      assets = listAssets(job.id);
      matches = findPhotoDuplicates(job.id);
      if (matches.length) {
        recordDuplicates(job.id, matches);
        transition(
          job.id,
          "duplicate",
          "확대 결과에서 중복 사진이 감지되어 중단했습니다.",
        );
        return;
      }
      if (!this.aiReady()) {
        transition(
          job.id,
          "awaiting_ai",
          "AI 연결이 필요합니다. 확대 사진은 준비됐으며 직접 초안을 작성하거나 연결 후 재시도할 수 있습니다.",
        );
        return;
      }
      transition(
        job.id,
        "writing",
        "사진과 확인된 정보를 바탕으로 글 초안을 작성하고 있습니다.",
      );
      const draft = await (this.services.write || generateDraft)(
        getJob(job.id)!,
        assets,
      );
      const parsed = draftSchema.parse(draft);
      this.validatePhotoOrder(parsed, assets);
      setDraft(job.id, parsed);
      transition(
        job.id,
        "ready",
        "초안과 확대 사진이 준비됐습니다. 내용을 확인해 주세요.",
      );
      if (job.input.mode === "publish") await this.publish(job.id, true);
    } catch (error) {
      const current = getJob(job.id);
      if (current?.publication_attempted)
        transition(
          job.id,
          "verification_required",
          "발행 결과를 확인하지 못했습니다. 같은 글을 다시 발행하지 않습니다. 기존 네이버 글을 확인하세요.",
        );
      else
        transition(
          job.id,
          "failed",
          error instanceof z.ZodError
            ? "초안 형식 검증에 실패했습니다."
            : error instanceof Error &&
                /AI_CONNECTION_REQUIRED/.test(error.message)
              ? "AI 연결이 필요합니다."
              : "작업을 완료하지 못했습니다. 저장된 사진을 유지한 채 재시도할 수 있습니다.",
        );
    }
  }
  validatePhotoOrder(draft: Draft, assets: Asset[]) {
    const order = draft.blocks.flatMap((block) =>
      block.imageIndex === null ? [] : [block.imageIndex],
    );
    if (
      order.length !== assets.length ||
      order.some((value, index) => value !== index)
    )
      throw new Error("사진을 빠짐없이 원래 순서대로 배치하세요.");
  }
  async publish(id: string, enabled: boolean) {
    const job = getJob(id);
    if (!job || !job.draft) throw new Error("초안을 먼저 준비하세요.");
    if (!enabled || !this.publishingEnabled())
      throw new Error(
        "자동 발행은 아직 실제 네이버에서 검증되지 않아 사용할 수 없습니다. 공식 편집기에서 직접 완료해 주세요.",
      );
    if (
      job.publication_attempted ||
      !["ready", "manual_completion"].includes(job.status)
    )
      throw new Error(
        "기존 발행 결과를 먼저 확인하세요. 같은 작업은 다시 발행하지 않습니다.",
      );
    const coverage = historyCoverage();
    if (
      !coverage.complete ||
      getSetting("history-blog", "") !== job.blog_id ||
      !coverage.syncedAt ||
      Date.now() - Date.parse(coverage.syncedAt) > 10 * 60 * 1000
    )
      throw new Error("선택한 블로그의 최신 전체 발행 기록 비교가 필요합니다.");
    if (
      !this.browser.status().connected ||
      this.browser.status().selectedBlog !== job.blog_id
    )
      throw new Error("본인 네이버 블로그에 다시 연결해 주세요.");
    const matches = findPhotoDuplicates(id);
    if (matches.length) {
      recordDuplicates(id, matches);
      transition(id, "duplicate", "중복이 감지되어 발행하지 않았습니다.");
      return;
    }
    this.browser.freeze(true);
    try {
      transition(
        id,
        "preparing_editor",
        "공식 네이버 편집기를 준비하고 있습니다.",
      );
      await openEditor(this.browser, job, listAssets(id));
      // Sticker insertion has not been validated on live Naver. Keep release gate closed.
      transition(
        id,
        "manual_completion",
        "스티커와 카테고리를 공식 편집기에서 직접 확인해 주세요.",
      );
      if (!claimPublication(id)) throw new Error("발행 상태가 변경되었습니다.");
      const url = await clickPublish(this.browser, job);
      if (!url) throw new Error("발행 URL을 확인하지 못했습니다.");
      const confirmed = await verifyPublishedPost(
        this.browser,
        url,
        job,
        listAssets(id),
      );
      markPublished(id, confirmed);
    } catch (error) {
      if (getJob(id)?.publication_attempted)
        transition(
          id,
          "verification_required",
          "발행 성공 여부를 확인할 수 없습니다. 자동 재발행하지 않고 기존 글 확인을 기다립니다.",
        );
      else
        transition(
          id,
          "manual_completion",
          "자동 작성이 제한되었습니다. 공식 화면에서 보안 절차·사진·카테고리·스티커를 직접 확인해 완료해 주세요.",
        );
      throw error;
    } finally {
      this.browser.freeze(false);
    }
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/health" && method === "GET") return json({ ok: true });
    const bearer =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || null;
    if (!tokenMatches(bearer, process.env.WORKER_AUTH_TOKEN))
      return json({ error: "접근 권한이 없습니다." }, 401);
    const ownerSession = request.headers.get("x-owner-session");
    try {
      if (path === "/auth/status" && method === "GET")
        return json({
          configured: Boolean(
            process.env.APP_OWNER_PASSWORD &&
              process.env.APP_OWNER_PASSWORD.length >= 12,
          ),
          authenticated: isOwnerSession(ownerSession),
        });
      if (path === "/auth/login" && method === "POST") {
        const input = z
          .object({ password: z.string().min(1).max(256) })
          .parse(await readJson(request));
        const session = loginOwner(input.password);
        if (!session)
          return json({ error: "접속 비밀번호를 확인해 주세요." }, 401);
        return json({ session });
      }
      if (!isOwnerSession(ownerSession))
        return json({ error: "관리자 로그인이 필요합니다." }, 401);
      if (path === "/auth/logout" && method === "POST") {
        logoutOwner(ownerSession!);
        return json({ ok: true });
      }
      if (path === "/auth/check" && method === "GET") return json({ ok: true });
      if (path === "/status" && method === "GET")
        return json({
          aiConnected: this.aiReady(),
          automaticPublishingEnabled: this.publishingEnabled(),
          liveNaverAdapterVerified: this.liveVerification().publishing,
          saveFromVerified: false,
          stickerVerified: this.liveVerification().sticker,
          connection: this.browser.status(),
        });
      if (path === "/profile" && method === "GET")
        return json({
          profile: getProfile(),
          connection: this.browser.status().connected
            ? "connected"
            : "not_connected",
        });
      if (path === "/profile" && method === "POST") {
        saveProfile(profileSchema.parse(await readJson(request)));
        return json({
          profile: getProfile(),
          connection: this.browser.status().connected
            ? "connected"
            : "not_connected",
        });
      }
      if (path === "/posts" && method === "GET")
        return json({ posts: listPosts() });
      if (path === "/images" && method === "GET")
        return json({ images: listImages() });
      if (path === "/naver/login" && method === "POST") {
        await this.browser.login();
        return json({ connection: this.browser.status() });
      }
      if (path === "/naver/confirm" && method === "POST")
        return json({ connection: await this.browser.confirmLogin() });
      if (path === "/naver/logout" && method === "POST") {
        if (this.running || this.auxiliary)
          throw new Error("작업이 끝난 뒤 연결을 해제해 주세요.");
        await this.browser.close();
        return json({ connection: this.browser.status() });
      }
      if (path === "/naver/screen" && method === "GET")
        return new Response(new Uint8Array(await this.browser.screenshot()), {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
          },
        });
      if (path === "/naver/action" && method === "POST") {
        await this.browser.action(
          remoteActionSchema.parse(await readJson(request)),
        );
        return json({ ok: true });
      }
      if (path === "/naver/select" && method === "POST") {
        if (this.running || this.auxiliary)
          throw new Error("진행 중인 작업이 끝난 뒤 선택을 변경하세요.");
        const input = selectionSchema.parse(await readJson(request));
        const blog = blogs().find((item) => item.id === input.blogId);
        if (
          !blog ||
          !blog.categories.some((category) => category.id === input.categoryId)
        )
          throw new Error("연결한 본인 블로그와 카테고리를 선택하세요.");
        if (getSetting("selectedBlog", "") !== input.blogId)
          setSetting("history", {
            complete: false,
            scanned: 0,
            total: null,
            message: "선택한 블로그의 발행 기록을 비교해야 합니다.",
            syncedAt: null,
          });
        setSetting("selectedBlog", input.blogId);
        setSetting("selectedCategory", input.categoryId);
        return json({ connection: this.browser.status() });
      }
      if (path === "/naver/history" && method === "POST") {
        if (this.running || this.auxiliary)
          throw new Error("다른 작업이 끝난 뒤 비교해 주세요.");
        const blogId = getSetting<string>("selectedBlog", "");
        if (!blogId) throw new Error("블로그에 먼저 연결해 주세요.");
        this.auxiliary = true;
        void syncHistory(this.browser, blogId)
          .then(() => setSetting("history-blog", blogId))
          .catch(() => {})
          .finally(() => {
            this.auxiliary = false;
          });
        return json({ ok: true }, 202);
      }
      if (path === "/jobs" && method === "GET")
        return json({ jobs: listJobs() });
      if (path === "/jobs" && method === "POST") {
        const form = await readForm(request);
        const input = jobInputSchema.parse(
          JSON.parse(String(form.get("input") || "{}")),
        );
        const requestId = z.string().uuid().parse(form.get("requestId"));
        if (input.mode === "publish" && !this.publishingEnabled())
          throw new Error(
            "자동 발행은 실제 검증이 끝나지 않아 제한됩니다. 초안 모드를 선택해 주세요.",
          );
        const files = form
          .getAll("images")
          .filter(
            (item): item is File => item instanceof File && item.size > 0,
          );
        if (!input.sourceUrl && !files.length)
          throw new Error("인스타그램 URL 또는 원본 사진이 필요합니다.");
        if (files.length > 20)
          throw new Error("최대 20장의 사진을 지원합니다.");
        const selectedBlog = getSetting("selectedBlog", "");
        const selectedCategory = getSetting("selectedCategory", "");
        const blog = blogs().find((item) => item.id === selectedBlog);
        const category = blog?.categories.find(
          (item) => item.id === selectedCategory,
        );
        const profile = getProfile();
        const created = createJob(
          input,
          requestId,
          blog?.id || profile?.blogId || "",
          category?.id || "",
          category?.name || profile?.selectedCategory || "미지정",
        );
        if (created.duplicate)
          return json(
            {
              error: "이미 등록되었거나 기존 발행 기록에 있는 게시물입니다.",
              job: created.job,
            },
            409,
          );
        if (created.replay) return json({ job: created.job });
        if (files.length) {
          if (!claimPhotoUpload(created.job.id))
            throw new Error("사진을 저장하는 작업이 이미 진행 중입니다.");
          setSetting(`expected-photo-count:${created.job.id}`, files.length);
          try {
            for (const file of files)
              await storePhoto(created.job.id, {
                name: file.name,
                bytes: Buffer.from(await file.arrayBuffer()),
              });
          } catch (error) {
            transition(
              created.job.id,
              "waiting_images",
              "일부 사진을 저장하지 못했습니다. 누락된 원본 사진을 추가로 업로드해 주세요.",
            );
            throw error;
          }
        }
        if (files.length)
          setSetting(`photos-confirmed:${created.job.id}`, true);
        transition(created.job.id, "queued", "작업을 대기열에 등록했습니다.");
        return json({ job: getJob(created.job.id) }, 201);
      }
      const detail = path.match(
        /^\/jobs\/([0-9a-f-]{36})(?:\/(assets|upload|confirm-photos|draft|retry|export|editor|publish|confirm-published))?$/,
      );
      if (detail) {
        const id = detail[1];
        const action = detail[2] || "detail";
        const job = getJob(id);
        if (!job) return json({ error: "작업을 찾을 수 없습니다." }, 404);
        if (method === "GET" && action === "detail")
          return json({
            job,
            assets: listAssets(id).map(publicAsset),
            events: events(id),
            history: historyCoverage(),
          });
        if (method === "GET" && action === "assets")
          return json({ assets: listAssets(id).map(publicAsset) });
        if (method === "GET" && action === "export")
          return exportBundle(job, listAssets(id));
        if (
          method === "POST" &&
          ["upload", "confirm-photos", "draft", "retry"].includes(action) &&
          (!["waiting_images", "failed", "awaiting_ai", "ready"].includes(
            job.status,
          ) ||
            job.publication_attempted)
        )
          throw new Error(
            "현재 상태에서는 사진이나 초안을 변경할 수 없습니다.",
          );
        if (method === "POST" && action === "upload") {
          const form = await readForm(request);
          if (form.get("rightsConfirmed") !== "true")
            throw new Error("사진 사용 권한을 확인해 주세요.");
          const files = form
            .getAll("images")
            .filter(
              (item): item is File => item instanceof File && item.size > 0,
            );
          if (!files.length) throw new Error("원본 사진을 선택하세요.");
          const count = listAssets(id).length + files.length;
          if (count > 20)
            throw new Error("한 작업에 최대 20장의 사진을 지원합니다.");
          if (!claimPhotoUpload(id))
            throw new Error("사진 저장이나 처리가 이미 진행 중입니다.");
          setSetting(`expected-photo-count:${id}`, count);
          try {
            for (const file of files)
              await storePhoto(id, {
                name: file.name,
                bytes: Buffer.from(await file.arrayBuffer()),
              });
          } catch (error) {
            transition(
              id,
              "waiting_images",
              "일부 사진을 저장하지 못했습니다. 누락된 사진을 추가로 업로드해 주세요.",
            );
            throw error;
          }
          setSetting(`photos-confirmed:${id}`, true);
          transition(id, "queued", "업로드한 사진으로 작업을 이어갑니다.");
          return json({ job: getJob(id) });
        }
        if (method === "POST" && action === "confirm-photos") {
          const input = z
            .object({ allPhotosConfirmed: z.literal(true) })
            .parse(await readJson(request));
          if (!input.allPhotosConfirmed || !listAssets(id).length)
            throw new Error("전체 사진을 확인하세요.");
          const expected = getSetting<number>(`expected-photo-count:${id}`, 0);
          if (expected && listAssets(id).length !== expected)
            throw new Error(
              "처음 업로드한 사진 중 누락된 사진이 있습니다. 원본 사진을 추가로 업로드해 주세요.",
            );
          setSetting(`photos-confirmed:${id}`, true);
          transition(id, "queued", "전체 사진 확인이 완료되었습니다.");
          return json({ job: getJob(id) });
        }
        if (method === "POST" && action === "draft") {
          const draft = draftSchema.parse(await readJson(request));
          const assets = listAssets(id);
          if (!assets.length || assets.some((asset) => !asset.upscaled_path))
            throw new Error("사진 확대가 끝난 뒤 초안을 저장하세요.");
          this.validatePhotoOrder(draft, assets);
          if (!saveReviewedDraft(id, { ...draft, origin: "manual" }))
            throw new Error(
              "작업 상태가 변경되어 초안을 저장하지 않았습니다. 현재 상태를 확인하세요.",
            );
          transition(id, "ready", "수정한 초안을 저장했습니다.");
          return json({ job: getJob(id) });
        }
        if (method === "POST" && action === "retry") {
          if (
            job.publication_attempted ||
            !["failed", "awaiting_ai", "waiting_images"].includes(job.status)
          )
            throw new Error(
              "발행 결과 확인이 필요하거나 재시도할 수 없는 상태입니다.",
            );
          transition(id, "queued", "같은 작업의 저장된 사진으로 재시도합니다.");
          return json({ job: getJob(id) });
        }
        if (method === "POST" && action === "editor") {
          if (this.running || this.auxiliary)
            throw new Error("다른 작업이 끝난 뒤 편집기를 여세요.");
          if (
            !["ready", "manual_completion"].includes(job.status) ||
            job.publication_attempted
          )
            throw new Error(
              "초안을 준비하거나 기존 발행 결과를 먼저 확인하세요.",
            );
          if (
            !this.browser.status().connected ||
            this.browser.status().selectedBlog !== job.blog_id
          )
            throw new Error(
              "작업을 생성할 때 선택한 본인 블로그에 먼저 연결해 주세요.",
            );
          this.auxiliary = true;
          try {
            await openEditor(this.browser, job, listAssets(id));
            transition(
              id,
              "manual_completion",
              "공식 편집기에서 사진·가운데 정렬·카테고리·스티커를 확인하고 임시저장 또는 발행하세요.",
            );
          } catch {
            transition(
              id,
              "manual_completion",
              "공식 편집기 자동 입력을 완료하지 못했습니다. 자료를 다운로드해 직접 입력하고 완료하세요.",
            );
          } finally {
            this.auxiliary = false;
          }
          return json({ job: getJob(id), connection: this.browser.status() });
        }
        if (method === "POST" && action === "publish") {
          const input = z
            .object({ automaticPublishingEnabled: z.literal(true) })
            .parse(await readJson(request));
          if (this.running || this.auxiliary)
            throw new Error("다른 작업이 끝난 뒤 발행하세요.");
          this.auxiliary = true;
          try {
            await this.publish(id, input.automaticPublishingEnabled);
          } finally {
            this.auxiliary = false;
          }
          return json({ job: getJob(id) });
        }
        if (method === "POST" && action === "confirm-published") {
          if (
            !["ready", "manual_completion", "verification_required"].includes(
              job.status,
            )
          )
            throw new Error("발행 확인을 진행할 수 없는 상태입니다.");
          const input = z
            .object({ url: z.string().max(2048) })
            .parse(await readJson(request));
          const confirmed = await verifyPublishedPost(
            this.browser,
            input.url,
            job,
            listAssets(id),
          );
          markPublished(id, confirmed);
          return json({ job: getJob(id) });
        }
      }
      const image = path.match(/^\/assets\/([0-9a-f-]{36})\/image$/);
      if (image && method === "GET") {
        const asset = getAsset(image[1]);
        if (!asset) return json({ error: "사진을 찾을 수 없습니다." }, 404);
        const variant = url.searchParams.get("variant");
        const bytes = await readFile(
          variant === "original"
            ? asset.original_path
            : variant === "upscaled"
              ? asset.upscaled_path || asset.original_path
              : join(dataDirectory(), "assets", `${asset.id}-preview.jpg`),
        );
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type":
              variant === "original" || variant === "upscaled"
                ? "image/png"
                : "image/jpeg",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      return json({ error: "지원하지 않는 요청입니다." }, 404);
    } catch (error) {
      if (error instanceof z.ZodError)
        return json(
          { error: error.issues[0]?.message || "입력을 확인하세요." },
          400,
        );
      if (error instanceof SyntaxError)
        return json({ error: "입력 형식을 확인하세요." }, 400);
      const message = error instanceof Error ? error.message : "";
      if (message === "BODY_TOO_LARGE")
        return json(
          {
            error:
              "업로드 용량이 너무 큽니다. 사진은 각 10MB, 한 번에 총 80MB 이하로 선택해 주세요.",
          },
          413,
        );
      if (message === "OWNER_SETUP_REQUIRED")
        return json(
          { error: "사이트 관리자 연결을 먼저 완료해야 합니다." },
          503,
        );
      if (message === "LOGIN_RATE_LIMITED")
        return json({ error: "잠시 후 다시 로그인하세요." }, 429);
      // Return only our Korean validation messages, never raw URLs, stack traces, or service errors.
      if (/[가-힣]/.test(message) && !/https?:\/\//.test(message))
        return json({ error: message }, 409);
      console.error(
        "Worker operation failed",
        error instanceof Error ? error.name : "Unknown",
      );
      return json(
        {
          error:
            "작업을 완료하지 못했습니다. 다시 시도하거나 수동 완료 방법을 이용해 주세요.",
        },
        502,
      );
    }
  }
}
