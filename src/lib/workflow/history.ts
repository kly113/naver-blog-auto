import type { BrowserContext } from "playwright";
import sharp from "sharp";
import { NaverBrowser } from "./browser.ts";
import { downloadMedia, isApprovedMediaUrl } from "./network.ts";
import { perceptualHash, hashDistance } from "./photos.ts";
import type { Asset } from "./types.ts";
import { withDatabase } from "../db.ts";
import { setSetting } from "./store.ts";
import { normalizeInstagramUrl } from "../validation.ts";

export function parseNaverPostUrl(
  value: string,
  expectedBlog?: string,
): { blogId: string; logNo: string; url: string } | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["blog.naver.com", "m.blog.naver.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{2,50})\/(\d+)\/?$/);
    const blogId = match?.[1] || url.searchParams.get("blogId");
    const logNo = match?.[2] || url.searchParams.get("logNo");
    if (
      !blogId ||
      !/^[A-Za-z0-9_-]{2,50}$/.test(blogId) ||
      !logNo ||
      !/^\d+$/.test(logNo) ||
      (expectedBlog && blogId !== expectedBlog)
    )
      return null;
    return { blogId, logNo, url: `https://blog.naver.com/${blogId}/${logNo}` };
  } catch {
    return null;
  }
}
async function inspectPost(
  context: BrowserContext,
  blogId: string,
  logNo: string,
) {
  const page = await context.newPage();
  try {
    const response = await page.goto(
      `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${logNo}`,
      { waitUntil: "domcontentloaded", timeout: 25_000 },
    );
    if (!response?.ok() || new URL(page.url()).hostname === "nid.naver.com")
      throw new Error("기존 글을 조회할 수 없습니다.");
    const main = page.frame({ name: "mainFrame" }) || page;
    const content = main.locator(".se-main-container, #postViewArea");
    if ((await content.count()) !== 1)
      throw new Error("기존 글 본문을 확인할 수 없습니다.");
    const links = await content
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLAnchorElement).href),
      );
    const text = await content.innerText();
    const sourceUrls = [
      ...new Set(
        [
          ...links,
          ...(text.match(
            /https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/g,
          ) || []),
        ].flatMap((value) => {
          try {
            return [normalizeInstagramUrl(value)];
          } catch {
            return [];
          }
        }),
      ),
    ];
    const images = await content
      .locator("img")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLImageElement).src),
      );
    const hashes: { hash: string; ratio: number }[] = [];
    for (const image of [...new Set(images.filter(isApprovedMediaUrl))]) {
      const bytes = await downloadMedia(image);
      const metadata = await sharp(bytes, {
        limitInputPixels: 25_000_000,
      }).metadata();
      if (metadata.width && metadata.height)
        hashes.push({
          hash: await perceptualHash(bytes),
          ratio: metadata.width / metadata.height,
        });
    }
    return {
      url: `https://blog.naver.com/${blogId}/${logNo}`,
      blogId,
      title: await page.title(),
      sourceUrls,
      hashes,
      text,
      imageCount: hashes.length,
    };
  } finally {
    await page.close();
  }
}
export async function syncHistory(browser: NaverBrowser, blogId: string) {
  // Coverage is invalidated BEFORE the scan, never left falsely complete after a partial failure.
  let scanned = 0;
  let total: number | null = null;
  setSetting("history", {
    complete: false,
    scanned,
    total,
    message: "기존 네이버 글을 비교하고 있습니다.",
    syncedAt: null,
  });
  try {
    await browser.withConnected(async (_page, context) => {
      const posts: { logNo: string }[] = [];
      const pageSize = 30;
      const limit = Number(process.env.HISTORY_MAX_POSTS || 300);
      for (
        let currentPage = 1;
        currentPage <= Math.ceil(limit / pageSize) + 1;
        currentPage++
      ) {
        const response = await context.request.get(
          `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${currentPage}&categoryNo=0&parentCategoryNo=&countPerPage=${pageSize}`,
          { timeout: 25_000 },
        );
        if (!response.ok()) throw new Error("발행 목록을 불러오지 못했습니다.");
        const payload = (await response.json()) as {
          totalCount?: number | string;
          postList?: { logNo?: number | string }[];
        };
        const expected = Number(payload.totalCount);
        if (
          !Number.isSafeInteger(expected) ||
          expected < 0 ||
          !Array.isArray(payload.postList)
        )
          throw new Error(
            "네이버 발행 목록 형식이 변경되어 전체 기록을 확인하지 못했습니다.",
          );
        if (total !== null && expected !== total)
          throw new Error(
            "비교 중 발행 기록이 변경되었습니다. 다시 비교해 주세요.",
          );
        total = expected;
        if (total > limit)
          throw new Error(
            `기존 글이 ${limit}개를 초과해 전체 비교를 완료하지 못했습니다.`,
          );
        for (const row of payload.postList)
          if (/^\d+$/.test(String(row.logNo)))
            posts.push({ logNo: String(row.logNo) });
        if (posts.length >= total) break;
        if (!payload.postList.length)
          throw new Error("기존 글 목록의 일부가 누락되었습니다.");
      }
      const unique = [...new Set(posts.map((post) => post.logNo))];
      if (unique.length !== total)
        throw new Error("기존 글 목록을 전부 확인하지 못했습니다.");
      const inspected: Awaited<ReturnType<typeof inspectPost>>[] = [];
      for (const logNo of unique) {
        inspected.push(await inspectPost(context, blogId, logNo));
        scanned++;
        setSetting("history", {
          complete: false,
          scanned,
          total,
          message: `기존 글 ${scanned}/${total}개 비교 중`,
          syncedAt: null,
        });
      }
      withDatabase((db) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("DELETE FROM history_posts WHERE blog_id = ?").run(blogId);
          const insert = db.prepare(
            "INSERT INTO history_posts VALUES (?,?,?,?,?)",
          );
          for (const post of inspected)
            insert.run(
              post.url,
              blogId,
              JSON.stringify(post.sourceUrls),
              JSON.stringify(post.hashes),
              post.title,
            );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
    });
    setSetting("history", {
      complete: true,
      scanned,
      total,
      message: `기존 글 ${scanned}개 비교 완료`,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    setSetting("history", {
      complete: false,
      scanned,
      total,
      message:
        error instanceof Error
          ? error.message
          : "기존 발행 기록 비교에 실패했습니다.",
      syncedAt: null,
    });
    throw error;
  }
}
export async function verifyPublishedPost(
  browser: NaverBrowser,
  url: string,
  job: {
    blog_id: string;
    draft: { title: string; blocks: { text: string }[] } | null;
  },
  expectedImages: Asset[],
) {
  const parsed = parseNaverPostUrl(url, job.blog_id);
  if (
    !parsed ||
    !job.draft ||
    !job.blog_id ||
    !browser.status().connected ||
    !browser.status().blogs.some((blog) => blog.id === job.blog_id)
  )
    throw new Error("선택한 본인 블로그의 실제 게시물 URL을 입력하세요.");
  return browser.withConnected(async (_page, context) => {
    const post = await inspectPost(context, parsed.blogId, parsed.logNo);
    const title = job.draft!.title.replace(/\s/g, "");
    if (
      !post.title.replace(/\s/g, "").includes(title) ||
      post.imageCount < expectedImages.length
    )
      throw new Error(
        "발행 글의 제목과 사진을 확인하지 못했습니다. 새 글을 다시 발행하지 말고 기존 글을 확인하세요.",
      );
    for (const block of job.draft!.blocks)
      if (
        block.text &&
        !post.text.replace(/\s/g, "").includes(block.text.replace(/\s/g, ""))
      )
        throw new Error(
          "발행 본문이 준비한 초안과 다릅니다. 기존 글을 직접 확인하세요.",
        );
    let photoPosition = 0;
    for (const photo of expectedImages) {
      let matched = false;
      while (photoPosition < post.hashes.length) {
        const candidate = post.hashes[photoPosition++];
        if (
          Math.abs(photo.width / photo.height - candidate.ratio) < 0.05 &&
          Math.min(
            hashDistance(photo.perceptual_hash, candidate.hash),
            photo.upscaled_perceptual_hash
              ? hashDistance(photo.upscaled_perceptual_hash, candidate.hash)
              : 64,
          ) <= 4
        ) {
          matched = true;
          break;
        }
      }
      if (!matched)
        throw new Error(
          "발행된 사진의 내용과 순서를 확인하지 못했습니다. 기존 글을 확인하세요.",
        );
    }
    return parsed.url;
  });
}
