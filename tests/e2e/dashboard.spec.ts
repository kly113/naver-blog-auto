import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("remote keyboard relay accepts Korean composition and long paste without storing input (UI fixture, not live Naver)", async ({
  page,
}) => {
  const messages: { action: string; text?: string }[] = [];
  const image = await sharp({
    create: { width: 10, height: 8, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        aiConnected: false,
        automaticPublishingEnabled: false,
        saveFromVerified: false,
        stickerVerified: false,
        connection: {
          connected: false,
          browserOpen: true,
          officialUrl: "https://nid.naver.com/nidlogin.login",
          blogs: [],
          selectedBlog: null,
          selectedCategory: null,
          history: {
            complete: false,
            scanned: 0,
            total: null,
            message: "연동 테스트용 화면",
            syncedAt: null,
          },
        },
      },
    }),
  );
  await page.route("**/api/naver/screen?*", (route) =>
    route.fulfill({ contentType: "image/jpeg", body: image }),
  );
  await page.route("**/api/naver/action", async (route) => {
    messages.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByLabel("사이트 접속 비밀번호").fill("e2e-owner-password-only");
  await page.getByRole("button", { name: "내 스튜디오 열기" }).click();
  await page.getByRole("button", { name: "네이버 연결", exact: true }).click();
  const keyboard = page.getByLabel("공식 네이버 화면 키보드 입력");
  await keyboard.focus();
  await keyboard.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    input.value = "한글 머릿결";
    input.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "한글 머릿결",
      }),
    );
  });
  await expect
    .poll(() => messages.some((message) => message.text === "한글 머릿결"))
    .toBe(true);
  const text = "가".repeat(2500);
  await keyboard.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
  await expect
    .poll(() => messages.some((message) => message.text === text))
    .toBe(true);
  expect(await keyboard.inputValue()).toBe("");
  await page.getByRole("button", { name: "사이트 로그아웃" }).click();
});
test("private web + real worker: upload, 2x processing, manual draft, export, duplicate protection and logout", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get("/api/jobs")).status()).toBe(401);
  await page.getByLabel("사이트 접속 비밀번호").fill("e2e-owner-password-only");
  await page.getByRole("button", { name: "내 스튜디오 열기" }).click();
  await expect(
    page.getByRole("heading", { name: "새로운 블로그 이야기" }),
  ).toBeVisible();
  await expect(page.getByLabel(/자동 발행을 명시적으로/)).toBeDisabled();
  const first = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 3,
      background: { r: 100, g: 70, b: 40 },
    },
  })
    .png()
    .toBuffer();
  const second = await sharp({
    create: {
      width: 10,
      height: 8,
      channels: 3,
      background: { r: 20, g: 100, b: 80 },
    },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("인스타그램 URL", { exact: true })
    .fill("https://instagram.com/p/OWNED_E2E/?utm_source=copy");
  await page.getByLabel(/원본 사진 직접 업로드/).setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: first },
    { name: "second.png", mimeType: "image/png", buffer: second },
  ]);
  await page
    .getByLabel("인스타그램 본문 또는 사진 설명")
    .fill("사진으로 확인한 기록입니다. 확인하지 않은 시술 정보는 없습니다.");
  await page.getByLabel(/제가 소유하거나 사용 허락/).check();
  await page.getByRole("button", { name: "자동화 시작", exact: true }).click();
  await expect(
    page.getByText("16 × 12 · 2배 확대", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("20 × 16 · 2배 확대", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "작성된 글 미리보기" }),
  ).toBeVisible();
  await page.getByLabel("글 제목").fill("확인한 스타일 사진 기록");
  await page.getByLabel("관련 해시태그").fill("스타일 사진기록");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page
      .locator(".blog-preview")
      .getByRole("heading", { name: "확인한 스타일 사진 기록" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".blog-preview")
      .evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe("center");
  await expect(page.locator(".blog-preview img")).toHaveCount(2);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "본문과 확대 사진 다운로드" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^blog-.*\.zip$/);
  const cookie = (await context.cookies()).find(
    (cookie) => cookie.name === "blog_owner_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect(
    (
      await context.request.post("/api/jobs", {
        headers: { origin: "https://evil.test" },
        data: "{}",
      })
    ).status(),
  ).toBe(403);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "확인한 스타일 사진 기록", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "확인한 스타일 사진 기록", exact: true })
    .click();
  await expect(
    page
      .locator(".blog-preview")
      .getByRole("heading", { name: "확인한 스타일 사진 기록" }),
  ).toBeVisible();
  await page
    .getByLabel("인스타그램 URL", { exact: true })
    .fill("https://www.instagram.com/p/OWNED_E2E/");
  await page.getByLabel(/제가 소유하거나 사용 허락/).check();
  await page.getByRole("button", { name: "자동화 시작", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "이미 등록되었거나" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "사이트 로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get("/api/jobs")).status()).toBe(401);
});
