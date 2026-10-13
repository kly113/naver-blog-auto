import type { Page, Frame } from "playwright";
import type { Asset, Job } from "./types.ts";
import { NaverBrowser } from "./browser.ts";
import { parseNaverPostUrl } from "./history.ts";

async function scopeFor(page: Page): Promise<Page | Frame> {
  for (const scope of [
    page,
    ...page.frames().filter((frame) => frame !== page.mainFrame()),
  ])
    if (
      (await scope
        .locator(".se-title-text [contenteditable='true']")
        .count()) === 1
    )
      return scope;
  throw new Error(
    "네이버 편집기 구조를 확인하지 못했습니다. 다운로드한 초안으로 공식 화면에서 직접 완료해 주세요.",
  );
}
export async function fillEditorPage(page: Page, job: Job, assets: Asset[]) {
  if (!job.draft) throw new Error("작성할 초안이 없습니다.");
  const scope = await scopeFor(page);
  const title = scope.locator(".se-title-text [contenteditable='true']");
  const body = scope.locator(".se-component.se-text [contenteditable='true']");
  if (
    (await body.count()) !== 1 ||
    (await title.innerText()).trim() ||
    (await body.innerText()).trim()
  )
    throw new Error("빈 글쓰기 화면이 아닙니다. 기존 글을 덮어쓰지 않습니다.");
  await title.fill(job.draft.title);
  await body.click();
  const center = scope.getByRole("button", { name: /^가운데\s?정렬$/ });
  if ((await center.count()) !== 1)
    throw new Error(
      "가운데 정렬 도구를 확인하지 못했습니다. 공식 편집기에서 직접 선택해 주세요.",
    );
  await center.click();
  await body.click();
  for (const block of job.draft.blocks) {
    if (block.text) {
      await page.keyboard.insertText(block.text);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    }
    if (block.imageIndex !== null) {
      const asset = assets[block.imageIndex];
      if (!asset?.upscaled_path)
        throw new Error("확대 사진을 확인할 수 없습니다.");
      const photoButton = scope.getByRole("button", {
        name: "사진",
        exact: true,
      });
      if ((await photoButton.count()) !== 1)
        throw new Error("사진 삽입 도구를 확인하지 못했습니다.");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 10_000 }),
        photoButton.click(),
      ]);
      await chooser.setFiles(asset.upscaled_path);
      await scope
        .locator(".se-component.se-image")
        .nth(block.imageIndex)
        .waitFor({ state: "visible", timeout: 20_000 });
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    }
  }
  if (job.draft.hashtags.length)
    await page.keyboard.insertText(
      job.draft.hashtags.map((tag) => `#${tag}`).join(" "),
    );
  return { sticker: "manual_required" as const };
}
export async function openEditor(
  browser: NaverBrowser,
  job: Job,
  assets: Asset[],
) {
  browser.reserveEditor(true);
  return browser.withConnected(async (page) => {
    await page.goto(
      `https://blog.naver.com/PostWriteForm.naver?blogId=${encodeURIComponent(job.blog_id)}&categoryNo=${encodeURIComponent(job.category_id)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    if (new URL(page.url()).hostname === "nid.naver.com")
      throw new Error("네이버 로그인과 보안 확인을 완료해 주세요.");
    return fillEditorPage(page, job, assets);
  });
}
export async function clickPublish(
  browser: NaverBrowser,
  job: Job,
): Promise<string | null> {
  return browser.withConnected(async (page) => {
    const scope = await scopeFor(page);
    const button = scope.getByRole("button", { name: "발행", exact: true });
    if ((await button.count()) !== 1)
      throw new Error(
        "발행 도구를 확인하지 못했습니다. 기존 결과를 확인해야 합니다.",
      );
    await button.click();
    const dialog = scope.getByRole("dialog");
    if ((await dialog.count()) !== 1)
      return parseNaverPostUrl(page.url(), job.blog_id)?.url || null;
    const category = dialog.getByRole("combobox", { name: /카테고리/ });
    if ((await category.count()) !== 1)
      throw new Error("발행 카테고리를 검증하지 못했습니다.");
    await category.selectOption(job.category_id);
    const confirm = dialog.getByRole("button", { name: "발행", exact: true });
    if ((await confirm.count()) !== 1)
      throw new Error("최종 발행 화면을 확인하지 못했습니다.");
    await confirm.click();
    await page.waitForURL(
      (url) => Boolean(parseNaverPostUrl(url.href, job.blog_id)),
      { timeout: 20_000 },
    );
    return parseNaverPostUrl(page.url(), job.blog_id)?.url || null;
  });
}
