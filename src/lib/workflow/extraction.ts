import { chromium } from "playwright";
import { isApprovedMediaUrl, downloadMedia } from "./network.ts";
import { normalizeInstagramUrl } from "../validation.ts";
import { browserProxy } from "../automation/proxy.ts";

export type ExtractedPhoto = { name: string; bytes: Buffer };
export type Extraction = {
  photos: ExtractedPhoto[];
  caption: string;
  source: "savefrom";
  completenessVerified: boolean;
};
export async function extractInstagram(inputUrl: string): Promise<Extraction> {
  const url = normalizeInstagramUrl(inputUrl);
  const browser = await chromium.launch({
    headless: true,
    proxy: browserProxy(),
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({ acceptDownloads: false });
  try {
    await context.route("**/*", async (route) => {
      const parsed = new URL(route.request().url());
      const allowed =
        parsed.protocol === "https:" &&
        [
          "savefrom.net",
          "sfstatic.net",
          "instagram.com",
          "cdninstagram.com",
          "fbcdn.net",
        ].some(
          (host) =>
            parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
        );
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const response = await page.goto(
      "https://ko.savefrom.net/137kq/download-from-instagram",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    if (!response?.ok())
      throw new Error(
        "SaveFrom에 접속할 수 없습니다. 원본 사진을 직접 업로드해 주세요.",
      );
    const body = (await page.locator("body").innerText()).toLowerCase();
    if (/captcha|verify you are human|checking your browser/.test(body))
      throw new Error(
        "다운로드 서비스에서 보안 확인을 요청했습니다. 우회하지 않고 사진 업로드로 전환합니다.",
      );
    const input = page.locator(
      "#sf_url, input[name='sf_url'], input[type='url']",
    );
    if ((await input.count()) !== 1)
      throw new Error(
        "SaveFrom 입력 화면을 확인하지 못했습니다. 사진을 직접 업로드해 주세요.",
      );
    await input.fill(url);
    const submit = page.locator("#sf_submit, button[type='submit']");
    if ((await submit.count()) !== 1)
      throw new Error("다운로드 시작 버튼을 안전하게 확인하지 못했습니다.");
    await submit.click();
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll("a[href]")).some((element) => {
            try {
              const url = new URL((element as HTMLAnchorElement).href);
              return /\.(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname);
            } catch {
              return false;
            }
          }),
        {},
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(
          "사진 추출 결과를 확인하지 못했습니다. 모든 원본 사진을 직접 업로드해 주세요.",
        );
      });
    const links = await page
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLAnchorElement).href),
      );
    const candidates = [...new Set(links.filter(isApprovedMediaUrl))];
    if (!candidates.length || candidates.length > 20)
      throw new Error(
        "전체 사진을 안전하게 추출하지 못했습니다. 최대 20장의 원본 사진을 업로드해 주세요.",
      );
    const photos: ExtractedPhoto[] = [];
    for (const [index, link] of candidates.entries())
      photos.push({
        name: `instagram-${index + 1}.jpg`,
        bytes: await downloadMedia(link),
      });
    let caption = "";
    const instagramPage = await context.newPage();
    await instagramPage
      .goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .then(async (response) => {
        if (
          !response?.ok() ||
          normalizeInstagramUrl(instagramPage.url()) !== url
        )
          return;
        const canonical = await instagramPage
          .locator("meta[property='og:url']")
          .getAttribute("content");
        if (!canonical || normalizeInstagramUrl(canonical) !== url) return;
        caption =
          (await instagramPage
            .locator("meta[property='og:description']")
            .getAttribute("content")) || "";
      })
      .catch(() => {});
    // The service's full carousel count is not reliably exposed. Require owner confirmation.
    return {
      photos,
      caption: caption.slice(0, 8000),
      source: "savefrom",
      completenessVerified: false,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
