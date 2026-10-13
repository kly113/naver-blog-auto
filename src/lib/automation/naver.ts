import { chromium, type BrowserContext } from "playwright";

/** Browser foundation only. Does not log in, fetch categories, or publish. */
export async function createNaverBrowser(): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
    context.on("close", () => { void browser.close(); });
    return context;
  } catch (error) { await browser.close(); throw error; }
}
